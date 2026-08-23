import { createReadStream } from "node:fs";

import { canonicalizeJsonV1, type CanonicalJsonValueV1 } from "@openbot/gate-attestation/internal";

import { compileD1ProbePreflightPlanV1 } from "./preflight.js";

const MAX_REQUEST_BYTES = 1024 * 1024;
const MAX_HMAC_KEY_BYTES = 128;

const fail = (code: string): never => {
    process.stderr.write(`${code}\n`);
    process.exit(1);
};

const readStream = async (stream: NodeJS.ReadableStream, maximum: number): Promise<Uint8Array | null> => {
    try {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of stream) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += bytes.byteLength;
            if (size > maximum) {
                if ("destroy" in stream && typeof stream.destroy === "function") stream.destroy();
                return null;
            }
            chunks.push(bytes);
        }
        return Buffer.concat(chunks);
    } catch {
        return null;
    }
};

const decodeUtf8 = (bytes: Uint8Array | null): string | null => {
    if (bytes === null) return null;
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        return null;
    }
};

const main = async (): Promise<void> => {
    if (process.argv.length !== 2) fail("usage_error");
    const raw = decodeUtf8(await readStream(process.stdin, MAX_REQUEST_BYTES));
    if (raw === null) fail("invalid_canonical_json");
    const requestText = raw as string;
    let input: unknown;
    try {
        input = JSON.parse(requestText) as unknown;
    } catch {
        fail("invalid_canonical_json");
    }
    let canonical = "";
    try {
        canonical = canonicalizeJsonV1(input as CanonicalJsonValueV1);
    } catch {
        fail("invalid_canonical_json");
    }
    if (requestText !== canonical && requestText !== `${canonical}\n`) fail("invalid_canonical_json");

    const keyStream = createReadStream("", { fd: 3, autoClose: false });
    const keyText = decodeUtf8(await readStream(keyStream, MAX_HMAC_KEY_BYTES));
    if (keyText === null) fail("commitment_key_unavailable");
    const keySource = keyText as string;
    const hmacKey = keySource.endsWith("\n") ? keySource.slice(0, -1) : keySource;
    if (hmacKey.length === 0) fail("commitment_key_unavailable");

    const result = await compileD1ProbePreflightPlanV1(input, { hmac_key_base64url: hmacKey });
    if (result.success) {
        process.stdout.write(`${canonicalizeJsonV1(result.plan as CanonicalJsonValueV1)}\n`);
        return;
    }
    fail(result.code);
};

await main();
