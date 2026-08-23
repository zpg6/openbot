import { z } from "zod";

import { SANDBOX_EXECUTION_HARD_LIMITS_V1, SANDBOX_PROTOCOL_VERSION_V1 } from "./constants.js";
import { SandboxProtocolError } from "./errors.js";
import { assertCanonicalJsonV1 } from "./json.js";
import { assertStrictUtf8StringV1, sha256HexV1 } from "./text.js";

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const OpaqueIdSchema = z
    .string()
    .min(16)
    .max(128)
    .regex(/^[A-Za-z0-9._~-]+$/u);
const SequenceSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const FenceSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const SandboxIdSchema = z
    .string()
    .length(64)
    .regex(/^[0-9a-f]{64}$/u);

export const SandboxExecutionLimitsV1Schema = z
    .object({
        max_source_bytes: z.number().int().positive().max(SANDBOX_EXECUTION_HARD_LIMITS_V1.max_source_bytes),
        max_input_bytes: z.number().int().positive().max(SANDBOX_EXECUTION_HARD_LIMITS_V1.max_input_bytes),
        max_stdout_bytes: z.number().int().positive().max(SANDBOX_EXECUTION_HARD_LIMITS_V1.max_stdout_bytes),
        max_stderr_bytes: z.number().int().positive().max(SANDBOX_EXECUTION_HARD_LIMITS_V1.max_stderr_bytes),
        max_result_bytes: z.number().int().positive().max(SANDBOX_EXECUTION_HARD_LIMITS_V1.max_result_bytes),
        max_output_bytes: z.number().int().positive().max(SANDBOX_EXECUTION_HARD_LIMITS_V1.max_output_bytes),
        filesystem_bytes_unverified_target: z
            .number()
            .int()
            .positive()
            .max(SANDBOX_EXECUTION_HARD_LIMITS_V1.filesystem_bytes_unverified_target),
        processes_unverified_target: z
            .number()
            .int()
            .positive()
            .max(SANDBOX_EXECUTION_HARD_LIMITS_V1.processes_unverified_target),
        max_outbound_requests: z.literal(SANDBOX_EXECUTION_HARD_LIMITS_V1.max_outbound_requests),
        max_output_frames: z.number().int().positive().max(SANDBOX_EXECUTION_HARD_LIMITS_V1.max_output_frames),
        execution_timeout_ms: z.number().int().positive().max(SANDBOX_EXECUTION_HARD_LIMITS_V1.execution_timeout_ms),
    })
    .strict()
    .superRefine((limits, context) => {
        if (limits.max_stdout_bytes + limits.max_stderr_bytes + limits.max_result_bytes > limits.max_output_bytes) {
            context.addIssue({
                code: "custom",
                path: ["max_output_bytes"],
                message: "Aggregate output must cover stdout, stderr, and result limits",
            });
        }
    });
export type SandboxExecutionLimitsV1 = z.infer<typeof SandboxExecutionLimitsV1Schema>;

export const UnsignedExecuteJavaScriptRequestV1Schema = z
    .object({
        schema_version: z.literal(SANDBOX_PROTOCOL_VERSION_V1),
        operation: z.literal("execute_javascript_v1"),
        request_id: OpaqueIdSchema,
        consumed_reservation_id: OpaqueIdSchema,
        run_id: OpaqueIdSchema,
        run_attempt_fence: FenceSchema,
        sandbox_id: SandboxIdSchema,
        call_sequence: SequenceSchema,
        manifest_digest: DigestSchema,
        reviewed_runtime_profile_digest: DigestSchema,
        source: z.string(),
        source_digest: DigestSchema,
        input_json: z.string(),
        input_digest: DigestSchema,
        limits: SandboxExecutionLimitsV1Schema,
    })
    .strict();
export type UnsignedExecuteJavaScriptRequestV1 = z.infer<typeof UnsignedExecuteJavaScriptRequestV1Schema>;

export const ExecuteJavaScriptRequestV1Schema = UnsignedExecuteJavaScriptRequestV1Schema.extend({
    request_digest: DigestSchema,
}).strict();
export type ExecuteJavaScriptRequestV1 = z.infer<typeof ExecuteJavaScriptRequestV1Schema>;

const lifecycleBase = {
    schema_version: z.literal(SANDBOX_PROTOCOL_VERSION_V1),
    request_id: OpaqueIdSchema,
    consumed_reservation_id: OpaqueIdSchema,
    run_id: OpaqueIdSchema,
    sandbox_id: SandboxIdSchema,
    call_sequence: SequenceSchema,
    execution_request_digest: DigestSchema,
    fence_value: FenceSchema,
};

export const UnsignedKillSandboxProcessRequestV1Schema = z
    .object({
        ...lifecycleBase,
        operation: z.literal("kill_sandbox_process_v1"),
        fence_kind: z.literal("run_attempt"),
        expected_process_handle_id: OpaqueIdSchema,
    })
    .strict();
export type UnsignedKillSandboxProcessRequestV1 = z.infer<typeof UnsignedKillSandboxProcessRequestV1Schema>;
export const KillSandboxProcessRequestV1Schema = UnsignedKillSandboxProcessRequestV1Schema.extend({
    request_digest: DigestSchema,
}).strict();
export type KillSandboxProcessRequestV1 = z.infer<typeof KillSandboxProcessRequestV1Schema>;

export const UnsignedDestroySandboxRequestV1Schema = z
    .object({
        ...lifecycleBase,
        operation: z.literal("destroy_sandbox_v1"),
        fence_kind: z.enum(["run_attempt", "cleanup"]),
        cleanup_obligation_id: OpaqueIdSchema.nullable(),
        expected_process_handle_id: OpaqueIdSchema.nullable(),
    })
    .strict()
    .superRefine((request, context) => {
        if ((request.fence_kind === "cleanup") !== (request.cleanup_obligation_id !== null)) {
            context.addIssue({
                code: "custom",
                path: ["cleanup_obligation_id"],
                message: "Cleanup authority requires its exact obligation ID",
            });
        }
    });
export type UnsignedDestroySandboxRequestV1 = z.infer<typeof UnsignedDestroySandboxRequestV1Schema>;
export const DestroySandboxRequestV1Schema = UnsignedDestroySandboxRequestV1Schema.extend({
    request_digest: DigestSchema,
}).strict();
export type DestroySandboxRequestV1 = z.infer<typeof DestroySandboxRequestV1Schema>;

const canonicalExecutionFieldProjectionV1 = (request: UnsignedExecuteJavaScriptRequestV1): string =>
    JSON.stringify({
        schema_version: request.schema_version,
        operation: request.operation,
        request_id: request.request_id,
        consumed_reservation_id: request.consumed_reservation_id,
        run_id: request.run_id,
        run_attempt_fence: request.run_attempt_fence,
        sandbox_id: request.sandbox_id,
        call_sequence: request.call_sequence,
        manifest_digest: request.manifest_digest,
        reviewed_runtime_profile_digest: request.reviewed_runtime_profile_digest,
        source: request.source,
        source_digest: request.source_digest,
        input_json: request.input_json,
        input_digest: request.input_digest,
        limits: {
            max_source_bytes: request.limits.max_source_bytes,
            max_input_bytes: request.limits.max_input_bytes,
            max_stdout_bytes: request.limits.max_stdout_bytes,
            max_stderr_bytes: request.limits.max_stderr_bytes,
            max_result_bytes: request.limits.max_result_bytes,
            max_output_bytes: request.limits.max_output_bytes,
            filesystem_bytes_unverified_target: request.limits.filesystem_bytes_unverified_target,
            processes_unverified_target: request.limits.processes_unverified_target,
            max_outbound_requests: request.limits.max_outbound_requests,
            max_output_frames: request.limits.max_output_frames,
            execution_timeout_ms: request.limits.execution_timeout_ms,
        },
    });

const canonicalLifecycleFieldProjectionV1 = (
    request: UnsignedKillSandboxProcessRequestV1 | UnsignedDestroySandboxRequestV1
): string =>
    JSON.stringify({
        schema_version: request.schema_version,
        operation: request.operation,
        request_id: request.request_id,
        consumed_reservation_id: request.consumed_reservation_id,
        run_id: request.run_id,
        sandbox_id: request.sandbox_id,
        call_sequence: request.call_sequence,
        execution_request_digest: request.execution_request_digest,
        fence_kind: request.fence_kind,
        fence_value: request.fence_value,
        cleanup_obligation_id: "cleanup_obligation_id" in request ? request.cleanup_obligation_id : null,
        expected_process_handle_id: request.expected_process_handle_id,
    });

export const computeExecuteJavaScriptRequestDigestV1 = async (
    request: UnsignedExecuteJavaScriptRequestV1
): Promise<string> => sha256HexV1(canonicalExecutionFieldProjectionV1(request));

export const computeLifecycleRequestDigestV1 = async (
    request: UnsignedKillSandboxProcessRequestV1 | UnsignedDestroySandboxRequestV1
): Promise<string> => sha256HexV1(canonicalLifecycleFieldProjectionV1(request));

export const parseAndVerifyExecuteJavaScriptRequestV1 = async (input: unknown): Promise<ExecuteJavaScriptRequestV1> => {
    const parsed = ExecuteJavaScriptRequestV1Schema.safeParse(input);
    if (!parsed.success) throw new SandboxProtocolError("invalid_request", "Invalid JavaScript execution request");
    const request = parsed.data;
    assertStrictUtf8StringV1(request.source, request.limits.max_source_bytes, "source");
    assertStrictUtf8StringV1(request.input_json, request.limits.max_input_bytes, "input_json");
    assertCanonicalJsonV1(request.input_json);
    if ((await sha256HexV1(request.source)) !== request.source_digest) {
        throw new SandboxProtocolError("digest_mismatch", "Source digest does not match source bytes");
    }
    if ((await sha256HexV1(request.input_json)) !== request.input_digest) {
        throw new SandboxProtocolError("digest_mismatch", "Input digest does not match input bytes");
    }
    const { request_digest: expected, ...unsigned } = request;
    if ((await computeExecuteJavaScriptRequestDigestV1(unsigned)) !== expected) {
        throw new SandboxProtocolError(
            "digest_mismatch",
            "Request digest does not match its canonical field projection"
        );
    }
    return request;
};

export const parseAndVerifyKillSandboxProcessRequestV1 = async (
    input: unknown
): Promise<KillSandboxProcessRequestV1> => {
    const parsed = KillSandboxProcessRequestV1Schema.safeParse(input);
    if (!parsed.success) throw new SandboxProtocolError("invalid_request", "Invalid sandbox process kill request");
    const { request_digest: expected, ...unsigned } = parsed.data;
    if ((await computeLifecycleRequestDigestV1(unsigned)) !== expected) {
        throw new SandboxProtocolError(
            "digest_mismatch",
            "Process kill request digest does not match its canonical field projection"
        );
    }
    return parsed.data;
};

export const parseAndVerifyDestroySandboxRequestV1 = async (input: unknown): Promise<DestroySandboxRequestV1> => {
    const parsed = DestroySandboxRequestV1Schema.safeParse(input);
    if (!parsed.success) throw new SandboxProtocolError("invalid_request", "Invalid sandbox destroy request");
    const { request_digest: expected, ...unsigned } = parsed.data;
    if ((await computeLifecycleRequestDigestV1(unsigned)) !== expected) {
        throw new SandboxProtocolError(
            "digest_mismatch",
            "Destroy request digest does not match its canonical field projection"
        );
    }
    return parsed.data;
};
