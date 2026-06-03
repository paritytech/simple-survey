/**
 * Surveys contract address + ABI resolution from cdm.json.
 *
 * cdm 0.8.18 writes a FLAT contracts map (`contracts["@example/surveys"]`);
 * older 0.7.x nested it under a target hash (`contracts[hash]["@example/surveys"]`).
 * We try flat first, then fall through to the nested shape, so the same code
 * works whichever cdm wrote the file. Resolution is lazy — a missing entry
 * (e.g. before the first deploy) throws only when a contract call is made,
 * never at import time.
 */

import cdmJson from "../../../cdm.json";
import { ethers } from "ethers";

const CONTRACT_KEY = "@example/surveys";

interface ContractEntry {
    address?: string;
    abi?: ethers.InterfaceAbi;
    metadataCid?: string;
}

function findEntry(): ContractEntry | null {
    const contracts = (cdmJson as { contracts?: Record<string, unknown> }).contracts ?? {};

    // Flat (cdm 0.8.x): contracts["@example/surveys"]
    const flat = contracts[CONTRACT_KEY] as ContractEntry | undefined;
    if (flat?.address && flat?.abi) return flat;

    // Nested (cdm 0.7.x): contracts[targetHash]["@example/surveys"]
    for (const target of Object.keys(contracts)) {
        const entry = (contracts[target] as Record<string, ContractEntry> | undefined)?.[CONTRACT_KEY];
        if (entry?.address && entry?.abi) return entry;
    }
    return null;
}

function notDeployed(): never {
    throw new Error(
        `Surveys contract not found in cdm.json for "${CONTRACT_KEY}". ` +
            "Run `npm run build:contracts && npm run deploy` (global cdm 0.8.x) first.",
    );
}

export function getSurveysAddress(): `0x${string}` {
    const entry = findEntry();
    if (!entry?.address) notDeployed();
    return entry.address as `0x${string}`;
}

export function getSurveysInterface(): ethers.Interface {
    const entry = findEntry();
    if (!entry?.abi) notDeployed();
    return new ethers.Interface(entry.abi);
}

/** True once a deployed address + ABI are present in cdm.json. */
export function isSurveysDeployed(): boolean {
    return findEntry() !== null;
}
