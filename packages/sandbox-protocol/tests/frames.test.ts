import { describe, expect, it } from "vitest";

import {
    SANDBOX_EXECUTION_HARD_LIMITS_V1,
    SANDBOX_FRAME_MAX_BYTES_V1,
    SANDBOX_FRAME_MAX_COUNT_V1,
    SANDBOX_PROTOCOL_VERSION_V1,
} from "../src/constants.js";
import {
    SandboxFrameDecoderV1,
    createSandboxFrameStreamV1,
    decodeSandboxFrameStreamV1,
    encodeSandboxFrameV1,
    type SandboxFrameV1,
    type SandboxTerminalFrameV1,
} from "../src/frames.js";
import { sha256HexV1 } from "../src/text.js";

const digest = "d".repeat(64);
const callSequence = 3;
const terminal = (
    frame_sequence: number,
    counts: { stdout_bytes?: number; stderr_bytes?: number; result_bytes?: number } = {}
): SandboxTerminalFrameV1 => {
    const stdoutBytes = counts.stdout_bytes ?? 0;
    const stderrBytes = counts.stderr_bytes ?? 0;
    const resultBytes = counts.result_bytes ?? 0;
    return {
        schema_version: SANDBOX_PROTOCOL_VERSION_V1,
        call_sequence: callSequence,
        frame_sequence,
        request_digest: digest,
        type: "terminal",
        status: "failed",
        error_code: "invalid_request",
        duration_ms: 0,
        stdout_bytes: stdoutBytes,
        stderr_bytes: stderrBytes,
        result_bytes: resultBytes,
        output_bytes: stdoutBytes + stderrBytes + resultBytes,
        stdout_truncated: false,
        stderr_truncated: false,
        result_truncated: false,
        result_content_type: null,
        result_digest: null,
    };
};

const started = (frame_sequence: number): SandboxFrameV1 => ({
    schema_version: SANDBOX_PROTOCOL_VERSION_V1,
    call_sequence: callSequence,
    frame_sequence,
    request_digest: digest,
    type: "execution_started",
    runtime_profile_digest: "a".repeat(64),
    process_handle_id: "process_000000001",
    process_pid: 4242,
});

const stdout = (frame_sequence: number, text = "ok"): SandboxFrameV1 => ({
    schema_version: SANDBOX_PROTOCOL_VERSION_V1,
    call_sequence: callSequence,
    frame_sequence,
    request_digest: digest,
    type: "stdout_chunk",
    text,
});

const result = (frame_sequence: number, text: string): SandboxFrameV1 => ({
    schema_version: SANDBOX_PROTOCOL_VERSION_V1,
    call_sequence: callSequence,
    frame_sequence,
    request_digest: digest,
    type: "result_chunk",
    text,
});

const executionError = (frame_sequence: number, error_code: "execution_failed" | "timed_out"): SandboxFrameV1 => ({
    schema_version: SANDBOX_PROTOCOL_VERSION_V1,
    call_sequence: callSequence,
    frame_sequence,
    request_digest: digest,
    type: "execution_error",
    error_code,
});

const successfulTerminal = async (frameSequence: number, resultText: string): Promise<SandboxTerminalFrameV1> => ({
    ...terminal(frameSequence, { result_bytes: new TextEncoder().encode(resultText).byteLength }),
    status: "succeeded",
    error_code: null,
    duration_ms: 1,
    result_content_type: "application/json",
    result_digest: await sha256HexV1(resultText),
});

const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

describe("sandbox NDJSON framing", () => {
    it("decodes split UTF-8 chunks with contiguous sequences and one terminal", async () => {
        const resultText = '{"ok":true}';
        const expected = [
            started(0),
            stdout(1, "hello 🌎"),
            result(2, resultText),
            {
                ...(await successfulTerminal(3, resultText)),
                stdout_bytes: 10,
                output_bytes: 21,
            },
        ];
        const encoded = expected.map(encodeSandboxFrameV1);
        const totalBytes = encoded.reduce((sum, frame) => sum + frame.byteLength, 0);
        const all = new Uint8Array(totalBytes);
        let offset = 0;
        for (const frame of encoded) {
            all.set(frame, offset);
            offset += frame.byteLength;
        }
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                for (const byte of all) controller.enqueue(Uint8Array.of(byte));
                controller.close();
            },
        });
        await expect(
            decodeSandboxFrameStreamV1(stream, digest, "a".repeat(64), callSequence, SANDBOX_EXECUTION_HARD_LIMITS_V1)
        ).resolves.toEqual(expected);
    });

    it.each([
        ["gap", [stdout(1), terminal(2)], "sequence_mismatch"],
        ["repeat", [stdout(0), terminal(0)], "sequence_mismatch"],
        ["missing terminal", [stdout(0)], "terminal_missing"],
        ["frame after terminal", [terminal(0), stdout(1)], "bytes_after_terminal"],
    ] as const)("rejects %s", async (_name, frames, code) => {
        await expect(createSandboxFrameStreamV1(frames)).rejects.toMatchObject({ code });
    });

    it("rejects the wrong request digest", () => {
        const decoder = new SandboxFrameDecoderV1(
            "e".repeat(64),
            "a".repeat(64),
            callSequence,
            SANDBOX_EXECUTION_HARD_LIMITS_V1
        );
        expect(() => decoder.push(encodeSandboxFrameV1(terminal(0)))).toThrow(
            expect.objectContaining({ code: "request_digest_mismatch" })
        );
    });

    it("rejects an execution started with an unreviewed runtime profile", () => {
        const decoder = new SandboxFrameDecoderV1(
            digest,
            "b".repeat(64),
            callSequence,
            SANDBOX_EXECUTION_HARD_LIMITS_V1
        );
        expect(() => decoder.push(encodeSandboxFrameV1(started(0)))).toThrow(
            expect.objectContaining({ code: "request_digest_mismatch" })
        );
    });

    it.each([
        ["blank line", bytes("\n")],
        ["CRLF", bytes(`${JSON.stringify(terminal(0))}\r\n`)],
        ["invalid JSON", bytes("{\n")],
        ["invalid UTF-8", Uint8Array.of(0xff, 0x0a)],
    ])("rejects %s", (_name, input) => {
        const decoder = new SandboxFrameDecoderV1(
            digest,
            "a".repeat(64),
            callSequence,
            SANDBOX_EXECUTION_HARD_LIMITS_V1
        );
        expect(() => decoder.push(input)).toThrow();
    });

    it("rejects a frame above 16 KiB and an unterminated final line", async () => {
        const decoder = new SandboxFrameDecoderV1(
            digest,
            "a".repeat(64),
            callSequence,
            SANDBOX_EXECUTION_HARD_LIMITS_V1
        );
        expect(() => decoder.push(bytes("x".repeat(SANDBOX_FRAME_MAX_BYTES_V1 + 1)))).toThrow(
            expect.objectContaining({ code: "frame_too_large" })
        );

        const incomplete = new SandboxFrameDecoderV1(
            digest,
            "a".repeat(64),
            callSequence,
            SANDBOX_EXECUTION_HARD_LIMITS_V1
        );
        incomplete.push(bytes(JSON.stringify(terminal(0))));
        await expect(incomplete.finish()).rejects.toMatchObject({ code: "invalid_frame" });
    });

    it("rejects more than 64 frames", () => {
        const decoder = new SandboxFrameDecoderV1(
            digest,
            "a".repeat(64),
            callSequence,
            SANDBOX_EXECUTION_HARD_LIMITS_V1
        );
        decoder.push(encodeSandboxFrameV1(started(0)));
        for (let sequence = 1; sequence < SANDBOX_FRAME_MAX_COUNT_V1; sequence += 1) {
            decoder.push(encodeSandboxFrameV1(stdout(sequence, "")));
        }
        expect(() => decoder.push(encodeSandboxFrameV1(terminal(SANDBOX_FRAME_MAX_COUNT_V1)))).toThrow(
            expect.objectContaining({ code: "stream_too_large" })
        );
    });

    it("rejects a channel before it can exceed its output ceiling", () => {
        const decoder = new SandboxFrameDecoderV1(
            digest,
            "a".repeat(64),
            callSequence,
            SANDBOX_EXECUTION_HARD_LIMITS_V1
        );
        decoder.push(encodeSandboxFrameV1(started(0)));
        for (let sequence = 1; sequence <= 4; sequence += 1) {
            decoder.push(encodeSandboxFrameV1(stdout(sequence, "x".repeat(12_000))));
        }
        expect(() => decoder.push(encodeSandboxFrameV1(stdout(5, "x".repeat(1_153))))).toThrow(
            expect.objectContaining({ code: "stream_too_large" })
        );
    });

    it("rejects inconsistent terminal byte accounting", () => {
        const invalid = { ...terminal(0), output_bytes: 1 } as SandboxFrameV1;
        expect(() => encodeSandboxFrameV1(invalid)).toThrow(expect.objectContaining({ code: "invalid_frame" }));
    });

    it("rejects byte counts that do not match emitted chunks", async () => {
        await expect(createSandboxFrameStreamV1([started(0), stdout(1, "ok"), terminal(2)])).rejects.toMatchObject({
            code: "invalid_frame",
        });
    });

    it("rejects non-canonical or duplicate-key wire JSON", () => {
        const rejected = { ...terminal(0), status: "failed" as const, error_code: "invalid_request" as const };
        const canonical = JSON.stringify(rejected);
        const whitespaceDecoder = new SandboxFrameDecoderV1(
            digest,
            "a".repeat(64),
            callSequence,
            SANDBOX_EXECUTION_HARD_LIMITS_V1
        );
        expect(() => whitespaceDecoder.push(bytes(` ${canonical}\n`))).toThrow(
            expect.objectContaining({ code: "invalid_frame" })
        );

        const duplicate = canonical.replace('"type":"terminal"', '"type":"terminal","type":"terminal"');
        const duplicateDecoder = new SandboxFrameDecoderV1(
            digest,
            "a".repeat(64),
            callSequence,
            SANDBOX_EXECUTION_HARD_LIMITS_V1
        );
        expect(() => duplicateDecoder.push(bytes(`${duplicate}\n`))).toThrow(
            expect.objectContaining({ code: "invalid_frame" })
        );
    });

    it("binds every frame to the gateway call sequence", () => {
        const decoder = new SandboxFrameDecoderV1(
            digest,
            "a".repeat(64),
            callSequence + 1,
            SANDBOX_EXECUTION_HARD_LIMITS_V1
        );
        expect(() => decoder.push(encodeSandboxFrameV1(terminal(0)))).toThrow(
            expect.objectContaining({ code: "sequence_mismatch" })
        );
    });

    it("allows pre-start outcome unknown after a possibly effective SDK call", async () => {
        const uncertain = {
            ...terminal(0),
            status: "outcome_unknown" as const,
            error_code: "outcome_unknown" as const,
        };
        await expect(createSandboxFrameStreamV1([uncertain])).resolves.toBeInstanceOf(ReadableStream);
    });

    it("requires one execution-error frame to match a failed post-start terminal", async () => {
        const valid = [
            started(0),
            executionError(1, "execution_failed"),
            { ...terminal(2), error_code: "execution_failed" as const },
        ];
        await expect(createSandboxFrameStreamV1(valid)).resolves.toBeInstanceOf(ReadableStream);

        const mismatched = [
            started(0),
            executionError(1, "timed_out"),
            { ...terminal(2), error_code: "execution_failed" as const },
        ];
        await expect(createSandboxFrameStreamV1(mismatched)).rejects.toMatchObject({ code: "invalid_frame" });
    });

    it.each(['{"b":1,"a":2}', "<script>alert(1)</script>", "# markdown"])(
        "rejects a noncanonical result: %s",
        async resultText => {
            const frames = [started(0), result(1, resultText), await successfulTerminal(2, resultText)];
            await expect(createSandboxFrameStreamV1(frames)).rejects.toMatchObject({
                code: "invalid_canonical_json",
            });
        }
    );

    it("rejects a forged canonical-result digest", async () => {
        const resultText = '{"ok":true}';
        const frames = [
            started(0),
            result(1, resultText),
            { ...(await successfulTerminal(2, resultText)), result_digest: "f".repeat(64) },
        ];
        await expect(createSandboxFrameStreamV1(frames)).rejects.toMatchObject({ code: "digest_mismatch" });
    });

    it("does not permit truncation to report success", async () => {
        const resultText = "null";
        const invalid = { ...(await successfulTerminal(0, resultText)), result_truncated: true } as SandboxFrameV1;
        expect(() => encodeSandboxFrameV1(invalid)).toThrow(expect.objectContaining({ code: "invalid_frame" }));
    });

    it("enforces narrowed output, frame, and process-time limits", () => {
        const limits = {
            ...SANDBOX_EXECUTION_HARD_LIMITS_V1,
            max_stdout_bytes: 2,
            max_output_frames: 2,
            execution_timeout_ms: 1,
        };
        const outputDecoder = new SandboxFrameDecoderV1(digest, "a".repeat(64), callSequence, limits);
        outputDecoder.push(encodeSandboxFrameV1(started(0)));
        expect(() => outputDecoder.push(encodeSandboxFrameV1(stdout(1, "too large")))).toThrow(
            expect.objectContaining({ code: "stream_too_large" })
        );

        const durationDecoder = new SandboxFrameDecoderV1(digest, "a".repeat(64), callSequence, limits);
        durationDecoder.push(encodeSandboxFrameV1(started(0)));
        expect(() => durationDecoder.push(encodeSandboxFrameV1({ ...terminal(1), duration_ms: 2 }))).toThrow(
            expect.objectContaining({ code: "invalid_frame" })
        );
    });

    it("cancels a rejected byte stream without treating cancellation as process termination", async () => {
        let cancelledWith: unknown;
        const stream = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(bytes("not-json\n"));
            },
            cancel(reason) {
                cancelledWith = reason;
            },
        });

        await expect(
            decodeSandboxFrameStreamV1(stream, digest, "a".repeat(64), callSequence, SANDBOX_EXECUTION_HARD_LIMITS_V1)
        ).rejects.toMatchObject({ code: "invalid_frame" });
        expect(cancelledWith).toBe("sandbox_protocol_error");
    });
});
