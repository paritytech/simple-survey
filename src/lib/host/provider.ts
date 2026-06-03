/**
 * Chain PAPI provider for Paseo Asset Hub Next (v2) — the Revive chain hosting
 * the surveys contract.
 *
 * Chain RPC is routed through the Polkadot Desktop host container via
 * product-sdk's `createPapiProvider`, with a direct-WSS fallback for hosts
 * that don't yet expose this chain as a known target. `createPapiProvider`
 * probes host support during `isReady()` and falls through to WS when absent.
 *
 * On polkadot-api v2 every layer (`getWsProvider`, `createPapiProvider`,
 * `createClient`) speaks `JsonRpcMessage` objects, so no string↔object
 * adapters are needed.
 */

import { createPapiProvider } from "@novasamatech/host-api-wrapper";
import { createClient } from "polkadot-api";
import type { PolkadotClient } from "polkadot-api";
import { getWsProvider } from "@polkadot-api/ws-provider";

// Paseo Asset Hub Next (v2) — Revive contracts. Genesis last refreshed
// 2026-06-02 (chain reset post-Paseo-Next-v2 upgrade); must match what
// `state_getRuntimeVersion` reports and the genesis baked into the local
// `.papi` metadata, otherwise PAPI's computed `additionalSigned` diverges from
// the chain's expectation and every signed extrinsic dies with `BadProof`.
export const PASEO_ASSET_HUB_GENESIS =
    "0xbf0488dbe9daa1de1c08c5f743e26fdc2a4ecd74cf87dd1b4b1eeb99ae4ef19f" as `0x${string}`;
export const PASEO_ASSET_HUB_WS = "wss://paseo-asset-hub-next-rpc.polkadot.io";

let paseoAssetHubClient: PolkadotClient | null = null;

export function getPaseoAssetHubClient(): PolkadotClient {
    if (paseoAssetHubClient) return paseoAssetHubClient;
    // Host bridge with WS fallback: createPapiProvider routes chain JSON-RPC
    // through the host container when available, and falls through to direct
    // WSS otherwise (e.g. when running standalone in a browser).
    const provider = createPapiProvider(
        PASEO_ASSET_HUB_GENESIS,
        getWsProvider(PASEO_ASSET_HUB_WS),
    );
    paseoAssetHubClient = createClient(provider);
    console.log("[Host Provider] Paseo Asset Hub Next client created (host bridge + WS fallback)");
    return paseoAssetHubClient;
}

export function resetClients(): void {
    if (paseoAssetHubClient) {
        paseoAssetHubClient.destroy();
        paseoAssetHubClient = null;
    }
}
