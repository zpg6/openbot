import { randomBytes as secureRandomBytes } from "node:crypto";
import { closeSync, fstatSync, readSync } from "node:fs";

import { canonicalizeJsonV1, type CanonicalJsonValueV1 } from "@openbot/gate-attestation/internal";

import { generateD1ProbeCloudflareWorkerApiCanaryCommandV1 } from "./cloudflare-worker-canary-plan.js";

const MAX_PLAN_REQUEST_BYTES = 1024;
const MAX_HMAC_KEY_BYTES = 128;

const writeLine = async (stream: NodeJS.WritableStream, value: string): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
        stream.write(`${value}\n`, error => (error === null || error === undefined ? resolve() : reject(error)));
    });
};

const fail = async (code: string): Promise<void> => {
    await writeLine(process.stderr, code).catch(() => undefined);
    process.exitCode = 1;
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

const readSecret = (fileDescriptor: number, maximum: number): string | null => {
    try {
        const descriptor = fstatSync(fileDescriptor);
        if (!descriptor.isFIFO() && !descriptor.isSocket()) return null;
    } catch {
        return null;
    }

    const bytes = Buffer.alloc(maximum + 2);
    let size = 0;
    try {
        while (size < bytes.byteLength) {
            const count = readSync(fileDescriptor, bytes, size, bytes.byteLength - size, null);
            if (count === 0) break;
            size += count;
        }
    } catch {
        size = -1;
    } finally {
        try {
            closeSync(fileDescriptor);
        } catch {
            size = -1;
        }
    }

    const text = size >= 0 && size <= maximum + 1 ? decodeUtf8(bytes.subarray(0, size)) : null;
    bytes.fill(0);
    if (text === null) return null;
    const secret = text.endsWith("\n") ? text.slice(0, -1) : text;
    if (secret.length === 0 || secret.includes("\n") || secret.includes("\r")) return null;
    if (Buffer.byteLength(secret, "utf8") > maximum) return null;
    return secret;
};

const readCanonicalRequest = async (): Promise<unknown | null> => {
    const text = decodeUtf8(await readStream(process.stdin, MAX_PLAN_REQUEST_BYTES));
    if (text === null) return null;
    try {
        const input = JSON.parse(text) as unknown;
        const canonical = canonicalizeJsonV1(input as CanonicalJsonValueV1);
        return text === canonical || text === `${canonical}\n` ? input : null;
    } catch {
        return null;
    }
};

const main = async (): Promise<void> => {
    if (process.argv.length !== 2) return await fail("usage_error");
    const request = await readCanonicalRequest();
    if (request === null) return await fail("invalid_canonical_json");
    const hmacKey = readSecret(3, MAX_HMAC_KEY_BYTES);
    if (hmacKey === null) return await fail("commitment_key_unavailable");

    try {
        const result = await generateD1ProbeCloudflareWorkerApiCanaryCommandV1(
            request,
            { hmac_key_base64url: hmacKey },
            {
                now: Date.now,
                randomBytes: byteLength => secureRandomBytes(byteLength),
            }
        );
        if (!result.success) return await fail(result.code);
        await writeLine(process.stdout, canonicalizeJsonV1(result.command as unknown as CanonicalJsonValueV1));
    } catch {
        await fail("canary_plan_internal_error");
    }
};

await main();
