/**
 * Transaction watcher.
 *
 * `signSubmitAndWatch` with a dual resolution path:
 *   - PAPI `txBestBlocksState.found` fires → resolve (happy path).
 *   - An optional inclusion oracle returns true → resolve. This is the
 *     workaround for the host-bridge transport, whose `chainHead_v1_follow`
 *     does not reliably deliver `txBestBlocksState` events to PAPI: the tx
 *     lands on-chain but the watcher would otherwise hang. Polling a state
 *     read (e.g. "did my CID appear?") detects inclusion independently.
 *
 * A stall watchdog rejects if NEITHER path settles within the timeout.
 */

import type { PolkadotSigner } from "polkadot-api";

export interface WatchableTx {
    signSubmitAndWatch(
        signer: PolkadotSigner,
        opts?: unknown,
    ): {
        subscribe(observer: {
            next(ev: unknown): void;
            error(e: unknown): void;
        }): { unsubscribe(): void };
    };
}

export interface WatchOptions {
    /** Mortality period in blocks (default 256). */
    mortalityPeriod?: number;
    /** Stall timeout in ms after broadcast (default 120_000). */
    stallTimeoutMs?: number;
    /** Optional state-read probe; resolves the tx when it returns true. */
    inclusionOracle?: () => Promise<boolean>;
    /** Label for logging. */
    label?: string;
}

const POLL_INTERVAL_MS = 1500;

export function watchTx(
    tx: WatchableTx,
    signer: PolkadotSigner,
    options: WatchOptions = {},
): Promise<`0x${string}`> {
    const label = options.label ?? "tx";
    const stallTimeoutMs = options.stallTimeoutMs ?? 120_000;
    const mortalityPeriod = options.mortalityPeriod ?? 256;
    const inclusionOracle = options.inclusionOracle;
    const submitOpts = { mortality: { mortal: true as const, period: mortalityPeriod } };

    return new Promise<`0x${string}`>((resolve, reject) => {
        let settled = false;
        let pollLoopStopped = false;
        let broadcastedHash: `0x${string}` | undefined;
        let stallTimer: ReturnType<typeof setTimeout> | undefined;

        const clearStall = () => {
            if (stallTimer) {
                clearTimeout(stallTimer);
                stallTimer = undefined;
            }
        };
        const armStall = () => {
            clearStall();
            stallTimer = setTimeout(() => {
                if (settled) return;
                settled = true;
                pollLoopStopped = true;
                try { sub.unsubscribe(); } catch { /* noop */ }
                reject(new Error(`[${label}] stalled: no inclusion within ${stallTimeoutMs}ms of broadcast`));
            }, stallTimeoutMs);
        };
        const succeed = (hash: `0x${string}`) => {
            if (settled) return;
            settled = true;
            pollLoopStopped = true;
            clearStall();
            resolve(hash);
        };
        const fail = (err: Error) => {
            if (settled) return;
            settled = true;
            pollLoopStopped = true;
            clearStall();
            try { sub.unsubscribe(); } catch { /* noop */ }
            reject(err);
        };

        const sub = tx.signSubmitAndWatch(signer, submitOpts).subscribe({
            next(ev: unknown) {
                const e = ev as {
                    type?: string;
                    found?: boolean;
                    ok?: boolean;
                    dispatchError?: unknown;
                    txHash?: string;
                    block?: { hash: string; number: number };
                };
                if (e.type === "signed") {
                    console.log(`[${label}] signed (txHash=${e.txHash?.slice(0, 12)}…)`);
                }
                if (e.type === "broadcasted") {
                    broadcastedHash = e.txHash as `0x${string}` | undefined;
                    console.log(`[${label}] broadcasted, arming inclusion watchdog (${stallTimeoutMs}ms)`);
                    armStall();
                    if (inclusionOracle) {
                        void (async () => {
                            await Promise.resolve();
                            while (!pollLoopStopped && !settled) {
                                try {
                                    if (await inclusionOracle()) {
                                        console.log(`[${label}] inclusion oracle: landed (state read confirms effect)`);
                                        if (broadcastedHash) succeed(broadcastedHash);
                                        return;
                                    }
                                    armStall();
                                } catch (err) {
                                    console.warn(`[${label}] inclusion oracle threw:`, err);
                                }
                                await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
                            }
                        })();
                    }
                }
                if (e.type === "txBestBlocksState" && e.found) {
                    armStall();
                    if (e.ok === false) {
                        fail(new Error(`[${label}] dispatch error: ${JSON.stringify(e.dispatchError)}`));
                        return;
                    }
                    console.log(`[${label}] txBestBlocksState.found in block ${e.block?.hash?.slice(0, 12)}…`);
                    succeed((e.block?.hash ?? broadcastedHash ?? "0x") as `0x${string}`);
                }
                if (e.type === "finalized") {
                    console.log(`[${label}] finalized (block ${e.block?.hash?.slice(0, 12)}…)`);
                    if (!settled) succeed((e.block?.hash ?? broadcastedHash ?? "0x") as `0x${string}`);
                    try { sub.unsubscribe(); } catch { /* noop */ }
                }
            },
            error(err: unknown) {
                console.error(`[${label}] subscription error:`, err);
                fail(err instanceof Error ? err : new Error(String(err)));
            },
        });
    });
}
