import { canonicalizeJsonV1, type CanonicalJsonValueV1 } from "@openbot/gate-attestation/internal";
import { createReadStream } from "node:fs";

import { attestReviewedD1ProbeV1 } from "./sign.js";

const MAX_STDIN_BYTES = 8 * 1024 * 1024;
const MAX_PRIVATE_KEY_BYTES = 8_192;

const fail = (code: string): never => {
    process.stderr.write(`${code}\n`);
    process.exit(1);
};

const readPrivateKey = async (): Promise<string | null> => {
    try {
        const stream = createReadStream("", { fd: 3, autoClose: false });
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of stream) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += bytes.byteLength;
            if (size > MAX_PRIVATE_KEY_BYTES) {
                stream.destroy();
                return null;
            }
            chunks.push(bytes);
        }
        const raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
        return raw.endsWith("\n") ? raw.slice(0, -1) : raw;
    } catch {
        return null;
    }
};

const main = async (): Promise<void> => {
    if (process.argv.length !== 2) fail("usage_error");
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.byteLength;
        if (size > MAX_STDIN_BYTES) fail("input_too_large");
        chunks.push(bytes);
    }
    let raw = "";
    try {
        raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    } catch {
        fail("invalid_canonical_json");
    }
    let input: unknown;
    try {
        input = JSON.parse(raw) as unknown;
    } catch {
        fail("invalid_canonical_json");
    }
    let canonical: string | null = null;
    try {
        canonical = canonicalizeJsonV1(input as CanonicalJsonValueV1);
    } catch {
        fail("invalid_canonical_json");
    }
    if (canonical === null || (`${canonical}\n` !== raw && canonical !== raw)) fail("invalid_canonical_json");
    const privateKey = await readPrivateKey();
    if (privateKey === null || privateKey.length === 0) fail("private_key_unavailable");
    const result = await attestReviewedD1ProbeV1(input, { private_key_pkcs8_base64url: privateKey });
    if (result.success) {
        process.stdout.write(`${canonicalizeJsonV1(result.bundle as CanonicalJsonValueV1)}\n`);
        return;
    }
    fail(result.code);
};

await main();
