/**
 * Host account management.
 *
 * Preferred path: `getProductAccount(identifier, 0)` where `identifier` is
 * `window.location.host` (a `.dot` domain in prod, `localhost:PORT` in dev).
 * Polkadot Desktop ≥ 0.7.5 accepts both. The resulting signer goes through the
 * non-legacy `createTransaction` host slot — the only end-to-end-functional
 * signing path for Asset Hub Next today.
 *
 * Fallback: `getLegacyAccounts()` for hosts that predate the localhost
 * identifier feature. The legacy signer is still a stub on the desktop, so it
 * is returned only for display.
 */

import { AccountId } from "polkadot-api";
import type { PolkadotSigner } from "polkadot-api";
import type { ProductAccount } from "@novasamatech/host-api-wrapper";
import { getAccountsProvider } from "./connection.ts";

export interface HostAccount {
    name: string;
    /** SS58 address. */
    address: string;
    polkadotSigner: PolkadotSigner;
    publicKey: Uint8Array;
}

const accountIdCodec = AccountId();

/**
 * The identifier the host uses to scope our product (dotNS hostname or
 * localhost:PORT). Read from `window.location.host`.
 */
function getProductIdentifier(): string | null {
    if (typeof window === "undefined") return null;
    return window.location.host || null;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
        ),
    ]);
}

/**
 * Product-account path: `accountsProvider.getProductAccount(identifier, 0)`.
 * Returns a single derived account whose signer uses the host's
 * `createTransaction` slot.
 */
async function tryProductAccount(): Promise<HostAccount[] | null> {
    const identifier = getProductIdentifier();
    if (!identifier) return null;

    const provider = getAccountsProvider() as any;
    if (typeof provider.getProductAccount !== "function") {
        console.log("[Host Accounts] getProductAccount not available on this SDK");
        return null;
    }

    try {
        console.log(`[Host Accounts] Trying getProductAccount("${identifier}", 0)...`);
        const result = await withTimeout(
            Promise.resolve(provider.getProductAccount(identifier, 0)),
            5000,
            "getProductAccount",
        );

        return result.match(
            (account: { publicKey: Uint8Array }) => {
                const address = accountIdCodec.dec(account.publicKey);
                console.log(`[Host Accounts] Product account: ${address} (identifier=${identifier})`);
                const productAccount: ProductAccount = {
                    dotNsIdentifier: identifier,
                    derivationIndex: 0,
                    publicKey: account.publicKey,
                };
                // `createTransaction` slot — host receives full extension bytes
                // (extra + additionalSigned) from PAPI's tx-utils and forwards
                // them to the phone wallet, which reconstructs and signs the v5
                // transaction (AsPgas membership proof, EthSetOrigin, …).
                return [{
                    name: "Survey account",
                    address,
                    polkadotSigner: provider.getProductAccountSigner(productAccount, "createTransaction"),
                    publicKey: account.publicKey,
                }] satisfies HostAccount[];
            },
            (err: unknown) => {
                console.warn("[Host Accounts] getProductAccount error:", JSON.stringify(err));
                return null;
            },
        );
    } catch (e: any) {
        console.warn("[Host Accounts] getProductAccount failed:", e?.message || e);
        return null;
    }
}

async function tryLegacyAccounts(): Promise<HostAccount[] | null> {
    const provider = getAccountsProvider() as any;

    if (typeof provider.getLegacyAccounts !== "function") {
        console.log("[Host Accounts] getLegacyAccounts not available");
        return null;
    }

    try {
        console.log("[Host Accounts] Trying getLegacyAccounts...");
        const result = await withTimeout(
            Promise.resolve(provider.getLegacyAccounts()),
            5000,
            "getLegacyAccounts",
        );

        return result.match(
            (accounts: Array<{ publicKey: Uint8Array; name: string | undefined }>) => {
                if (accounts.length === 0) return [] as HostAccount[];
                console.log(`[Host Accounts] Got ${accounts.length} legacy account(s)`);
                return accounts.map((acc) => {
                    const address = accountIdCodec.dec(acc.publicKey);
                    return {
                        name: acc.name || "Host Account",
                        address,
                        polkadotSigner: provider.getLegacyAccountSigner({
                            dotNsIdentifier: "",
                            derivationIndex: 0,
                            publicKey: acc.publicKey,
                        }),
                        publicKey: acc.publicKey,
                    };
                });
            },
            (err: unknown) => {
                console.warn("[Host Accounts] getLegacyAccounts error:", JSON.stringify(err));
                return null;
            },
        );
    } catch (e: any) {
        console.warn("[Host Accounts] getLegacyAccounts failed:", e?.message || e);
        return null;
    }
}

export async function getHostAccounts(): Promise<HostAccount[]> {
    const productResult = await tryProductAccount();
    if (productResult !== null && productResult.length > 0) return productResult;
    return (await tryLegacyAccounts()) ?? [];
}

export function subscribeHostAccounts(
    onAccountsChanged: (accounts: HostAccount[]) => void,
): () => void {
    const provider = getAccountsProvider();

    const sub = provider.subscribeAccountConnectionStatus(async (status) => {
        if (status === "connected") {
            onAccountsChanged(await getHostAccounts());
        } else {
            onAccountsChanged([]);
        }
    });

    return () => sub.unsubscribe();
}
