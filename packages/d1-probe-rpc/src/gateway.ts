import { z } from "zod";

import {
    D1_PROBE_RPC_VERSION_V1,
    D1ProbeReceiptResponseV1Schema,
    D1ProbeRecordedReceiptResponseV1Schema,
    D1ProbeRpcError,
} from "./protocol.js";

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const OpaqueIdSchema = z
    .string()
    .min(16)
    .max(128)
    .regex(/^[A-Za-z0-9._~-]+$/u);
const ScenarioSchema = z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9][a-z0-9_-]*$/u);
const SequenceSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const CountSchema = z.number().int().nonnegative().max(64);

export const UnsignedD1ProbeGatewayReservationRequestV1Schema = z
    .object({
        schema_version: z.literal(D1_PROBE_RPC_VERSION_V1),
        operation: z.literal("reserve_gateway_call_v1"),
        request_id: OpaqueIdSchema,
        probe_run_id: OpaqueIdSchema,
        scenario: ScenarioSchema,
        writer_role: z.enum(["writer_a", "writer_b"]),
        request_variant: z.enum(["exact", "substituted"]),
        call_kind: z.enum(["model", "provider_tool", "code"]),
        logical_call_id: OpaqueIdSchema,
        attempt_id: OpaqueIdSchema,
        call_sequence: SequenceSchema,
        reservation_id: OpaqueIdSchema,
        dispatch_request_digest: DigestSchema,
        fault_point: z.enum(["none", "reserve_then_crash", "dispatch_response_lost"]),
    })
    .strict();
export type UnsignedD1ProbeGatewayReservationRequestV1 = z.infer<
    typeof UnsignedD1ProbeGatewayReservationRequestV1Schema
>;

export const D1ProbeGatewayReservationRequestV1Schema = UnsignedD1ProbeGatewayReservationRequestV1Schema.extend({
    request_digest: DigestSchema,
}).strict();
export type D1ProbeGatewayReservationRequestV1 = z.infer<typeof D1ProbeGatewayReservationRequestV1Schema>;

export const D1ProbeD1MetadataV1Schema = z
    .object({
        changes: CountSchema,
        rows_read: CountSchema,
        rows_written: CountSchema,
        changed_db: z.boolean(),
        served_by_primary: z.literal(true),
        served_by: z.string().min(1).max(128),
        served_by_region: z.string().min(1).max(64),
        duration: z.number().nonnegative().max(60_000),
        sql_duration_ms: z.number().nonnegative().max(60_000),
        total_attempts: z.number().int().positive().max(16),
        last_row_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
        size_after: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    })
    .strict();
export type D1ProbeD1MetadataV1 = z.infer<typeof D1ProbeD1MetadataV1Schema>;

const exactOwnDataRecord = (value: unknown, expectedKeys: readonly string[], name: string) => {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new TypeError(`${name} is invalid`);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    for (const descriptor of Object.values(descriptors)) {
        if (!("value" in descriptor)) throw new TypeError(`${name} is invalid`);
    }
    const keys = Object.keys(descriptors).sort();
    const sortedExpectedKeys = [...expectedKeys].sort();
    if (keys.length !== sortedExpectedKeys.length || keys.some((key, index) => key !== sortedExpectedKeys[index])) {
        throw new TypeError(`${name} is invalid`);
    }
    return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
};

const finiteNumber = (value: unknown, name: string): number => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new TypeError(`${name} is invalid`);
    return value;
};

const safeInteger = (value: unknown, name: string): number => {
    if (!Number.isSafeInteger(value) || (value as number) < 0) throw new TypeError(`${name} is invalid`);
    return value as number;
};

const nonemptyString = (value: unknown, name: string, maximum: number): string => {
    if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
        throw new TypeError(`${name} is invalid`);
    }
    return value;
};

const d1MetadataKeys = [
    "changed_db",
    "changes",
    "duration",
    "last_row_id",
    "rows_read",
    "rows_written",
    "served_by",
    "served_by_primary",
    "served_by_region",
    "size_after",
    "timings",
    "total_attempts",
] as const;

export const normalizeD1ProbeD1MetadataV1 = (value: unknown, expectWrite: boolean): D1ProbeD1MetadataV1 => {
    const meta = exactOwnDataRecord(value, d1MetadataKeys, "D1 metadata");
    const timings = exactOwnDataRecord(meta["timings"], ["sql_duration_ms"], "D1 timings");
    const metadata = {
        changes: safeInteger(meta["changes"], "changes"),
        rows_read: safeInteger(meta["rows_read"], "rows_read"),
        rows_written: safeInteger(meta["rows_written"], "rows_written"),
        changed_db: meta["changed_db"],
        served_by_primary: meta["served_by_primary"],
        served_by: nonemptyString(meta["served_by"], "served_by", 128),
        served_by_region: nonemptyString(meta["served_by_region"], "served_by_region", 64),
        duration: finiteNumber(meta["duration"], "duration"),
        sql_duration_ms: finiteNumber(timings["sql_duration_ms"], "sql_duration_ms"),
        total_attempts: safeInteger(meta["total_attempts"], "total_attempts"),
        last_row_id: meta["last_row_id"] === null ? null : safeInteger(meta["last_row_id"], "last_row_id"),
        size_after: safeInteger(meta["size_after"], "size_after"),
    };
    if (metadata.served_by_primary !== true || metadata.total_attempts < 1) {
        throw new TypeError("D1 primary metadata is missing");
    }
    if (metadata.changed_db !== expectWrite) throw new TypeError("D1 mutation metadata is inconsistent");
    if (!expectWrite && (metadata.changes !== 0 || metadata.rows_written !== 0)) {
        throw new TypeError("D1 read metadata is inconsistent");
    }
    const parsed = D1ProbeD1MetadataV1Schema.safeParse(metadata);
    if (!parsed.success) throw new TypeError("D1 metadata is invalid");
    return parsed.data;
};

export const D1ProbeGatewayCommittedBatchV1Schema = z
    .object({
        insert_reservation: z
            .object({
                row: z
                    .object({
                        probe_run_id: OpaqueIdSchema,
                        scenario: ScenarioSchema,
                        call_kind: z.enum(["model", "provider_tool", "code"]),
                        call_sequence: SequenceSchema,
                        reservation_id: OpaqueIdSchema,
                    })
                    .strict(),
                metadata: D1ProbeD1MetadataV1Schema,
            })
            .strict(),
        insert_guard: z
            .object({ row: z.object({ reservation_id: OpaqueIdSchema }).strict(), metadata: D1ProbeD1MetadataV1Schema })
            .strict(),
        decrement_budget: z
            .object({
                row: z
                    .object({
                        probe_run_id: OpaqueIdSchema,
                        scenario: ScenarioSchema,
                        call_kind: z.enum(["model", "provider_tool", "code"]),
                        remaining: z.literal(0),
                    })
                    .strict(),
                metadata: D1ProbeD1MetadataV1Schema,
            })
            .strict(),
        bookmark: z.string().min(1).max(512),
    })
    .strict();
export type D1ProbeGatewayCommittedBatchV1 = z.infer<typeof D1ProbeGatewayCommittedBatchV1Schema>;

export const D1ProbeGatewayReadbackV1Schema = z
    .object({
        remaining: z.literal(0),
        reservation_count: z.literal(1),
        guard_count: z.literal(1),
        sink_receipt_count: CountSchema,
        stored_writer_role: z.enum(["writer_a", "writer_b"]),
        stored_request_variant: z.enum(["exact", "substituted"]),
        stored_fault_point: z.enum(["none", "reserve_then_crash", "dispatch_response_lost"]),
        stored_logical_call_id: OpaqueIdSchema,
        stored_attempt_id: OpaqueIdSchema,
        stored_reservation_id: OpaqueIdSchema,
        stored_dispatch_request_digest: DigestSchema,
        stored_request_digest: DigestSchema,
        metadata: D1ProbeD1MetadataV1Schema,
    })
    .strict();
export type D1ProbeGatewayReadbackV1 = z.infer<typeof D1ProbeGatewayReadbackV1Schema>;

const responseBase = {
    schema_version: z.literal(D1_PROBE_RPC_VERSION_V1),
    operation: z.literal("reserve_gateway_call_v1"),
    request_digest: DigestSchema,
    writer_role: z.enum(["writer_a", "writer_b"]),
};

const D1ProbeGatewayReservationResponseUnionV1Schema = z.discriminatedUnion("status", [
    z
        .object({
            ...responseBase,
            status: z.literal("dispatched"),
            error_code: z.null(),
            committed_batch: D1ProbeGatewayCommittedBatchV1Schema,
            sink_response: D1ProbeRecordedReceiptResponseV1Schema,
            readback: z.null(),
        })
        .strict(),
    z
        .object({
            ...responseBase,
            status: z.literal("guarded_denial"),
            error_code: z.enum(["same_digest_replay", "duplicate_dispatch_denied", "changed_digest_denied"]),
            committed_batch: z.null(),
            sink_response: z.null(),
            readback: D1ProbeGatewayReadbackV1Schema,
        })
        .strict(),
    z
        .object({
            ...responseBase,
            status: z.literal("reserved_without_dispatch"),
            error_code: z.enum(["sink_rejected", "sink_unavailable"]),
            committed_batch: D1ProbeGatewayCommittedBatchV1Schema,
            sink_response: D1ProbeReceiptResponseV1Schema,
            readback: z.null(),
        })
        .strict(),
    z
        .object({
            ...responseBase,
            status: z.literal("outcome_unknown"),
            error_code: z.enum([
                "bookmark_unavailable",
                "d1_outcome_unknown",
                "dispatch_preparation_failed",
                "dispatch_response_lost",
                "reserve_then_crash",
                "sink_outcome_unknown",
            ]),
            committed_batch: D1ProbeGatewayCommittedBatchV1Schema.nullable(),
            sink_response: z.null(),
            readback: z.null(),
        })
        .strict(),
    z
        .object({
            ...responseBase,
            status: z.literal("inconclusive"),
            error_code: z.literal("unexpected_d1_result"),
            committed_batch: z.null(),
            sink_response: z.null(),
            readback: z.null(),
        })
        .strict(),
    z
        .object({
            ...responseBase,
            status: z.literal("rejected"),
            error_code: z.literal("invalid_request"),
            committed_batch: z.null(),
            sink_response: z.null(),
            readback: z.null(),
        })
        .strict(),
]);
export const D1ProbeGatewayReservationResponseV1Schema = D1ProbeGatewayReservationResponseUnionV1Schema.superRefine(
    (response, context) => {
        if (response.status !== "reserved_without_dispatch") return;
        if (response.error_code === "sink_rejected" && response.sink_response.status !== "rejected") {
            context.addIssue({ code: "custom", message: "A rejected sink response is required" });
        }
        if (response.error_code === "sink_unavailable" && response.sink_response.status !== "unavailable") {
            context.addIssue({ code: "custom", message: "An unavailable sink response is required" });
        }
    }
);
export type D1ProbeGatewayReservationResponseV1 = z.infer<typeof D1ProbeGatewayReservationResponseV1Schema>;

export interface D1ProbeGatewayWriterServiceV1 {
    reserveGateway(input: unknown): Promise<D1ProbeGatewayReservationResponseV1>;
}

const encoder = new TextEncoder();
const toHex = (value: ArrayBuffer): string =>
    [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");

const canonicalProjection = (request: UnsignedD1ProbeGatewayReservationRequestV1): string =>
    JSON.stringify({
        schema_version: request.schema_version,
        operation: request.operation,
        request_id: request.request_id,
        probe_run_id: request.probe_run_id,
        scenario: request.scenario,
        writer_role: request.writer_role,
        request_variant: request.request_variant,
        call_kind: request.call_kind,
        logical_call_id: request.logical_call_id,
        attempt_id: request.attempt_id,
        call_sequence: request.call_sequence,
        reservation_id: request.reservation_id,
        dispatch_request_digest: request.dispatch_request_digest,
        fault_point: request.fault_point,
    });

export const computeD1ProbeGatewayReservationRequestDigestV1 = async (
    input: UnsignedD1ProbeGatewayReservationRequestV1
): Promise<string> => {
    let parsed: ReturnType<typeof UnsignedD1ProbeGatewayReservationRequestV1Schema.safeParse>;
    try {
        parsed = UnsignedD1ProbeGatewayReservationRequestV1Schema.safeParse(input);
    } catch {
        throw new D1ProbeRpcError("invalid_request", "Invalid gateway reservation request");
    }
    if (!parsed.success) throw new D1ProbeRpcError("invalid_request", "Invalid gateway reservation request");
    const bytes = encoder.encode(`openbot.d1-probe-gateway-reservation.v1\u0000${canonicalProjection(parsed.data)}`);
    return toHex(await globalThis.crypto.subtle.digest("SHA-256", bytes));
};

export const parseAndVerifyD1ProbeGatewayReservationRequestV1 = async (
    input: unknown
): Promise<D1ProbeGatewayReservationRequestV1> => {
    let parsed: ReturnType<typeof D1ProbeGatewayReservationRequestV1Schema.safeParse>;
    try {
        parsed = D1ProbeGatewayReservationRequestV1Schema.safeParse(input);
    } catch {
        throw new D1ProbeRpcError("invalid_request", "Invalid gateway reservation request");
    }
    if (!parsed.success) throw new D1ProbeRpcError("invalid_request", "Invalid gateway reservation request");
    const { request_digest: expected, ...unsigned } = parsed.data;
    if ((await computeD1ProbeGatewayReservationRequestDigestV1(unsigned)) !== expected) {
        throw new D1ProbeRpcError("digest_mismatch", "Gateway reservation request digest mismatch");
    }
    return parsed.data;
};

export const gatewayReservationResponseV1 = (input: unknown): D1ProbeGatewayReservationResponseV1 => {
    let parsed: ReturnType<typeof D1ProbeGatewayReservationResponseV1Schema.safeParse>;
    try {
        parsed = D1ProbeGatewayReservationResponseV1Schema.safeParse(input);
    } catch {
        throw new TypeError("Invalid gateway reservation response");
    }
    if (!parsed.success) throw new TypeError("Invalid gateway reservation response");
    return parsed.data;
};
