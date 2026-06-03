import { blake2b } from "@noble/hashes/blake2.js";
import { CID } from "multiformats/cid";
import * as raw from "multiformats/codecs/raw";
import type { MultihashDigest } from "multiformats/hashes/interface";

const BLAKE2B_256_CODE = 0xb220;

function encodeVarint(value: number): Uint8Array {
    const bytes: number[] = [];
    let num = value;
    while (num >= 0x80) {
        bytes.push((num & 0x7f) | 0x80);
        num >>= 7;
    }
    bytes.push(num & 0x7f);
    return new Uint8Array(bytes);
}

/**
 * Calculate the CID (Content Identifier) for a payload using a Blake2b-256
 * hash. Content-addressed: the same bytes always yield the same CID, so we can
 * compute the CID locally before/independent of the on-chain preimage submit.
 */
export function calculateCID(fileBytes: Uint8Array): string {
    const hash = blake2b(fileBytes, { dkLen: 32 });

    // multihash: varint(code) + varint(length) + hash
    const codeBytes = encodeVarint(BLAKE2B_256_CODE);
    const lengthBytes = encodeVarint(hash.length);

    const multihashBytes = new Uint8Array(
        codeBytes.length + lengthBytes.length + hash.length,
    );
    multihashBytes.set(codeBytes, 0);
    multihashBytes.set(lengthBytes, codeBytes.length);
    multihashBytes.set(hash, codeBytes.length + lengthBytes.length);

    const digest: MultihashDigest = {
        code: BLAKE2B_256_CODE,
        size: hash.length,
        bytes: multihashBytes,
        digest: hash,
    };

    // CIDv1 with raw codec.
    return CID.createV1(raw.code, digest).toString();
}
