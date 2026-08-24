import { closeSync, readSync } from "node:fs";

import {
    D1_PROBE_CHILD_ASSIGNMENT_LIMIT_BYTES_V1,
    D1_PROBE_CHILD_GO_TIMEOUT_MS_V1,
    D1ProbeGatewayChildAssignmentV1Schema,
    D1ProbeGatewayChildGoV1Schema,
    canonicalD1ProbeGatewayChildAssignmentV1,
    canonicalD1ProbeGatewayChildResultV1,
    executeD1ProbeGatewayChildV1,
    goForD1ProbeGatewayChildV1,
    readyForD1ProbeGatewayChildV1,
    type D1ProbeGatewayChildAssignmentV1,
    type D1ProbeGatewayChildGoV1,
    type D1ProbeGatewayChildReadyV1,
} from "./child.js";

const MAX_SERVICE_TOKEN_BYTES = 513;

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

const parseCanonicalAssignment = async (): Promise<D1ProbeGatewayChildAssignmentV1> => {
    const text = decodeUtf8(await readStream(process.stdin, D1_PROBE_CHILD_ASSIGNMENT_LIMIT_BYTES_V1));
    if (text === null) return fail("invalid_assignment");
    const assignmentText: string = text;
    let input: unknown = null;
    try {
        input = JSON.parse(assignmentText) as unknown;
        const canonical = await canonicalD1ProbeGatewayChildAssignmentV1(input);
        if (assignmentText !== canonical && assignmentText !== `${canonical}\n`) return fail("invalid_assignment");
    } catch {
        return fail("invalid_assignment");
    }
    const parsed = D1ProbeGatewayChildAssignmentV1Schema.safeParse(input);
    if (!parsed.success) return fail("invalid_assignment");
    return parsed.data;
};

const sendReady = async (ready: D1ProbeGatewayChildReadyV1): Promise<void> => {
    if (!process.connected || process.send === undefined) fail("ipc_unavailable");
    await new Promise<void>((resolve, reject) => {
        process.send?.(ready, error => (error === null ? resolve() : reject(error)));
    }).catch(() => fail("ipc_unavailable"));
};

const waitForGo = async (assignment: D1ProbeGatewayChildAssignmentV1): Promise<D1ProbeGatewayChildGoV1> =>
    await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            process.off("message", onMessage);
            process.off("disconnect", onDisconnect);
            callback();
        };
        const onMessage = (message: unknown) => {
            const go = goForD1ProbeGatewayChildV1(assignment, message);
            finish(() => (go === null ? reject(new Error("invalid GO")) : resolve(go)));
        };
        const onDisconnect = () => finish(() => reject(new Error("IPC disconnected")));
        const timeout = setTimeout(
            () => finish(() => reject(new Error("GO timeout"))),
            D1_PROBE_CHILD_GO_TIMEOUT_MS_V1
        );
        process.on("message", onMessage);
        process.on("disconnect", onDisconnect);
    });

const readServiceToken = (): { client_secret: string } => {
    const bytes = Buffer.alloc(MAX_SERVICE_TOKEN_BYTES + 1);
    let size = 0;
    try {
        while (size <= MAX_SERVICE_TOKEN_BYTES) {
            const read = readSync(4, bytes, size, bytes.byteLength - size, null);
            if (read === 0) break;
            size += read;
        }
    } catch {
        size = -1;
    } finally {
        try {
            closeSync(4);
        } catch {
            size = -1;
        }
    }
    const text = size >= 0 && size <= MAX_SERVICE_TOKEN_BYTES ? decodeUtf8(bytes.subarray(0, size)) : null;
    if (text === null) return fail("service_token_unavailable");
    const tokenText: string = text;
    const clientSecret = tokenText.endsWith("\n") ? tokenText.slice(0, -1) : tokenText;
    if (clientSecret.length === 0 || clientSecret.includes("\n") || clientSecret.includes("\r")) {
        return fail("service_token_unavailable");
    }
    return { client_secret: clientSecret };
};

const main = async (): Promise<void> => {
    if (process.argv.length !== 2) fail("usage_error");
    if (!process.connected || process.send === undefined) fail("ipc_unavailable");
    const assignment = await parseCanonicalAssignment();
    const ready = readyForD1ProbeGatewayChildV1(assignment);
    if (ready === null) return fail("invalid_assignment");
    const goPromise = waitForGo(assignment);
    await sendReady(ready);
    const go = await goPromise.catch(() => fail("go_invalid"));
    const parsedGo = D1ProbeGatewayChildGoV1Schema.safeParse(go);
    if (!parsedGo.success) return fail("go_invalid");
    const result = await executeD1ProbeGatewayChildV1(assignment, parsedGo.data, readServiceToken());
    if (!result.success) return fail(result.code);
    process.stdout.write(`${canonicalD1ProbeGatewayChildResultV1(result.result)}\n`);
    process.disconnect();
};

await main();
