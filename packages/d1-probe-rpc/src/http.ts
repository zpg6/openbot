import { z } from "zod";

import { D1_PROBE_RPC_VERSION_V1, D1ProbeRpcError } from "./protocol.js";
import { D1ProbeD1MetadataV1Schema } from "./gateway.js";
import {
    D1ProbeGatewayTrialResponseV1Schema,
    parseAndVerifyD1ProbeGatewayTrialRequestV1,
    type D1ProbeGatewayTrialRequestV1,
    type D1ProbeGatewayTrialResponseV1,
} from "./trigger.js";

export const D1_PROBE_GATEWAY_TRIAL_HTTP_BODY_LIMIT_BYTES_V1 = 16_384 as const;

const AccessAudienceSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const OpaqueIdSchema = z
    .string()
    .min(16)
    .max(128)
    .regex(/^[A-Za-z0-9._~-]+$/u);
export const D1ProbeAccessServiceTokenClientIdV1Schema = z.string().regex(/^[A-Za-z0-9_-]{16,128}\.access$/u);
export const D1ProbeWriterTriggerUrlV1Schema = z
    .string()
    .max(2_048)
    .superRefine((value, context) => {
        try {
            const url = new URL(value);
            if (
                url.toString() !== value ||
                url.protocol !== "https:" ||
                url.username !== "" ||
                url.password !== "" ||
                url.port !== "" ||
                url.search !== "" ||
                url.hash !== "" ||
                url.pathname === "/"
            ) {
                context.addIssue({ code: "custom", message: "Trigger URL must be one canonical HTTPS route" });
            }
        } catch {
            context.addIssue({ code: "custom", message: "Trigger URL is invalid" });
        }
    });

export const D1ProbeWriterHttpConfigV1Schema = z
    .object({
        schema_version: z.literal(1),
        exact_trigger_url: D1ProbeWriterTriggerUrlV1Schema,
        access_audience: AccessAudienceSchema,
        access_service_client_id: D1ProbeAccessServiceTokenClientIdV1Schema,
        writer_role: z.enum(["writer_a", "writer_b"]),
    })
    .strict();
export type D1ProbeWriterHttpConfigV1 = z.infer<typeof D1ProbeWriterHttpConfigV1Schema>;

export const D1ProbeRuntimeVersionMetadataV1Schema = z
    .object({
        id: OpaqueIdSchema,
        tag: z.string().max(128),
        timestamp: z.string().datetime({ offset: true }),
    })
    .strict();
export type D1ProbeRuntimeVersionMetadataV1 = z.infer<typeof D1ProbeRuntimeVersionMetadataV1Schema>;

export const D1ProbeSinkReadbackHttpConfigV1Schema = z
    .object({
        schema_version: z.literal(1),
        exact_readback_url: D1ProbeWriterTriggerUrlV1Schema,
        access_audience: AccessAudienceSchema,
        access_service_client_id: D1ProbeAccessServiceTokenClientIdV1Schema,
        probe_run_id: OpaqueIdSchema,
    })
    .strict();
export type D1ProbeSinkReadbackHttpConfigV1 = z.infer<typeof D1ProbeSinkReadbackHttpConfigV1Schema>;

const ReadbackCountSchema = z.number().int().nonnegative().max(10_000);
export const D1ProbeSinkReadbackV1Schema = z
    .object({
        schema_version: z.literal(D1_PROBE_RPC_VERSION_V1),
        kind: z.literal("d1_probe_sink_readback"),
        probe_run_id: OpaqueIdSchema,
        runtime_version: D1ProbeRuntimeVersionMetadataV1Schema,
        receipt_count: ReadbackCountSchema,
        writer_a_receipt_count: ReadbackCountSchema,
        writer_b_receipt_count: ReadbackCountSchema,
        distinct_source_request_digest_count: ReadbackCountSchema,
        distinct_receipt_request_digest_count: ReadbackCountSchema,
        metadata: D1ProbeD1MetadataV1Schema,
    })
    .strict()
    .superRefine((readback, context) => {
        if (readback.receipt_count !== readback.writer_a_receipt_count + readback.writer_b_receipt_count) {
            context.addIssue({
                code: "custom",
                path: ["receipt_count"],
                message: "Writer receipt counts must be exact",
            });
        }
        if (
            readback.distinct_source_request_digest_count > readback.receipt_count ||
            readback.distinct_receipt_request_digest_count > readback.receipt_count
        ) {
            context.addIssue({ code: "custom", path: ["receipt_count"], message: "Distinct counts exceed receipts" });
        }
    });
export type D1ProbeSinkReadbackV1 = z.infer<typeof D1ProbeSinkReadbackV1Schema>;

export const canonicalD1ProbeSinkReadbackV1 = (input: unknown): string =>
    JSON.stringify(D1ProbeSinkReadbackV1Schema.parse(input));

export const D1_PROBE_RUNTIME_VERSION_HEADER_V1 = "x-openbot-d1-probe-runtime-version" as const;

const bytesToBase64Url = (bytes: Uint8Array): string => {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
};

export const d1ProbeRuntimeVersionHeaderV1 = (input: unknown): string => {
    const version = D1ProbeRuntimeVersionMetadataV1Schema.parse(input);
    return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(version)));
};

export const parseD1ProbeRuntimeVersionHeaderV1 = (input: unknown): D1ProbeRuntimeVersionMetadataV1 => {
    try {
        if (
            typeof input !== "string" ||
            input.length < 16 ||
            input.length > 1_024 ||
            !/^[A-Za-z0-9_-]+$/u.test(input)
        ) {
            throw new TypeError("Invalid D1 probe runtime version header");
        }
        const padding = "=".repeat((4 - (input.length % 4)) % 4);
        const binary = atob(`${input.replaceAll("-", "+").replaceAll("_", "/")}${padding}`);
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        if (bytesToBase64Url(bytes) !== input) throw new TypeError("Invalid D1 probe runtime version header");
        const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        const version = D1ProbeRuntimeVersionMetadataV1Schema.parse(JSON.parse(text) as unknown);
        if (text !== JSON.stringify(version)) throw new TypeError("Invalid D1 probe runtime version header");
        return version;
    } catch {
        throw new TypeError("Invalid D1 probe runtime version header");
    }
};

export const D1ProbeHttpErrorCodeV1Schema = z.enum([
    "access_required",
    "not_found",
    "method_not_allowed",
    "content_type_required",
    "content_encoding_forbidden",
    "content_length_required",
    "body_too_large",
    "invalid_body",
    "readback_unavailable",
]);
export type D1ProbeHttpErrorCodeV1 = z.infer<typeof D1ProbeHttpErrorCodeV1Schema>;

export const D1ProbeHttpErrorV1Schema = z
    .object({
        schema_version: z.literal(D1_PROBE_RPC_VERSION_V1),
        kind: z.literal("d1_probe_http_error"),
        code: D1ProbeHttpErrorCodeV1Schema,
    })
    .strict();
export type D1ProbeHttpErrorV1 = z.infer<typeof D1ProbeHttpErrorV1Schema>;

export const D1ProbeGatewayTrialHttpResponseV1Schema = z.union([
    D1ProbeGatewayTrialResponseV1Schema,
    D1ProbeHttpErrorV1Schema,
]);
export type D1ProbeGatewayTrialHttpResponseV1 = z.infer<typeof D1ProbeGatewayTrialHttpResponseV1Schema>;

const gatewayRequestProjection = (request: D1ProbeGatewayTrialRequestV1): Readonly<Record<string, unknown>> => ({
    schema_version: request.gateway_request.schema_version,
    operation: request.gateway_request.operation,
    request_id: request.gateway_request.request_id,
    probe_run_id: request.gateway_request.probe_run_id,
    scenario: request.gateway_request.scenario,
    writer_role: request.gateway_request.writer_role,
    request_variant: request.gateway_request.request_variant,
    call_kind: request.gateway_request.call_kind,
    logical_call_id: request.gateway_request.logical_call_id,
    attempt_id: request.gateway_request.attempt_id,
    call_sequence: request.gateway_request.call_sequence,
    reservation_id: request.gateway_request.reservation_id,
    dispatch_request_digest: request.gateway_request.dispatch_request_digest,
    fault_point: request.gateway_request.fault_point,
    request_digest: request.gateway_request.request_digest,
});

const trialRequestProjection = (request: D1ProbeGatewayTrialRequestV1): Readonly<Record<string, unknown>> => ({
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
    gateway_request: gatewayRequestProjection(request),
    request_digest: request.request_digest,
});

export const canonicalD1ProbeGatewayTrialHttpBodyV1 = async (input: unknown): Promise<string> => {
    const request = await parseAndVerifyD1ProbeGatewayTrialRequestV1(input);
    const body = JSON.stringify(trialRequestProjection(request));
    if (new TextEncoder().encode(body).byteLength > D1_PROBE_GATEWAY_TRIAL_HTTP_BODY_LIMIT_BYTES_V1) {
        throw new D1ProbeRpcError("invalid_request", "D1 probe gateway trial HTTP body is too large");
    }
    return body;
};

export const parseD1ProbeGatewayTrialHttpResponseV1 = (input: unknown): D1ProbeGatewayTrialHttpResponseV1 => {
    let parsed: ReturnType<typeof D1ProbeGatewayTrialHttpResponseV1Schema.safeParse>;
    try {
        parsed = D1ProbeGatewayTrialHttpResponseV1Schema.safeParse(input);
    } catch {
        throw new TypeError("Invalid D1 probe gateway trial HTTP response");
    }
    if (!parsed.success) throw new TypeError("Invalid D1 probe gateway trial HTTP response");
    return parsed.data;
};

export const canonicalD1ProbeGatewayTrialHttpResponseV1 = (input: unknown): string =>
    JSON.stringify(parseD1ProbeGatewayTrialHttpResponseV1(input));

export const d1ProbeHttpErrorV1 = (code: D1ProbeHttpErrorCodeV1): D1ProbeHttpErrorV1 =>
    D1ProbeHttpErrorV1Schema.parse({
        schema_version: D1_PROBE_RPC_VERSION_V1,
        kind: "d1_probe_http_error",
        code,
    });

export const d1ProbeHttpErrorStatusV1 = (error: D1ProbeHttpErrorV1): number => {
    switch (error.code) {
        case "access_required":
            return 403;
        case "not_found":
            return 404;
        case "method_not_allowed":
            return 405;
        case "content_type_required":
        case "content_encoding_forbidden":
            return 415;
        case "content_length_required":
            return 411;
        case "body_too_large":
            return 413;
        case "invalid_body":
            return 400;
        case "readback_unavailable":
            return 503;
    }
};

export const d1ProbeGatewayTrialHttpStatusV1 = (response: D1ProbeGatewayTrialResponseV1): number => {
    switch (response.status) {
        case "executed":
            return 200;
        case "guarded_denial":
            return 409;
        case "barrier_timeout":
            return 504;
        case "outcome_unknown":
            return 503;
        case "rejected":
            return 400;
    }
};
