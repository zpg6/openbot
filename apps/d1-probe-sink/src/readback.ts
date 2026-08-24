import {
    D1_PROBE_RUNTIME_VERSION_HEADER_V1,
    D1ProbeRuntimeVersionMetadataV1Schema,
    D1ProbeSinkReadbackHttpConfigV1Schema,
    D1ProbeSinkReadbackV1Schema,
    canonicalD1ProbeSinkReadbackV1,
    d1ProbeHttpErrorV1,
    d1ProbeRuntimeVersionHeaderV1,
    normalizeD1ProbeD1MetadataV1,
    type D1ProbeSinkReadbackHttpConfigV1,
} from "@openbot/d1-probe-rpc";

export { D1ProbeSinkReadbackHttpConfigV1Schema };
export type { D1ProbeSinkReadbackHttpConfigV1 };

export interface D1ProbeAccessContextV1 {
    readonly aud: unknown;
    getIdentity(): Promise<unknown>;
}

type ReadbackRowV1 = Readonly<{
    probe_run_id: unknown;
    receipt_count: unknown;
    writer_a_receipt_count: unknown;
    writer_b_receipt_count: unknown;
    distinct_source_request_digest_count: unknown;
    distinct_receipt_request_digest_count: unknown;
}>;

const responseHeaders = Object.freeze({
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
});

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
    config: D1ProbeSinkReadbackHttpConfigV1
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

const jsonResponse = (body: string, status: number, runtimeHeader?: string): Response =>
    new Response(body, {
        status,
        headers: {
            ...responseHeaders,
            ...(runtimeHeader === undefined ? {} : { [D1_PROBE_RUNTIME_VERSION_HEADER_V1]: runtimeHeader }),
        },
    });

const errorResponse = (
    code: "access_required" | "method_not_allowed" | "not_found" | "readback_unavailable",
    status: number,
    runtimeHeader?: string
): Response => jsonResponse(JSON.stringify(d1ProbeHttpErrorV1(code)), status, runtimeHeader);

const exactReadback = async (
    database: D1Database,
    config: D1ProbeSinkReadbackHttpConfigV1,
    runtimeVersion: unknown
): Promise<string | null> => {
    try {
        const session = database.withSession("first-primary");
        const result = await session
            .prepare(
                `SELECT ? AS probe_run_id,
                        COUNT(*) AS receipt_count,
                        COALESCE(SUM(CASE WHEN writer_role = 'writer_a' THEN 1 ELSE 0 END), 0) AS writer_a_receipt_count,
                        COALESCE(SUM(CASE WHEN writer_role = 'writer_b' THEN 1 ELSE 0 END), 0) AS writer_b_receipt_count,
                        COUNT(DISTINCT source_request_digest) AS distinct_source_request_digest_count,
                        COUNT(DISTINCT receipt_request_digest) AS distinct_receipt_request_digest_count
                 FROM _openbot_probe_external_sink_receipt
                 WHERE probe_run_id = ?`
            )
            .bind(config.probe_run_id, config.probe_run_id)
            .all<ReadbackRowV1>();
        if (result.success !== true || result.results.length !== 1) return null;
        const row = ownDataRecord(result.results[0]);
        if (row === null) return null;
        const keys = Object.keys(row).sort();
        const expectedKeys = [
            "distinct_receipt_request_digest_count",
            "distinct_source_request_digest_count",
            "probe_run_id",
            "receipt_count",
            "writer_a_receipt_count",
            "writer_b_receipt_count",
        ];
        if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) return null;
        const readback = D1ProbeSinkReadbackV1Schema.safeParse({
            schema_version: 1,
            kind: "d1_probe_sink_readback",
            ...row,
            runtime_version: runtimeVersion,
            metadata: normalizeD1ProbeD1MetadataV1(result.meta, false),
        });
        return readback.success ? canonicalD1ProbeSinkReadbackV1(readback.data) : null;
    } catch {
        return null;
    }
};

export const createD1ProbeSinkReadbackHttpHandlerV1 = (
    configInput: unknown,
    database: D1Database,
    runtimeVersionInput: unknown
): ((request: Request, access?: D1ProbeAccessContextV1) => Promise<Response>) => {
    let config: ReturnType<typeof D1ProbeSinkReadbackHttpConfigV1Schema.safeParse>;
    let runtimeVersion: ReturnType<typeof D1ProbeRuntimeVersionMetadataV1Schema.safeParse>;
    try {
        config = D1ProbeSinkReadbackHttpConfigV1Schema.safeParse(configInput);
        runtimeVersion = D1ProbeRuntimeVersionMetadataV1Schema.safeParse(runtimeVersionInput);
    } catch {
        throw new TypeError("Invalid D1 probe sink readback configuration");
    }
    if (!config.success || !runtimeVersion.success) {
        throw new TypeError("Invalid D1 probe sink readback configuration");
    }
    const runtimeHeader = d1ProbeRuntimeVersionHeaderV1(runtimeVersion.data);

    return async (request, access) => {
        if (request.url !== config.data.exact_readback_url) return errorResponse("not_found", 404);
        if (!(await accessMatches(access, config.data))) return errorResponse("access_required", 403);
        if (request.method !== "GET") {
            const response = errorResponse("method_not_allowed", 405, runtimeHeader);
            response.headers.set("allow", "GET");
            return response;
        }
        if (
            request.body !== null ||
            request.headers.has("content-length") ||
            request.headers.has("content-type") ||
            request.headers.has("content-encoding") ||
            request.headers.has("transfer-encoding")
        ) {
            return errorResponse("not_found", 404, runtimeHeader);
        }
        const body = await exactReadback(database, config.data, runtimeVersion.data);
        return body === null
            ? errorResponse("readback_unavailable", 503, runtimeHeader)
            : jsonResponse(body, 200, runtimeHeader);
    };
};
