/**
 * Host API connection.
 *
 * Uses `createAccountsProvider(sandboxTransport)` from host-api-wrapper to talk
 * to the Polkadot Desktop / dot.li host. Works on both Desktop (webview) and
 * dot.li (iframe).
 *
 * Why host-api-wrapper, not the frozen product-sdk signer: only
 * host-api-wrapper exposes `getProductAccountSigner(account, "createTransaction")`,
 * the slot that forwards the full extrinsic bytes to the phone wallet so it can
 * sign Asset Hub Next's `AsPgas` / `EthSetOrigin` signed extensions. The
 * product-sdk signer is signPayload-only and routes through PJS, which throws
 * on those extensions.
 */

import {
    sandboxProvider,
    sandboxTransport,
    createAccountsProvider,
} from "@novasamatech/host-api-wrapper";
import { isInHost } from "./detect.ts";

let accountsProvider: ReturnType<typeof createAccountsProvider> | null = null;
let connected = false;

export function getAccountsProvider() {
    if (!accountsProvider) {
        accountsProvider = createAccountsProvider(sandboxTransport);
    }
    return accountsProvider;
}

export async function connectToHost(): Promise<boolean> {
    if (!isInHost()) return false;
    if (connected) return true;

    if (!sandboxProvider.isCorrectEnvironment()) {
        console.log("[Host] Not in correct environment");
        return false;
    }

    try {
        getAccountsProvider();
        connected = true;
        console.log("[Host] Transport ready");
        return true;
    } catch (e: any) {
        console.log(`[Host] Connection error: ${e?.message || e}`);
        return false;
    }
}

export function isHostConnected(): boolean {
    return connected;
}
