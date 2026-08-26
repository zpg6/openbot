import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

import { canonicalizeJsonV1, type CanonicalJsonValueV1 } from "@openbot/gate-attestation/internal";
import { z } from "zod";

export const D1_PROBE_WORKER_CANARY_LAUNCH_COMMAND_LIMIT_BYTES_V1 = 2_097_152 as const;
export const D1_PROBE_WORKER_CANARY_LAUNCH_OUTPUT_LIMIT_BYTES_V1 = 262_144 as const;
export const D1_PROBE_WORKER_CANARY_LAUNCH_DEADLINE_MS_V1 = 310_000 as const;
export const D1_PROBE_WORKER_CANARY_LAUNCH_TERMINATION_TIMEOUT_MS_V1 = 1_000 as const;
// Direct-PID termination is valid only while the fixed disabled child contains no process-creation code.
export const D1_PROBE_WORKER_CANARY_LAUNCH_CHILD_DESCENDANT_PROCESSES_ALLOWED_V1 = false as const;

const ApiTokenV1Schema = z.string().regex(/^[A-Za-z0-9_-]{20,256}$/u);
const CommitmentKeyV1Schema = z.string().regex(/^[A-Za-z0-9_-]{43,86}$/u);
const DigestV1Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const SafeTimeV1Schema = z.number().int().safe().nonnegative();
const TranscriptEntryV1Schema = z
    .object({
        sequence: z.number().int().positive(),
        method: z.enum(["GET", "POST", "DELETE"]),
        path_digest: DigestV1Schema,
        request_digest: DigestV1Schema,
        response_digest: DigestV1Schema.nullable(),
        status: z.number().int().min(100).max(599).nullable(),
        observed_at_ms: SafeTimeV1Schema,
    })
    .strict()
    .refine(entry => (entry.response_digest === null) === (entry.status === null), {
        message: "response digest and status must both be present or absent",
    });
const ChildMutationAttemptsBoundaryV1Schema = z
    .object({
        shell_create: z.union([z.literal(0), z.literal(1)]),
        version_create: z.union([z.literal(0), z.literal(1)]),
        deployment_create: z.union([z.literal(0), z.literal(1)]),
        worker_delete: z.union([z.literal(0), z.literal(1)]),
    })
    .strict();
const ChildResultBoundaryV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("untrusted_d1_probe_cloudflare_worker_api_canary_result"),
        status: z.enum(["observed_candidate", "inconclusive", "manual_required"]),
        stage: z.string().min(1).max(128),
        planned_worker_name: z.string().regex(/^openbot-d1-probe-canary-[a-z0-9]{16}$/u),
        plan_digest: DigestV1Schema,
        commitment_key_id_digest: DigestV1Schema,
        attempt_tag_commitment: DigestV1Schema,
        account_id_commitment: DigestV1Schema,
        worker_id_commitment: DigestV1Schema.nullable(),
        version_id_commitment: DigestV1Schema.nullable(),
        deployment_id_commitment: DigestV1Schema.nullable(),
        fixed_module_sha256: DigestV1Schema,
        mutation_attempts: ChildMutationAttemptsBoundaryV1Schema,
        cleanup_status: z.enum(["not_needed", "control_plane_absence_observed", "manual_required"]),
        transcript: z
            .array(TranscriptEntryV1Schema)
            .max(128)
            .refine(entries => entries.every((entry, index) => entry.sequence === index + 1), {
                message: "transcript sequence must be contiguous",
            }),
        transcript_digest: DigestV1Schema,
        runtime_identity_verified: z.literal(false),
        caller_mutation_authority: z.literal(false),
        authoritative: z.literal(false),
        eligible_for_upload: z.literal(false),
        eligible_for_attestation: z.literal(false),
        lifecycle_advance_allowed: z.literal(false),
        gate_promotion_allowed: z.literal(false),
    })
    .strict();

const LauncherResultBaseV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("d1_probe_cloudflare_worker_api_canary_secure_launch_result"),
        attempt_count: z.union([z.literal(0), z.literal(1)]),
        retry_count: z.literal(0),
        child_descendant_processes_allowed: z.literal(false),
        termination: z.enum(["none", "sigterm", "sigkill"]),
        child_exit_observed: z.boolean(),
        authoritative: z.literal(false),
        eligible_for_upload: z.literal(false),
        eligible_for_attestation: z.literal(false),
        lifecycle_advance_allowed: z.literal(false),
        gate_promotion_allowed: z.literal(false),
    })
    .strict();

export const D1ProbeCloudflareWorkerCanarySecureLaunchResultV1Schema = z.discriminatedUnion("status", [
    LauncherResultBaseV1Schema.extend({
        status: z.literal("completed"),
        error_code: z.null(),
        attempt_count: z.literal(1),
        termination: z.literal("none"),
        child_exit_observed: z.literal(true),
        child_result_sha256: DigestV1Schema,
    }).strict(),
    LauncherResultBaseV1Schema.extend({
        status: z.literal("inconclusive"),
        error_code: z.enum([
            "invalid_launch_input",
            "launcher_interrupted",
            "child_spawn_failed",
            "child_streams_unavailable",
            "child_stream_error",
            "child_process_error",
            "child_deadline_exceeded",
            "child_output_limit_exceeded",
            "child_terminal_invalid",
            "child_result_invalid",
        ]),
        child_result_sha256: z.null(),
    }).strict(),
]);

export type D1ProbeCloudflareWorkerCanarySecureLaunchResultV1 = z.infer<
    typeof D1ProbeCloudflareWorkerCanarySecureLaunchResultV1Schema
>;

export interface D1ProbeCloudflareWorkerCanarySecureLauncherOptionsV1 {
    readonly signal?: AbortSignal | undefined;
}

interface D1ProbeCloudflareWorkerCanarySecureLauncherTestOnlyV1 {
    readonly spawn?: typeof spawn;
    readonly deadline_ms?: number;
    readonly termination_timeout_ms?: number;
}

// This rejection is deliberately outside the canonical result union. Before wiring credentials, the launcher host
// must have a process-tree supervisor that treats it as fatal and terminates the full launcher containment unit.
export class D1ProbeCloudflareWorkerCanarySecureLaunchContainmentErrorV1 extends Error {
    readonly code = "worker_canary_child_containment_unproven" as const;

    constructor() {
        super("the canary child did not produce a close event after bounded SIGTERM and SIGKILL waits");
        this.name = "D1ProbeCloudflareWorkerCanarySecureLaunchContainmentErrorV1";
    }
}

type TerminationV1 = D1ProbeCloudflareWorkerCanarySecureLaunchResultV1["termination"];
type LaunchErrorV1 = Extract<
    D1ProbeCloudflareWorkerCanarySecureLaunchResultV1,
    { status: "inconclusive" }
>["error_code"];
type TerminalV1 = Readonly<{ code: number | null; signal: NodeJS.Signals | null }>;

const result = (
    value:
        | Readonly<{ status: "completed"; child_result_sha256: string }>
        | Readonly<{
              status: "inconclusive";
              error_code: LaunchErrorV1;
              attempt_count: 0 | 1;
              termination: TerminationV1;
              child_exit_observed: boolean;
          }>
): D1ProbeCloudflareWorkerCanarySecureLaunchResultV1 =>
    Object.freeze(
        D1ProbeCloudflareWorkerCanarySecureLaunchResultV1Schema.parse({
            schema_version: 1,
            kind: "d1_probe_cloudflare_worker_api_canary_secure_launch_result",
            retry_count: 0,
            child_descendant_processes_allowed: false,
            authoritative: false,
            eligible_for_upload: false,
            eligible_for_attestation: false,
            lifecycle_advance_allowed: false,
            gate_promotion_allowed: false,
            ...(value.status === "completed"
                ? {
                      status: "completed",
                      error_code: null,
                      attempt_count: 1,
                      termination: "none",
                      child_exit_observed: true,
                      child_result_sha256: value.child_result_sha256,
                  }
                : { ...value, child_result_sha256: null }),
        })
    );

export const canonicalD1ProbeCloudflareWorkerCanarySecureLaunchResultV1 = (
    value: D1ProbeCloudflareWorkerCanarySecureLaunchResultV1
): string => canonicalizeJsonV1(value as unknown as CanonicalJsonValueV1);

const canonicalCommand = (input: unknown): string | null => {
    if (
        typeof input !== "string" ||
        Buffer.byteLength(input, "utf8") > D1_PROBE_WORKER_CANARY_LAUNCH_COMMAND_LIMIT_BYTES_V1
    ) {
        return null;
    }
    const text = input.endsWith("\n") ? input.slice(0, -1) : input;
    if (text.length === 0 || text.includes("\n") || text.includes("\r")) return null;
    try {
        const parsed = JSON.parse(text) as unknown;
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        const canonical = canonicalizeJsonV1(parsed as CanonicalJsonValueV1);
        return canonical === text ? canonical : null;
    } catch {
        return null;
    }
};

const observeChild = (
    child: ChildProcess
): Readonly<{ close: Promise<TerminalV1>; processError: Promise<"process_error">; closed: () => boolean }> => {
    let closed = false;
    const close = new Promise<TerminalV1>(resolve => {
        child.once("close", (code, signal) => {
            closed = true;
            resolve({ code, signal });
        });
    });
    const processError = new Promise<"process_error">(resolve => {
        child.once("error", () => resolve("process_error"));
    });
    return { close, processError, closed: () => closed };
};

const boundedStream = (
    stream: NodeJS.ReadableStream,
    exceeded: () => void,
    failed: () => void
): Readonly<{
    done: Promise<Buffer>;
    limitExceeded: () => boolean;
    streamFailed: () => boolean;
    wipe: () => void;
}> => {
    let overLimit = false;
    let streamError = false;
    let total = 0;
    let completed: Buffer | null = null;
    const chunks: Buffer[] = [];
    const done = new Promise<Buffer>(resolve => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            const joined = Buffer.concat(chunks);
            completed = joined;
            for (const chunk of chunks) chunk.fill(0);
            chunks.length = 0;
            resolve(joined);
        };
        stream.on("data", chunk => {
            if (overLimit) return;
            const bytes = Buffer.from(chunk);
            total += bytes.byteLength;
            if (total > D1_PROBE_WORKER_CANARY_LAUNCH_OUTPUT_LIMIT_BYTES_V1) {
                overLimit = true;
                bytes.fill(0);
                for (const buffered of chunks) buffered.fill(0);
                chunks.length = 0;
                exceeded();
                if ("destroy" in stream && typeof stream.destroy === "function") stream.destroy();
                return;
            }
            chunks.push(bytes);
        });
        stream.once("end", finish);
        stream.once("close", finish);
        stream.once("error", () => {
            if (overLimit) return finish();
            streamError = true;
            for (const buffered of chunks) buffered.fill(0);
            chunks.length = 0;
            failed();
            finish();
        });
    });
    const wipe = () => {
        for (const chunk of chunks) chunk.fill(0);
        chunks.length = 0;
        completed?.fill(0);
    };
    return { done, limitExceeded: () => overLimit, streamFailed: () => streamError, wipe };
};

const isWritableSecretDescriptor = (value: unknown): value is NodeJS.WritableStream =>
    value !== null &&
    typeof value === "object" &&
    "end" in value &&
    typeof (value as { end?: unknown }).end === "function";

const destroyStream = (value: unknown): void => {
    try {
        if (
            value !== null &&
            typeof value === "object" &&
            "destroy" in value &&
            typeof (value as { destroy?: unknown }).destroy === "function"
        ) {
            (value as { destroy: () => void }).destroy();
        }
    } catch {
        // Buffer wiping and the canonical result must not depend on stream cleanup succeeding.
    }
};

const destroyChildStreams = (child: ChildProcess): void => {
    destroyStream(child.stdin);
    for (const stream of child.stdio) destroyStream(stream);
};

const writeSecret = (stream: NodeJS.WritableStream, secret: string): (() => void) => {
    const bytes = Buffer.from(`${secret}\n`, "utf8");
    let wiped = false;
    const wipe = () => {
        if (wiped) return;
        wiped = true;
        bytes.fill(0);
    };
    try {
        stream.once("error", wipe);
        stream.once("close", wipe);
        stream.end(bytes, wipe);
    } catch (error) {
        wipe();
        throw error;
    }
    return wipe;
};

const waitFor = async <T>(promise: Promise<T>, milliseconds: number): Promise<T | null> => {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<null>(resolve => {
                timeout = setTimeout(() => resolve(null), milliseconds);
            }),
        ]);
    } finally {
        if (timeout !== undefined) clearTimeout(timeout);
    }
};

const validateChildResult = (stdout: Buffer): string | null => {
    let text: string;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(stdout);
    } catch {
        return null;
    }
    if (!text.endsWith("\n") || text.slice(0, -1).includes("\n") || text.includes("\r")) return null;
    const line = text.slice(0, -1);
    try {
        const parsed = JSON.parse(line) as unknown;
        if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
        if (!ChildResultBoundaryV1Schema.safeParse(parsed).success) return null;
        return canonicalizeJsonV1(parsed as CanonicalJsonValueV1) === line ? line : null;
    } catch {
        return null;
    }
};

// Validation below proves only the strict canonical result shape. Binding its plan and commitment-key digests to the
// launch inputs remains unwired, so a completed launch result is not evidence and grants no downstream authority.

const launchWithDependencies = async (
    canonicalCommandInput: unknown,
    commitmentKeyInput: unknown,
    apiTokenInput: unknown,
    options: D1ProbeCloudflareWorkerCanarySecureLauncherOptionsV1 = {},
    testOnly: D1ProbeCloudflareWorkerCanarySecureLauncherTestOnlyV1 = {}
): Promise<D1ProbeCloudflareWorkerCanarySecureLaunchResultV1> => {
    let command: string | null;
    let commitmentKey: string | null = null;
    let apiToken: string | null = null;
    try {
        command = canonicalCommand(canonicalCommandInput);
        const parsedCommitmentKey = CommitmentKeyV1Schema.safeParse(commitmentKeyInput);
        const parsedApiToken = ApiTokenV1Schema.safeParse(apiTokenInput);
        if (parsedCommitmentKey.success) commitmentKey = parsedCommitmentKey.data;
        if (parsedApiToken.success) apiToken = parsedApiToken.data;
    } catch {
        command = null;
    }
    if (command === null || commitmentKey === null || apiToken === null) {
        return result({
            status: "inconclusive",
            error_code: "invalid_launch_input",
            attempt_count: 0,
            termination: "none",
            child_exit_observed: false,
        });
    }
    let signal: AbortSignal | undefined;
    let alreadyInterrupted = false;
    try {
        signal = options.signal;
        alreadyInterrupted = signal?.aborted === true;
    } catch {
        alreadyInterrupted = true;
    }
    if (alreadyInterrupted) {
        return result({
            status: "inconclusive",
            error_code: "launcher_interrupted",
            attempt_count: 0,
            termination: "none",
            child_exit_observed: false,
        });
    }

    const executable = process.execPath;
    const childArguments = [
        "--import",
        "tsx",
        fileURLToPath(new URL("./cloudflare-worker-canary-cli.ts", import.meta.url)),
    ];
    let child: ChildProcess;
    try {
        const spawnImplementation = testOnly.spawn ?? spawn;
        child = spawnImplementation(executable, childArguments, {
            cwd: fileURLToPath(new URL("../", import.meta.url)),
            env: {},
            detached: false,
            shell: false,
            stdio: ["pipe", "pipe", "pipe", "pipe", "pipe"],
        });
    } catch {
        return result({
            status: "inconclusive",
            error_code: "child_spawn_failed",
            attempt_count: 1,
            termination: "none",
            child_exit_observed: false,
        });
    }

    const observation = observeChild(child);
    const terminationTimeout =
        testOnly.termination_timeout_ms ?? D1_PROBE_WORKER_CANARY_LAUNCH_TERMINATION_TIMEOUT_MS_V1;
    let termination: TerminationV1 = "none";
    const terminate = async (): Promise<boolean> => {
        if (observation.closed()) return true;
        termination = "sigterm";
        try {
            child.kill("SIGTERM");
        } catch {
            // A close event remains the only proof that the child exited.
        }
        if ((await waitFor(observation.close, terminationTimeout)) !== null) return true;
        termination = "sigkill";
        try {
            child.kill("SIGKILL");
        } catch {
            // The bounded close wait below decides whether termination succeeded.
        }
        return (await waitFor(observation.close, terminationTimeout)) !== null;
    };

    if (child.stdin === null || child.stdout === null || child.stderr === null) {
        const terminated = await terminate();
        destroyChildStreams(child);
        if (!terminated) throw new D1ProbeCloudflareWorkerCanarySecureLaunchContainmentErrorV1();
        return result({
            status: "inconclusive",
            error_code: "child_streams_unavailable",
            attempt_count: 1,
            termination,
            child_exit_observed: observation.closed(),
        });
    }
    const commitmentDescriptor = child.stdio[3];
    const apiTokenDescriptor = child.stdio[4];
    if (!isWritableSecretDescriptor(commitmentDescriptor) || !isWritableSecretDescriptor(apiTokenDescriptor)) {
        const terminated = await terminate();
        destroyChildStreams(child);
        if (!terminated) throw new D1ProbeCloudflareWorkerCanarySecureLaunchContainmentErrorV1();
        return result({
            status: "inconclusive",
            error_code: "child_streams_unavailable",
            attempt_count: 1,
            termination,
            child_exit_observed: observation.closed(),
        });
    }

    let outputExceeded!: () => void;
    const outputLimit = new Promise<"output_limit">(resolve => {
        outputExceeded = () => resolve("output_limit");
    });
    let streamFailed!: () => void;
    const streamFailure = new Promise<"stream_error">(resolve => {
        streamFailed = () => resolve("stream_error");
    });
    const stdout = boundedStream(child.stdout, outputExceeded, streamFailed);
    const stderr = boundedStream(child.stderr, outputExceeded, streamFailed);
    child.stdin.on("error", streamFailed);
    commitmentDescriptor.on("error", streamFailed);
    apiTokenDescriptor.on("error", streamFailed);

    let wipeCommitment: () => void = () => undefined;
    let wipeApiToken: () => void = () => undefined;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    let removeAbort: () => void = () => undefined;
    let stdoutBytes: Buffer | null = null;
    let stderrBytes: Buffer | null = null;
    try {
        child.stdin.end(`${command}\n`);
        wipeCommitment = writeSecret(commitmentDescriptor, commitmentKey);
        wipeApiToken = writeSecret(apiTokenDescriptor, apiToken);

        const deadlineSignal = new Promise<"deadline">(resolve => {
            deadline = setTimeout(
                () => resolve("deadline"),
                testOnly.deadline_ms ?? D1_PROBE_WORKER_CANARY_LAUNCH_DEADLINE_MS_V1
            );
        });
        const abortSignal = new Promise<"interrupted">(resolve => {
            const onAbort = () => resolve("interrupted");
            signal?.addEventListener("abort", onAbort, { once: true });
            removeAbort = () => signal?.removeEventListener("abort", onAbort);
            if (signal?.aborted === true) onAbort();
        });
        const observed = await Promise.race([
            observation.close.then(value => ({ kind: "terminal" as const, value })),
            observation.processError.then(value => ({ kind: value })),
            deadlineSignal.then(value => ({ kind: value })),
            abortSignal.then(value => ({ kind: value })),
            outputLimit.then(value => ({ kind: value })),
            streamFailure.then(value => ({ kind: value })),
        ]);

        if (observed.kind !== "terminal") {
            const terminated = await terminate();
            if (!terminated) throw new D1ProbeCloudflareWorkerCanarySecureLaunchContainmentErrorV1();
            return result({
                status: "inconclusive",
                error_code:
                    observed.kind === "deadline"
                        ? "child_deadline_exceeded"
                        : observed.kind === "interrupted"
                          ? "launcher_interrupted"
                          : observed.kind === "output_limit"
                            ? "child_output_limit_exceeded"
                            : observed.kind === "stream_error"
                              ? "child_stream_error"
                              : "child_process_error",
                attempt_count: 1,
                termination,
                child_exit_observed: observation.closed(),
            });
        }

        [stdoutBytes, stderrBytes] = await Promise.all([stdout.done, stderr.done]);
        if (stdout.limitExceeded() || stderr.limitExceeded() || stdout.streamFailed() || stderr.streamFailed()) {
            return result({
                status: "inconclusive",
                error_code:
                    stdout.limitExceeded() || stderr.limitExceeded()
                        ? "child_output_limit_exceeded"
                        : "child_stream_error",
                attempt_count: 1,
                termination,
                child_exit_observed: true,
            });
        }
        if (observed.value.code !== 0 || observed.value.signal !== null || stderrBytes.byteLength !== 0) {
            return result({
                status: "inconclusive",
                error_code: "child_terminal_invalid",
                attempt_count: 1,
                termination: "none",
                child_exit_observed: true,
            });
        }
        const childResult = validateChildResult(stdoutBytes);
        if (childResult === null) {
            return result({
                status: "inconclusive",
                error_code: "child_result_invalid",
                attempt_count: 1,
                termination: "none",
                child_exit_observed: true,
            });
        }
        return result({
            status: "completed",
            child_result_sha256: createHash("sha256").update(childResult, "utf8").digest("hex"),
        });
    } catch (error) {
        if (error instanceof D1ProbeCloudflareWorkerCanarySecureLaunchContainmentErrorV1) throw error;
        const terminated = await terminate().catch(() => false);
        if (!terminated) throw new D1ProbeCloudflareWorkerCanarySecureLaunchContainmentErrorV1();
        return result({
            status: "inconclusive",
            error_code: "child_process_error",
            attempt_count: 1,
            termination,
            child_exit_observed: observation.closed(),
        });
    } finally {
        const cleanup = (action: () => void): void => {
            try {
                action();
            } catch {
                // Each remaining cleanup action must still run.
            }
        };
        cleanup(wipeCommitment);
        cleanup(wipeApiToken);
        cleanup(() => stdout.wipe());
        cleanup(() => stderr.wipe());
        cleanup(() => stdoutBytes?.fill(0));
        cleanup(() => stderrBytes?.fill(0));
        cleanup(() => {
            if (deadline !== undefined) clearTimeout(deadline);
        });
        cleanup(removeAbort);
        cleanup(() => destroyChildStreams(child));
    }
};

export const launchD1ProbeCloudflareWorkerCanarySecureChildV1 = async (
    canonicalCommandInput: unknown,
    commitmentKeyInput: unknown,
    apiTokenInput: unknown,
    options: D1ProbeCloudflareWorkerCanarySecureLauncherOptionsV1 = {}
): Promise<D1ProbeCloudflareWorkerCanarySecureLaunchResultV1> => {
    try {
        return await launchWithDependencies(canonicalCommandInput, commitmentKeyInput, apiTokenInput, options);
    } catch (error) {
        if (error instanceof D1ProbeCloudflareWorkerCanarySecureLaunchContainmentErrorV1) throw error;
        return result({
            status: "inconclusive",
            error_code: "child_process_error",
            attempt_count: 0,
            termination: "none",
            child_exit_observed: false,
        });
    }
};

export const launchD1ProbeCloudflareWorkerCanarySecureChildWithDependenciesTestOnlyV1 = async (
    canonicalCommandInput: unknown,
    commitmentKeyInput: unknown,
    apiTokenInput: unknown,
    options: D1ProbeCloudflareWorkerCanarySecureLauncherOptionsV1,
    testOnly: D1ProbeCloudflareWorkerCanarySecureLauncherTestOnlyV1
): Promise<D1ProbeCloudflareWorkerCanarySecureLaunchResultV1> => {
    try {
        return await launchWithDependencies(
            canonicalCommandInput,
            commitmentKeyInput,
            apiTokenInput,
            options,
            testOnly
        );
    } catch (error) {
        if (error instanceof D1ProbeCloudflareWorkerCanarySecureLaunchContainmentErrorV1) throw error;
        return result({
            status: "inconclusive",
            error_code: "child_process_error",
            attempt_count: 0,
            termination: "none",
            child_exit_observed: false,
        });
    }
};
