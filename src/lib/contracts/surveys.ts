/**
 * Surveys contract interaction.
 *
 * Reads go through the `ReviveApi.call` runtime API (no signing, no fees) with
 * a known-mapped origin. Writes go through `Revive.call` extrinsics signed by
 * the host product-account signer, watched with an inclusion oracle because the
 * host-bridge transport doesn't reliably surface `txBestBlocksState` events.
 *
 * ABI encode/decode is done with ethers; the chain only sees raw calldata.
 */

import { ethers } from "ethers";
import { Binary } from "polkadot-api";
import type { PolkadotSigner } from "polkadot-api";
import { getSurveysAddress, getSurveysInterface } from "./config.ts";
import { getAPI } from "./chain.ts";
import { claimDefaultAllowances } from "../host/allowances.ts";
import { watchTx, type WatchableTx } from "../tx/submit.ts";

// ABI + address come from cdm.json (single source of truth, rewritten by
// `cdm deploy`). Resolved lazily + cached so importing this module before the
// first deploy doesn't throw.
let _iface: ethers.Interface | null = null;
function iface(): ethers.Interface {
    if (!_iface) _iface = getSurveysInterface();
    return _iface;
}

// Alice on Paseo — always mapped. `ReviveApi.call` requires a mapped origin
// even for pure view functions, and view results don't depend on the caller.
const READ_ORIGIN = "5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY";

// Generous limits — view + small-payload writes. Mirrors t3rminal.
const WEIGHT_LIMIT = { ref_time: 50_000_000_000n, proof_size: 1_000_000n };
const STORAGE_DEPOSIT_LIMIT = 10_000_000_000n;

// ---------------------------------------------------------------------------
// Low-level read/write
// ---------------------------------------------------------------------------

async function readContract(functionName: string, args: unknown[]): Promise<ethers.Result> {
    const calldata = iface().encodeFunctionData(functionName, args);
    const client = await getAPI();

    const result = await client.assetHub.apis.ReviveApi.call(
        READ_ORIGIN,
        getSurveysAddress(),
        0n,
        undefined, // gas_limit
        undefined, // storage_deposit_limit
        Binary.fromHex(calldata as `0x${string}`),
    );

    if (result.result.success) {
        const hex = Binary.toHex(result.result.value.data);
        return iface().decodeFunctionResult(functionName, hex);
    }
    throw new Error(`Contract call ${functionName} failed: ${JSON.stringify(result.result.value)}`);
}

type WatchableShim = {
    decodedCall: unknown;
    signSubmitAndWatch: WatchableTx["signSubmitAndWatch"];
};
type ReviveTxShim = {
    call(args: {
        dest: string;
        value: bigint;
        weight_limit: { ref_time: bigint; proof_size: bigint };
        storage_deposit_limit: bigint;
        data: Uint8Array;
    }): WatchableShim;
    map_account(): WatchableShim;
};

/** Resolve the on-chain H160 for an SS58 account, or null if not mapped. */
export async function getMappedH160(ss58: string): Promise<`0x${string}` | null> {
    const client = await getAPI();
    const unsafeApi = client.raw.assetHub.getUnsafeApi();
    try {
        const reviveApi = (unsafeApi.apis as unknown as {
            ReviveApi?: { address(ss58: string): Promise<string | null> };
        }).ReviveApi;
        const h160 = await reviveApi?.address(ss58);
        if (!h160) return null;
        const original = await (unsafeApi.query as unknown as {
            Revive?: { OriginalAccount?: { getValue(h: string): Promise<unknown> } };
        }).Revive?.OriginalAccount?.getValue(h160);
        return original != null ? (h160 as `0x${string}`) : null;
    } catch (err) {
        console.warn("[surveys] H160 mapping probe failed:", err);
        return null;
    }
}

/**
 * Encode + submit a state-changing contract method as a `Revive.call`
 * extrinsic. Ensures allowances + account mapping first.
 */
async function writeContract(
    functionName: string,
    args: unknown[],
    origin: string,
    signer: PolkadotSigner,
    inclusionOracle?: () => Promise<boolean>,
): Promise<`0x${string}`> {
    // `SmartContractAllowance(0)` is the critical grant — without it AsPgas
    // rejects every signed Revive.call with BadProof. Idempotent + cached.
    await claimDefaultAllowances();

    const calldata = iface().encodeFunctionData(functionName, args);
    const client = await getAPI();
    await client.raw.assetHub.getBestBlocks();
    const dest = getSurveysAddress();

    const unsafeApi = client.raw.assetHub.getUnsafeApi();
    const reviveTx = unsafeApi.tx.Revive as unknown as ReviveTxShim;

    // Map the product account on first use — Revive.call needs a mapped origin.
    const mapped = await getMappedH160(origin);
    if (!mapped) {
        console.log("[surveys] account unmapped → Revive.map_account");
        try {
            await watchTx(reviveTx.map_account(), signer, { label: "map_account" });
            console.log("[surveys] ✓ map_account confirmed");
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            if (!/AccountAlreadyMapped/i.test(message)) throw e;
            console.log("[surveys] map_account: already mapped (race), continuing");
        }
    }

    console.log(`[surveys] → Revive.call ${functionName} → ${dest} (awaiting signature)…`);
    const tx = reviveTx.call({
        dest,
        value: 0n,
        weight_limit: WEIGHT_LIMIT,
        storage_deposit_limit: STORAGE_DEPOSIT_LIMIT,
        data: Binary.fromHex(calldata as `0x${string}`) as unknown as Uint8Array,
    });

    const blockHash = await watchTx(tx, signer, { inclusionOracle, label: `Revive.call ${functionName}` });
    console.log(`[surveys] ✓ ${functionName} confirmed (block ${blockHash.slice(0, 12)}…)`);
    return blockHash;
}

// ---------------------------------------------------------------------------
// Public read API
// ---------------------------------------------------------------------------

export async function getSurveyCount(): Promise<number> {
    const [count] = await readContract("getSurveyCount", []);
    return Number(count);
}

export async function getSurveyCid(surveyId: number): Promise<string> {
    const [cid] = await readContract("getSurveyCid", [surveyId]);
    return cid as string;
}

export async function getSurveyCreator(surveyId: number): Promise<string> {
    const [creator] = await readContract("getSurveyCreator", [surveyId]);
    return creator as string; // 0x-prefixed 20-byte hex
}

export async function getResponseCount(surveyId: number): Promise<number> {
    const [count] = await readContract("getResponseCount", [surveyId]);
    return Number(count);
}

export async function getResponseCid(surveyId: number, index: number): Promise<string> {
    const [cid] = await readContract("getResponseCid", [surveyId, index]);
    return cid as string;
}

export async function hasResponded(surveyId: number, userH160: string): Promise<boolean> {
    const [responded] = await readContract("hasResponded", [surveyId, userH160]);
    return Boolean(responded);
}

// ---------------------------------------------------------------------------
// Public write API
// ---------------------------------------------------------------------------

/** Create a survey from its Bulletin CID. Returns the on-chain survey id. */
export async function createSurvey(
    cid: string,
    origin: string,
    signer: PolkadotSigner,
): Promise<number> {
    const baseline = await getSurveyCount().catch(() => 0);
    await writeContract("createSurvey", [cid], origin, signer, async () => {
        try {
            return (await getSurveyCount()) > baseline;
        } catch {
            return false;
        }
    });
    return baseline; // the new survey's id is the previous count
}

/** Submit a response (Bulletin CID) to a survey. */
export async function submitResponse(
    surveyId: number,
    responseCid: string,
    origin: string,
    signer: PolkadotSigner,
): Promise<void> {
    const baseline = await getResponseCount(surveyId).catch(() => 0);
    await writeContract("submitResponse", [surveyId, responseCid], origin, signer, async () => {
        try {
            return (await getResponseCount(surveyId)) > baseline;
        } catch {
            return false;
        }
    });
}
