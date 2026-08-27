import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

process.env["WRANGLER_LOG_PATH"] ??= path.resolve(".wrangler/logs/vitest-d1-probe-writer.log");

const writerBBundleDirectory = path.resolve(".build", "vitest-d1-probe-writer-b");
mkdirSync(writerBBundleDirectory, { recursive: true });
const writerBBuild = spawnSync(
    process.execPath,
    [
        fileURLToPath(import.meta.resolve("wrangler")),
        "deploy",
        "--config",
        "apps/d1-probe-writer/wrangler.b.local.jsonc",
        "--dry-run",
        "--outdir",
        writerBBundleDirectory,
    ],
    {
        env: { ...process.env, WRANGLER_SEND_METRICS: "false" },
        encoding: "utf8",
    }
);
if (writerBBuild.status !== 0) {
    throw new Error(`Writer B local bundle failed: ${writerBBuild.stderr.slice(0, 2_048)}`);
}
const writerBBundle = readFileSync(path.join(writerBBundleDirectory, "entry.b.js"), "utf8");
const writerBHasWriterAExport = /\bD1ProbeWriterAService\b/u.test(writerBBundle);

export default defineConfig({
    plugins: [
        cloudflareTest({
            miniflare: {
                serviceBindings: {
                    WRITER_B: {
                        name: "openbot-d1-probe-writer-b-local-only",
                        entrypoint: "D1ProbeWriterBService",
                    },
                    WRITER_B_FETCH: "openbot-d1-probe-writer-b-local-only",
                },
                bindings: { WRITER_B_HAS_WRITER_A_EXPORT: writerBHasWriterAExport },
                workers: [
                    {
                        name: "openbot-d1-probe-sink-local-only",
                        compatibilityDate: "2026-08-22",
                        d1Databases: { PROBE_DB: "00000000-0000-0000-0000-000000000000" },
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
                    {
                        name: "openbot-d1-probe-writer-b-local-only",
                        compatibilityDate: "2026-08-22",
                        d1Databases: { PROBE_DB: "00000000-0000-0000-0000-000000000000" },
                        versionMetadata: "VERSION_METADATA",
                        serviceBindings: {
                            PROBE_SINK: {
                                name: "openbot-d1-probe-sink-local-only",
                                entrypoint: "D1ProbeSinkService",
                            },
                        },
                        modules: [
                            {
                                type: "ESModule",
                                path: "entry.b.js",
                                contents: writerBBundle,
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
