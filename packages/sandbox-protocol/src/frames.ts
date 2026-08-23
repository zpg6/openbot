import { z } from "zod";

import {
    SANDBOX_EXECUTION_HARD_LIMITS_V1,
    SANDBOX_FRAME_MAX_BYTES_V1,
    SANDBOX_LIFECYCLE_HARD_LIMITS_V1,
    SANDBOX_PROTOCOL_VERSION_V1,
    SANDBOX_STREAM_MAX_BYTES_V1,
    SANDBOX_TEXT_CHUNK_MAX_BYTES_V1,
} from "./constants.js";
import { SandboxProtocolError } from "./errors.js";
import { assertCanonicalJsonV1 } from "./json.js";
import { SandboxExecutionLimitsV1Schema, type SandboxExecutionLimitsV1 } from "./requests.js";
import { assertStrictUtf8StringV1, sha256HexV1, utf8ByteLengthV1 } from "./text.js";

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const SequenceSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const ByteCountSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const OpaqueIdSchema = z
    .string()
    .min(16)
    .max(128)
    .regex(/^[A-Za-z0-9._~-]+$/u);

const frameBase = {
    schema_version: z.literal(SANDBOX_PROTOCOL_VERSION_V1),
    call_sequence: SequenceSchema,
    frame_sequence: SequenceSchema,
    request_digest: DigestSchema,
};

const StartedFrameV1Schema = z
    .object({
        ...frameBase,
        type: z.literal("execution_started"),
        runtime_profile_digest: DigestSchema,
        process_handle_id: OpaqueIdSchema,
        process_pid: z.number().int().positive().max(2_147_483_647),
    })
    .strict();

const textChunkSchema = (type: "stdout_chunk" | "stderr_chunk" | "result_chunk") =>
    z
        .object({
            ...frameBase,
            type: z.literal(type),
            text: z.string(),
        })
        .strict()
        .superRefine((frame, context) => {
            try {
                assertStrictUtf8StringV1(frame.text, SANDBOX_TEXT_CHUNK_MAX_BYTES_V1, "frame text");
            } catch {
                context.addIssue({
                    code: "custom",
                    path: ["text"],
                    message: "Frame text exceeds its strict UTF-8 limit",
                });
            }
        });

const ExecutionErrorFrameV1Schema = z
    .object({
        ...frameBase,
        type: z.literal("execution_error"),
        error_code: z.enum(["execution_failed", "invalid_result", "limit_exceeded", "timed_out"]),
    })
    .strict();

export const SandboxTerminalStatusV1Schema = z.enum([
    "cancelled",
    "failed",
    "outcome_unknown",
    "succeeded",
    "unavailable",
]);

const TerminalFrameV1Schema = z
    .object({
        ...frameBase,
        type: z.literal("terminal"),
        status: SandboxTerminalStatusV1Schema,
        error_code: z
            .enum([
                "cancelled",
                "execution_failed",
                "invalid_request",
                "invalid_result",
                "limit_exceeded",
                "outcome_unknown",
                "runner_internal_error",
                "sandbox_unavailable",
                "timed_out",
            ])
            .nullable(),
        duration_ms: ByteCountSchema.max(SANDBOX_LIFECYCLE_HARD_LIMITS_V1.total_sandbox_age_ms),
        stdout_bytes: ByteCountSchema.max(SANDBOX_EXECUTION_HARD_LIMITS_V1.max_stdout_bytes),
        stderr_bytes: ByteCountSchema.max(SANDBOX_EXECUTION_HARD_LIMITS_V1.max_stderr_bytes),
        result_bytes: ByteCountSchema.max(SANDBOX_EXECUTION_HARD_LIMITS_V1.max_result_bytes),
        output_bytes: ByteCountSchema.max(SANDBOX_EXECUTION_HARD_LIMITS_V1.max_output_bytes),
        stdout_truncated: z.boolean(),
        stderr_truncated: z.boolean(),
        result_truncated: z.boolean(),
        result_content_type: z.literal("application/json").nullable(),
        result_digest: DigestSchema.nullable(),
    })
    .strict()
    .superRefine((frame, context) => {
        if (frame.output_bytes !== frame.stdout_bytes + frame.stderr_bytes + frame.result_bytes) {
            context.addIssue({
                code: "custom",
                path: ["output_bytes"],
                message: "Output bytes must equal component bytes",
            });
        }
        const validStatusError =
            (frame.status === "succeeded" && frame.error_code === null) ||
            (frame.status === "unavailable" &&
                (frame.error_code === "sandbox_unavailable" || frame.error_code === "runner_internal_error")) ||
            (frame.status === "cancelled" && frame.error_code === "cancelled") ||
            (frame.status === "outcome_unknown" && frame.error_code === "outcome_unknown") ||
            (frame.status === "failed" &&
                frame.error_code !== null &&
                ["execution_failed", "invalid_request", "invalid_result", "limit_exceeded", "timed_out"].includes(
                    frame.error_code
                ));
        if (!validStatusError) {
            context.addIssue({
                code: "custom",
                path: ["error_code"],
                message: "Terminal status and error code do not agree",
            });
        }
        const resultMetadataPresent = frame.result_content_type !== null && frame.result_digest !== null;
        if (frame.result_bytes > 0 !== resultMetadataPresent) {
            context.addIssue({
                code: "custom",
                path: ["result_digest"],
                message: "A nonempty result requires its JSON content type and digest",
            });
        }
        if (frame.status === "succeeded" && frame.result_bytes === 0) {
            context.addIssue({
                code: "custom",
                path: ["result_bytes"],
                message: "Successful execution requires one strict JSON result",
            });
        }
        if (
            (frame.stdout_truncated || frame.stderr_truncated || frame.result_truncated) &&
            !(frame.status === "failed" && frame.error_code === "limit_exceeded")
        ) {
            context.addIssue({
                code: "custom",
                path: ["status"],
                message: "Truncated output must terminate as a limit failure",
            });
        }
    });

export const SandboxFrameV1Schema = z.discriminatedUnion("type", [
    StartedFrameV1Schema,
    textChunkSchema("stdout_chunk"),
    textChunkSchema("stderr_chunk"),
    textChunkSchema("result_chunk"),
    ExecutionErrorFrameV1Schema,
    TerminalFrameV1Schema,
]);
export type SandboxFrameV1 = z.infer<typeof SandboxFrameV1Schema>;
export type SandboxTerminalFrameV1 = z.infer<typeof TerminalFrameV1Schema>;

const encoder = new TextEncoder();

export const encodeSandboxFrameV1 = (frame: SandboxFrameV1): Uint8Array => {
    const parsed = SandboxFrameV1Schema.safeParse(frame);
    if (!parsed.success) throw new SandboxProtocolError("invalid_frame", "Cannot encode an invalid sandbox frame");
    const bytes = encoder.encode(`${JSON.stringify(parsed.data)}\n`);
    if (bytes.byteLength > SANDBOX_FRAME_MAX_BYTES_V1) {
        throw new SandboxProtocolError("frame_too_large", "Encoded sandbox frame exceeds 16 KiB");
    }
    return bytes;
};

export const createSandboxFrameStreamV1 = async (
    frames: readonly SandboxFrameV1[],
    expectedLimits: SandboxExecutionLimitsV1 = SANDBOX_EXECUTION_HARD_LIMITS_V1
): Promise<ReadableStream<Uint8Array>> => {
    let sawTerminal = false;
    for (const [index, frame] of frames.entries()) {
        if (frame.frame_sequence !== index) {
            throw new SandboxProtocolError(
                "sequence_mismatch",
                "Encoded frame sequence must start at zero and be contiguous"
            );
        }
        if (sawTerminal) throw new SandboxProtocolError("bytes_after_terminal", "A terminal frame must be last");
        if (frame.type === "terminal") sawTerminal = true;
    }
    if (!sawTerminal)
        throw new SandboxProtocolError("terminal_missing", "Encoded frame stream needs one terminal frame");
    const encoded = frames.map(encodeSandboxFrameV1);
    const total = encoded.reduce((sum, bytes) => sum + bytes.byteLength, 0);
    if (total > SANDBOX_STREAM_MAX_BYTES_V1) {
        throw new SandboxProtocolError("stream_too_large", "Encoded sandbox stream exceeds its aggregate limit");
    }
    const first = frames[0];
    if (!first) throw new SandboxProtocolError("terminal_missing", "Encoded frame stream needs one terminal frame");
    const started = frames.find(frame => frame.type === "execution_started");
    const verifier = new SandboxFrameDecoderV1(
        first.request_digest,
        started?.type === "execution_started" ? started.runtime_profile_digest : "0".repeat(64),
        first.call_sequence,
        expectedLimits
    );
    for (const bytes of encoded) verifier.push(bytes);
    await verifier.finish();
    return new ReadableStream<Uint8Array>({
        start(controller) {
            for (const bytes of encoded) controller.enqueue(bytes);
            controller.close();
        },
    });
};

export class SandboxFrameDecoderV1 {
    readonly #decoder = new TextDecoder("utf-8", { fatal: true });
    readonly #expectedRequestDigest: string;
    readonly #expectedRuntimeProfileDigest: string;
    readonly #expectedCallSequence: number;
    readonly #expectedLimits: SandboxExecutionLimitsV1;
    readonly #frames: SandboxFrameV1[] = [];
    #buffer = "";
    #bufferBytes = 0;
    #streamBytes = 0;
    #terminal = false;
    #started = false;
    #stdoutBytes = 0;
    #stderrBytes = 0;
    #resultBytes = 0;
    #resultText = "";
    #executionErrorCode: string | null = null;

    constructor(
        expectedRequestDigest: string,
        expectedRuntimeProfileDigest: string,
        expectedCallSequence: number,
        expectedLimits: SandboxExecutionLimitsV1
    ) {
        if (!DigestSchema.safeParse(expectedRequestDigest).success) {
            throw new SandboxProtocolError("invalid_request", "Expected request digest must be a SHA-256 digest");
        }
        if (!DigestSchema.safeParse(expectedRuntimeProfileDigest).success) {
            throw new SandboxProtocolError("invalid_request", "Expected runtime profile must be a SHA-256 digest");
        }
        if (!SequenceSchema.safeParse(expectedCallSequence).success) {
            throw new SandboxProtocolError("invalid_request", "Expected call sequence must be a nonnegative integer");
        }
        const parsedLimits = SandboxExecutionLimitsV1Schema.safeParse(expectedLimits);
        if (!parsedLimits.success) {
            throw new SandboxProtocolError("invalid_request", "Expected limits must fit the Sandbox hard profile");
        }
        this.#expectedRequestDigest = expectedRequestDigest;
        this.#expectedRuntimeProfileDigest = expectedRuntimeProfileDigest;
        this.#expectedCallSequence = expectedCallSequence;
        this.#expectedLimits = parsedLimits.data;
    }

    push(bytes: Uint8Array): readonly SandboxFrameV1[] {
        if (this.#terminal && bytes.byteLength > 0) {
            throw new SandboxProtocolError("bytes_after_terminal", "Received bytes after terminal frame");
        }
        this.#streamBytes += bytes.byteLength;
        if (this.#streamBytes > SANDBOX_STREAM_MAX_BYTES_V1) {
            throw new SandboxProtocolError("stream_too_large", "Sandbox stream exceeds its aggregate limit");
        }
        let text: string;
        try {
            text = this.#decoder.decode(bytes, { stream: true });
        } catch {
            throw new SandboxProtocolError("invalid_utf8", "Sandbox stream contains invalid UTF-8");
        }
        this.#buffer += text;
        this.#bufferBytes += bytes.byteLength;
        const emitted: SandboxFrameV1[] = [];
        let newline = this.#buffer.indexOf("\n");
        while (newline >= 0) {
            const line = this.#buffer.slice(0, newline);
            const lineBytes = encoder.encode(`${line}\n`).byteLength;
            if (lineBytes > SANDBOX_FRAME_MAX_BYTES_V1) {
                throw new SandboxProtocolError("frame_too_large", "Sandbox frame exceeds 16 KiB");
            }
            this.#buffer = this.#buffer.slice(newline + 1);
            this.#bufferBytes -= lineBytes;
            this.#acceptLine(line, emitted);
            newline = this.#buffer.indexOf("\n");
        }
        if (this.#bufferBytes > SANDBOX_FRAME_MAX_BYTES_V1) {
            throw new SandboxProtocolError("frame_too_large", "Incomplete sandbox frame exceeds 16 KiB");
        }
        return emitted;
    }

    async finish(): Promise<readonly SandboxFrameV1[]> {
        let tail: string;
        try {
            tail = this.#decoder.decode();
        } catch {
            throw new SandboxProtocolError("invalid_utf8", "Sandbox stream ends with invalid UTF-8");
        }
        if (tail.length > 0) this.#buffer += tail;
        if (this.#buffer.length > 0) {
            throw new SandboxProtocolError("invalid_frame", "Sandbox stream must end on an NDJSON newline");
        }
        if (!this.#terminal) throw new SandboxProtocolError("terminal_missing", "Sandbox stream has no terminal frame");
        const terminal = this.#frames.at(-1);
        if (!terminal || terminal.type !== "terminal") {
            throw new SandboxProtocolError("terminal_missing", "Sandbox stream has no terminal frame");
        }
        if (terminal.result_bytes > 0) {
            assertCanonicalJsonV1(this.#resultText);
            if ((await sha256HexV1(this.#resultText)) !== terminal.result_digest) {
                throw new SandboxProtocolError("digest_mismatch", "Result digest does not match canonical JSON bytes");
            }
        }
        return this.#frames;
    }

    #acceptLine(line: string, emitted: SandboxFrameV1[]): void {
        if (this.#terminal) throw new SandboxProtocolError("bytes_after_terminal", "Received a frame after terminal");
        if (this.#frames.length >= this.#expectedLimits.max_output_frames) {
            throw new SandboxProtocolError("stream_too_large", "Sandbox stream exceeded its signed frame limit");
        }
        if (line.length === 0 || line.includes("\r")) {
            throw new SandboxProtocolError("invalid_frame", "Sandbox NDJSON lines must be nonempty and LF-terminated");
        }
        let value: unknown;
        try {
            value = JSON.parse(line) as unknown;
        } catch {
            throw new SandboxProtocolError("invalid_frame", "Sandbox frame is not valid JSON");
        }
        const parsed = SandboxFrameV1Schema.safeParse(value);
        if (!parsed.success)
            throw new SandboxProtocolError("invalid_frame", "Sandbox frame does not match the protocol");
        const frame = parsed.data;
        if (JSON.stringify(frame) !== line) {
            throw new SandboxProtocolError("invalid_frame", "Sandbox frame must use the canonical wire encoding");
        }
        if (frame.frame_sequence !== this.#frames.length) {
            throw new SandboxProtocolError(
                "sequence_mismatch",
                "Sandbox frame sequence is missing, repeated, or reordered"
            );
        }
        if (frame.request_digest !== this.#expectedRequestDigest) {
            throw new SandboxProtocolError("request_digest_mismatch", "Sandbox frame belongs to another request");
        }
        if (frame.call_sequence !== this.#expectedCallSequence) {
            throw new SandboxProtocolError(
                "sequence_mismatch",
                "Sandbox frame belongs to another gateway call sequence"
            );
        }
        if (frame.type === "execution_started") {
            if (this.#started || frame.frame_sequence !== 0) {
                throw new SandboxProtocolError("invalid_frame", "Execution may start exactly once at frame zero");
            }
            if (frame.runtime_profile_digest !== this.#expectedRuntimeProfileDigest) {
                throw new SandboxProtocolError("request_digest_mismatch", "Sandbox used an unreviewed runtime profile");
            }
            this.#started = true;
        } else if (frame.type === "stdout_chunk" || frame.type === "stderr_chunk" || frame.type === "result_chunk") {
            if (!this.#started) {
                throw new SandboxProtocolError("invalid_frame", "Output cannot precede execution start");
            }
            if (this.#executionErrorCode !== null) {
                throw new SandboxProtocolError("invalid_frame", "Output cannot follow an execution-error frame");
            }
            const count = utf8ByteLengthV1(frame.text);
            if (frame.type === "stdout_chunk") this.#stdoutBytes += count;
            if (frame.type === "stderr_chunk") this.#stderrBytes += count;
            if (frame.type === "result_chunk") {
                this.#resultBytes += count;
                this.#resultText += frame.text;
            }
            if (
                this.#stdoutBytes > this.#expectedLimits.max_stdout_bytes ||
                this.#stderrBytes > this.#expectedLimits.max_stderr_bytes ||
                this.#resultBytes > this.#expectedLimits.max_result_bytes ||
                this.#stdoutBytes + this.#stderrBytes + this.#resultBytes > this.#expectedLimits.max_output_bytes
            ) {
                throw new SandboxProtocolError("stream_too_large", "Sandbox output exceeded its mechanical limit");
            }
        } else if (frame.type === "execution_error") {
            if (!this.#started) {
                throw new SandboxProtocolError("invalid_frame", "Execution errors cannot precede execution start");
            }
            if (this.#executionErrorCode !== null) {
                throw new SandboxProtocolError("invalid_frame", "Execution may emit at most one error frame");
            }
            this.#executionErrorCode = frame.error_code;
        } else if (frame.type === "terminal") {
            const preStartTerminal =
                (frame.status === "failed" && frame.error_code === "invalid_request") ||
                (frame.status === "unavailable" &&
                    (frame.error_code === "sandbox_unavailable" || frame.error_code === "runner_internal_error")) ||
                (frame.status === "outcome_unknown" && frame.error_code === "outcome_unknown");
            if (!this.#started && !preStartTerminal) {
                throw new SandboxProtocolError(
                    "invalid_frame",
                    "Only rejection or unavailability may terminate before start"
                );
            }
            if (
                frame.stdout_bytes !== this.#stdoutBytes ||
                frame.stderr_bytes !== this.#stderrBytes ||
                frame.result_bytes !== this.#resultBytes
            ) {
                throw new SandboxProtocolError("invalid_frame", "Terminal byte counts do not match emitted chunks");
            }
            if (frame.duration_ms > this.#expectedLimits.execution_timeout_ms) {
                throw new SandboxProtocolError("invalid_frame", "Execution exceeded its signed per-call timeout");
            }
            if (
                this.#started &&
                frame.status === "failed" &&
                (this.#executionErrorCode === null || this.#executionErrorCode !== frame.error_code)
            ) {
                throw new SandboxProtocolError("invalid_frame", "Failed terminal must match one execution-error frame");
            }
            if (frame.status !== "failed" && this.#executionErrorCode !== null) {
                throw new SandboxProtocolError(
                    "invalid_frame",
                    "Only a failed terminal may follow an execution-error frame"
                );
            }
        }
        this.#frames.push(frame);
        emitted.push(frame);
        if (frame.type === "terminal") this.#terminal = true;
    }
}

export const decodeSandboxFrameStreamV1 = async (
    stream: ReadableStream<Uint8Array>,
    expectedRequestDigest: string,
    expectedRuntimeProfileDigest: string,
    expectedCallSequence: number,
    expectedLimits: SandboxExecutionLimitsV1
): Promise<readonly SandboxFrameV1[]> => {
    const decoder = new SandboxFrameDecoderV1(
        expectedRequestDigest,
        expectedRuntimeProfileDigest,
        expectedCallSequence,
        expectedLimits
    );
    const reader = stream.getReader();
    try {
        for (;;) {
            const next = await reader.read();
            if (next.done) break;
            decoder.push(next.value);
        }
        return await decoder.finish();
    } catch (error) {
        try {
            await reader.cancel("sandbox_protocol_error");
        } catch {
            // Stream cancellation stops import only. It is not evidence that the Sandbox process stopped.
        }
        throw error;
    } finally {
        reader.releaseLock();
    }
};
