import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
    D1_PROBE_PARENT_READY_TIMEOUT_MS_V1,
    D1_PROBE_PARENT_RESULT_TIMEOUT_MS_V1,
    D1_PROBE_PARENT_TERMINATION_TIMEOUT_MS_V1,
    type D1ProbeGatewayParentChildHandleV1,
    type D1ProbeGatewayParentDependenciesV1,
} from "./parent.js";
import {
    D1ProbeGatewayChildReadyV1Schema,
    D1ProbeGatewayChildResultV1Schema,
    canonicalD1ProbeGatewayChildAssignmentV1,
    canonicalD1ProbeGatewayChildGoV1,
    canonicalD1ProbeGatewayChildResultV1,
    type D1ProbeGatewayChildReadyV1,
} from "./child.js";

export const D1_PROBE_PARENT_CHILD_OUTPUT_LIMIT_BYTES_V1 = 131_072 as const;

export interface D1ProbeNodeChildDependenciesV1 {
    readonly entrypoint?: URL;
    readonly signal?: AbortSignal | undefined;
    readonly spawn?: typeof spawn;
}

const withTimeout = async <T>(promise: Promise<T>, milliseconds: number, code: string): Promise<T> => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_resolve, reject) => {
                timeout = setTimeout(() => reject(new Error(code)), milliseconds);
            }),
        ]);
    } finally {
        if (timeout !== undefined) clearTimeout(timeout);
    }
};

const boundedStream = (stream: NodeJS.ReadableStream): Readonly<{ done: Promise<Buffer>; exceeded: () => boolean }> => {
    let tooLarge = false;
    const chunks: Buffer[] = [];
    let total = 0;
    const done = new Promise<Buffer>((resolve, reject) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            resolve(Buffer.concat(chunks));
        };
        stream.on("data", chunk => {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            total += bytes.byteLength;
            if (total > D1_PROBE_PARENT_CHILD_OUTPUT_LIMIT_BYTES_V1) {
                tooLarge = true;
                if ("destroy" in stream && typeof stream.destroy === "function") stream.destroy();
                return;
            }
            chunks.push(bytes);
        });
        stream.once("end", finish);
        stream.once("close", finish);
        stream.once("error", error => {
            if (settled) return;
            settled = true;
            reject(error);
        });
    });
    return { done, exceeded: () => tooLarge };
};

const waitForClose = (child: ChildProcess): Promise<Readonly<{ code: number | null; signal: NodeJS.Signals | null }>> =>
    new Promise((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code, signal) => resolve({ code, signal }));
    });

export const createNodeD1ProbeGatewayParentDependenciesV1 = (
    options: D1ProbeNodeChildDependenciesV1 = {}
): D1ProbeGatewayParentDependenciesV1 => ({
    signal: options.signal,
    spawnChild: async (assignment, serviceToken) => {
        const canonicalAssignment = await canonicalD1ProbeGatewayChildAssignmentV1(assignment);
        const spawnImplementation = options.spawn ?? spawn;
        const entrypoint = options.entrypoint ?? new URL("./child-cli.ts", import.meta.url);
        const child = spawnImplementation(process.execPath, ["--import", "tsx", fileURLToPath(entrypoint)], {
            cwd: fileURLToPath(new URL("../", import.meta.url)),
            env: {},
            stdio: ["pipe", "pipe", "pipe", "ipc", "pipe"],
        });
        if (child.stdin === null || child.stdout === null || child.stderr === null) {
            child.kill("SIGTERM");
            throw new Error("child streams unavailable");
        }
        const secretStream = child.stdio[4];
        if (secretStream === undefined || secretStream === null || !("end" in secretStream)) {
            child.kill("SIGTERM");
            throw new Error("child credential stream unavailable");
        }
        child.stdin.on("error", () => undefined);
        if ("on" in secretStream && typeof secretStream.on === "function") {
            secretStream.on("error", () => undefined);
        }
        const close = waitForClose(child);
        const stdout = boundedStream(child.stdout);
        const stderr = boundedStream(child.stderr);
        let extraMessage = false;
        const ready = withTimeout(
            new Promise<D1ProbeGatewayChildReadyV1>((resolve, reject) => {
                const onMessage = (message: unknown) => {
                    const parsed = D1ProbeGatewayChildReadyV1Schema.safeParse(message);
                    if (!parsed.success) {
                        reject(new Error("child READY invalid"));
                        return;
                    }
                    child.off("message", onMessage);
                    child.on("message", () => {
                        extraMessage = true;
                    });
                    resolve(parsed.data);
                };
                child.on("message", onMessage);
                close.then(
                    () => reject(new Error("child closed before READY")),
                    () => reject(new Error("child failed before READY"))
                );
            }),
            D1_PROBE_PARENT_READY_TIMEOUT_MS_V1,
            "child READY timeout"
        );
        child.stdin.end(canonicalAssignment);
        secretStream.end(`${serviceToken.client_secret}\n`);

        let released = false;
        const handle: D1ProbeGatewayParentChildHandleV1 = {
            ready,
            release: async go => {
                if (released || extraMessage || !child.connected) throw new Error("child cannot accept GO");
                released = true;
                const canonicalGo = canonicalD1ProbeGatewayChildGoV1(go);
                const parsedGo = JSON.parse(canonicalGo) as never;
                if (child.send === undefined) throw new Error("child IPC unavailable");
                await new Promise<void>((resolve, reject) => {
                    child.send?.(parsedGo, error => (error === null ? resolve() : reject(error)));
                });
                const terminal = await withTimeout(close, D1_PROBE_PARENT_RESULT_TIMEOUT_MS_V1, "child result timeout");
                const [stdoutBytes, stderrBytes] = await Promise.all([stdout.done, stderr.done]);
                if (
                    terminal.code !== 0 ||
                    terminal.signal !== null ||
                    extraMessage ||
                    stdout.exceeded() ||
                    stderr.exceeded() ||
                    stderrBytes.byteLength !== 0
                ) {
                    throw new Error("child terminal invalid");
                }
                let text: string;
                try {
                    text = new TextDecoder("utf-8", { fatal: true }).decode(stdoutBytes);
                } catch {
                    throw new Error("child result encoding invalid");
                }
                if (!text.endsWith("\n") || text.slice(0, -1).includes("\n") || text.includes("\r")) {
                    throw new Error("child result framing invalid");
                }
                let input: unknown;
                try {
                    input = JSON.parse(text.slice(0, -1)) as unknown;
                } catch {
                    throw new Error("child result JSON invalid");
                }
                const parsed = D1ProbeGatewayChildResultV1Schema.safeParse(input);
                if (!parsed.success || canonicalD1ProbeGatewayChildResultV1(parsed.data) !== text.slice(0, -1)) {
                    throw new Error("child result invalid");
                }
                return parsed.data;
            },
            terminate: async () => {
                if (child.exitCode !== null || child.signalCode !== null) {
                    await close.catch(() => undefined);
                    return;
                }
                child.kill("SIGTERM");
                try {
                    await withTimeout(close, D1_PROBE_PARENT_TERMINATION_TIMEOUT_MS_V1, "child termination timeout");
                } catch {
                    child.kill("SIGKILL");
                    await withTimeout(close, D1_PROBE_PARENT_TERMINATION_TIMEOUT_MS_V1, "child kill timeout");
                }
            },
        };
        return handle;
    },
});
