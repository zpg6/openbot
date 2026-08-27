import {
    D1_DISPOSABLE_PROBE_SCHEMA_MANIFEST_V1,
    D1_DISPOSABLE_PROBE_SCHEMA_STATEMENTS_V1,
} from "@openbot/d1-probe-rpc/schema";
import { beforeAll, describe, expect, it, vi } from "vitest";

import {
    initializeD1ProbeDatabaseV1,
    type InitializedD1ProbeDatabaseV1,
} from "../src/cloudflare-database-bootstrap.js";
import { createD1ProbeDatabaseV1 } from "../src/cloudflare-database.js";
import { compileUntrustedD1ProbeCloudflareWorkerProtocolV1 } from "../src/cloudflare-worker-protocol.js";
import { createD1ProbeLifecycleJournalV1 } from "../src/lifecycle.js";
import { compileD1ProbePreflightPlanV1 } from "../src/preflight.js";
import { readD1ProbeCloudflareRouteV1 } from "../src/cloudflare-route-reader.js";
import { verifyD1ProbePreflightV1 } from "../src/verified-preflight.js";
import { compileUntrustedD1ProbeWorkerArtifactCandidateV1 } from "../src/worker-artifact.js";

const key = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const apiToken = "w".repeat(32);
const databaseId = "33333333-3333-4333-8333-333333333333";
const operationId = "d".repeat(32);
const encoder = new TextEncoder();
const suffixes = {
    database: "0000000000000000",
    sink_script: "0000000000000001",
    writer_a_script: "0000000000000002",
    writer_b_script: "0000000000000003",
    access_application: "0000000000000004",
    access_policy: "0000000000000005",
    access_service_token: "0000000000000006",
    writer_a_route: "0000000000000007",
    writer_b_route: "0000000000000008",
    readback_route: "0000000000000009",
} as const;

const request = () => ({
    schema_version: 1 as const,
    kind: "d1_probe_preflight_request" as const,
    account_id: "a".repeat(32),
    zone_id: "b".repeat(32),
    probe_origin: "https://probe.example.test",
    database_jurisdiction: "us" as const,
    installation_digest: "1".repeat(64),
    environment_digest: "2".repeat(64),
    configuration_digest: "3".repeat(64),
    probe_definition_digest: "4".repeat(64),
    collector_build_digest: "5".repeat(64),
    commitment_key_id_digest: "45a7064c002c4b269eb5932fd42622c7b2ed330deef98203ea1bd342d56d238c",
    operator_database_deny_list: ["11111111-1111-1111-1111-111111111111"],
    resource_suffixes: { ...suffixes },
});

const jsonResponse = (value: unknown, status = 200): Response =>
    new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json; charset=utf-8" },
    });

const meta = (overrides: Partial<Record<string, unknown>> = {}) => ({
    changed_db: false,
    changes: 0,
    duration: 0.1,
    last_row_id: 0,
    rows_read: 0,
    rows_written: 0,
    served_by_primary: true,
    size_after: 4096,
    ...overrides,
});

const queryResult = (results: ReadonlyArray<unknown>, overrides: Partial<Record<string, unknown>> = {}) => ({
    meta: meta(overrides),
    results,
    success: true,
});

const queryEnvelope = (results: ReadonlyArray<unknown>) => ({
    errors: [],
    messages: [],
    result: results,
    success: true,
});
const schemaRows = [...D1_DISPOSABLE_PROBE_SCHEMA_MANIFEST_V1].sort(
    (left, right) => left.type.localeCompare(right.type) || left.name.localeCompare(right.name)
);

const successfulBootstrapFetch = () => {
    let call = 0;
    return vi.fn(async () => {
        call += 1;
        if (call === 1) {
            return jsonResponse(
                queryEnvelope(
                    [queryResult([])]
                        .concat(
                            D1_DISPOSABLE_PROBE_SCHEMA_STATEMENTS_V1.map(() =>
                                queryResult([], { changed_db: true, rows_written: 1 })
                            )
                        )
                        .concat(queryResult(schemaRows, { rows_read: schemaRows.length }))
                )
            );
        }
        if (call === 2) return jsonResponse(queryEnvelope([queryResult([{ foreign_keys: 1 }], { rows_read: 1 })]));
        if (call === 3) {
            return jsonResponse(
                {
                    errors: [{ code: 7500, message: "D1_ERROR: FOREIGN KEY constraint failed" }],
                    messages: [],
                    result: null,
                    success: false,
                },
                400
            );
        }
        if (call === 4) return jsonResponse(queryEnvelope([queryResult([{ row_count: 0 }], { rows_read: 1 })]));
        throw new Error("unexpected bootstrap request");
    }) as unknown as typeof globalThis.fetch;
};

const prepareInitializedDatabase = async (): Promise<InitializedD1ProbeDatabaseV1> => {
    const compiled = await compileD1ProbePreflightPlanV1(request(), { hmac_key_base64url: key });
    if (!compiled.success) throw new Error(compiled.code);
    const verified = await verifyD1ProbePreflightV1(request(), compiled.plan, { hmac_key_base64url: key });
    if (!verified.success) throw new Error(verified.code);
    const route = await readD1ProbeCloudflareRouteV1(
        verified.verified,
        { api_token: apiToken },
        {
            fetch: (async (input: string | URL | Request) =>
                String(input).includes("/dns_records?")
                    ? jsonResponse({
                          errors: [],
                          messages: [],
                          result: [
                              {
                                  id: "c".repeat(32),
                                  name: "probe.example.test",
                                  type: "A",
                                  proxiable: true,
                                  proxied: true,
                              },
                          ],
                          result_info: { count: 1, page: 1, per_page: 1000, total_count: 1, total_pages: 1 },
                          success: true,
                      })
                    : jsonResponse({
                          errors: [],
                          messages: [],
                          result: {
                              account: { id: request().account_id, name: "Probe account" },
                              id: request().zone_id,
                              name: "example.test",
                              paused: false,
                              status: "active",
                              type: "full",
                          },
                          success: true,
                      })) as typeof globalThis.fetch,
        }
    );
    if (!route.success) throw new Error(route.code);
    const journal = createD1ProbeLifecycleJournalV1(compiled.plan);
    if (!journal.success) throw new Error(journal.code);
    const created = await createD1ProbeDatabaseV1(
        route.observed,
        journal.journal,
        { hmac_key_base64url: key },
        apiToken,
        {
            fetch: (async () =>
                jsonResponse({
                    errors: [],
                    messages: [],
                    result: {
                        jurisdiction: "us",
                        name: `openbot-d1-probe-${suffixes.database}`,
                        read_replication: { mode: "auto" },
                        uuid: databaseId,
                    },
                    success: true,
                })) as typeof globalThis.fetch,
        }
    );
    if (!created.success) throw new Error(created.code);
    const initialized = await initializeD1ProbeDatabaseV1(
        created.created,
        created.journal,
        { hmac_key_base64url: key },
        apiToken,
        { fetch: successfulBootstrapFetch() }
    );
    if (!initialized.success) throw new Error(initialized.code);
    return initialized.initialized;
};

const sha = (character: string) => `sha256:${character.repeat(64)}`;
const modules = () => [
    { role: "sink" as const, bytes: encoder.encode("export class D1ProbeSinkService{};export default {}") },
    { role: "writer_a" as const, bytes: encoder.encode("export class D1ProbeWriterAService{};export default {}") },
    { role: "writer_b" as const, bytes: encoder.encode("export class D1ProbeWriterBService{};export default {}") },
];

const build = (workerModules = modules()) => ({
    schema_version: 1 as const,
    kind: "d1_probe_worker_build_observation" as const,
    node_version: "22.19.0" as const,
    pnpm_version: "11.22.0" as const,
    wrangler_version: "4.125.0" as const,
    compatibility_date: "2026-08-22" as const,
    compatibility_flags: [] as [],
    workers_dev: false as const,
    preview_urls: false as const,
    observability: false as const,
    route_count: 0 as const,
    asset_count: 0 as const,
    additional_module_count: 0 as const,
    variable_binding_count: 0 as const,
    secret_binding_count: 0 as const,
    tail_consumer_count: 0 as const,
    worker_build_recipe_digest: sha("0"),
    dependency_digests: {
        pnpm_lock_sha256: sha("1"),
        root_package_json_sha256: sha("2"),
        pnpm_workspace_sha256: sha("3"),
        worker_build_script_sha256: sha("4"),
        sink_package_json_sha256: sha("5"),
        writer_package_json_sha256: sha("6"),
        rpc_package_json_sha256: sha("7"),
    },
    workers: [
        {
            role: "sink" as const,
            source_entrypoint: "apps/d1-probe-sink/src/entry.ts" as const,
            main_module: "entry.js" as const,
            selected_entrypoint: "D1ProbeSinkService" as const,
            public_fetch_contract: "access_readback_v1" as const,
            runtime_version_metadata_response_contract: "required_not_observed" as const,
            exports: ["D1ProbeSinkService", "default"],
            external_imports: ["cloudflare:workers"] as ["cloudflare:workers"],
            output_byte_length: workerModules[0]!.bytes.byteLength,
            module_format: "esm" as const,
            additional_module_count: 0 as const,
            asset_count: 0 as const,
            source_map_emitted: false as const,
            source_map_comment: false as const,
        },
        {
            role: "writer_a" as const,
            source_entrypoint: "apps/d1-probe-writer/src/entry.a.ts" as const,
            main_module: "entry.js" as const,
            selected_entrypoint: "D1ProbeWriterAService" as const,
            public_fetch_contract: "access_writer_a_trigger_v1" as const,
            runtime_version_metadata_response_contract: "required_not_observed" as const,
            exports: ["D1ProbeWriterAService", "default"],
            external_imports: ["cloudflare:workers"] as ["cloudflare:workers"],
            output_byte_length: workerModules[1]!.bytes.byteLength,
            module_format: "esm" as const,
            additional_module_count: 0 as const,
            asset_count: 0 as const,
            source_map_emitted: false as const,
            source_map_comment: false as const,
        },
        {
            role: "writer_b" as const,
            source_entrypoint: "apps/d1-probe-writer/src/entry.b.ts" as const,
            main_module: "entry.js" as const,
            selected_entrypoint: "D1ProbeWriterBService" as const,
            public_fetch_contract: "access_writer_b_trigger_v1" as const,
            runtime_version_metadata_response_contract: "required_not_observed" as const,
            exports: ["D1ProbeWriterBService", "default"],
            external_imports: ["cloudflare:workers"] as ["cloudflare:workers"],
            output_byte_length: workerModules[2]!.bytes.byteLength,
            module_format: "esm" as const,
            additional_module_count: 0 as const,
            asset_count: 0 as const,
            source_map_emitted: false as const,
            source_map_comment: false as const,
        },
    ],
});

const protocolInput = (role: "sink" | "writer_a" | "writer_b", moduleBytes: Uint8Array): Record<string, unknown> => {
    const scriptName = `openbot-d1-probe-${suffixes[`${role}_script`]}`;
    const topology = {
        sink: `openbot-d1-probe-${suffixes.sink_script}`,
        writer_a: `openbot-d1-probe-${suffixes.writer_a_script}`,
        writer_b: `openbot-d1-probe-${suffixes.writer_b_script}`,
    };
    const markerPrefix = `openbot:d1-probe:v1:${operationId}:${role}`;
    const versionId = "22222222-2222-4222-8222-222222222222";
    const deploymentId = "44444444-4444-4444-8444-444444444444";
    const createdOn = "2026-08-24T15:16:17.000Z";
    const annotations = {
        "workers/message": `${markerPrefix}:first-private-version`,
        "workers/tag": `${markerPrefix}:version`,
        "workers/triggered_by": "openbot-d1-probe-operator",
    };
    const bindings = [
        { name: "PROBE_DB", type: "d1", database_id: databaseId },
        ...(role === "sink"
            ? []
            : [
                  {
                      name: "PROBE_SINK",
                      type: "service",
                      service: topology.sink,
                      entrypoint: "D1ProbeSinkService",
                  },
              ]),
        { name: "VERSION_METADATA", type: "version_metadata" },
    ];
    const deployment = {
        id: deploymentId,
        strategy: "percentage",
        annotations: { "workers/message": `${markerPrefix}:deployment` },
        versions: [{ version_id: versionId, percentage: 100 }],
    };
    return {
        schema_version: 1,
        projection_contract: "reviewed_cloudflare_fields_only_v1",
        commitment_key_id_digest: request().commitment_key_id_digest,
        account_id: request().account_id,
        operation_id: operationId,
        operation_window: {
            dispatch_started_on: "2026-08-24T14:59:59.000Z",
            dispatch_finished_on: "2026-08-24T15:00:01.000Z",
            observation_started_on: "2026-08-24T15:00:01.000Z",
            observation_finished_on: "2026-08-24T15:01:01.000Z",
        },
        role,
        topology,
        database_id: databaseId,
        module_bytes: moduleBytes,
        beta_worker_readback: {
            id: "1".repeat(32),
            name: scriptName,
            created_on: "2026-08-24T15:00:00.000Z",
            tags: [`${markerPrefix}:owner`],
            logpush: false,
            observability: { enabled: false },
            subdomain: { enabled: false, previews_enabled: false },
            tail_consumers: [],
            deployed_on: null,
        },
        classic_subdomain_readback: { enabled: false, previews_enabled: false },
        preupload_beta_version_list: { complete: true, total_count: 0, versions: [] },
        preupload_deployment_list: { complete: true, deployments: [] },
        beta_version_list: {
            complete: true,
            total_count: 1,
            versions: [{ id: versionId, annotations, urls: [] }],
        },
        beta_version_readback: {
            id: versionId,
            created_on: createdOn,
            annotations,
            urls: [],
            main_module: "entry.js",
            compatibility_date: "2026-08-22",
            compatibility_flags: [],
            bindings,
            modules: [
                {
                    name: "entry.js",
                    content_type: "application/javascript+module",
                    content_base64: btoa(String.fromCharCode(...moduleBytes)),
                },
            ],
        },
        classic_version_readback: {
            id: versionId,
            metadata: { hasPreview: false },
            resources: {
                bindings,
                script_runtime: { compatibility_date: "2026-08-22", compatibility_flags: [] },
            },
        },
        deployment_list: { complete: true, deployments: [deployment] },
        deployment_readback: deployment,
        post_deployment_subdomain_readback: { enabled: false, previews_enabled: false },
        runtime_version_metadata: { id: versionId, tag: `${markerPrefix}:version`, timestamp: createdOn },
    };
};

describe("untrusted D1 probe Worker artifact candidate", () => {
    let initialized: InitializedD1ProbeDatabaseV1;

    beforeAll(async () => {
        initialized = await prepareInitializedDatabase();
    });

    it("binds the exact direct-API metadata, ordered parts, roles, and run database without upload authority", async () => {
        const workerModules = modules();
        const result = await compileUntrustedD1ProbeWorkerArtifactCandidateV1(initialized, {
            operation_id: operationId,
            build: build(workerModules),
            modules: workerModules,
        });
        expect(result.success).toBe(true);
        if (!result.success) return;

        expect(result.candidate).toMatchObject({
            authoritative: false,
            deployment_ready: false,
            eligible_for_upload: false,
            upload_performed: false,
            deploy_performed: false,
            lifecycle_advanced: false,
            upload_metadata_credentials_present: false,
            routes_present: false,
        });
        expect(result.candidate.artifacts.map(artifact => artifact.role)).toEqual(["sink", "writer_a", "writer_b"]);
        expect(
            result.candidate.artifacts.every(artifact => artifact.artifact_contract === "beta_worker_json_version_v1")
        ).toBe(true);
        expect(result.candidate.artifacts.map(artifact => artifact.selected_entrypoint)).toEqual([
            "D1ProbeSinkService",
            "D1ProbeWriterAService",
            "D1ProbeWriterBService",
        ]);
        for (const artifact of result.candidate.artifacts) {
            expect(artifact.eligible_for_upload).toBe(false);
            expect(artifact.deployment_ready).toBe(false);
        }
        expect(result.candidate.artifacts[1].binding_configuration_digest).not.toBe(
            result.candidate.artifacts[2].binding_configuration_digest
        );
    });

    it("gives the artifact candidate and reviewed Cloudflare protocol one digest chain for every role", async () => {
        const workerModules = modules();
        const candidate = await compileUntrustedD1ProbeWorkerArtifactCandidateV1(initialized, {
            operation_id: operationId,
            build: build(workerModules),
            modules: workerModules,
        });
        expect(candidate.success).toBe(true);
        if (!candidate.success) return;

        for (const [index, role] of (["sink", "writer_a", "writer_b"] as const).entries()) {
            const protocol = await compileUntrustedD1ProbeCloudflareWorkerProtocolV1(
                protocolInput(role, workerModules[index]!.bytes),
                { hmac_key_base64url: key }
            );
            expect(protocol.success, role).toBe(true);
            if (!protocol.success) continue;
            const artifact = candidate.candidate.artifacts[index]!;
            expect(protocol.protocol.version.artifact_digest, role).toBe(artifact.artifact_digest);
            expect(protocol.protocol.version.binding_configuration_digest, role).toBe(
                artifact.binding_configuration_digest
            );
            expect(protocol.protocol.version.module_sha256, role).toBe(artifact.module_sha256);
            expect(protocol.protocol.version.create.request_digest, role).toBe(artifact.version_request_digest);
        }
    });

    it("is deterministic and binds one-byte module and dependency changes", async () => {
        const firstModules = modules();
        const first = await compileUntrustedD1ProbeWorkerArtifactCandidateV1(initialized, {
            operation_id: operationId,
            build: build(firstModules),
            modules: firstModules,
        });
        const repeatedModules = modules();
        const repeated = await compileUntrustedD1ProbeWorkerArtifactCandidateV1(initialized, {
            operation_id: operationId,
            build: build(repeatedModules),
            modules: repeatedModules,
        });
        expect(first).toEqual(repeated);
        if (!first.success) throw new Error(first.code);

        const mutatedModules = modules();
        mutatedModules[1]!.bytes[0] = (mutatedModules[1]!.bytes[0] ?? 0) ^ 1;
        const mutatedModule = await compileUntrustedD1ProbeWorkerArtifactCandidateV1(initialized, {
            operation_id: operationId,
            build: build(mutatedModules),
            modules: mutatedModules,
        });
        expect(mutatedModule.success).toBe(true);
        if (!mutatedModule.success) return;
        expect(mutatedModule.candidate.artifacts[1].module_sha256).not.toBe(first.candidate.artifacts[1].module_sha256);
        expect(mutatedModule.candidate.candidate_digest).not.toBe(first.candidate.candidate_digest);

        const dependencyModules = modules();
        const dependencyBuild = build(dependencyModules);
        dependencyBuild.dependency_digests.pnpm_lock_sha256 = sha("8");
        const mutatedDependency = await compileUntrustedD1ProbeWorkerArtifactCandidateV1(initialized, {
            operation_id: operationId,
            build: dependencyBuild,
            modules: dependencyModules,
        });
        expect(mutatedDependency.success).toBe(true);
        if (!mutatedDependency.success) return;
        expect(mutatedDependency.candidate.dependency_digest).not.toBe(first.candidate.dependency_digest);
        expect(mutatedDependency.candidate.candidate_digest).not.toBe(first.candidate.candidate_digest);
    });

    it("copies inputs and emits no raw database ID, module bytes, route, credential, or authority", async () => {
        const workerModules = modules();
        const input = { operation_id: operationId, build: build(workerModules), modules: workerModules };
        const result = await compileUntrustedD1ProbeWorkerArtifactCandidateV1(initialized, input);
        expect(result.success).toBe(true);
        if (!result.success) return;
        const bytesBefore = JSON.stringify(result.candidate);
        workerModules[0]!.bytes.fill(120);
        input.build.workers[0]!.exports[0] = "HostileExport";
        expect(JSON.stringify(result.candidate)).toBe(bytesBefore);
        expect(Object.isFrozen(result.candidate)).toBe(true);
        expect(Object.isFrozen(result.candidate.artifacts[0])).toBe(true);
        expect(bytesBefore).not.toContain(databaseId);
        expect(bytesBefore).not.toContain("D1ProbeWriterAService{};export");
        expect(bytesBefore).not.toContain(apiToken);
        expect(bytesBefore).not.toContain(key);
        expect(bytesBefore).not.toContain("https://");
    });

    it("rejects current local bundles with source maps, shared Writer exports, or missing role-pinned ingress", async () => {
        const workerModules = modules();
        const sourceMapped = build(workerModules);
        sourceMapped.workers[1]!.source_map_emitted = true as false;
        await expect(
            compileUntrustedD1ProbeWorkerArtifactCandidateV1(initialized, {
                operation_id: operationId,
                build: sourceMapped,
                modules: workerModules,
            })
        ).resolves.toEqual({ success: false, code: "invalid_worker_build_observation" });

        const sharedExports = build(workerModules);
        sharedExports.workers[1]!.exports = ["D1ProbeWriterAService", "D1ProbeWriterBService", "default"];
        await expect(
            compileUntrustedD1ProbeWorkerArtifactCandidateV1(initialized, {
                operation_id: operationId,
                build: sharedExports,
                modules: workerModules,
            })
        ).resolves.toEqual({ success: false, code: "worker_build_binding_mismatch" });

        const localIngress = build(workerModules);
        localIngress.workers[1]!.public_fetch_contract = "access_writer_b_trigger_v1";
        await expect(
            compileUntrustedD1ProbeWorkerArtifactCandidateV1(initialized, {
                operation_id: operationId,
                build: localIngress,
                modules: workerModules,
            })
        ).resolves.toEqual({ success: false, code: "worker_build_binding_mismatch" });

        const commentModules = modules();
        commentModules[2]!.bytes = encoder.encode("export default {};\n//# sourceMappingURL=entry.js.map");
        await expect(
            compileUntrustedD1ProbeWorkerArtifactCandidateV1(initialized, {
                operation_id: operationId,
                build: build(commentModules),
                modules: commentModules,
            })
        ).resolves.toEqual({ success: false, code: "worker_module_invalid" });

        for (const path of [
            "/private/tmp/project/x.ts",
            "/tmp/project/x.ts",
            "/root/project/x.ts",
            "/workspace/x.ts",
            "/github/workspace/x.ts",
            "C:/workspace/x.ts",
        ]) {
            const pathModules = modules();
            pathModules[0]!.bytes = encoder.encode(`export default ${JSON.stringify(path)}`);
            await expect(
                compileUntrustedD1ProbeWorkerArtifactCandidateV1(initialized, {
                    operation_id: operationId,
                    build: build(pathModules),
                    modules: pathModules,
                })
            ).resolves.toEqual({ success: false, code: "worker_module_invalid" });
        }
    });

    it("rejects hostile topology, toolchain, authority, routing, logging, and byte inputs", async () => {
        const cases: unknown[] = [];
        for (const key of [
            "routes",
            "vars",
            "secrets",
            "tails",
            "logging",
            "credentials",
            "deploy",
            "gate_authority",
        ]) {
            const workerModules = modules();
            cases.push({
                operation_id: operationId,
                build: { ...build(workerModules), [key]: true },
                modules: workerModules,
            });
        }
        const enabled = build(modules());
        cases.push({ operation_id: operationId, build: { ...enabled, workers_dev: true }, modules: modules() });
        cases.push({
            operation_id: operationId,
            build: { ...enabled, compatibility_flags: ["nodejs_compat"] },
            modules: modules(),
        });
        cases.push({
            operation_id: operationId,
            build: { ...enabled, wrangler_version: "4.126.0" },
            modules: modules(),
        });
        for (const hostile of cases) {
            const result = await compileUntrustedD1ProbeWorkerArtifactCandidateV1(initialized, hostile);
            expect(result).toEqual({ success: false, code: "invalid_worker_build_observation" });
        }

        const reordered = modules().reverse();
        await expect(
            compileUntrustedD1ProbeWorkerArtifactCandidateV1(initialized, {
                operation_id: operationId,
                build: build(reordered),
                modules: reordered,
            })
        ).resolves.toEqual({ success: false, code: "invalid_worker_modules" });

        const empty = modules();
        empty[0]!.bytes = new Uint8Array();
        await expect(
            compileUntrustedD1ProbeWorkerArtifactCandidateV1(initialized, {
                operation_id: operationId,
                build: build(empty),
                modules: empty,
            })
        ).resolves.toEqual({ success: false, code: "invalid_worker_build_observation" });

        const invalidUtf8 = modules();
        invalidUtf8[0]!.bytes = Uint8Array.of(0xff);
        await expect(
            compileUntrustedD1ProbeWorkerArtifactCandidateV1(initialized, {
                operation_id: operationId,
                build: build(invalidUtf8),
                modules: invalidUtf8,
            })
        ).resolves.toEqual({ success: false, code: "worker_module_invalid" });
    });

    it("fails closed for a forged initialized database and accessor-bearing input", async () => {
        await expect(
            compileUntrustedD1ProbeWorkerArtifactCandidateV1(
                { schema_version: 1, kind: "initialized_d1_probe_database" } as InitializedD1ProbeDatabaseV1,
                { operation_id: operationId, build: build(), modules: modules() }
            )
        ).resolves.toEqual({ success: false, code: "invalid_initialized_database" });

        const hostile = Object.defineProperty({}, "build", {
            enumerable: true,
            get: () => {
                throw new Error("hostile getter");
            },
        });
        await expect(compileUntrustedD1ProbeWorkerArtifactCandidateV1(initialized, hostile)).resolves.toEqual({
            success: false,
            code: "invalid_worker_build_observation",
        });
    });
});
