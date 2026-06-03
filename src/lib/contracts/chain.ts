/**
 * Typed API for Paseo Asset Hub Next (v2).
 *
 * The descriptor is generated locally via `npm run papi` (see
 * `.papi/polkadot-api.json`) against the live chain. The published
 * `@parity/product-sdk-descriptors` lags behind the runtime's signed-extension
 * set, which makes every signed tx fail validation with `BadProof`.
 */

import type { PolkadotClient, TypedApi } from "polkadot-api";
import { paseo_asset_hub } from "@polkadot-api/descriptors";
import { getPaseoAssetHubClient } from "../host/provider.ts";

export interface ChainAPI {
    assetHub: TypedApi<typeof paseo_asset_hub>;
    raw: { assetHub: PolkadotClient };
}

let apiInstance: ChainAPI | null = null;

/** Get the Paseo Asset Hub Next typed API (cached singleton). */
export async function getAPI(): Promise<ChainAPI> {
    if (apiInstance) return apiInstance;

    const client = getPaseoAssetHubClient();
    apiInstance = {
        assetHub: client.getTypedApi(paseo_asset_hub),
        raw: { assetHub: client },
    };
    return apiInstance;
}
