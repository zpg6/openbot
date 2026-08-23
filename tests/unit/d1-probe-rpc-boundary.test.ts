import { readFile } from "node:fs/promises";

import {
    computeD1ProbeReceiptRequestDigestV1,
    type D1ProbeReceiptResponseV1,
    type D1ProbeSinkServiceV1,
    type UnsignedD1ProbeReceiptRequestV1,
} from "../../packages/d1-probe-rpc/src/index.js";
import { describe, expect, it } from "vitest";

import { recordProbeReceiptV1 } from "../../apps/d1-probe-sink/src/record.js";
import { forwardProbeReceiptV1 } from "../../apps/d1-probe-writer/src/forward.js";

const hex = (character: string): string => character.repeat(64);

const signedRequest = async (role: "writer_a" | "writer_b" = "writer_a") => {
    const unsigned: UnsignedD1ProbeReceiptRequestV1 = {
        schema_version: 1,
        operation: "record_probe_receipt_v1",
        request_id: "request_0000000001",
        probe_run_id: "probe_run_0000001",
        writer_role: role,
        source_request_digest: hex("1"),
        payload: {
            kind: "gateway_dispatch",
            call_kind: "model",
            logical_call_id: "logical_call_0001",
            attempt_id: "attempt_00000001",
            call_sequence: 1,
            reservation_id: "reservation_0001",
            dispatch_request_digest: hex("2"),
        },
    };
    return { ...unsigned, request_digest: await computeD1ProbeReceiptRequestDigestV1(unsigned) };
};

class FakeDatabase {
    readonly calls: Array<{ query: string; values: unknown[] }> = [];
    mode: "success" | "throw_before" | "throw_during" | "malformed" = "success";

    prepare(query: string) {
        if (this.mode === "throw_before") throw new Error("prepare failed");
        return {
            bind: (...values: unknown[]) => ({
                all: async <T>() => {
                    this.calls.push({ query, values });
                    if (this.mode === "throw_during") throw new Error("D1 response lost");
                    if (this.mode === "malformed") return { success: true, results: [] as T[] };
                    return { success: true, results: [{ receipt_id: values[0] }] as T[] };
                },
            }),
        };
    }
}

describe("deployed D1 probe private RPC boundary", () => {
    it("records every valid request under a fresh receipt without deduplication", async () => {
        const database = new FakeDatabase();
        const request = await signedRequest();
        const receipts = ["receipt_000000001", "receipt_000000002"];
        const first = await recordProbeReceiptV1(
            database,
            "version_00000001",
            request,
            () => receipts.shift() as string
        );
        const second = await recordProbeReceiptV1(
            database,
            "version_00000001",
            request,
            () => receipts.shift() as string
        );
        expect(first).toMatchObject({ status: "recorded", receipt_id: "receipt_000000001" });
        expect(second).toMatchObject({ status: "recorded", receipt_id: "receipt_000000002" });
        expect(database.calls).toHaveLength(2);
        expect(database.calls[0]?.query).not.toMatch(/OR\s+(?:IGNORE|REPLACE)|ON\s+CONFLICT/iu);
        expect(database.calls[0]?.values).toEqual([
            "receipt_000000001",
            request.probe_run_id,
            request.writer_role,
            request.payload.kind,
            request.source_request_digest,
            request.request_digest,
        ]);
    });

    it("rejects malformed input before D1 and keeps post-call ambiguity explicit", async () => {
        const database = new FakeDatabase();
        expect(await recordProbeReceiptV1(database, "version_00000001", {}, () => "receipt_000000001")).toMatchObject({
            status: "rejected",
            error_code: "invalid_request",
        });
        expect(database.calls).toHaveLength(0);
        expect(
            await recordProbeReceiptV1(database, "bad", await signedRequest(), () => "receipt_000000001")
        ).toMatchObject({
            status: "unavailable",
            error_code: "sink_unavailable",
        });
        expect(database.calls).toHaveLength(0);

        database.mode = "throw_during";
        expect(
            await recordProbeReceiptV1(database, "version_00000001", await signedRequest(), () => "receipt_000000001")
        ).toMatchObject({ status: "outcome_unknown", error_code: "d1_outcome_unknown" });
        database.mode = "malformed";
        expect(
            await recordProbeReceiptV1(database, "version_00000001", await signedRequest(), () => "receipt_000000002")
        ).toMatchObject({ status: "outcome_unknown" });
        database.mode = "throw_before";
        expect(
            await recordProbeReceiptV1(database, "version_00000001", await signedRequest(), () => "receipt_000000003")
        ).toMatchObject({ status: "unavailable", error_code: "sink_unavailable" });
    });

    it("pins each writer role and treats a lost or malformed sink response as unknown", async () => {
        const calls: unknown[] = [];
        const sink: D1ProbeSinkServiceV1 = {
            record: async input => {
                calls.push(input);
                const request = input as { request_digest: string };
                return {
                    schema_version: 1,
                    operation: "record_probe_receipt_v1",
                    request_digest: request.request_digest,
                    status: "recorded",
                    error_code: null,
                    receipt_id: "receipt_000000001",
                    sink_runtime_version_id: "version_00000001",
                };
            },
        };
        expect(await forwardProbeReceiptV1(sink, "writer_a", await signedRequest("writer_b"))).toMatchObject({
            status: "rejected",
        });
        expect(calls).toHaveLength(0);
        expect(await forwardProbeReceiptV1(sink, "writer_a", await signedRequest("writer_a"))).toMatchObject({
            status: "recorded",
        });
        expect(calls).toHaveLength(1);

        const lostSink: D1ProbeSinkServiceV1 = {
            record: async () => {
                throw new Error("RPC response lost");
            },
        };
        expect(await forwardProbeReceiptV1(lostSink, "writer_a", await signedRequest())).toMatchObject({
            status: "outcome_unknown",
        });
        const wrongDigestSink: D1ProbeSinkServiceV1 = {
            record: async () =>
                ({
                    schema_version: 1,
                    operation: "record_probe_receipt_v1",
                    request_digest: hex("f"),
                    status: "recorded",
                    error_code: null,
                    receipt_id: "receipt_000000001",
                    sink_runtime_version_id: "version_00000001",
                }) satisfies D1ProbeReceiptResponseV1,
        };
        expect(await forwardProbeReceiptV1(wrongDigestSink, "writer_a", await signedRequest())).toMatchObject({
            status: "outcome_unknown",
        });
    });

    it("keeps every checked-in config local-only, private, unlogged, and bound to one D1 database", async () => {
        const configUrls = [
            new URL("../../apps/d1-probe-sink/wrangler.local.jsonc", import.meta.url),
            new URL("../../apps/d1-probe-writer/wrangler.a.local.jsonc", import.meta.url),
            new URL("../../apps/d1-probe-writer/wrangler.b.local.jsonc", import.meta.url),
        ];
        const configs = await Promise.all(configUrls.map(url => readFile(url, "utf8")));
        for (const config of configs) {
            expect(config).toMatch(/local-only/u);
            expect(config).toMatch(/"workers_dev": false/u);
            expect(config).toMatch(/"preview_urls": false/u);
            expect(config).toMatch(/"observability": \{ "enabled": false \}/u);
            expect(config).not.toMatch(/"routes?"\s*:/u);
            expect(config).toMatch(/"binding": "PROBE_DB"/u);
            expect(config).not.toMatch(/API_KEY|TOKEN|SECRET|METORIAL|OPENROUTER/iu);
        }
        expect(configs[1]).toMatch(/"entrypoint": "D1ProbeSinkService"/u);
        expect(configs[2]).toMatch(/"entrypoint": "D1ProbeSinkService"/u);
        const parsed = configs.map(config => JSON.parse(config.replace(/,\s*([}\]])/gu, "$1"))) as Array<{
            name: string;
            d1_databases: Array<{ database_id: string }>;
            services?: Array<{ service: string; entrypoint: string }>;
        }>;
        expect(new Set(parsed.map(config => config.name)).size).toBe(3);
        expect(new Set(parsed.map(config => config.d1_databases[0]?.database_id)).size).toBe(1);
        expect(parsed[1]?.services?.[0]).toEqual({
            binding: "PROBE_SINK",
            service: parsed[0]?.name,
            entrypoint: "D1ProbeSinkService",
        });
        expect(parsed[2]?.services?.[0]).toEqual(parsed[1]?.services?.[0]);

        const [sinkEntry, writerEntry, sinkRecord, writerForward] = await Promise.all([
            readFile(new URL("../../apps/d1-probe-sink/entry.ts", import.meta.url), "utf8"),
            readFile(new URL("../../apps/d1-probe-writer/entry.ts", import.meta.url), "utf8"),
            readFile(new URL("../../apps/d1-probe-sink/src/record.ts", import.meta.url), "utf8"),
            readFile(new URL("../../apps/d1-probe-writer/src/forward.ts", import.meta.url), "utf8"),
        ]);
        expect(sinkEntry).toMatch(/fetch\(\): Response[\s\S]*new Response\("Not found", \{ status: 404/iu);
        expect(writerEntry).toMatch(/fetch\(\): Response[\s\S]*new Response\("Not found", \{ status: 404/iu);
        expect(`${sinkRecord}\n${writerForward}`).not.toMatch(/\bfetch\s*\(/u);
    });
});
