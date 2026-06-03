/**
 * Bulletin Chain client — host preimage path.
 *
 * Uploads route through `preimageManager.submit(value)`: the host (Polkadot
 * Desktop) signs and submits `TransactionStorage.store` on Paseo Bulletin Next
 * on our behalf, then pins the bytes to its IPFS service.
 *
 * Why not merchant-signed locally: the host's signPayload slot relays the
 * entire encoded tx to the phone wallet, which caps payloads at ~256 bytes —
 * preimage extrinsics are a few KB. The host preimage slot is the only path
 * that fits.
 *
 * Allowance prerequisite: the chain rejects the preimage submit with
 * `no allowance set for account` unless the host-derived account has an active
 * `BulletinAllowance`. We grant that lazily via `claimDefaultAllowances` (one
 * host modal per session, memoized).
 */

import { calculateCID } from "./cid.ts";
import { BULLETIN_ENDPOINTS, readJsonFromGateway } from "./upload.ts";
import { claimDefaultAllowances } from "../host/allowances.ts";
import { isInHost } from "../host/detect.ts";

export interface BulletinUploadResult {
    cid: string;
    gatewayUrl: string;
}

export async function uploadToBulletin(data: Uint8Array): Promise<BulletinUploadResult> {
    if (!isInHost()) {
        throw new Error(
            "Bulletin upload requires a host environment (Polkadot Desktop). " +
                "Open this app inside the desktop product container so the host can " +
                "submit preimages on Paseo Bulletin on your behalf.",
        );
    }

    // Claim on-chain BulletinAllowance (idempotent, cached per session). The
    // host forwards the resulting modal to the phone wallet; repeated calls
    // within the page lifetime short-circuit.
    await claimDefaultAllowances();

    const cid = calculateCID(data);
    const gatewayUrl = `${BULLETIN_ENDPOINTS.paseo.gateway}${cid}`;

    const { preimageManager } = await import("@novasamatech/host-api-wrapper");
    console.log("[Bulletin] Submitting preimage via host API, size:", data.length);
    let key: string;
    try {
        key = await preimageManager.submit(data);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/no allowance set for account/i.test(message)) {
            throw new Error(
                "Paseo Bulletin rejected the preimage submission (`no allowance set " +
                    "for account`). Open Polkadot Mobile, approve the pending Bulletin " +
                    "allowance request, and retry.",
            );
        }
        throw err;
    }
    console.log("[Bulletin] Preimage stored, host key:", key, "CID:", cid);

    return { cid, gatewayUrl };
}

/** Fetch JSON from IPFS via the multi-gateway race. */
export async function fetchJsonFromBulletin<T = unknown>(cid: string): Promise<T> {
    console.log("[Bulletin] Fetching from IPFS, CID:", cid);
    return readJsonFromGateway<T>(cid);
}
