import {
    useState, useEffect, useMemo, useCallback, useRef, type ReactNode,
} from "react";
import { createCdm } from "@dotdm/cdm";
import { FixedSizeBinary } from "polkadot-api";
import {
    ACCOUNTS, deriveWallet, short, publishBlob, IPFS_GATEWAY,
    type Wallet,
} from "./utils.ts";
import type { SurveyData, ResponseData, SurveyListItem, Question } from "./types.ts";
import cdmJson from "../cdm.json";

// ---------------------------------------------------------------------------
// CDM — one connection for the lifetime of the page
// ---------------------------------------------------------------------------

const cdm = createCdm(cdmJson);
const sv = cdm.getContract("@example/surveys");

const toBytes = (hex: string) => FixedSizeBinary.fromHex(hex);

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
    const [accountIdx, setAccountIdx] = useState(0);
    const wallet = useMemo<Wallet>(() => deriveWallet(ACCOUNTS[accountIdx].mnemonic), [accountIdx]);
    const me = ACCOUNTS[accountIdx].ethAddress;

    useEffect(() => {
        cdm.setDefaults({ origin: wallet.address, signer: wallet.signer });
    }, [wallet]);

    const [view, setView] = useState<
        | { page: "list" }
        | { page: "fill"; surveyId: number }
        | { page: "results"; surveyId: number }
    >({ page: "list" });

    const [refreshKey, setRefreshKey] = useState(0);
    const refresh = () => setRefreshKey(k => k + 1);

    return (
        <>
            <header>
                <h1>Surveys</h1>
                <select
                    className="account-select"
                    value={accountIdx}
                    onChange={e => setAccountIdx(Number(e.target.value))}
                >
                    {ACCOUNTS.map((a, i) => <option key={i} value={i}>{a.name}</option>)}
                </select>
            </header>

            {view.page !== "list" && (
                <button className="back-btn" onClick={() => setView({ page: "list" })}>
                    &larr; Back to surveys
                </button>
            )}

            {view.page === "list" && (
                <SurveyList
                    key={refreshKey}
                    onFill={id => setView({ page: "fill", surveyId: id })}
                    onResults={id => setView({ page: "results", surveyId: id })}
                />
            )}

            {view.page === "fill" && (
                <FillSurvey
                    surveyId={view.surveyId}
                    wallet={wallet}
                    me={me}
                    onDone={() => { refresh(); setView({ page: "list" }); }}
                />
            )}

            {view.page === "results" && (
                <SurveyResults surveyId={view.surveyId} />
            )}

            {view.page === "list" && (
                <CreateSurvey wallet={wallet} onCreated={refresh} />
            )}
        </>
    );
}

// ---------------------------------------------------------------------------
// Survey List
// ---------------------------------------------------------------------------

function SurveyList({ onFill, onResults }: {
    onFill: (id: number) => void;
    onResults: (id: number) => void;
}) {
    const [surveys, setSurveys] = useState<SurveyListItem[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                console.log("[SurveyList] Querying contract for survey count...");
                const countRes = await sv.getSurveyCount.query();
                if (!countRes.success || cancelled) return;
                const count = Number(countRes.value);
                console.log("[SurveyList] Total surveys on-chain:", count);

                const items: SurveyListItem[] = [];
                for (let i = count - 1; i >= 0; i--) {
                    if (cancelled) return;
                    console.log("[SurveyList] Fetching survey #%d from contract...", i);
                    const [cidRes, creatorRes, respRes] = await Promise.all([
                        sv.getSurveyCid.query(BigInt(i)),
                        sv.getSurveyCreator.query(BigInt(i)),
                        sv.getResponseCount.query(BigInt(i)),
                    ]);

                    const cid = cidRes.success ? cidRes.value : "";
                    const creator = creatorRes.success
                        ? "0x" + [...creatorRes.value.asBytes()].map((b: number) => b.toString(16).padStart(2, "0")).join("")
                        : "";
                    const responseCount = respRes.success ? Number(respRes.value) : 0;
                    console.log("[SurveyList] Survey #%d — CID: %s, creator: %s, responses: %d", i, cid, short(creator), responseCount);

                    const item: SurveyListItem = { id: i, cid, creator, responseCount };

                    // Fetch survey data from Bulletin
                    if (cid) {
                        try {
                            console.log("[SurveyList] Fetching survey #%d data from Bulletin: %s", i, IPFS_GATEWAY + cid);
                            const resp = await fetch(IPFS_GATEWAY + cid);
                            if (resp.ok) {
                                item.data = await resp.json();
                                console.log("[SurveyList] Survey #%d data loaded: \"%s\"", i, item.data?.title);
                            }
                        } catch { /* gateway might be slow */ }
                    }

                    items.push(item);
                }

                if (!cancelled) setSurveys(items);
            } catch (err) {
                console.error("Failed to load surveys:", err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    if (loading) return <div className="spinner">Loading surveys...</div>;
    if (surveys.length === 0) {
        return <div className="empty">No surveys yet.<br />Create the first one!</div>;
    }

    return (
        <div>
            {surveys.map(s => (
                <div key={s.id} className="survey-card">
                    <div className="survey-card-header">
                        <div className="survey-card-title">
                            {s.data?.title ?? `Survey #${s.id}`}
                        </div>
                        <div className="survey-card-meta">#{s.id}</div>
                    </div>
                    {s.data?.description && (
                        <div className="survey-card-desc">{s.data.description}</div>
                    )}
                    <div className="survey-card-footer">
                        <span className="badge">
                            {s.data?.questions.length ?? "?"} questions
                        </span>
                        <span className="badge">
                            {s.responseCount} responses
                        </span>
                        <span className="badge">by {short(s.creator)}</span>
                    </div>
                    <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                        <button className="btn btn-primary btn-sm" onClick={() => onFill(s.id)}>
                            Fill
                        </button>
                        <button className="btn btn-ghost btn-sm" onClick={() => onResults(s.id)}>
                            Results
                        </button>
                    </div>
                </div>
            ))}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Fill Survey
// ---------------------------------------------------------------------------

function FillSurvey({ surveyId, wallet, me, onDone }: {
    surveyId: number;
    wallet: Wallet;
    me: string;
    onDone: () => void;
}) {
    const [survey, setSurvey] = useState<SurveyData | null>(null);
    const [answers, setAnswers] = useState<number[]>([]);
    const [alreadyResponded, setAlreadyResponded] = useState(false);
    const [loading, setLoading] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const [status, setStatus] = useState("");

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                // Check if already responded
                const hasRes = await sv.hasResponded.query(BigInt(surveyId), toBytes(me));
                if (!cancelled && hasRes.success && hasRes.value) {
                    setAlreadyResponded(true);
                }

                // Fetch survey data
                const cidRes = await sv.getSurveyCid.query(BigInt(surveyId));
                if (!cidRes.success || cancelled) return;

                const resp = await fetch(IPFS_GATEWAY + cidRes.value);
                if (!resp.ok || cancelled) return;

                const data: SurveyData = await resp.json();
                setSurvey(data);
                setAnswers(new Array(data.questions.length).fill(-1));
            } catch (err) {
                console.error("Failed to load survey:", err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [surveyId, me]);

    const selectOption = (qIdx: number, oIdx: number) => {
        setAnswers(prev => {
            const next = [...prev];
            next[qIdx] = oIdx;
            return next;
        });
    };

    const allAnswered = answers.length > 0 && answers.every(a => a >= 0);

    const submit = async () => {
        if (!allAnswered || submitting) return;
        setSubmitting(true);
        try {
            const responseData: ResponseData = {
                surveyId,
                answers,
                respondedAt: Math.floor(Date.now() / 1000),
            };

            console.log("[FillSurvey] Response data:", responseData);

            setStatus("Uploading response to Bulletin...");
            const bytes = new TextEncoder().encode(JSON.stringify(responseData));
            console.log("[FillSurvey] Uploading response to Bulletin Chain (%d bytes)...", bytes.length);
            const responseCid = await publishBlob(bytes, wallet.signer);
            console.log("[FillSurvey] Bulletin upload complete. Response CID:", responseCid);
            console.log("[FillSurvey] Gateway URL:", IPFS_GATEWAY + responseCid);

            setStatus("Submitting response on-chain...");
            console.log("[FillSurvey] Calling contract submitResponse(surveyId=%d, cid=%s)...", surveyId, responseCid);
            const txResult = await sv.submitResponse.tx(BigInt(surveyId), responseCid);
            console.log("[FillSurvey] Contract tx result:", txResult);
            console.log("[FillSurvey] Response submitted successfully!");

            onDone();
        } catch (err) {
            console.error("Submit response error:", err);
            setStatus("Failed — check console");
        } finally {
            setSubmitting(false);
        }
    };

    if (loading) return <div className="spinner">Loading survey...</div>;
    if (!survey) return <div className="empty">Survey not found.</div>;

    if (alreadyResponded) {
        return <div className="already-responded">You have already responded to this survey.</div>;
    }

    return (
        <div className="survey-fill">
            <h2>{survey.title}</h2>
            {survey.description && <p className="survey-fill-desc">{survey.description}</p>}

            {survey.questions.map((q, qi) => (
                <div key={qi} className="question-block">
                    <div className="question-text">{qi + 1}. {q.text}</div>
                    {q.options.map((opt, oi) => (
                        <label
                            key={oi}
                            className={`option-label ${answers[qi] === oi ? "selected" : ""}`}
                            onClick={() => selectOption(qi, oi)}
                        >
                            <input type="radio" name={`q-${qi}`} checked={answers[qi] === oi} readOnly />
                            <span className="radio-dot" />
                            {opt}
                        </label>
                    ))}
                </div>
            ))}

            {status && <div className="status">{status}</div>}

            <button
                className="btn btn-primary"
                style={{ width: "100%" }}
                onClick={submit}
                disabled={!allAnswered || submitting}
            >
                {submitting ? "Submitting..." : "Submit Response"}
            </button>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Survey Results
// ---------------------------------------------------------------------------

function SurveyResults({ surveyId }: { surveyId: number }) {
    const [survey, setSurvey] = useState<SurveyData | null>(null);
    const [tallies, setTallies] = useState<number[][] | null>(null);
    const [totalResponses, setTotalResponses] = useState(0);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                // Fetch survey data
                console.log("[Results] Querying contract for survey #%d CID...", surveyId);
                const cidRes = await sv.getSurveyCid.query(BigInt(surveyId));
                if (!cidRes.success || cancelled) return;
                console.log("[Results] Survey CID:", cidRes.value);

                console.log("[Results] Fetching survey data from Bulletin: %s", IPFS_GATEWAY + cidRes.value);
                const resp = await fetch(IPFS_GATEWAY + cidRes.value);
                if (!resp.ok || cancelled) return;
                const data: SurveyData = await resp.json();
                console.log("[Results] Survey data loaded:", data.title);
                setSurvey(data);

                // Fetch response count
                console.log("[Results] Querying contract for response count...");
                const countRes = await sv.getResponseCount.query(BigInt(surveyId));
                if (!countRes.success || cancelled) return;
                const count = Number(countRes.value);
                console.log("[Results] Total responses on-chain:", count);
                setTotalResponses(count);

                // Initialize tallies: [question][option] = count
                const t: number[][] = data.questions.map(q => new Array(q.options.length).fill(0));

                // Fetch all responses and aggregate
                for (let i = 0; i < count; i++) {
                    if (cancelled) return;
                    console.log("[Results] Fetching response #%d CID from contract...", i);
                    const rCidRes = await sv.getResponseCid.query(BigInt(surveyId), BigInt(i));
                    if (!rCidRes.success) continue;
                    console.log("[Results] Response #%d CID:", i, rCidRes.value);

                    try {
                        console.log("[Results] Fetching response #%d data from Bulletin: %s", i, IPFS_GATEWAY + rCidRes.value);
                        const rResp = await fetch(IPFS_GATEWAY + rCidRes.value);
                        if (!rResp.ok) continue;
                        const rData: ResponseData = await rResp.json();
                        console.log("[Results] Response #%d answers:", i, rData.answers);

                        rData.answers.forEach((optIdx, qIdx) => {
                            if (qIdx < t.length && optIdx >= 0 && optIdx < t[qIdx].length) {
                                t[qIdx][optIdx]++;
                            }
                        });
                    } catch { /* skip malformed responses */ }
                }

                console.log("[Results] Final tallies:", t);
                if (!cancelled) setTallies(t);
            } catch (err) {
                console.error("Failed to load results:", err);
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [surveyId]);

    if (loading) return <div className="spinner">Loading results...</div>;
    if (!survey || !tallies) return <div className="empty">No results available.</div>;

    return (
        <div className="results">
            <h2>{survey.title}</h2>
            <div style={{ fontSize: 13, color: "var(--text2)", marginBottom: 16 }}>
                {totalResponses} response{totalResponses !== 1 ? "s" : ""}
            </div>

            {survey.questions.map((q, qi) => {
                const questionTotal = tallies[qi].reduce((a, b) => a + b, 0);
                return (
                    <div key={qi} className="results-question">
                        <div className="results-question-text">{qi + 1}. {q.text}</div>
                        {q.options.map((opt, oi) => {
                            const count = tallies[qi][oi];
                            const pct = questionTotal > 0 ? Math.round((count / questionTotal) * 100) : 0;
                            return (
                                <div key={oi} className="result-bar">
                                    <div className="result-label">{opt}</div>
                                    <div className="result-track">
                                        <div className="result-fill" style={{ width: `${pct}%` }} />
                                    </div>
                                    <div className="result-pct">{pct}%</div>
                                </div>
                            );
                        })}
                        <div className="result-count">{questionTotal} votes</div>
                    </div>
                );
            })}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Create Survey (FAB + modal)
// ---------------------------------------------------------------------------

interface QuestionDraft {
    text: string;
    options: string[];
}

function CreateSurvey({ wallet, onCreated }: { wallet: Wallet; onCreated: () => void }) {
    const [open, setOpen] = useState(false);
    const [title, setTitle] = useState("");
    const [description, setDescription] = useState("");
    const [questions, setQuestions] = useState<QuestionDraft[]>([
        { text: "", options: ["", ""] },
    ]);
    const [status, setStatus] = useState("");
    const [busy, setBusy] = useState(false);

    const updateQuestion = (qi: number, text: string) => {
        setQuestions(prev => {
            const next = [...prev];
            next[qi] = { ...next[qi], text };
            return next;
        });
    };

    const updateOption = (qi: number, oi: number, value: string) => {
        setQuestions(prev => {
            const next = [...prev];
            const opts = [...next[qi].options];
            opts[oi] = value;
            next[qi] = { ...next[qi], options: opts };
            return next;
        });
    };

    const addOption = (qi: number) => {
        setQuestions(prev => {
            const next = [...prev];
            next[qi] = { ...next[qi], options: [...next[qi].options, ""] };
            return next;
        });
    };

    const removeOption = (qi: number, oi: number) => {
        setQuestions(prev => {
            const next = [...prev];
            if (next[qi].options.length <= 2) return prev;
            const opts = next[qi].options.filter((_, i) => i !== oi);
            next[qi] = { ...next[qi], options: opts };
            return next;
        });
    };

    const addQuestion = () => {
        setQuestions(prev => [...prev, { text: "", options: ["", ""] }]);
    };

    const removeQuestion = (qi: number) => {
        if (questions.length <= 1) return;
        setQuestions(prev => prev.filter((_, i) => i !== qi));
    };

    const isValid = title.trim() &&
        questions.every(q => q.text.trim() && q.options.every(o => o.trim()) && q.options.length >= 2);

    const reset = () => {
        setTitle("");
        setDescription("");
        setQuestions([{ text: "", options: ["", ""] }]);
        setStatus("");
    };

    const submit = async () => {
        if (!isValid || busy) return;
        setBusy(true);
        try {
            const surveyData: SurveyData = {
                title: title.trim(),
                description: description.trim(),
                questions: questions.map(q => ({
                    text: q.text.trim(),
                    options: q.options.map(o => o.trim()),
                })),
                createdAt: Math.floor(Date.now() / 1000),
            };

            console.log("[CreateSurvey] Survey data:", surveyData);

            setStatus("Uploading survey to Bulletin...");
            const bytes = new TextEncoder().encode(JSON.stringify(surveyData));
            console.log("[CreateSurvey] Uploading to Bulletin Chain (%d bytes)...", bytes.length);
            const cid = await publishBlob(bytes, wallet.signer);
            console.log("[CreateSurvey] Bulletin upload complete. CID:", cid);
            console.log("[CreateSurvey] Gateway URL:", IPFS_GATEWAY + cid);

            setStatus("Creating survey on-chain...");
            console.log("[CreateSurvey] Calling contract createSurvey(cid=%s)...", cid);
            const txResult = await sv.createSurvey.tx(cid);
            console.log("[CreateSurvey] Contract tx result:", txResult);
            console.log("[CreateSurvey] Survey created successfully!");

            reset();
            setOpen(false);
            onCreated();
        } catch (err) {
            console.error("Create survey error:", err);
            setStatus("Failed — check console");
        } finally {
            setBusy(false);
        }
    };

    return (
        <>
            <button className="fab" onClick={() => setOpen(true)}>+</button>
            {open && (
                <div className="modal-overlay" onClick={() => !busy && setOpen(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <h2>New Survey</h2>

                        <input
                            type="text"
                            placeholder="Survey title"
                            value={title}
                            onChange={e => setTitle(e.target.value)}
                        />
                        <textarea
                            rows={2}
                            placeholder="Description (optional)"
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                        />

                        {questions.map((q, qi) => (
                            <div key={qi} className="question-builder">
                                <div className="question-builder-header">
                                    <span>Question {qi + 1}</span>
                                    {questions.length > 1 && (
                                        <button
                                            className="remove-btn"
                                            onClick={() => removeQuestion(qi)}
                                        >
                                            &times;
                                        </button>
                                    )}
                                </div>
                                <input
                                    type="text"
                                    placeholder="Question text"
                                    value={q.text}
                                    onChange={e => updateQuestion(qi, e.target.value)}
                                />
                                {q.options.map((opt, oi) => (
                                    <div key={oi} className="option-row">
                                        <input
                                            type="text"
                                            placeholder={`Option ${oi + 1}`}
                                            value={opt}
                                            onChange={e => updateOption(qi, oi, e.target.value)}
                                        />
                                        {q.options.length > 2 && (
                                            <button
                                                className="remove-btn"
                                                onClick={() => removeOption(qi, oi)}
                                            >
                                                &times;
                                            </button>
                                        )}
                                    </div>
                                ))}
                                <button className="add-option-btn" onClick={() => addOption(qi)}>
                                    + Add option
                                </button>
                            </div>
                        ))}

                        <button className="add-question-btn" onClick={addQuestion}>
                            + Add question
                        </button>

                        {status && <div className="status">{status}</div>}

                        <div className="modal-actions">
                            <button
                                className="btn btn-ghost"
                                onClick={() => { reset(); setOpen(false); }}
                                disabled={busy}
                            >
                                Cancel
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={submit}
                                disabled={busy || !isValid}
                            >
                                {busy ? "Creating..." : "Create Survey"}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
