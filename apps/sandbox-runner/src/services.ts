import {
    SANDBOX_PROTOCOL_VERSION_V1,
    SandboxProtocolError,
    createSandboxFrameStreamV1,
    parseAndVerifyDestroySandboxRequestV1,
    parseAndVerifyExecuteJavaScriptRequestV1,
    parseAndVerifyKillSandboxProcessRequestV1,
    type SandboxExecutionServiceV1,
    type SandboxExecutionLimitsV1,
    type SandboxLifecycleAckV1,
    type SandboxLifecycleServiceV1,
} from "@openbot/sandbox-protocol";
import { WorkerEntrypoint } from "cloudflare:workers";

const fallbackDigest = "0".repeat(64);
const requestDigestFrom = (input: unknown): string => {
    if (typeof input !== "object" || input === null || !("request_digest" in input)) return fallbackDigest;
    const digest = input.request_digest;
    return typeof digest === "string" && /^[0-9a-f]{64}$/u.test(digest) ? digest : fallbackDigest;
};
const callSequenceFrom = (input: unknown): number => {
    if (typeof input !== "object" || input === null || !("call_sequence" in input)) return 0;
    const sequence = input.call_sequence;
    return typeof sequence === "number" && Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : 0;
};

const terminalStream = async (
    requestDigest: string,
    callSequence: number,
    status: "failed" | "unavailable",
    errorCode: "invalid_request" | "runner_internal_error" | "sandbox_unavailable",
    limits?: SandboxExecutionLimitsV1
): Promise<ReadableStream<Uint8Array>> =>
    createSandboxFrameStreamV1(
        [
            {
                schema_version: SANDBOX_PROTOCOL_VERSION_V1,
                call_sequence: callSequence,
                frame_sequence: 0,
                request_digest: requestDigest,
                type: "terminal",
                status,
                error_code: errorCode,
                duration_ms: 0,
                stdout_bytes: 0,
                stderr_bytes: 0,
                result_bytes: 0,
                output_bytes: 0,
                stdout_truncated: false,
                stderr_truncated: false,
                result_truncated: false,
                result_content_type: null,
                result_digest: null,
            },
        ],
        limits
    );

export class SandboxExecutionService extends WorkerEntrypoint implements SandboxExecutionServiceV1 {
    async execute(input: unknown): Promise<ReadableStream<Uint8Array>> {
        try {
            const request = await parseAndVerifyExecuteJavaScriptRequestV1(input);
            return await terminalStream(
                request.request_digest,
                request.call_sequence,
                "unavailable",
                "sandbox_unavailable",
                request.limits
            );
        } catch (error) {
            return await terminalStream(
                requestDigestFrom(input),
                callSequenceFrom(input),
                error instanceof SandboxProtocolError ? "failed" : "unavailable",
                error instanceof SandboxProtocolError ? "invalid_request" : "runner_internal_error"
            );
        }
    }
}

const unavailableAck = (
    requestDigest: string,
    operation: "kill_sandbox_process_v1" | "destroy_sandbox_v1",
    internal = false
): SandboxLifecycleAckV1 => ({
    schema_version: SANDBOX_PROTOCOL_VERSION_V1,
    request_digest: requestDigest,
    operation,
    status: "unavailable",
    error_code: internal ? "runner_internal_error" : "sandbox_unavailable",
});

export const lifecyclePostCallOutcomeUnknownV1 = (
    requestDigest: string,
    operation: "kill_sandbox_process_v1" | "destroy_sandbox_v1"
): SandboxLifecycleAckV1 => ({
    schema_version: SANDBOX_PROTOCOL_VERSION_V1,
    request_digest: requestDigest,
    operation,
    status: "outcome_unknown",
    error_code: "outcome_unknown",
});

export class SandboxLifecycleService extends WorkerEntrypoint implements SandboxLifecycleServiceV1 {
    async kill(input: unknown): Promise<SandboxLifecycleAckV1> {
        try {
            const request = await parseAndVerifyKillSandboxProcessRequestV1(input);
            return unavailableAck(request.request_digest, request.operation);
        } catch (error) {
            if (!(error instanceof SandboxProtocolError)) {
                return unavailableAck(requestDigestFrom(input), "kill_sandbox_process_v1", true);
            }
            return {
                schema_version: SANDBOX_PROTOCOL_VERSION_V1,
                request_digest: requestDigestFrom(input),
                operation: "kill_sandbox_process_v1",
                status: "rejected",
                error_code: "invalid_request",
            };
        }
    }

    async destroy(input: unknown): Promise<SandboxLifecycleAckV1> {
        try {
            const request = await parseAndVerifyDestroySandboxRequestV1(input);
            return unavailableAck(request.request_digest, request.operation);
        } catch (error) {
            if (!(error instanceof SandboxProtocolError)) {
                return unavailableAck(requestDigestFrom(input), "destroy_sandbox_v1", true);
            }
            return {
                schema_version: SANDBOX_PROTOCOL_VERSION_V1,
                request_digest: requestDigestFrom(input),
                operation: "destroy_sandbox_v1",
                status: "rejected",
                error_code: "invalid_request",
            };
        }
    }
}
