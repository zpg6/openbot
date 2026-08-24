import { D1_PROBE_RUNTIME_VERSION_HEADER_V1, d1ProbeRuntimeVersionHeaderV1 } from "@openbot/d1-probe-rpc";
import { describe, expect, it, vi } from "vitest";

import { createD1ProbeSinkReadbackHttpHandlerV1, type D1ProbeAccessContextV1 } from "./readback.js";

const exactUrl = "https://probe.example.test/_openbot-d1-probe/readback/run-000000000001";
const audience = "a".repeat(64);
const serviceTokenClientId = `${"b".repeat(32)}.access`;
const probeRunId = "probe_run_0000001";
const runtimeVersion = {
    id: "sink_version_00001",
    tag: "probe-sink",
    timestamp: "2026-08-24T12:34:56.000Z",
} as const;

const config = {
    schema_version: 1,
    exact_readback_url: exactUrl,
    access_audience: audience,
    access_service_client_id: serviceTokenClientId,
    probe_run_id: probeRunId,
} as const;

const rawMetadata = {
    changes: 0,
    rows_read: 1,
    rows_written: 0,
    changed_db: false,
    served_by_primary: true,
    served_by: "d1-primary",
    served_by_region: "WNAM",
    duration: 0.2,
    timings: { sql_duration_ms: 0.1 },
    total_attempts: 1,
    last_row_id: null,
    size_after: 4096,
} as const;
const normalizedMetadata = {
    changes: 0,
    rows_read: 1,
    rows_written: 0,
    changed_db: false,
    served_by_primary: true,
    served_by: "d1-primary",
    served_by_region: "WNAM",
    duration: 0.2,
    sql_duration_ms: 0.1,
    total_attempts: 1,
    last_row_id: null,
    size_after: 4096,
} as const;

const access = (overrides: Partial<D1ProbeAccessContextV1> = {}): D1ProbeAccessContextV1 => ({
    aud: audience,
    getIdentity: async () => ({
        service_token_status: true,
        service_token_id: serviceTokenClientId,
        email: "ignored@example.test",
    }),
    ...overrides,
});

const database = (resultOverrides: Readonly<Record<string, unknown>> = {}) => {
    const all = vi.fn(async () => ({
        success: true,
        results: [
            {
                probe_run_id: probeRunId,
                receipt_count: 3,
                writer_a_receipt_count: 2,
                writer_b_receipt_count: 1,
                distinct_source_request_digest_count: 2,
                distinct_receipt_request_digest_count: 3,
            },
        ],
        meta: rawMetadata,
        ...resultOverrides,
    }));
    const bind = vi.fn(() => ({ all }));
    const prepare = vi.fn((_query: string) => ({ bind }));
    const withSession = vi.fn(() => ({ prepare }));
    return { all, bind, prepare, withSession, value: { withSession } as unknown as D1Database };
};

describe("D1 probe sink readback HTTP boundary", () => {
    it("returns one fixed primary readback for the configured run and exact runtime version", async () => {
        const probeDatabase = database();
        const handler = createD1ProbeSinkReadbackHttpHandlerV1(config, probeDatabase.value, runtimeVersion);
        const response = await handler(new Request(exactUrl), access());
        expect(response.status).toBe(200);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get(D1_PROBE_RUNTIME_VERSION_HEADER_V1)).toBe(
            d1ProbeRuntimeVersionHeaderV1(runtimeVersion)
        );
        expect(await response.json()).toEqual({
            schema_version: 1,
            kind: "d1_probe_sink_readback",
            probe_run_id: probeRunId,
            runtime_version: runtimeVersion,
            receipt_count: 3,
            writer_a_receipt_count: 2,
            writer_b_receipt_count: 1,
            distinct_source_request_digest_count: 2,
            distinct_receipt_request_digest_count: 3,
            metadata: normalizedMetadata,
        });
        expect(probeDatabase.withSession).toHaveBeenCalledWith("first-primary");
        expect(probeDatabase.bind).toHaveBeenCalledWith(probeRunId, probeRunId);
    });

    it.each([
        ["missing context", undefined],
        ["wrong audience", access({ aud: "c".repeat(64) })],
        ["wrong service token", access({ getIdentity: async () => ({ service_token_status: true }) })],
        ["failed identity lookup", access({ getIdentity: async () => Promise.reject(new Error("unavailable")) })],
    ] as const)("rejects %s before D1", async (_label, context) => {
        const probeDatabase = database();
        const response = await createD1ProbeSinkReadbackHttpHandlerV1(
            config,
            probeDatabase.value,
            runtimeVersion
        )(new Request(exactUrl), context);
        expect(response.status).toBe(403);
        expect(await response.json()).toMatchObject({ code: "access_required" });
        expect(response.headers.get(D1_PROBE_RUNTIME_VERSION_HEADER_V1)).toBeNull();
        expect(probeDatabase.withSession).not.toHaveBeenCalled();
    });

    it("rejects another path, query, method, and body-shaped GET before D1", async () => {
        const probeDatabase = database();
        const handler = createD1ProbeSinkReadbackHttpHandlerV1(config, probeDatabase.value, runtimeVersion);
        const responses = await Promise.all([
            handler(new Request(`${exactUrl}/other`), access()),
            handler(new Request(`${exactUrl}?probe_run_id=other`), access()),
            handler(new Request(exactUrl, { method: "POST" }), access()),
            handler(new Request(exactUrl, { headers: { "content-type": "application/json" } }), access()),
        ]);
        expect(responses.map(response => response.status)).toEqual([404, 404, 405, 404]);
        expect(responses[0]?.headers.get(D1_PROBE_RUNTIME_VERSION_HEADER_V1)).toBeNull();
        expect(responses[1]?.headers.get(D1_PROBE_RUNTIME_VERSION_HEADER_V1)).toBeNull();
        expect(probeDatabase.withSession).not.toHaveBeenCalled();
    });

    it("accepts an exact empty receipt set", async () => {
        const probeDatabase = database({
            results: [
                {
                    probe_run_id: probeRunId,
                    receipt_count: 0,
                    writer_a_receipt_count: 0,
                    writer_b_receipt_count: 0,
                    distinct_source_request_digest_count: 0,
                    distinct_receipt_request_digest_count: 0,
                },
            ],
        });
        const response = await createD1ProbeSinkReadbackHttpHandlerV1(
            config,
            probeDatabase.value,
            runtimeVersion
        )(new Request(exactUrl), access());
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ receipt_count: 0 });
        expect(probeDatabase.prepare.mock.calls[0]?.[0]).toContain("COALESCE(SUM");
    });

    it("contains malformed or non-primary D1 observations", async () => {
        for (const meta of [
            { ...rawMetadata, served_by_primary: false },
            { ...rawMetadata, unrecognized: "field" },
            { ...rawMetadata, timings: {} },
        ]) {
            const probeDatabase = database({ meta });
            const response = await createD1ProbeSinkReadbackHttpHandlerV1(
                config,
                probeDatabase.value,
                runtimeVersion
            )(new Request(exactUrl), access());
            expect(response.status).toBe(503);
            expect(await response.json()).toMatchObject({ code: "readback_unavailable" });
        }
    });

    it("rejects invalid bootstrap config and runtime metadata", () => {
        const probeDatabase = database();
        expect(() =>
            createD1ProbeSinkReadbackHttpHandlerV1(
                { ...config, exact_readback_url: "http://probe.example.test/readback" },
                probeDatabase.value,
                runtimeVersion
            )
        ).toThrow(TypeError);
        expect(() =>
            createD1ProbeSinkReadbackHttpHandlerV1(config, probeDatabase.value, {
                ...runtimeVersion,
                timestamp: "invalid",
            })
        ).toThrow(TypeError);
    });
});
