import { cloudflareTest } from "@cloudflare/vitest-plugin";
import path from "node:path";
import { defineConfig } from "vitest/config";

process.env["WRANGLER_LOG_PATH"] ??= path.resolve(".wrangler/logs/vitest-d1-probe-writer.log");

export default defineConfig({
    plugins: [
        cloudflareTest({
            miniflare: {
                workers: [
                    {
                        name: "openbot-d1-probe-sink-local-only",
                        compatibilityDate: "2026-08-22",
                        d1Databases: { PROBE_DB: "openbot-d1-probe-local-only" },
                        modules: [
                            {
                                type: "ESModule",
                                path: "d1-probe-sink-test-double.mjs",
                                contents: `
                                    import { WorkerEntrypoint } from "cloudflare:workers";
                                    export class D1ProbeSinkService extends WorkerEntrypoint {
                                        async record(input) {
                                            const receiptId = crypto.randomUUID();
                                            const result = await this.env.PROBE_DB.prepare(
                                                "INSERT INTO _openbot_probe_external_sink_receipt (receipt_id, probe_run_id, writer_role, receipt_kind, source_request_digest, receipt_request_digest) VALUES (?, ?, ?, 'gateway_dispatch', ?, ?) RETURNING receipt_id"
                                            ).bind(receiptId, input.probe_run_id, input.writer_role, input.source_request_digest, input.request_digest).all();
                                            if (!result.success || result.results.length !== 1) throw new Error("sink insert failed");
                                            return {
                                                schema_version: 1,
                                                operation: "record_probe_receipt_v1",
                                                request_digest: input.request_digest,
                                                status: "recorded",
                                                error_code: null,
                                                receipt_id: receiptId,
                                                sink_runtime_version_id: "sink_runtime_0001"
                                            };
                                        }
                                    }
                                    export default { fetch() { return new Response("Not found", { status: 404 }); } };
                                `,
                            },
                        ],
                    },
                ],
            },
            wrangler: { configPath: "./apps/d1-probe-writer/wrangler.a.local.jsonc" },
        }),
    ],
    test: {
        include: ["tests/d1-probe-writer-workers/**/*.test.ts"],
        passWithNoTests: false,
        restoreMocks: true,
    },
});
