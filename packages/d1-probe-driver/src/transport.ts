import {
    D1_PROBE_RUNTIME_VERSION_HEADER_V1,
    D1ProbeHttpErrorV1Schema,
    D1ProbeAccessServiceTokenClientIdV1Schema,
    D1ProbeGatewayTrialResponseV1Schema,
    D1ProbeRuntimeVersionMetadataV1Schema,
    D1ProbeWriterTriggerUrlV1Schema,
    canonicalD1ProbeGatewayTrialHttpBodyV1,
    canonicalD1ProbeGatewayTrialHttpResponseV1,
    d1ProbeGatewayTrialHttpStatusV1,
    d1ProbeHttpErrorStatusV1,
    parseAndVerifyD1ProbeGatewayTrialRequestV1,
    parseD1ProbeGatewayTrialHttpResponseV1,
    parseD1ProbeRuntimeVersionHeaderV1,
    type D1ProbeGatewayTrialHttpResponseV1,
    type D1ProbeGatewayTrialRequestV1,
    type D1ProbeRuntimeVersionMetadataV1,
} from "@openbot/d1-probe-rpc";
import { z } from "zod";

export const D1_PROBE_DRIVER_RESPONSE_LIMIT_BYTES_V1 = 65_536 as const;
export const D1_PROBE_DRIVER_MAX_TIMEOUT_MS_V1 = 15_000 as const;

export const D1ProbeDriverTransportConfigV1Schema = z
    .object({
        schema_version: z.literal(1),
        exact_trigger_url: D1ProbeWriterTriggerUrlV1Schema,
        access_service_token_client_id: D1ProbeAccessServiceTokenClientIdV1Schema,
        writer_role: z.enum(["writer_a", "writer_b"]),
        request_timeout_ms: z.number().int().positive().max(D1_PROBE_DRIVER_MAX_TIMEOUT_MS_V1),
    })
    .strict();
export type D1ProbeDriverTransportConfigV1 = z.infer<typeof D1ProbeDriverTransportConfigV1Schema>;

export const D1ProbeDriverServiceTokenV1Schema = z
    .object({
        client_secret: z.string().regex(/^[\x21-\x7e]{32,512}$/u),
    })
    .strict();
export type D1ProbeDriverServiceTokenV1 = z.infer<typeof D1ProbeDriverServiceTokenV1Schema>;

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const WriterRoleSchema = z.enum(["writer_a", "writer_b"]);

export const D1ProbeDriverTransportResultV1Schema = z
    .discriminatedUnion("status", [
        z
            .object({
                status: z.literal("delivered"),
                request_digest: DigestSchema,
                writer_role: WriterRoleSchema,
                http_status: z.number().int().min(100).max(599),
                response_byte_count: z.number().int().positive().max(D1_PROBE_DRIVER_RESPONSE_LIMIT_BYTES_V1),
                runtime_version: D1ProbeRuntimeVersionMetadataV1Schema,
                response: D1ProbeGatewayTrialResponseV1Schema,
            })
            .strict(),
        z
            .object({
                status: z.literal("server_rejected"),
                request_digest: DigestSchema,
                writer_role: WriterRoleSchema,
                http_status: z.number().int().min(100).max(599),
                response_byte_count: z.number().int().positive().max(D1_PROBE_DRIVER_RESPONSE_LIMIT_BYTES_V1),
                runtime_version: D1ProbeRuntimeVersionMetadataV1Schema.nullable(),
                response: D1ProbeHttpErrorV1Schema,
            })
            .strict(),
        z
            .object({
                status: z.literal("local_rejected"),
                request_digest: z.null(),
                writer_role: WriterRoleSchema,
                error_code: z.literal("invalid_request"),
            })
            .strict(),
        z
            .object({
                status: z.literal("outcome_unknown"),
                request_digest: DigestSchema,
                writer_role: WriterRoleSchema,
                error_code: z.enum(["network_error", "request_timeout", "response_invalid", "response_too_large"]),
            })
            .strict(),
    ])
    .superRefine((result, context) => {
        if (result.status === "delivered") {
            if (
                result.response.request_digest !== result.request_digest ||
                result.response.writer_role !== result.writer_role
            ) {
                context.addIssue({
                    code: "custom",
                    path: ["response"],
                    message: "Delivered Writer response must match the request digest and role",
                });
            }
            if (result.http_status !== d1ProbeGatewayTrialHttpStatusV1(result.response)) {
                context.addIssue({
                    code: "custom",
                    path: ["http_status"],
                    message: "Delivered Writer status must match its response",
                });
            }
        }
        if (result.status === "server_rejected" && result.http_status !== d1ProbeHttpErrorStatusV1(result.response)) {
            context.addIssue({
                code: "custom",
                path: ["http_status"],
                message: "Rejected Writer status must match its response",
            });
        }
        if (result.status === "server_rejected") {
            const rejectedBeforeAccess =
                result.response.code === "access_required" || result.response.code === "not_found";
            if (
                (rejectedBeforeAccess && result.runtime_version !== null) ||
                (!rejectedBeforeAccess && result.runtime_version === null)
            ) {
                context.addIssue({
                    code: "custom",
                    path: ["runtime_version"],
                    message: "Writer runtime metadata must appear only after Access authentication",
                });
            }
        }
    });
export type D1ProbeDriverTransportResultV1 = z.infer<typeof D1ProbeDriverTransportResultV1Schema>;

export interface D1ProbeDriverTransportDependenciesV1 {
    readonly fetch: typeof globalThis.fetch;
}

const readBoundedResponse = async (response: Response): Promise<Uint8Array | "too_large" | null> => {
    if (response.body === null) return null;
    const declaredHeader = response.headers.get("content-length");
    let declaredLength: number | null = null;
    if (declaredHeader !== null) {
        if (!/^[1-9][0-9]{0,5}$/u.test(declaredHeader)) return null;
        declaredLength = Number(declaredHeader);
        if (!Number.isSafeInteger(declaredLength)) return null;
        if (declaredLength > D1_PROBE_DRIVER_RESPONSE_LIMIT_BYTES_V1) return "too_large";
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const result = await reader.read();
            if (result.done) break;
            total += result.value.byteLength;
            if (total > D1_PROBE_DRIVER_RESPONSE_LIMIT_BYTES_V1) {
                await reader.cancel("D1 probe Writer response exceeded its bound");
                return "too_large";
            }
            chunks.push(result.value);
        }
    } catch {
        return null;
    }
    if (total === 0 || (declaredLength !== null && total !== declaredLength)) return null;
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return body;
};

const unknown = (
    request: D1ProbeGatewayTrialRequestV1,
    errorCode: Extract<D1ProbeDriverTransportResultV1, { status: "outcome_unknown" }>["error_code"]
): D1ProbeDriverTransportResultV1 => ({
    status: "outcome_unknown",
    request_digest: request.request_digest,
    writer_role: request.writer_role,
    error_code: errorCode,
});

export const createD1ProbeGatewayTrialTransportV1 = (
    configInput: unknown,
    serviceTokenInput: unknown,
    dependencies: D1ProbeDriverTransportDependenciesV1 = { fetch: globalThis.fetch }
): ((input: unknown) => Promise<D1ProbeDriverTransportResultV1>) => {
    let config: ReturnType<typeof D1ProbeDriverTransportConfigV1Schema.safeParse>;
    let serviceToken: ReturnType<typeof D1ProbeDriverServiceTokenV1Schema.safeParse>;
    let fetchImplementation: typeof globalThis.fetch;
    try {
        config = D1ProbeDriverTransportConfigV1Schema.safeParse(configInput);
        serviceToken = D1ProbeDriverServiceTokenV1Schema.safeParse(serviceTokenInput);
        fetchImplementation = dependencies.fetch;
    } catch {
        throw new TypeError("Invalid D1 probe driver bootstrap configuration");
    }
    if (!config.success || !serviceToken.success || typeof fetchImplementation !== "function") {
        throw new TypeError("Invalid D1 probe driver bootstrap configuration");
    }
    const trustedConfig = Object.freeze({ ...config.data });
    const clientSecret = serviceToken.data.client_secret;

    return async input => {
        let request: D1ProbeGatewayTrialRequestV1;
        let requestBody: string;
        try {
            request = await parseAndVerifyD1ProbeGatewayTrialRequestV1(input);
            requestBody = await canonicalD1ProbeGatewayTrialHttpBodyV1(request);
        } catch {
            return {
                status: "local_rejected",
                request_digest: null,
                writer_role: trustedConfig.writer_role,
                error_code: "invalid_request",
            };
        }
        if (request.writer_role !== trustedConfig.writer_role) {
            return {
                status: "local_rejected",
                request_digest: null,
                writer_role: trustedConfig.writer_role,
                error_code: "invalid_request",
            };
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), trustedConfig.request_timeout_ms);
        let response: Response;
        try {
            response = await fetchImplementation(trustedConfig.exact_trigger_url, {
                method: "POST",
                headers: {
                    "CF-Access-Client-Id": trustedConfig.access_service_token_client_id,
                    "CF-Access-Client-Secret": clientSecret,
                    "content-length": String(new TextEncoder().encode(requestBody).byteLength),
                    "content-type": "application/json",
                },
                body: requestBody,
                cache: "no-store",
                credentials: "omit",
                redirect: "error",
                referrerPolicy: "no-referrer",
                signal: controller.signal,
            });
        } catch {
            clearTimeout(timeout);
            return unknown(request, controller.signal.aborted ? "request_timeout" : "network_error");
        }

        try {
            if (
                response.redirected ||
                (response.url !== "" && response.url !== trustedConfig.exact_trigger_url) ||
                response.headers.get("content-type") !== "application/json; charset=utf-8" ||
                response.headers.get("cache-control") !== "no-store" ||
                response.headers.get("referrer-policy") !== "no-referrer" ||
                response.headers.get("x-content-type-options") !== "nosniff" ||
                response.headers.has("content-encoding")
            ) {
                return unknown(request, "response_invalid");
            }
            const body = await readBoundedResponse(response);
            if (body === "too_large") return unknown(request, "response_too_large");
            if (body === null) {
                return unknown(request, controller.signal.aborted ? "request_timeout" : "response_invalid");
            }

            let text: string;
            let parsed: D1ProbeGatewayTrialHttpResponseV1;
            let runtimeVersion: D1ProbeRuntimeVersionMetadataV1 | null = null;
            try {
                const runtimeHeader = response.headers.get(D1_PROBE_RUNTIME_VERSION_HEADER_V1);
                runtimeVersion = runtimeHeader === null ? null : parseD1ProbeRuntimeVersionHeaderV1(runtimeHeader);
                text = new TextDecoder("utf-8", { fatal: true }).decode(body);
                parsed = parseD1ProbeGatewayTrialHttpResponseV1(JSON.parse(text) as unknown);
                if (text !== canonicalD1ProbeGatewayTrialHttpResponseV1(parsed)) {
                    return unknown(request, "response_invalid");
                }
            } catch {
                return unknown(request, "response_invalid");
            }

            if ("kind" in parsed) {
                const rejectedBeforeAccess = parsed.code === "access_required" || parsed.code === "not_found";
                return response.status === d1ProbeHttpErrorStatusV1(parsed) &&
                    ((rejectedBeforeAccess && runtimeVersion === null) ||
                        (!rejectedBeforeAccess && runtimeVersion !== null))
                    ? {
                          status: "server_rejected",
                          request_digest: request.request_digest,
                          writer_role: request.writer_role,
                          http_status: response.status,
                          response_byte_count: body.byteLength,
                          runtime_version: runtimeVersion,
                          response: parsed,
                      }
                    : unknown(request, "response_invalid");
            }
            if (
                runtimeVersion === null ||
                response.status !== d1ProbeGatewayTrialHttpStatusV1(parsed) ||
                parsed.request_digest !== request.request_digest ||
                parsed.writer_role !== request.writer_role
            ) {
                return unknown(request, "response_invalid");
            }
            return {
                status: "delivered",
                request_digest: request.request_digest,
                writer_role: request.writer_role,
                http_status: response.status,
                response_byte_count: body.byteLength,
                runtime_version: runtimeVersion,
                response: parsed,
            };
        } catch {
            return unknown(request, controller.signal.aborted ? "request_timeout" : "response_invalid");
        } finally {
            clearTimeout(timeout);
        }
    };
};
