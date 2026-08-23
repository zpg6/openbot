import { z } from "zod";

export const D1_PROBE_RPC_VERSION_V1 = 1 as const;

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const OpaqueIdSchema = z
    .string()
    .min(16)
    .max(128)
    .regex(/^[A-Za-z0-9._~-]+$/u);
const SequenceSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const GatewayDispatchPayloadV1Schema = z
    .object({
        kind: z.literal("gateway_dispatch"),
        call_kind: z.enum(["model", "provider_tool", "code"]),
        logical_call_id: OpaqueIdSchema,
        attempt_id: OpaqueIdSchema,
        call_sequence: SequenceSchema,
        reservation_id: OpaqueIdSchema,
        dispatch_request_digest: DigestSchema,
    })
    .strict();

const PrivateRpcProbePayloadV1Schema = z
    .object({
        kind: z.literal("private_rpc_probe"),
        setup_nonce_digest: DigestSchema,
    })
    .strict();

const DestroyObservationPayloadV1Schema = z
    .object({
        kind: z.literal("destroy_observation"),
        installation_id_digest: DigestSchema,
        run_id: OpaqueIdSchema,
        run_attempt_fence: SequenceSchema,
        claim_id: OpaqueIdSchema,
        sandbox_id_digest: DigestSchema,
        destroy_receipt_digest: DigestSchema,
    })
    .strict();

const ReceiptPayloadV1Schema = z.discriminatedUnion("kind", [
    PrivateRpcProbePayloadV1Schema,
    GatewayDispatchPayloadV1Schema,
    DestroyObservationPayloadV1Schema,
]);

export const D1ProbeWriterRoleV1Schema = z.enum(["writer_a", "writer_b"]);
export type D1ProbeWriterRoleV1 = z.infer<typeof D1ProbeWriterRoleV1Schema>;

export const UnsignedD1ProbeReceiptRequestV1Schema = z
    .object({
        schema_version: z.literal(D1_PROBE_RPC_VERSION_V1),
        operation: z.literal("record_probe_receipt_v1"),
        request_id: OpaqueIdSchema,
        probe_run_id: OpaqueIdSchema,
        writer_role: D1ProbeWriterRoleV1Schema,
        source_request_digest: DigestSchema,
        payload: ReceiptPayloadV1Schema,
    })
    .strict();
export type UnsignedD1ProbeReceiptRequestV1 = z.infer<typeof UnsignedD1ProbeReceiptRequestV1Schema>;

export const D1ProbeReceiptRequestV1Schema = UnsignedD1ProbeReceiptRequestV1Schema.extend({
    request_digest: DigestSchema,
}).strict();
export type D1ProbeReceiptRequestV1 = z.infer<typeof D1ProbeReceiptRequestV1Schema>;

const responseBase = {
    schema_version: z.literal(D1_PROBE_RPC_VERSION_V1),
    operation: z.literal("record_probe_receipt_v1"),
    request_digest: DigestSchema,
};

export const D1ProbeRecordedReceiptResponseV1Schema = z
    .object({
        ...responseBase,
        status: z.literal("recorded"),
        error_code: z.null(),
        receipt_id: OpaqueIdSchema,
        sink_runtime_version_id: OpaqueIdSchema,
    })
    .strict();
export type D1ProbeRecordedReceiptResponseV1 = z.infer<typeof D1ProbeRecordedReceiptResponseV1Schema>;

export const D1ProbeReceiptResponseV1Schema = z.discriminatedUnion("status", [
    D1ProbeRecordedReceiptResponseV1Schema,
    z
        .object({
            ...responseBase,
            status: z.literal("rejected"),
            error_code: z.literal("invalid_request"),
            receipt_id: z.null(),
            sink_runtime_version_id: z.null(),
        })
        .strict(),
    z
        .object({
            ...responseBase,
            status: z.literal("unavailable"),
            error_code: z.enum(["sink_unavailable", "writer_unavailable"]),
            receipt_id: z.null(),
            sink_runtime_version_id: OpaqueIdSchema.nullable(),
        })
        .strict(),
    z
        .object({
            ...responseBase,
            status: z.literal("outcome_unknown"),
            error_code: z.literal("d1_outcome_unknown"),
            receipt_id: z.null(),
            sink_runtime_version_id: OpaqueIdSchema.nullable(),
        })
        .strict(),
]);
export type D1ProbeReceiptResponseV1 = z.infer<typeof D1ProbeReceiptResponseV1Schema>;

export interface D1ProbeSinkServiceV1 {
    record(input: unknown): Promise<D1ProbeReceiptResponseV1>;
}

export class D1ProbeRpcError extends Error {
    constructor(
        readonly code: "digest_mismatch" | "invalid_request",
        message: string
    ) {
        super(message);
        this.name = "D1ProbeRpcError";
    }
}

const encoder = new TextEncoder();

const toHex = (value: ArrayBuffer): string =>
    [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");

const sha256Hex = async (value: string): Promise<string> =>
    toHex(await globalThis.crypto.subtle.digest("SHA-256", encoder.encode(value)));

const canonicalPayloadProjectionV1 = (payload: z.infer<typeof ReceiptPayloadV1Schema>): object => {
    if (payload.kind === "private_rpc_probe") {
        return { kind: payload.kind, setup_nonce_digest: payload.setup_nonce_digest };
    }
    if (payload.kind === "gateway_dispatch") {
        return {
            kind: payload.kind,
            call_kind: payload.call_kind,
            logical_call_id: payload.logical_call_id,
            attempt_id: payload.attempt_id,
            call_sequence: payload.call_sequence,
            reservation_id: payload.reservation_id,
            dispatch_request_digest: payload.dispatch_request_digest,
        };
    }
    return {
        kind: payload.kind,
        installation_id_digest: payload.installation_id_digest,
        run_id: payload.run_id,
        run_attempt_fence: payload.run_attempt_fence,
        claim_id: payload.claim_id,
        sandbox_id_digest: payload.sandbox_id_digest,
        destroy_receipt_digest: payload.destroy_receipt_digest,
    };
};

const canonicalRequestProjectionV1 = (request: UnsignedD1ProbeReceiptRequestV1): string =>
    JSON.stringify({
        schema_version: request.schema_version,
        operation: request.operation,
        request_id: request.request_id,
        probe_run_id: request.probe_run_id,
        writer_role: request.writer_role,
        source_request_digest: request.source_request_digest,
        payload: canonicalPayloadProjectionV1(request.payload),
    });

export const computeD1ProbeReceiptRequestDigestV1 = async (input: UnsignedD1ProbeReceiptRequestV1): Promise<string> => {
    let request: ReturnType<typeof UnsignedD1ProbeReceiptRequestV1Schema.safeParse>;
    try {
        request = UnsignedD1ProbeReceiptRequestV1Schema.safeParse(input);
    } catch {
        throw new D1ProbeRpcError("invalid_request", "Invalid D1 probe receipt request");
    }
    if (!request.success) throw new D1ProbeRpcError("invalid_request", "Invalid D1 probe receipt request");
    return sha256Hex(`openbot.d1-probe-receipt-request.v1\u0000${canonicalRequestProjectionV1(request.data)}`);
};

export const parseAndVerifyD1ProbeReceiptRequestV1 = async (input: unknown): Promise<D1ProbeReceiptRequestV1> => {
    let parsed: ReturnType<typeof D1ProbeReceiptRequestV1Schema.safeParse>;
    try {
        parsed = D1ProbeReceiptRequestV1Schema.safeParse(input);
    } catch {
        throw new D1ProbeRpcError("invalid_request", "Invalid D1 probe receipt request");
    }
    if (!parsed.success) throw new D1ProbeRpcError("invalid_request", "Invalid D1 probe receipt request");
    const { request_digest: expected, ...unsigned } = parsed.data;
    if ((await computeD1ProbeReceiptRequestDigestV1(unsigned)) !== expected) {
        throw new D1ProbeRpcError("digest_mismatch", "D1 probe receipt request digest mismatch");
    }
    return parsed.data;
};

export const receiptResponseV1 = (input: unknown): D1ProbeReceiptResponseV1 => {
    const parsed = D1ProbeReceiptResponseV1Schema.safeParse(input);
    if (!parsed.success) throw new TypeError("Invalid D1 probe receipt response");
    return parsed.data;
};
