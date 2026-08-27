import { type ChildProcess, type spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { canonicalizeJsonV1 } from "@openbot/gate-attestation/internal";
import { describe, expect, it, vi } from "vitest";

import {
    D1_PROBE_WORKER_CANARY_LAUNCH_OUTPUT_LIMIT_BYTES_V1,
    D1ProbeCloudflareWorkerCanarySecureLaunchContainmentErrorV1,
    canonicalD1ProbeCloudflareWorkerCanarySecureLaunchResultV1,
    launchD1ProbeCloudflareWorkerCanarySecureChildV1,
    launchD1ProbeCloudflareWorkerCanarySecureChildWithDependenciesTestOnlyV1,
} from "../src/cloudflare-worker-canary-secure-launcher.js";

const canonicalCommand = '{"kind":"fixture","schema_version":1}';
const commitmentKey = "A".repeat(43);
const apiToken = "t".repeat(32);
const digest = (character: string) => character.repeat(64);
const canonicalChildResult = canonicalizeJsonV1({
    schema_version: 1,
    kind: "untrusted_d1_probe_cloudflare_worker_api_canary_result",
    status: "inconclusive",
    stage: "fixture",
    planned_worker_name: "openbot-d1-probe-canary-0123456789abcdef",
    plan_digest: digest("1"),
    commitment_key_id_digest: digest("2"),
    attempt_tag_commitment: digest("3"),
    account_id_commitment: digest("4"),
    worker_id_commitment: null,
    version_id_commitment: null,
    deployment_id_commitment: null,
    fixed_module_sha256: digest("5"),
    mutation_attempts: { shell_create: 0, version_create: 0, deployment_create: 0, worker_delete: 0 },
    cleanup_status: "not_needed",
    transcript: [],
    transcript_digest: digest("6"),
    runtime_identity_verified: false,
    caller_mutation_authority: false,
    authoritative: false,
    eligible_for_upload: false,
    eligible_for_attestation: false,
    lifecycle_advance_allowed: false,
    gate_promotion_allowed: false,
});
const childResultWithUnexpectedField = (target: "root" | "mutation" | "transcript"): string => {
    const value = JSON.parse(canonicalChildResult);
    if (target === "root") value.unexpected = true;
    if (target === "mutation") value.mutation_attempts.unexpected = true;
    if (target === "transcript") {
        value.transcript = [
            {
                sequence: 1,
                method: "GET",
                path_digest: digest("7"),
                request_digest: digest("8"),
                response_digest: digest("9"),
                status: 200,
                observed_at_ms: 1,
                unexpected: true,
            },
        ];
    }
    return `${canonicalizeJsonV1(value)}\n`;
};

class FakeChild extends EventEmitter {
    readonly stdinStream = new PassThrough();
    readonly stdoutStream = new PassThrough();
    readonly stderrStream = new PassThrough();
    readonly commitmentStream = new PassThrough();
    readonly apiTokenStream = new PassThrough();
    readonly killSignals: NodeJS.Signals[] = [];
    exitCode: number | null = null;
    signalCode: NodeJS.Signals | null = null;
    onKill: ((signal: NodeJS.Signals) => void) | undefined;

    constructor() {
        super();
        this.stdinStream.resume();
        this.commitmentStream.resume();
        this.apiTokenStream.resume();
    }

    get stdin() {
        return this.stdinStream;
    }

    get stdout() {
        return this.stdoutStream;
    }

    get stderr() {
        return this.stderrStream;
    }

    get stdio() {
        return [this.stdinStream, this.stdoutStream, this.stderrStream, this.commitmentStream, this.apiTokenStream];
    }

    kill(signal: NodeJS.Signals = "SIGTERM"): boolean {
        this.killSignals.push(signal);
        this.onKill?.(signal);
        return true;
    }

    close(code: number | null, signal: NodeJS.Signals | null): void {
        this.exitCode = code;
        this.signalCode = signal;
        if (!this.stdoutStream.destroyed) this.stdoutStream.end();
        if (!this.stderrStream.destroyed) this.stderrStream.end();
        this.emit("close", code, signal);
    }

    asChildProcess(): ChildProcess {
        return this as unknown as ChildProcess;
    }
}

const spawnFor = (child: FakeChild) => vi.fn(() => child.asChildProcess()) as unknown as typeof spawn;

const collect = (stream: PassThrough): Promise<string> =>
    new Promise(resolve => {
        const chunks: Buffer[] = [];
        stream.on("data", chunk => chunks.push(Buffer.from(chunk)));
        stream.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });

describe("Cloudflare Worker canary secure child launcher", () => {
    it("uses one fixed child, empty environment, stdin command, and dedicated secret descriptors", async () => {
        const child = new FakeChild();
        const stdin = collect(child.stdinStream);
        const commitment = collect(child.commitmentStream);
        const token = collect(child.apiTokenStream);
        const spawnImplementation = spawnFor(child);
        queueMicrotask(() => {
            child.stdoutStream.end(`${canonicalChildResult}\n`);
            child.stderrStream.end();
            child.close(0, null);
        });

        const launch = await launchD1ProbeCloudflareWorkerCanarySecureChildWithDependenciesTestOnlyV1(
            canonicalCommand,
            commitmentKey,
            apiToken,
            {},
            { spawn: spawnImplementation }
        );

        expect(spawnImplementation).toHaveBeenCalledOnce();
        const [executable, arguments_, options] = vi.mocked(spawnImplementation).mock.calls[0]!;
        expect(executable).toBe(process.execPath);
        expect(arguments_).toEqual([
            "--import",
            "tsx",
            new URL("../src/cloudflare-worker-canary-cli.ts", import.meta.url).pathname,
        ]);
        expect(options).toMatchObject({
            env: {},
            detached: false,
            shell: false,
            stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
        });
        expect(await stdin).toBe(`${canonicalCommand}\n`);
        expect(await commitment).toBe(`${commitmentKey}\n`);
        expect(await token).toBe(`${apiToken}\n`);
        expect(launch).toEqual({
            schema_version: 1,
            kind: "d1_probe_cloudflare_worker_api_canary_secure_launch_result",
            status: "completed",
            error_code: null,
            attempt_count: 1,
            retry_count: 0,
            child_descendant_processes_allowed: false,
            termination: "none",
            child_exit_observed: true,
            child_result_sha256: createHash("sha256").update(canonicalChildResult).digest("hex"),
            authoritative: false,
            eligible_for_upload: false,
            eligible_for_attestation: false,
            lifecycle_advance_allowed: false,
            gate_promotion_allowed: false,
        });
        const canonical = canonicalD1ProbeCloudflareWorkerCanarySecureLaunchResultV1(launch);
        expect(JSON.parse(canonical)).toEqual(launch);
        expect(canonical).not.toMatch(new RegExp(`${commitmentKey}|${apiToken}`, "u"));
    });

    it("captures the abort signal once and runs every wipe before fallible listener cleanup", async () => {
        const child = new FakeChild();
        const commitmentChunks: Buffer[] = [];
        const tokenChunks: Buffer[] = [];
        child.commitmentStream.on("data", chunk => commitmentChunks.push(chunk));
        child.apiTokenStream.on("data", chunk => tokenChunks.push(chunk));
        const signal = {
            aborted: false,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(() => {
                throw new Error("listener cleanup failed");
            }),
        } as unknown as AbortSignal;
        let signalReads = 0;
        const options = Object.defineProperty({}, "signal", {
            get: () => {
                signalReads += 1;
                if (signalReads > 1) throw new Error("signal was read again");
                return signal;
            },
        });
        queueMicrotask(() => {
            child.stdoutStream.end(`${canonicalChildResult}\n`);
            child.stderrStream.end();
            child.close(0, null);
        });

        await expect(
            launchD1ProbeCloudflareWorkerCanarySecureChildWithDependenciesTestOnlyV1(
                canonicalCommand,
                commitmentKey,
                apiToken,
                options,
                { spawn: spawnFor(child) }
            )
        ).resolves.toMatchObject({ status: "completed" });

        expect(signalReads).toBe(1);
        expect(signal.removeEventListener).toHaveBeenCalledOnce();
        expect(commitmentChunks).toHaveLength(1);
        expect(tokenChunks).toHaveLength(1);
        expect(commitmentChunks[0]!.every(byte => byte === 0)).toBe(true);
        expect(tokenChunks[0]!.every(byte => byte === 0)).toBe(true);
        expect(child.stdinStream.destroyed).toBe(true);
        expect(child.commitmentStream.destroyed).toBe(true);
        expect(child.apiTokenStream.destroyed).toBe(true);
    });

    it("runs the fixed disabled command once and does not expose its inputs", async () => {
        const launch = await launchD1ProbeCloudflareWorkerCanarySecureChildV1(
            canonicalCommand,
            commitmentKey,
            apiToken
        );

        expect(launch).toMatchObject({
            status: "inconclusive",
            error_code: "child_terminal_invalid",
            attempt_count: 1,
            retry_count: 0,
            termination: "none",
            child_result_sha256: null,
        });
        const serialized = JSON.stringify(launch);
        expect(serialized).not.toContain(commitmentKey);
        expect(serialized).not.toContain(apiToken);
        expect(serialized).not.toContain(canonicalCommand);
    }, 15_000);

    it("rejects malformed commands and secrets before spawn", async () => {
        const child = new FakeChild();
        const spawnImplementation = spawnFor(child);
        for (const input of [
            ["{}\n\n", commitmentKey, apiToken],
            ['{"schema_version":1,"kind":"fixture"}', commitmentKey, apiToken],
            [canonicalCommand, "short", apiToken],
            [canonicalCommand, commitmentKey, "short"],
            [
                new Proxy(
                    {},
                    {
                        get: () => {
                            throw new Error("hostile");
                        },
                    }
                ),
                commitmentKey,
                apiToken,
            ],
        ] as const) {
            await expect(
                launchD1ProbeCloudflareWorkerCanarySecureChildWithDependenciesTestOnlyV1(
                    input[0],
                    input[1],
                    input[2],
                    {},
                    {
                        spawn: spawnImplementation,
                    }
                )
            ).resolves.toMatchObject({
                status: "inconclusive",
                error_code: "invalid_launch_input",
                attempt_count: 0,
                retry_count: 0,
            });
        }
        expect(spawnImplementation).not.toHaveBeenCalled();
    });

    it("uses SIGTERM then SIGKILL after the fixed deadline and never retries", async () => {
        const child = new FakeChild();
        child.onKill = signal => {
            if (signal === "SIGKILL") queueMicrotask(() => child.close(null, "SIGKILL"));
        };
        const spawnImplementation = spawnFor(child);

        const launch = await launchD1ProbeCloudflareWorkerCanarySecureChildWithDependenciesTestOnlyV1(
            canonicalCommand,
            commitmentKey,
            apiToken,
            {},
            { spawn: spawnImplementation, deadline_ms: 5, termination_timeout_ms: 5 }
        );

        expect(launch).toMatchObject({
            status: "inconclusive",
            error_code: "child_deadline_exceeded",
            attempt_count: 1,
            retry_count: 0,
            termination: "sigkill",
            child_exit_observed: true,
        });
        expect(child.killSignals).toEqual(["SIGTERM", "SIGKILL"]);
        expect(spawnImplementation).toHaveBeenCalledOnce();
    });

    it("propagates an abort into one SIGTERM and returns one non-authoritative result", async () => {
        const child = new FakeChild();
        child.onKill = signal => queueMicrotask(() => child.close(null, signal));
        const controller = new AbortController();
        const spawnImplementation = spawnFor(child);
        queueMicrotask(() => controller.abort());

        const launch = await launchD1ProbeCloudflareWorkerCanarySecureChildWithDependenciesTestOnlyV1(
            canonicalCommand,
            commitmentKey,
            apiToken,
            { signal: controller.signal },
            { spawn: spawnImplementation, termination_timeout_ms: 10 }
        );

        expect(launch).toMatchObject({
            status: "inconclusive",
            error_code: "launcher_interrupted",
            attempt_count: 1,
            retry_count: 0,
            termination: "sigterm",
            child_exit_observed: true,
        });
        expect(child.killSignals).toEqual(["SIGTERM"]);
        expect(spawnImplementation).toHaveBeenCalledOnce();
    });

    it.each(["stdout", "stderr"] as const)("terminates on bounded %s overflow", async streamName => {
        const child = new FakeChild();
        child.onKill = signal => queueMicrotask(() => child.close(null, signal));
        const spawnImplementation = spawnFor(child);
        queueMicrotask(() => {
            const stream = streamName === "stdout" ? child.stdoutStream : child.stderrStream;
            stream.write(Buffer.alloc(D1_PROBE_WORKER_CANARY_LAUNCH_OUTPUT_LIMIT_BYTES_V1 + 1, 120));
        });

        const launch = await launchD1ProbeCloudflareWorkerCanarySecureChildWithDependenciesTestOnlyV1(
            canonicalCommand,
            commitmentKey,
            apiToken,
            {},
            { spawn: spawnImplementation, termination_timeout_ms: 10 }
        );

        expect(launch).toMatchObject({
            status: "inconclusive",
            error_code: "child_output_limit_exceeded",
            attempt_count: 1,
            retry_count: 0,
            termination: "sigterm",
        });
        expect(child.killSignals).toEqual(["SIGTERM"]);
        expect(spawnImplementation).toHaveBeenCalledOnce();
    });

    it.each([
        ["two lines", `${canonicalChildResult}\n${canonicalChildResult}\n`],
        ["noncanonical JSON", '{"schema_version":1,"kind":"untrusted_d1_probe_cloudflare_worker_api_canary_result"}\n'],
        ["claimed authority", canonicalChildResult.replace('"authoritative":false', '"authoritative":true') + "\n"],
        ["unexpected top-level field", childResultWithUnexpectedField("root")],
        ["unexpected mutation field", childResultWithUnexpectedField("mutation")],
        ["unexpected transcript field", childResultWithUnexpectedField("transcript")],
        [
            "minimal false-authority object",
            '{"authoritative":false,"caller_mutation_authority":false,"eligible_for_attestation":false,"eligible_for_upload":false,"gate_promotion_allowed":false,"kind":"untrusted_d1_probe_cloudflare_worker_api_canary_result","lifecycle_advance_allowed":false,"runtime_identity_verified":false,"schema_version":1}\n',
        ],
        ["invalid JSON", "not-json\n"],
    ])("rejects %s instead of accepting a child result", async (_name, stdout) => {
        const child = new FakeChild();
        const spawnImplementation = spawnFor(child);
        queueMicrotask(() => {
            child.stdoutStream.end(stdout);
            child.stderrStream.end();
            child.close(0, null);
        });

        const launch = await launchD1ProbeCloudflareWorkerCanarySecureChildWithDependenciesTestOnlyV1(
            canonicalCommand,
            commitmentKey,
            apiToken,
            {},
            { spawn: spawnImplementation }
        );

        expect(launch).toMatchObject({
            status: "inconclusive",
            error_code: "child_result_invalid",
            attempt_count: 1,
            retry_count: 0,
            child_result_sha256: null,
        });
        expect(spawnImplementation).toHaveBeenCalledOnce();
    });

    it("classifies an asynchronous child process error without waiting for streams", async () => {
        const child = new FakeChild();
        child.onKill = signal => queueMicrotask(() => child.close(null, signal));
        const spawnImplementation = spawnFor(child);
        queueMicrotask(() => child.emit("error", new Error("child error")));

        const launch = await launchD1ProbeCloudflareWorkerCanarySecureChildWithDependenciesTestOnlyV1(
            canonicalCommand,
            commitmentKey,
            apiToken,
            {},
            { spawn: spawnImplementation }
        );

        expect(launch).toMatchObject({
            status: "inconclusive",
            error_code: "child_process_error",
            attempt_count: 1,
            retry_count: 0,
            termination: "sigterm",
            child_exit_observed: true,
        });
        expect(child.killSignals).toEqual(["SIGTERM"]);
        expect(spawnImplementation).toHaveBeenCalledOnce();
    });

    it.each(["stdout", "stderr"] as const)("terminates and reports a %s stream error", async streamName => {
        const child = new FakeChild();
        child.onKill = signal => queueMicrotask(() => child.close(null, signal));
        const spawnImplementation = spawnFor(child);
        queueMicrotask(() => {
            const stream = streamName === "stdout" ? child.stdoutStream : child.stderrStream;
            stream.emit("error", new Error("stream failed"));
        });

        const launch = await launchD1ProbeCloudflareWorkerCanarySecureChildWithDependenciesTestOnlyV1(
            canonicalCommand,
            commitmentKey,
            apiToken,
            {},
            { spawn: spawnImplementation, termination_timeout_ms: 10 }
        );

        expect(launch).toMatchObject({
            status: "inconclusive",
            error_code: "child_stream_error",
            attempt_count: 1,
            retry_count: 0,
            termination: "sigterm",
            child_exit_observed: true,
        });
        expect(child.killSignals).toEqual(["SIGTERM"]);
        expect(spawnImplementation).toHaveBeenCalledOnce();
    });

    it.each(["stdin", "commitment descriptor", "API token descriptor"] as const)(
        "terminates and reports a %s error",
        async streamName => {
            const child = new FakeChild();
            child.onKill = signal => queueMicrotask(() => child.close(null, signal));
            const spawnImplementation = spawnFor(child);
            queueMicrotask(() => {
                const stream =
                    streamName === "stdin"
                        ? child.stdinStream
                        : streamName === "commitment descriptor"
                          ? child.commitmentStream
                          : child.apiTokenStream;
                stream.emit("error", new Error("input stream failed"));
            });

            const launch = await launchD1ProbeCloudflareWorkerCanarySecureChildWithDependenciesTestOnlyV1(
                canonicalCommand,
                commitmentKey,
                apiToken,
                {},
                { spawn: spawnImplementation, termination_timeout_ms: 10 }
            );

            expect(launch).toMatchObject({
                status: "inconclusive",
                error_code: "child_stream_error",
                attempt_count: 1,
                retry_count: 0,
                termination: "sigterm",
                child_exit_observed: true,
            });
            expect(child.killSignals).toEqual(["SIGTERM"]);
            expect(spawnImplementation).toHaveBeenCalledOnce();
        }
    );

    it("returns a canonical failure and terminates when a descriptor write throws", async () => {
        const child = new FakeChild();
        Object.defineProperty(child.commitmentStream, "end", {
            configurable: true,
            value: () => {
                throw new Error("descriptor write failed");
            },
        });
        child.onKill = signal => queueMicrotask(() => child.close(null, signal));
        const spawnImplementation = spawnFor(child);

        await expect(
            launchD1ProbeCloudflareWorkerCanarySecureChildWithDependenciesTestOnlyV1(
                canonicalCommand,
                commitmentKey,
                apiToken,
                {},
                { spawn: spawnImplementation, termination_timeout_ms: 10 }
            )
        ).resolves.toMatchObject({
            status: "inconclusive",
            error_code: "child_process_error",
            attempt_count: 1,
            retry_count: 0,
            termination: "sigterm",
            child_exit_observed: true,
        });
        expect(child.killSignals).toEqual(["SIGTERM"]);
        expect(spawnImplementation).toHaveBeenCalledOnce();
    });

    it("terminates a partially spawned child when a required stream is absent", async () => {
        const child = new FakeChild();
        Object.defineProperty(child, "stdin", { configurable: true, value: null });
        child.onKill = signal => queueMicrotask(() => child.close(null, signal));
        const spawnImplementation = spawnFor(child);

        const launch = await launchD1ProbeCloudflareWorkerCanarySecureChildWithDependenciesTestOnlyV1(
            canonicalCommand,
            commitmentKey,
            apiToken,
            {},
            { spawn: spawnImplementation, termination_timeout_ms: 10 }
        );

        expect(launch).toMatchObject({
            status: "inconclusive",
            error_code: "child_streams_unavailable",
            attempt_count: 1,
            retry_count: 0,
            termination: "sigterm",
            child_exit_observed: true,
        });
        expect(child.killSignals).toEqual(["SIGTERM"]);
        expect(spawnImplementation).toHaveBeenCalledOnce();
    });

    it("rejects with a fatal containment error after both bounded signal waits", async () => {
        const child = new FakeChild();
        const spawnImplementation = spawnFor(child);

        await expect(
            launchD1ProbeCloudflareWorkerCanarySecureChildWithDependenciesTestOnlyV1(
                canonicalCommand,
                commitmentKey,
                apiToken,
                {},
                { spawn: spawnImplementation, deadline_ms: 2, termination_timeout_ms: 2 }
            )
        ).rejects.toEqual(
            expect.objectContaining({
                name: D1ProbeCloudflareWorkerCanarySecureLaunchContainmentErrorV1.name,
                code: "worker_canary_child_containment_unproven",
            })
        );
        expect(child.killSignals).toEqual(["SIGTERM", "SIGKILL"]);
        expect(spawnImplementation).toHaveBeenCalledOnce();
        expect(child.stdinStream.destroyed).toBe(true);
        expect(child.commitmentStream.destroyed).toBe(true);
        expect(child.apiTokenStream.destroyed).toBe(true);
    });

    it("reports spawn failure without retrying and stops before spawn for a prior abort", async () => {
        const spawnImplementation = vi.fn(() => {
            throw new Error("spawn denied");
        }) as unknown as typeof spawn;
        await expect(
            launchD1ProbeCloudflareWorkerCanarySecureChildWithDependenciesTestOnlyV1(
                canonicalCommand,
                commitmentKey,
                apiToken,
                {},
                {
                    spawn: spawnImplementation,
                }
            )
        ).resolves.toMatchObject({
            status: "inconclusive",
            error_code: "child_spawn_failed",
            attempt_count: 1,
            retry_count: 0,
        });
        expect(spawnImplementation).toHaveBeenCalledOnce();

        const controller = new AbortController();
        controller.abort();
        await expect(
            launchD1ProbeCloudflareWorkerCanarySecureChildWithDependenciesTestOnlyV1(
                canonicalCommand,
                commitmentKey,
                apiToken,
                { signal: controller.signal },
                { spawn: spawnImplementation }
            )
        ).resolves.toMatchObject({
            status: "inconclusive",
            error_code: "launcher_interrupted",
            attempt_count: 0,
            retry_count: 0,
        });
        expect(spawnImplementation).toHaveBeenCalledOnce();
    });
});
