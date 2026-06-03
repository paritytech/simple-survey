import { useState, useEffect } from "react";
import type { PolkadotSigner } from "polkadot-api";
import {
    connectToHost,
    getHostAccounts,
    subscribeHostAccounts,
    isInHost,
    type HostAccount,
} from "./lib/host/index.ts";
import { getMappedH160 } from "./lib/contracts/index.ts";

// ---------------------------------------------------------------------------
// Account manager — host product-account signing (Polkadot Desktop / dot.li)
//
// Replaces the old browser-extension SignerManager. Accounts come from the
// host via host-api-wrapper; the signer is the `createTransaction` slot, the
// only path that signs Asset Hub Next's AsPgas / EthSetOrigin extensions.
// ---------------------------------------------------------------------------

export interface SurveyAccount {
    name: string;
    /** SS58 address. */
    address: string;
    /** Mapped H160 (Revive), or null if the account isn't mapped yet. */
    h160Address: string | null;
    publicKey: Uint8Array;
    getSigner: () => PolkadotSigner;
}

export type SignerStatus = "connecting" | "ready" | "error" | "no-host";

export interface SignerState {
    status: SignerStatus;
    accounts: SurveyAccount[];
    selectedAddress: string | null;
    error?: Error;
}

class AccountManager {
    private state: SignerState = {
        status: "connecting",
        accounts: [],
        selectedAddress: null,
    };
    private listeners = new Set<(s: SignerState) => void>();
    private unsubHost: (() => void) | null = null;

    getState(): SignerState {
        return this.state;
    }

    subscribe(listener: (s: SignerState) => void): () => void {
        this.listeners.add(listener);
        listener(this.state);
        return () => this.listeners.delete(listener);
    }

    private set(patch: Partial<SignerState>) {
        this.state = { ...this.state, ...patch };
        for (const l of this.listeners) l(this.state);
    }

    private async toSurveyAccounts(hostAccounts: HostAccount[]): Promise<SurveyAccount[]> {
        return Promise.all(
            hostAccounts.map(async (acc) => ({
                name: acc.name,
                address: acc.address,
                h160Address: await getMappedH160(acc.address).catch(() => null),
                publicKey: acc.publicKey,
                getSigner: () => acc.polkadotSigner,
            })),
        );
    }

    private apply(accounts: SurveyAccount[]) {
        const selectedStillThere = accounts.some((a) => a.address === this.state.selectedAddress);
        this.set({
            status: "ready",
            accounts,
            selectedAddress: selectedStillThere
                ? this.state.selectedAddress
                : accounts[0]?.address ?? null,
        });
    }

    async connect(): Promise<void> {
        if (typeof window !== "undefined" && !isInHost()) {
            this.set({
                status: "no-host",
                error: new Error(
                    "Not running inside Polkadot Desktop. Open this app in the host " +
                        "container to sign transactions.",
                ),
            });
            return;
        }
        try {
            await connectToHost();
            const hostAccounts = await getHostAccounts();
            this.apply(await this.toSurveyAccounts(hostAccounts));

            this.unsubHost?.();
            this.unsubHost = subscribeHostAccounts(async (next) => {
                this.apply(await this.toSurveyAccounts(next));
            });
        } catch (err) {
            this.set({ status: "error", error: err as Error });
        }
    }

    selectAccount(address: string) {
        this.set({ selectedAddress: address });
    }
}

export const accountManager = new AccountManager();

export function useSignerState(): SignerState & { selectedAccount: SurveyAccount | null } {
    const [state, setState] = useState<SignerState>(accountManager.getState());
    useEffect(() => accountManager.subscribe(setState), []);
    const selectedAccount = state.accounts.find((a) => a.address === state.selectedAddress) ?? null;
    return { ...state, selectedAccount };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const short = (addr: string) =>
    addr ? addr.slice(0, 6) + "..." + addr.slice(-4) : "";
