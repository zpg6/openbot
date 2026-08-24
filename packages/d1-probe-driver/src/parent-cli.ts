import { closeSync, readSync } from "node:fs";

import { createNodeD1ProbeGatewayParentDependenciesV1 } from "./node-child.js";
import {
    D1_PROBE_PARENT_ASSIGNMENT_LIMIT_BYTES_V1,
    D1ProbeGatewayParentAssignmentV1Schema,
    canonicalD1ProbeGatewayParentAssignmentV1,
    canonicalD1ProbeGatewayParentResultV1,
    executeD1ProbeGatewayParentV1,
    type D1ProbeGatewayParentAssignmentV1,
} from "./parent.js";

const MAX_SERVICE_TOKEN_BYTES_WITH_NEWLINE = 513;

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

const readAssignment = async (): Promise<D1ProbeGatewayParentAssignmentV1 | null> => {
    const text = decodeUtf8(await readStream(process.stdin, D1_PROBE_PARENT_ASSIGNMENT_LIMIT_BYTES_V1));
    if (text === null) return null;
    try {
        const input = JSON.parse(text) as unknown;
        const canonical = await canonicalD1ProbeGatewayParentAssignmentV1(input);
        if (text !== canonical && text !== `${canonical}\n`) return null;
        const parsed = D1ProbeGatewayParentAssignmentV1Schema.safeParse(input);
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
};

const readServiceToken = (): { client_secret: string } | null => {
    const bytes = Buffer.alloc(MAX_SERVICE_TOKEN_BYTES_WITH_NEWLINE + 1);
    let size = 0;
    try {
        while (size <= MAX_SERVICE_TOKEN_BYTES_WITH_NEWLINE) {
            const read = readSync(3, bytes, size, bytes.byteLength - size, null);
            if (read === 0) break;
            size += read;
        }
    } catch {
        size = -1;
    } finally {
        try {
            closeSync(3);
        } catch {
            size = -1;
        }
    }
    const text = size >= 0 && size <= MAX_SERVICE_TOKEN_BYTES_WITH_NEWLINE ? decodeUtf8(bytes.subarray(0, size)) : null;
    if (text === null) return null;
    const hasTrailingNewline = text.endsWith("\n");
    const secret = hasTrailingNewline ? text.slice(0, -1) : text;
    if (size - (hasTrailingNewline ? 1 : 0) > 512) return null;
    if (secret.length === 0 || secret.includes("\n") || secret.includes("\r")) return null;
    return { client_secret: secret };
};

const main = async (): Promise<void> => {
    if (process.argv.length !== 2) return await fail("usage_error");
    const assignment = await readAssignment();
    if (assignment === null) return await fail("invalid_assignment");
    const serviceToken = readServiceToken();
    if (serviceToken === null) return await fail("service_token_unavailable");

    const controller = new AbortController();
    const interrupt = () => controller.abort();
    process.on("SIGINT", interrupt);
    process.on("SIGTERM", interrupt);
    try {
        const execution = await executeD1ProbeGatewayParentV1(
            assignment,
            serviceToken,
            createNodeD1ProbeGatewayParentDependenciesV1({ signal: controller.signal })
        );
        if (!execution.success) return await fail(execution.code);
        await writeLine(process.stdout, canonicalD1ProbeGatewayParentResultV1(execution.result));
        process.exitCode = execution.result.status === "completed" ? 0 : 2;
    } catch {
        await fail("parent_internal_error");
    } finally {
        process.off("SIGINT", interrupt);
        process.off("SIGTERM", interrupt);
    }
};

await main();
