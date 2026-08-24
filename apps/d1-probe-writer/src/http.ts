import {
    D1_PROBE_GATEWAY_TRIAL_HTTP_BODY_LIMIT_BYTES_V1,
    D1_PROBE_RPC_VERSION_V1,
    D1_PROBE_RUNTIME_VERSION_HEADER_V1,
    D1ProbeRuntimeVersionMetadataV1Schema,
    D1ProbeWriterHttpConfigV1Schema,
    canonicalD1ProbeGatewayTrialHttpBodyV1,
    canonicalD1ProbeGatewayTrialHttpResponseV1,
    d1ProbeGatewayTrialHttpStatusV1,
    d1ProbeHttpErrorV1,
    d1ProbeRuntimeVersionHeaderV1,
    gatewayTrialResponseV1,
    parseAndVerifyD1ProbeGatewayTrialRequestV1,
    type D1ProbeGatewayTrialRequestV1,
    type D1ProbeGatewayTrialResponseV1,
    type D1ProbeHttpErrorCodeV1,
    type D1ProbeWriterHttpConfigV1,
    type D1ProbeWriterRoleV1,
} from "@openbot/d1-probe-rpc";

export { D1ProbeWriterHttpConfigV1Schema };
export type { D1ProbeWriterHttpConfigV1 };

export interface D1ProbeAccessContextV1 {
    readonly aud: unknown;
    getIdentity(): Promise<unknown>;
}

export interface D1ProbeWriterHttpExecutionV1 {
    runGatewayTrial(input: D1ProbeGatewayTrialRequestV1): Promise<D1ProbeGatewayTrialResponseV1>;
}

const responseHeaders = Object.freeze({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
});

const jsonResponse = (body: string, status: number, extraHeaders: Readonly<Record<string, string>> = {}): Response =>
    new Response(body, { status, headers: { ...responseHeaders, ...extraHeaders } });

const errorResponse = (code: D1ProbeHttpErrorCodeV1, status: number, extraHeaders = {}): Response =>
    jsonResponse(JSON.stringify(d1ProbeHttpErrorV1(code)), status, extraHeaders);

const ownDataRecord = (value: unknown): Readonly<Record<string, unknown>> | null => {
    try {
        if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
        const descriptors = Object.getOwnPropertyDescriptors(value);
        for (const descriptor of Object.values(descriptors)) if (!("value" in descriptor)) return null;
        return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [key, descriptor.value]));
    } catch {
        return null;
    }
};

const accessMatches = async (
    access: D1ProbeAccessContextV1 | undefined,
    config: D1ProbeWriterHttpConfigV1
): Promise<boolean> => {
    try {
        if (access === undefined || access.aud !== config.access_audience) return false;
        const identity = ownDataRecord(await access.getIdentity());
        return (
            identity !== null &&
            identity["service_token_status"] === true &&
            identity["service_token_id"] === config.access_service_client_id
        );
    } catch {
        return false;
    }
};

const contentLengthFrom = (request: Request): number | null => {
    const value = request.headers.get("content-length");
    if (value === null || !/^[1-9][0-9]{0,4}$/u.test(value)) return null;
    const length = Number(value);
    return Number.isSafeInteger(length) ? length : null;
};

const readExactBody = async (request: Request, declaredLength: number): Promise<Uint8Array | null | "too_large"> => {
    if (request.body === null) return null;
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const result = await reader.read();
            if (result.done) break;
            total += result.value.byteLength;
            if (total > D1_PROBE_GATEWAY_TRIAL_HTTP_BODY_LIMIT_BYTES_V1 || total > declaredLength) {
                await reader.cancel("D1 probe request body exceeded its bound");
                return "too_large";
            }
            chunks.push(result.value);
        }
    } catch {
        return null;
    }
    if (total !== declaredLength) return null;
    const body = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return body;
};

const unknownExecution = (
    request: D1ProbeGatewayTrialRequestV1,
    writerRole: D1ProbeWriterRoleV1
): D1ProbeGatewayTrialResponseV1 =>
    gatewayTrialResponseV1({
        schema_version: D1_PROBE_RPC_VERSION_V1,
        operation: "run_gateway_trial_v1",
        request_digest: request.request_digest,
        writer_role: writerRole,
        status: "outcome_unknown",
        error_code: "gateway_execution_unknown",
        readiness: null,
        barrier: null,
        readiness_denial_readback: null,
        gateway_response: null,
    });

export const createD1ProbeWriterHttpHandlerV1 = (
    configInput: unknown,
    execution: D1ProbeWriterHttpExecutionV1,
    runtimeVersionInput: unknown
): ((request: Request, access?: D1ProbeAccessContextV1) => Promise<Response>) => {
    let config: ReturnType<typeof D1ProbeWriterHttpConfigV1Schema.safeParse>;
    try {
        config = D1ProbeWriterHttpConfigV1Schema.safeParse(configInput);
    } catch {
        throw new TypeError("Invalid D1 probe Writer HTTP configuration");
    }
    if (!config.success) throw new TypeError("Invalid D1 probe Writer HTTP configuration");
    let runtimeVersion: ReturnType<typeof D1ProbeRuntimeVersionMetadataV1Schema.safeParse>;
    try {
        runtimeVersion = D1ProbeRuntimeVersionMetadataV1Schema.safeParse(runtimeVersionInput);
    } catch {
        throw new TypeError("Invalid D1 probe Writer runtime version metadata");
    }
    if (!runtimeVersion.success) throw new TypeError("Invalid D1 probe Writer runtime version metadata");
    const runtimeHeaders = {
        [D1_PROBE_RUNTIME_VERSION_HEADER_V1]: d1ProbeRuntimeVersionHeaderV1(runtimeVersion.data),
    } satisfies Readonly<Record<string, string>>;

    return async (request, access) => {
        if (request.url !== config.data.exact_trigger_url) return errorResponse("not_found", 404);
        if (!(await accessMatches(access, config.data))) return errorResponse("access_required", 403);
        if (request.method !== "POST") {
            return errorResponse("method_not_allowed", 405, { ...runtimeHeaders, allow: "POST" });
        }
        if (request.headers.get("content-type") !== "application/json") {
            return errorResponse("content_type_required", 415, runtimeHeaders);
        }
        if (request.headers.has("content-encoding") || request.headers.has("transfer-encoding")) {
            return errorResponse("content_encoding_forbidden", 415, runtimeHeaders);
        }
        const contentLength = contentLengthFrom(request);
        if (contentLength === null) return errorResponse("content_length_required", 411, runtimeHeaders);
        if (contentLength > D1_PROBE_GATEWAY_TRIAL_HTTP_BODY_LIMIT_BYTES_V1) {
            return errorResponse("body_too_large", 413, runtimeHeaders);
        }
        const body = await readExactBody(request, contentLength);
        if (body === "too_large") return errorResponse("body_too_large", 413, runtimeHeaders);
        if (body === null) return errorResponse("invalid_body", 400, runtimeHeaders);

        let text: string;
        let parsedBody: unknown;
        let trial: D1ProbeGatewayTrialRequestV1;
        try {
            text = new TextDecoder("utf-8", { fatal: true }).decode(body);
            parsedBody = JSON.parse(text) as unknown;
            trial = await parseAndVerifyD1ProbeGatewayTrialRequestV1(parsedBody);
            if (text !== (await canonicalD1ProbeGatewayTrialHttpBodyV1(trial))) {
                return errorResponse("invalid_body", 400, runtimeHeaders);
            }
        } catch {
            return errorResponse("invalid_body", 400, runtimeHeaders);
        }
        if (trial.writer_role !== config.data.writer_role) return errorResponse("invalid_body", 400, runtimeHeaders);

        let result: D1ProbeGatewayTrialResponseV1;
        try {
            const candidate = gatewayTrialResponseV1(await execution.runGatewayTrial(trial));
            result =
                candidate.request_digest === trial.request_digest && candidate.writer_role === config.data.writer_role
                    ? candidate
                    : unknownExecution(trial, config.data.writer_role);
        } catch {
            result = unknownExecution(trial, config.data.writer_role);
        }
        return jsonResponse(
            canonicalD1ProbeGatewayTrialHttpResponseV1(result),
            d1ProbeGatewayTrialHttpStatusV1(result),
            runtimeHeaders
        );
    };
};
