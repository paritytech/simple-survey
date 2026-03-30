import { useRef, useEffect } from "react";
import { createClient, type PolkadotClient, Binary } from "polkadot-api";
import { getWsProvider } from "polkadot-api/ws-provider/web";
import { getPolkadotSigner } from "polkadot-api/signer";
import { sr25519CreateDerive } from "@polkadot-labs/hdkd";
import {
    entropyToMiniSecret,
    mnemonicToEntropy,
    ss58Encode,
} from "@polkadot-labs/hdkd-helpers";
import { bulletin } from "@polkadot-api/descriptors";
import { CID } from "multiformats/cid";

// ---------------------------------------------------------------------------
// Wallet
// ---------------------------------------------------------------------------

export type Signer = ReturnType<typeof getPolkadotSigner>;

export interface Wallet {
    signer: Signer;
    address: string;
}

export function deriveWallet(mnemonic: string): Wallet {
    const entropy = mnemonicToEntropy(mnemonic);
    const miniSecret = entropyToMiniSecret(entropy);
    const derive = sr25519CreateDerive(miniSecret);
    const kp = derive("//0");
    return {
        signer: getPolkadotSigner(kp.publicKey, "Sr25519", kp.sign),
        address: ss58Encode(kp.publicKey, 42),
    };
}

// ---------------------------------------------------------------------------
// Dev accounts (pre-funded on Paseo)
// ---------------------------------------------------------------------------

export const ACCOUNTS = [
    { name: "Alice",   mnemonic: "glimpse final adapt peanut entire ring lift eager mansion orchard silent grunt",   ethAddress: "0xbe1cc67438e4970ee97132721e4cec7738322fef" },
    { name: "Bob",     mnemonic: "match edit thunder foil inner tobacco drift exchange jealous short nuclear mandate",   ethAddress: "0x782f1d6bd00193565dae42a8c4cfcdc21257c564" },
    { name: "Charlie", mnemonic: "what reunion black exit find often month force envelope network connect oppose",      ethAddress: "0xdc9e7641f75f1fb3c4047da5513c33828d00b8b2" },
    { name: "Dave",    mnemonic: "novel soup ginger cereal toilet paper merge upset pottery void impulse visit",        ethAddress: "0x53e4ad30596ae0c00cf17837802fc35112bb3804" },
    { name: "Eve",     mnemonic: "reform lamp logic rare cup hood face caution sun park prison wall",                   ethAddress: "0x63de7f7d9e75a6923c1b470966e049321c2aba86" },
];

// ---------------------------------------------------------------------------
// Bulletin (data upload to Polkadot's decentralised storage)
// ---------------------------------------------------------------------------

const BULLETIN_URL = "wss://paseo-bulletin-rpc.polkadot.io";
let _bulletinClient: PolkadotClient | null = null;

function bulletinApi() {
    if (!_bulletinClient) _bulletinClient = createClient(getWsProvider(BULLETIN_URL));
    return _bulletinClient.getTypedApi(bulletin);
}

export async function publishBlob(bytes: Uint8Array, signer: Signer): Promise<string> {
    const api = bulletinApi();
    const result = await api.tx.TransactionStorage.store({
        data: Binary.fromBytes(bytes),
    }).signAndSubmit(signer);

    const stored = api.event.TransactionStorage.Stored.filter(result.events);
    if (!stored.length || !stored[0].cid) throw new Error("Upload failed");
    return CID.decode(stored[0].cid.asBytes()).toString();
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const IPFS_GATEWAY = "https://paseo-ipfs.polkadot.io/ipfs/";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const short = (addr: string) => addr.slice(0, 6) + "..." + addr.slice(-4);

export function useIntersectionObserver(
    onIntersect: () => void,
    enabled: boolean,
) {
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const el = ref.current;
        if (!el || !enabled) return;
        const observer = new IntersectionObserver(
            ([entry]) => { if (entry.isIntersecting) onIntersect(); },
            { threshold: 0.1 },
        );
        observer.observe(el);
        return () => observer.disconnect();
    }, [onIntersect, enabled]);

    return ref;
}
