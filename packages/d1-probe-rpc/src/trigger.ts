import { z } from "zod";

import {
    D1ProbeD1MetadataV1Schema,
    D1ProbeGatewayReservationRequestV1Schema,
    D1ProbeGatewayReservationResponseV1Schema,
    parseAndVerifyD1ProbeGatewayReservationRequestV1,
} from "./gateway.js";
import { D1_PROBE_RPC_VERSION_V1, D1ProbeRpcError } from "./protocol.js";

export const D1_PROBE_GATEWAY_BARRIER_TIMEOUT_MS_V1 = 2_000 as const;
export const D1_PROBE_GATEWAY_BARRIER_POLL_INTERVAL_MS_V1 = 25 as const;
export const D1_PROBE_GATEWAY_BARRIER_MAX_POLLS_V1 = 80 as const;

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const OpaqueIdSchema = z
    .string()
    .min(16)
    .max(128)
    .regex(/^[A-Za-z0-9._~-]+$/u);
const TrialIdSchema = z
    .string()
    .min(16)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/u);

export const UnsignedD1ProbeGatewayTrialRequestV1Schema = z
    .object({
        schema_version: z.literal(D1_PROBE_RPC_VERSION_V1),
        operation: z.literal("run_gateway_trial_v1"),
        request_id: OpaqueIdSchema,
        probe_run_id: OpaqueIdSchema,
        trial_id: TrialIdSchema,
        child_process_id: OpaqueIdSchema,
        writer_role: z.enum(["writer_a", "writer_b"]),
        expected_contender_count: z.literal(2),
        go_receipt_digest: DigestSchema,
        barrier_timeout_ms: z.literal(D1_PROBE_GATEWAY_BARRIER_TIMEOUT_MS_V1),
        barrier_poll_interval_ms: z.literal(D1_PROBE_GATEWAY_BARRIER_POLL_INTERVAL_MS_V1),
        gateway_request: D1ProbeGatewayReservationRequestV1Schema,
    })
    .strict()
    .superRefine((request, context) => {
        if (
            request.gateway_request.probe_run_id !== request.probe_run_id ||
            request.gateway_request.scenario !== request.trial_id ||
            request.gateway_request.writer_role !== request.writer_role
        ) {
            context.addIssue({
                code: "custom",
                path: ["gateway_request"],
                message: "Gateway request must match the trial run, ID, and writer role",
            });
        }
    });
export type UnsignedD1ProbeGatewayTrialRequestV1 = z.infer<typeof UnsignedD1ProbeGatewayTrialRequestV1Schema>;

export const D1ProbeGatewayTrialRequestV1Schema = UnsignedD1ProbeGatewayTrialRequestV1Schema.extend({
    request_digest: DigestSchema,
}).strict();
export type D1ProbeGatewayTrialRequestV1 = z.infer<typeof D1ProbeGatewayTrialRequestV1Schema>;

export const D1ProbeGatewayReadinessCommitV1Schema = z
    .object({
        row: z
            .object({
                probe_run_id: OpaqueIdSchema,
                trial_id: TrialIdSchema,
                child_process_id: OpaqueIdSchema,
                writer_role: z.enum(["writer_a", "writer_b"]),
                request_id: OpaqueIdSchema,
            })
            .strict(),
        insert_readiness_metadata: D1ProbeD1MetadataV1Schema,
        insert_guard_metadata: D1ProbeD1MetadataV1Schema,
        bookmark: z.string().min(1).max(512),
    })
    .strict();
export type D1ProbeGatewayReadinessCommitV1 = z.infer<typeof D1ProbeGatewayReadinessCommitV1Schema>;

export const D1ProbeGatewayBarrierReadbackV1Schema = z
    .object({
        probe_run_id: OpaqueIdSchema,
        trial_id: TrialIdSchema,
        trial_state: z.literal("open"),
        expected_contender_count: z.literal(2),
        assignment_count: z.literal(2),
        assigned_writer_role_count: z.literal(2),
        distinct_go_receipt_count: z.literal(2),
        distinct_operation_request_count: z.literal(2),
        ready_count: z.number().int().min(1).max(2),
        readiness_guard_count: z.number().int().min(1).max(2),
        ready_writer_role_count: z.number().int().min(1).max(2),
        ready_child_process_ids: z.array(OpaqueIdSchema).min(1).max(2),
        poll_attempt: z.number().int().positive().max(D1_PROBE_GATEWAY_BARRIER_MAX_POLLS_V1),
        metadata: D1ProbeD1MetadataV1Schema,
    })
    .strict()
    .superRefine((readback, context) => {
        if (
            readback.readiness_guard_count !== readback.ready_count ||
            readback.ready_writer_role_count !== readback.ready_count ||
            readback.ready_child_process_ids.length !== readback.ready_count ||
            new Set(readback.ready_child_process_ids).size !== readback.ready_child_process_ids.length ||
            JSON.stringify([...readback.ready_child_process_ids].sort()) !==
                JSON.stringify(readback.ready_child_process_ids)
        ) {
            context.addIssue({
                code: "custom",
                path: ["ready_child_process_ids"],
                message: "Barrier child IDs must be unique, sorted, and match the ready count",
            });
        }
    });
export type D1ProbeGatewayBarrierReadbackV1 = z.infer<typeof D1ProbeGatewayBarrierReadbackV1Schema>;

export const D1ProbeGatewayReadinessDenialReadbackV1Schema = z
    .object({
        probe_run_id: OpaqueIdSchema,
        trial_id: TrialIdSchema,
        trial_state: z.enum(["open", "closed"]),
        assignment_count: z.number().int().min(0).max(1),
        readiness_count: z.number().int().min(0).max(1),
        readiness_guard_count: z.number().int().min(0).max(1),
        stored_request_digest: DigestSchema.nullable(),
        metadata: D1ProbeD1MetadataV1Schema,
    })
    .strict()
    .superRefine((readback, context) => {
        if (
            readback.readiness_count !== readback.readiness_guard_count ||
            (readback.readiness_count === 0) !== (readback.stored_request_digest === null)
        ) {
            context.addIssue({
                code: "custom",
                path: ["readiness_guard_count"],
                message: "Readiness denial must bind the readiness row, guard, and stored request digest",
            });
        }
    });
export type D1ProbeGatewayReadinessDenialReadbackV1 = z.infer<typeof D1ProbeGatewayReadinessDenialReadbackV1Schema>;

const responseBase = {
    schema_version: z.literal(D1_PROBE_RPC_VERSION_V1),
    operation: z.literal("run_gateway_trial_v1"),
    request_digest: DigestSchema,
    writer_role: z.enum(["writer_a", "writer_b"]),
} as const;

export const D1ProbeGatewayTrialResponseV1Schema = z.discriminatedUnion("status", [
    z
        .object({
            ...responseBase,
            status: z.literal("executed"),
            error_code: z.null(),
            readiness: D1ProbeGatewayReadinessCommitV1Schema,
            barrier: D1ProbeGatewayBarrierReadbackV1Schema.safeExtend({ ready_count: z.literal(2) }),
            readiness_denial_readback: z.null(),
            gateway_response: D1ProbeGatewayReservationResponseV1Schema,
        })
        .strict(),
    z
        .object({
            ...responseBase,
            status: z.literal("barrier_timeout"),
            error_code: z.literal("barrier_timeout"),
            readiness: D1ProbeGatewayReadinessCommitV1Schema,
            barrier: D1ProbeGatewayBarrierReadbackV1Schema.safeExtend({ ready_count: z.literal(1) }),
            readiness_denial_readback: z.null(),
            gateway_response: z.null(),
        })
        .strict(),
    z
        .object({
            ...responseBase,
            status: z.literal("guarded_denial"),
            error_code: z.enum(["readiness_replay", "readiness_changed", "assignment_mismatch", "trial_closed"]),
            readiness: z.null(),
            barrier: z.null(),
            readiness_denial_readback: D1ProbeGatewayReadinessDenialReadbackV1Schema,
            gateway_response: z.null(),
        })
        .strict(),
    z
        .object({
            ...responseBase,
            status: z.literal("outcome_unknown"),
            error_code: z.enum([
                "readiness_d1_unknown",
                "readiness_bookmark_unavailable",
                "barrier_read_unknown",
                "gateway_execution_unknown",
            ]),
            readiness: D1ProbeGatewayReadinessCommitV1Schema.nullable(),
            barrier: D1ProbeGatewayBarrierReadbackV1Schema.nullable(),
            readiness_denial_readback: z.null(),
            gateway_response: z.null(),
        })
        .strict(),
    z
        .object({
            ...responseBase,
            status: z.literal("rejected"),
            error_code: z.literal("invalid_request"),
            readiness: z.null(),
            barrier: z.null(),
            readiness_denial_readback: z.null(),
            gateway_response: z.null(),
        })
        .strict(),
]);
export type D1ProbeGatewayTrialResponseV1 = z.infer<typeof D1ProbeGatewayTrialResponseV1Schema>;

export interface D1ProbeGatewayTrialServiceV1 {
    runGatewayTrial(input: unknown): Promise<D1ProbeGatewayTrialResponseV1>;
}

const encoder = new TextEncoder();
const toHex = (value: ArrayBuffer): string =>
    [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");

const projection = (request: UnsignedD1ProbeGatewayTrialRequestV1): string =>
    JSON.stringify({
        schema_version: request.schema_version,
        operation: request.operation,
        request_id: request.request_id,
        probe_run_id: request.probe_run_id,
        trial_id: request.trial_id,
        child_process_id: request.child_process_id,
        writer_role: request.writer_role,
        expected_contender_count: request.expected_contender_count,
        go_receipt_digest: request.go_receipt_digest,
        barrier_timeout_ms: request.barrier_timeout_ms,
        barrier_poll_interval_ms: request.barrier_poll_interval_ms,
        gateway_request: request.gateway_request,
    });

export const computeD1ProbeGatewayTrialRequestDigestV1 = async (
    input: UnsignedD1ProbeGatewayTrialRequestV1
): Promise<string> => {
    let parsed: ReturnType<typeof UnsignedD1ProbeGatewayTrialRequestV1Schema.safeParse>;
    try {
        parsed = UnsignedD1ProbeGatewayTrialRequestV1Schema.safeParse(input);
    } catch {
        throw new D1ProbeRpcError("invalid_request", "Invalid D1 probe gateway trial request");
    }
    if (!parsed.success) throw new D1ProbeRpcError("invalid_request", "Invalid D1 probe gateway trial request");
    await parseAndVerifyD1ProbeGatewayReservationRequestV1(parsed.data.gateway_request);
    const bytes = encoder.encode(`openbot.d1-probe-gateway-trial.v1\u0000${projection(parsed.data)}`);
    return toHex(await globalThis.crypto.subtle.digest("SHA-256", bytes));
};

export const parseAndVerifyD1ProbeGatewayTrialRequestV1 = async (
    input: unknown
): Promise<D1ProbeGatewayTrialRequestV1> => {
    let parsed: ReturnType<typeof D1ProbeGatewayTrialRequestV1Schema.safeParse>;
    try {
        parsed = D1ProbeGatewayTrialRequestV1Schema.safeParse(input);
    } catch {
        throw new D1ProbeRpcError("invalid_request", "Invalid D1 probe gateway trial request");
    }
    if (!parsed.success) throw new D1ProbeRpcError("invalid_request", "Invalid D1 probe gateway trial request");
    const { request_digest: expected, ...unsigned } = parsed.data;
    if ((await computeD1ProbeGatewayTrialRequestDigestV1(unsigned)) !== expected) {
        throw new D1ProbeRpcError("digest_mismatch", "D1 probe gateway trial request digest mismatch");
    }
    return parsed.data;
};

export const gatewayTrialResponseV1 = (input: unknown): D1ProbeGatewayTrialResponseV1 => {
    let parsed: ReturnType<typeof D1ProbeGatewayTrialResponseV1Schema.safeParse>;
    try {
        parsed = D1ProbeGatewayTrialResponseV1Schema.safeParse(input);
    } catch {
        throw new TypeError("Invalid D1 probe gateway trial response");
    }
    if (!parsed.success) throw new TypeError("Invalid D1 probe gateway trial response");
    return parsed.data;
};
