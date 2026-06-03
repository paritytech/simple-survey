/**
 * IPFS gateway read helpers.
 *
 * Survey + response JSON is stored via `preimageManager.submit` to Paseo
 * Bulletin Next (which pins it to Bulletin Next's IPFS service). To read it
 * back we race the dedicated v2 gateway against well-connected public gateways
 * and return the first body to arrive — the v2 gateway can lag right after
 * upload (DHT propagation delay).
 */

const GATEWAYS = [
    "https://paseo-bulletin-next-ipfs.polkadot.io/ipfs/",
    "https://dweb.link/ipfs/",
    "https://ipfs.io/ipfs/",
    "https://nftstorage.link/ipfs/",
] as const;

export const BULLETIN_ENDPOINTS = {
    /** Public gateway used for share links / "Open in IPFS" buttons. */
    paseo: {
        gateway: GATEWAYS[0],
    },
} as const;

/**
 * Race fetches across all known gateways. First successful response wins;
 * remaining requests are aborted. Throws an aggregated error only if every
 * gateway fails.
 */
export async function readFromGateway(cid: string, timeoutMs = 30000): Promise<Uint8Array> {
    const masterController = new AbortController();
    const masterTimeout = setTimeout(() => masterController.abort(), timeoutMs);

    const attempts = GATEWAYS.map(async (gateway) => {
        const url = `${gateway}${cid}`;
        const response = await fetch(url, { signal: masterController.signal });
        if (!response.ok) throw new Error(`${url} -> ${response.status}`);
        const buffer = await response.arrayBuffer();
        return { gateway, bytes: new Uint8Array(buffer) };
    });

    try {
        const winner = await Promise.any(attempts);
        masterController.abort();
        console.log("[Bulletin] Fetched via", winner.gateway);
        return winner.bytes;
    } catch (e) {
        if (e instanceof AggregateError) {
            const detail = e.errors.map((er) => (er instanceof Error ? er.message : String(er))).join(" | ");
            throw new Error(`All IPFS gateways failed: ${detail}`);
        }
        throw e;
    } finally {
        clearTimeout(masterTimeout);
    }
}

export async function readJsonFromGateway<T = unknown>(cid: string, timeoutMs = 30000): Promise<T> {
    const bytes = await readFromGateway(cid, timeoutMs);
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
}

/** Public IPFS gateway URL for a CID — used for share / "Open in IPFS" links. */
export function gatewayUrlForCid(cid: string): string {
    return `${BULLETIN_ENDPOINTS.paseo.gateway}${cid}`;
}
