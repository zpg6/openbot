import { describe, expect, it } from "vitest";

import { digestCanonicalJsonV1, type CanonicalJsonValueV1 } from "@openbot/gate-attestation/internal";

import { compileUntrustedD1ProbeCloudflareWorkerProtocolV1 as compileProtocol } from "./cloudflare-worker-protocol.js";
import { compileD1ProbeWorkerJsonVersionContractV1 } from "./worker-version-contract.js";

const commitmentKey = { hmac_key_base64url: "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE" };
const commitmentKeyIdDigest = "45a7064c002c4b269eb5932fd42622c7b2ed330deef98203ea1bd342d56d238c";
const accountId = "a".repeat(32);
const operationId = "b".repeat(32);
const workerId = "1".repeat(32);
const versionId = "22222222-2222-4222-8222-222222222222";
const otherVersionId = "33333333-3333-4333-8333-333333333333";
const deploymentId = "44444444-4444-4444-8444-444444444444";
const databaseId = "55555555-5555-4555-8555-555555555555";
const createdOn = "2026-08-24T15:16:17.000Z";
const topology = {
    sink: "openbot-d1-probe-0000000000000001",
    writer_a: "openbot-d1-probe-0000000000000002",
    writer_b: "openbot-d1-probe-0000000000000003",
} as const;
const moduleBytes = new TextEncoder().encode("export class D1ProbeSinkService {}; export default {};");
const moduleBase64 = btoa(String.fromCharCode(...moduleBytes));
const hmacIdentity = async (domain: string, value: string): Promise<string> => {
    const raw = Uint8Array.from(atob(commitmentKey.hmac_key_base64url), character => character.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(`${domain}\u0000${JSON.stringify(value)}`)
    );
    return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, "0")).join("");
};
const artifactManifestFor = async (role: "sink" | "writer_a" | "writer_b", bytes = moduleBytes) => {
    const scriptName = topology[role];
    const scriptNameCommitment = await hmacIdentity(
        `openbot.d1-probe.generated-resource-name.${role === "sink" ? "sink_script" : `${role}_script`}.v1`,
        scriptName
    );
    return compileD1ProbeWorkerJsonVersionContractV1({
        role,
        operation_id: operationId,
        generated_script_name_commitment: scriptNameCommitment,
        database_id: databaseId,
        sink_script_name: topology.sink,
        module_bytes: bytes,
    });
};
const reverseObjectKeyOrder = (value: unknown): CanonicalJsonValueV1 => {
    if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
        return value;
    }
    if (Array.isArray(value)) return value.map(reverseObjectKeyOrder);
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
            .reverse()
            .map(([key, child]) => [key, reverseObjectKeyOrder(child)])
    );
};
const markerPrefix = `openbot:d1-probe:v1:${operationId}:sink`;
const markers = {
    ownership: `${markerPrefix}:owner`,
    version: `${markerPrefix}:version`,
    versionMessage: `${markerPrefix}:first-private-version`,
    deployment: `${markerPrefix}:deployment`,
} as const;
const annotations = {
    "workers/message": markers.versionMessage,
    "workers/tag": markers.version,
    "workers/triggered_by": "openbot-d1-probe-operator",
} as const;
const bindings = [
    { name: "PROBE_DB", type: "d1", database_id: databaseId },
    { name: "VERSION_METADATA", type: "version_metadata" },
] as const;
const deployment = {
    id: deploymentId,
    strategy: "percentage",
    annotations: { "workers/message": markers.deployment },
    versions: [{ version_id: versionId, percentage: 100 }],
} as const;

const validInput = () => ({
    schema_version: 1,
    projection_contract: "reviewed_cloudflare_fields_only_v1",
    commitment_key_id_digest: commitmentKeyIdDigest,
    account_id: accountId,
    operation_id: operationId,
    operation_window: {
        dispatch_started_on: "2026-08-24T14:59:59.000Z",
        dispatch_finished_on: "2026-08-24T15:00:01.000Z",
        observation_started_on: "2026-08-24T15:00:01.000Z",
        observation_finished_on: "2026-08-24T15:01:01.000Z",
    },
    role: "sink",
    topology: { ...topology },
    database_id: databaseId,
    module_bytes: new Uint8Array(moduleBytes),
    beta_worker_readback: {
        id: workerId,
        name: topology.sink,
        created_on: "2026-08-24T15:00:00.000Z",
        tags: [markers.ownership],
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
        versions: [{ id: versionId, annotations: { ...annotations }, urls: [] }],
    },
    beta_version_readback: {
        id: versionId,
        created_on: createdOn,
        annotations: { ...annotations },
        urls: [],
        main_module: "entry.js",
        compatibility_date: "2026-08-22",
        compatibility_flags: [],
        bindings: bindings.map(binding => ({ ...binding })),
        modules: [
            {
                name: "entry.js",
                content_type: "application/javascript+module",
                content_base64: moduleBase64,
            },
        ],
    },
    classic_version_readback: {
        id: versionId,
        metadata: { hasPreview: false },
        resources: {
            bindings: bindings.map(binding => ({ ...binding })),
            script_runtime: { compatibility_date: "2026-08-22", compatibility_flags: [] },
        },
    },
    deployment_list: {
        complete: true,
        deployments: [
            { ...deployment, annotations: { ...deployment.annotations }, versions: [...deployment.versions] },
        ],
    },
    deployment_readback: {
        ...deployment,
        annotations: { ...deployment.annotations },
        versions: [...deployment.versions],
    },
    post_deployment_subdomain_readback: { enabled: false, previews_enabled: false },
    runtime_version_metadata: { id: versionId, tag: markers.version, timestamp: createdOn },
});

const mutate = (change: (input: any) => void): unknown => {
    const input = structuredClone(validInput()) as any;
    change(input);
    return input;
};

const compileUntrustedD1ProbeCloudflareWorkerProtocolV1 = (input: unknown) => compileProtocol(input, commitmentKey);

describe("Cloudflare Worker provisioning protocol", () => {
    it("compiles exact private-shell, version, deployment, runtime, and cleanup data without authority", async () => {
        const result = await compileUntrustedD1ProbeCloudflareWorkerProtocolV1(validInput());
        expect(result.success).toBe(true);
        if (!result.success) return;

        expect(result.protocol).toMatchObject({
            authoritative: false,
            mutation_allowed: false,
            eligible_for_upload: false,
            eligible_for_attestation: false,
            lifecycle_advance_allowed: false,
            gate: false,
            gate_promotion_allowed: false,
            observation_projection: "reviewed_cloudflare_fields_only_v1",
            commitment_key_id_digest: commitmentKeyIdDigest,
            identity_commitment_spec: {
                commitment_algorithm: "hmac-sha256-v1",
                commitment_key_id_digest: commitmentKeyIdDigest,
                role_in_preimage: false,
                domains: {
                    account_id: "openbot.identity.cloudflare_account_id.v1",
                    database_id: "openbot.identity.cloudflare_d1_database_id.v1",
                    worker_script_id: "openbot.identity.cloudflare_worker_script_id.v1",
                    worker_version_id: "openbot.identity.cloudflare_worker_version_id.v1",
                    worker_deployment_id: "openbot.identity.cloudflare_worker_deployment_id.v1",
                },
            },
            operation_window: {
                ...validInput().operation_window,
                dispatch_max_ms: 30_000,
                observation_max_ms: 120_000,
                total_max_ms: 150_000,
                shell_created_on: "2026-08-24T15:00:00.000Z",
                shell_created_within_window: true,
            },
        });
        expect(result.protocol.account_id_commitment).toMatch(/^[0-9a-f]{64}$/u);
        expect(result.protocol.database_id_commitment).toMatch(/^[0-9a-f]{64}$/u);
        expect(result.protocol.shell.readback.worker_id_commitment).toMatch(/^[0-9a-f]{64}$/u);
        expect(result.protocol.shell.create).toEqual({
            dispatch_allowed: false,
            method: "POST",
            path: "/accounts/{account_id}/workers/workers",
            body: {
                name: topology.sink,
                logpush: false,
                observability: { enabled: false },
                subdomain: { enabled: false, previews_enabled: false },
                tags: [markers.ownership],
                tail_consumers: [],
            },
        });
        expect(result.protocol.shell.readback).toMatchObject({
            exposure_disabled: true,
            preupload_version_count: 0,
            preupload_deployment_count: 0,
            deployed_on: null,
        });
        expect(result.protocol.version.create).toMatchObject({
            dispatch_allowed: false,
            method: "POST",
            path: "/accounts/{account_id}/workers/workers/{worker_id}/versions",
            query: { deploy: false },
            request_digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
        });
        const expectedVersionBody = {
            main_module: "entry.js",
            compatibility_date: "2026-08-22",
            compatibility_flags: [],
            annotations,
            bindings,
            modules: [
                {
                    name: "entry.js",
                    content_type: "application/javascript+module",
                    content_base64: moduleBase64,
                },
            ],
        };
        expect(result.protocol.version.create.request_digest).toBe(
            await digestCanonicalJsonV1("openbot.d1-probe.cloudflare-version-request.v1", {
                method: "POST",
                path: "/accounts/{account_id}/workers/workers/{worker_id}/versions",
                query: { deploy: false },
                body: expectedVersionBody,
            } as unknown as CanonicalJsonValueV1)
        );
        const artifactManifest = await artifactManifestFor("sink");
        expect(artifactManifest).not.toBeNull();
        expect(result.protocol.version.binding_configuration_digest).toBe(
            artifactManifest?.binding_configuration_digest
        );
        expect(result.protocol.version.artifact_digest).toBe(artifactManifest?.artifact_digest);
        expect(result.protocol.version.binding_configuration_digest).toMatch(/^[0-9a-f]{64}$/u);
        expect(result.protocol.version.artifact_digest).toMatch(/^[0-9a-f]{64}$/u);
        expect(result.protocol.version).toMatchObject({
            id_commitment: expect.stringMatching(/^[0-9a-f]{64}$/u),
            artifact_contract: "beta_worker_json_version_v1",
            marker_match_count: 1,
            urls: [],
            has_preview: false,
        });
        expect(result.protocol.deployment.create).toEqual({
            dispatch_allowed: false,
            method: "POST",
            path: "/accounts/{account_id}/workers/scripts/{script_name}/deployments",
            query: { force: false },
            request_digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
        });
        expect(result.protocol.deployment.id_commitment).toMatch(/^[0-9a-f]{64}$/u);
        expect(result.protocol.deployment.create.request_digest).toBe(
            await digestCanonicalJsonV1("openbot.d1-probe.cloudflare-deployment-request.v1", {
                method: "POST",
                path: "/accounts/{account_id}/workers/scripts/{script_name}/deployments",
                query: { force: false },
                body: {
                    strategy: "percentage",
                    annotations: { "workers/message": markers.deployment },
                    versions: [{ version_id: versionId, percentage: 100 }],
                },
            } as CanonicalJsonValueV1)
        );
        expect(result.protocol.runtime).toEqual({
            version_id_commitment: result.protocol.version.id_commitment,
            version_tag_commitment: result.protocol.version.version_tag_commitment,
            version_created_on: createdOn,
            matched: true,
        });
        expect(result.protocol.cleanup).toEqual({
            force: false,
            order: ["writer_a", "writer_b", "sink"],
            steps: [
                {
                    role: "writer_a",
                    method: "DELETE",
                    path: `/accounts/{account_id}/workers/scripts/${topology.writer_a}`,
                    query: {},
                },
                {
                    role: "writer_b",
                    method: "DELETE",
                    path: `/accounts/{account_id}/workers/scripts/${topology.writer_b}`,
                    query: {},
                },
                {
                    role: "sink",
                    method: "DELETE",
                    path: `/accounts/{account_id}/workers/scripts/${topology.sink}`,
                    query: {},
                },
            ],
        });
        expect(Object.isFrozen(result.protocol)).toBe(true);
        expect(JSON.stringify(result.protocol)).not.toContain("api_token");
        expect(JSON.stringify(result.protocol)).not.toContain("authorization");
        expect(JSON.stringify(result.protocol)).not.toContain("fetch");
        expect(JSON.stringify(result.protocol)).not.toContain(commitmentKey.hmac_key_base64url);
        expect(JSON.stringify(result.protocol)).not.toContain(accountId);
        expect(JSON.stringify(result.protocol)).not.toContain(databaseId);
        expect(JSON.stringify(result.protocol)).not.toContain(workerId);
        expect(JSON.stringify(result.protocol)).not.toContain(versionId);
        expect(JSON.stringify(result.protocol)).not.toContain(deploymentId);
    });

    it("derives the exact service binding for a Writer instead of accepting caller-defined bindings", async () => {
        const writerPrefix = `openbot:d1-probe:v1:${operationId}:writer_a`;
        const writerMarkers = {
            ownership: `${writerPrefix}:owner`,
            version: `${writerPrefix}:version`,
            versionMessage: `${writerPrefix}:first-private-version`,
            deployment: `${writerPrefix}:deployment`,
        };
        const writerBindings = [
            { name: "PROBE_DB", type: "d1", database_id: databaseId },
            {
                name: "PROBE_SINK",
                type: "service",
                service: topology.sink,
                entrypoint: "D1ProbeSinkService",
            },
            { name: "VERSION_METADATA", type: "version_metadata" },
        ];
        const input = mutate(value => {
            value.role = "writer_a";
            value.beta_worker_readback.name = topology.writer_a;
            value.beta_worker_readback.tags = [writerMarkers.ownership];
            value.beta_version_list.versions[0].annotations = {
                "workers/message": writerMarkers.versionMessage,
                "workers/tag": writerMarkers.version,
                "workers/triggered_by": "openbot-d1-probe-operator",
            };
            value.beta_version_readback.annotations = structuredClone(value.beta_version_list.versions[0].annotations);
            value.beta_version_readback.bindings = structuredClone(writerBindings);
            value.classic_version_readback.resources.bindings = structuredClone(writerBindings);
            value.deployment_list.deployments[0].annotations["workers/message"] = writerMarkers.deployment;
            value.deployment_readback.annotations["workers/message"] = writerMarkers.deployment;
            value.runtime_version_metadata.tag = writerMarkers.version;
        });
        const result = await compileUntrustedD1ProbeCloudflareWorkerProtocolV1(input);
        const sinkResult = await compileUntrustedD1ProbeCloudflareWorkerProtocolV1(validInput());
        expect(result.success).toBe(true);
        expect(sinkResult.success).toBe(true);
        if (!result.success || !sinkResult.success) return;
        expect(result.protocol.version.binding_configuration_digest).toMatch(/^[0-9a-f]{64}$/u);
        expect(result.protocol.version.artifact_digest).toMatch(/^[0-9a-f]{64}$/u);
        const writerArtifact = await artifactManifestFor("writer_a");
        expect(result.protocol.version.binding_configuration_digest).toBe(writerArtifact?.binding_configuration_digest);
        expect(result.protocol.version.artifact_digest).toBe(writerArtifact?.artifact_digest);
        expect(result.protocol.shell.readback.worker_id_commitment).toBe(
            sinkResult.protocol.shell.readback.worker_id_commitment
        );
    });

    it("uses the shared role-free HMAC identity domains and separates identity types", async () => {
        const result = await compileUntrustedD1ProbeCloudflareWorkerProtocolV1(validInput());
        expect(result.success).toBe(true);
        if (!result.success) return;
        expect(result.protocol.account_id_commitment).toBe(
            await hmacIdentity("openbot.identity.cloudflare_account_id.v1", accountId)
        );
        expect(result.protocol.database_id_commitment).toBe(
            await hmacIdentity("openbot.identity.cloudflare_d1_database_id.v1", databaseId)
        );
        expect(result.protocol.shell.readback.worker_id_commitment).toBe(
            await hmacIdentity("openbot.identity.cloudflare_worker_script_id.v1", workerId)
        );
        expect(result.protocol.version.id_commitment).toBe(
            await hmacIdentity("openbot.identity.cloudflare_worker_version_id.v1", versionId)
        );
        expect(result.protocol.deployment.id_commitment).toBe(
            await hmacIdentity("openbot.identity.cloudflare_worker_deployment_id.v1", deploymentId)
        );

        const sharedPreimage = mutate(input => {
            input.deployment_list.deployments[0].id = versionId;
            input.deployment_readback.id = versionId;
        });
        const separated = await compileUntrustedD1ProbeCloudflareWorkerProtocolV1(sharedPreimage);
        expect(separated.success).toBe(true);
        if (!separated.success) return;
        expect(separated.protocol.version.id_commitment).not.toBe(separated.protocol.deployment.id_commitment);
    });

    it("rejects an invalid commitment key", async () => {
        await expect(compileProtocol(validInput(), { hmac_key_base64url: "bad" })).resolves.toEqual({
            success: false,
            code: "invalid_commitment_key",
        });
        await expect(compileProtocol(validInput(), { ...commitmentKey, extra: true })).resolves.toEqual({
            success: false,
            code: "invalid_commitment_key",
        });
    });

    it("derives and binds the commitment key ID digest", async () => {
        const initial = await compileUntrustedD1ProbeCloudflareWorkerProtocolV1(validInput());
        const changed = await compileUntrustedD1ProbeCloudflareWorkerProtocolV1(
            mutate(input => (input.commitment_key_id_digest = "7".repeat(64)))
        );
        expect(initial.success).toBe(true);
        expect(changed).toEqual({ success: false, code: "commitment_key_id_mismatch" });
        if (!initial.success) return;
        expect(initial.protocol.commitment_key_id_digest).toBe(commitmentKeyIdDigest);
    });

    it.each([
        [
            "zero dispatch duration",
            (input: any) => (input.operation_window.dispatch_finished_on = input.operation_window.dispatch_started_on),
        ],
        [
            "inverted dispatch",
            (input: any) => (input.operation_window.dispatch_finished_on = "2026-08-24T14:59:58.999Z"),
        ],
        [
            "dispatch over 30 seconds",
            (input: any) => (input.operation_window.dispatch_finished_on = "2026-08-24T15:00:29.001Z"),
        ],
        [
            "observation overlaps dispatch",
            (input: any) => (input.operation_window.observation_started_on = "2026-08-24T15:00:00.999Z"),
        ],
        [
            "zero observation duration",
            (input: any) =>
                (input.operation_window.observation_finished_on = input.operation_window.observation_started_on),
        ],
        [
            "inverted observation",
            (input: any) => (input.operation_window.observation_finished_on = "2026-08-24T15:00:00.999Z"),
        ],
        [
            "observation over 120 seconds",
            (input: any) => (input.operation_window.observation_finished_on = "2026-08-24T15:02:01.001Z"),
        ],
        [
            "unbounded gap between dispatch and observation",
            (input: any) => {
                input.operation_window.observation_started_on = "2026-08-24T15:02:29.000Z";
                input.operation_window.observation_finished_on = "2026-08-24T15:02:29.001Z";
            },
        ],
        [
            "shell predates dispatch",
            (input: any) => (input.beta_worker_readback.created_on = "2026-08-24T14:59:58.999Z"),
        ],
        [
            "shell follows observation",
            (input: any) => (input.beta_worker_readback.created_on = "2026-08-24T15:01:01.001Z"),
        ],
    ])("rejects temporal attack: %s", async (_name, change) => {
        const result = await compileUntrustedD1ProbeCloudflareWorkerProtocolV1(mutate(change));
        expect(result).toEqual({ success: false, code: "invalid_operation_window" });
    });

    it("binds the exact operation window into the protocol and its digest", async () => {
        const initial = await compileUntrustedD1ProbeCloudflareWorkerProtocolV1(validInput());
        const changedInput = mutate(
            input => (input.operation_window.observation_finished_on = "2026-08-24T15:01:02.000Z")
        );
        const changed = await compileUntrustedD1ProbeCloudflareWorkerProtocolV1(changedInput);
        expect(initial.success).toBe(true);
        expect(changed.success).toBe(true);
        if (!initial.success || !changed.success) return;
        expect(changed.protocol.operation_window.observation_finished_on).toBe("2026-08-24T15:01:02.000Z");
        expect(changed.protocol.protocol_digest).not.toBe(initial.protocol.protocol_digest);
    });

    it("digests the complete canonical returned protocol body and ignores object key insertion order", async () => {
        const result = await compileUntrustedD1ProbeCloudflareWorkerProtocolV1(validInput());
        expect(result.success).toBe(true);
        if (!result.success) return;
        const { protocol_digest: protocolDigest, ...unsignedProtocol } = result.protocol;
        const recomputed = await digestCanonicalJsonV1(
            "openbot.d1-probe.cloudflare-worker-protocol.v1",
            unsignedProtocol as unknown as CanonicalJsonValueV1
        );
        const reordered = reverseObjectKeyOrder(unsignedProtocol);
        const reorderedDigest = await digestCanonicalJsonV1(
            "openbot.d1-probe.cloudflare-worker-protocol.v1",
            reordered
        );
        expect(recomputed).toBe(protocolDigest);
        expect(reorderedDigest).toBe(protocolDigest);
        expect(protocolDigest).toBe("04cc15cdb3089ff623764f4b36396e5c1fc1bc599208076941f9c03461e84e52");
    });

    it("binds peer topology used only by dependency-ordered cleanup", async () => {
        const initial = await compileUntrustedD1ProbeCloudflareWorkerProtocolV1(validInput());
        const changed = await compileUntrustedD1ProbeCloudflareWorkerProtocolV1(
            mutate(input => (input.topology.writer_b = "openbot-d1-probe-0000000000000004"))
        );
        expect(initial.success).toBe(true);
        expect(changed.success).toBe(true);
        if (!initial.success || !changed.success) return;
        expect(changed.protocol.shell).toEqual(initial.protocol.shell);
        expect(changed.protocol.version).toEqual(initial.protocol.version);
        expect(changed.protocol.deployment).toEqual(initial.protocol.deployment);
        expect(changed.protocol.cleanup.steps[1]?.path).not.toBe(initial.protocol.cleanup.steps[1]?.path);
        expect(changed.protocol.protocol_digest).not.toBe(initial.protocol.protocol_digest);
    });

    it.each([
        ["missing beta exposure flag", (input: any) => delete input.beta_worker_readback.subdomain.enabled],
        ["true beta exposure flag", (input: any) => (input.beta_worker_readback.subdomain.enabled = true)],
        ["missing classic preview flag", (input: any) => delete input.classic_subdomain_readback.previews_enabled],
        ["true classic preview flag", (input: any) => (input.classic_subdomain_readback.previews_enabled = true)],
        [
            "true post-deployment exposure flag",
            (input: any) => (input.post_deployment_subdomain_readback.enabled = true),
        ],
        [
            "missing post-deployment preview flag",
            (input: any) => delete input.post_deployment_subdomain_readback.previews_enabled,
        ],
        ["true logpush", (input: any) => (input.beta_worker_readback.logpush = true)],
        ["true observability", (input: any) => (input.beta_worker_readback.observability.enabled = true)],
        ["tail consumer", (input: any) => input.beta_worker_readback.tail_consumers.push({ name: "hostile" })],
        ["incomplete pre-upload versions", (input: any) => (input.preupload_beta_version_list.complete = false)],
        ["incomplete pre-upload deployments", (input: any) => (input.preupload_deployment_list.complete = false)],
        ["nonempty beta list URLs", (input: any) => input.beta_version_list.versions[0].urls.push("https://x")],
        ["nonempty beta readback URLs", (input: any) => input.beta_version_readback.urls.push("https://x")],
        ["missing hasPreview", (input: any) => delete input.classic_version_readback.metadata.hasPreview],
        ["true hasPreview", (input: any) => (input.classic_version_readback.metadata.hasPreview = true)],
        ["latest version selector", (input: any) => (input.beta_version_readback.id = "latest")],
        ["version UUID prefix", (input: any) => (input.beta_version_readback.id = versionId.slice(0, 8))],
        [
            "extra binding",
            (input: any) =>
                input.beta_version_readback.bindings.push({ type: "plain_text", name: "X", text: "hostile" }),
        ],
        ["extra input authority", (input: any) => (input.api_token = "secret")],
        ["extra input fetch", (input: any) => (input.fetch = () => undefined)],
        ["invalid commitment key ID digest", (input: any) => (input.commitment_key_id_digest = "short")],
        ["empty module", (input: any) => (input.module_bytes = new Uint8Array())],
    ])("rejects %s", async (_name, change) => {
        const result = await compileUntrustedD1ProbeCloudflareWorkerProtocolV1(mutate(change));
        expect(result).toEqual({ success: false, code: "invalid_input" });
    });

    it("rejects a shell that was not empty before upload", async () => {
        const versionPresent = await compileUntrustedD1ProbeCloudflareWorkerProtocolV1(
            mutate(input => {
                input.preupload_beta_version_list.versions = structuredClone(input.beta_version_list.versions);
                input.preupload_beta_version_list.total_count = 1;
            })
        );
        expect(versionPresent).toEqual({ success: false, code: "preupload_shell_not_empty" });

        const deploymentPresent = await compileUntrustedD1ProbeCloudflareWorkerProtocolV1(
            mutate(input => {
                input.preupload_deployment_list.deployments = structuredClone(input.deployment_list.deployments);
            })
        );
        expect(deploymentPresent).toEqual({ success: false, code: "preupload_shell_not_empty" });
    });

    it("rejects zero, duplicate, and additional version markers", async () => {
        const zero = await compileUntrustedD1ProbeCloudflareWorkerProtocolV1(
            mutate(input => (input.beta_version_list.versions[0].annotations["workers/tag"] = "wrong"))
        );
        expect(zero).toEqual({ success: false, code: "version_marker_not_unique" });

        const duplicate = await compileUntrustedD1ProbeCloudflareWorkerProtocolV1(
            mutate(input => {
                input.beta_version_list.versions.push(structuredClone(input.beta_version_list.versions[0]));
                input.beta_version_list.total_count = 2;
            })
        );
        expect(duplicate).toEqual({ success: false, code: "version_marker_not_unique" });

        const additional = await compileUntrustedD1ProbeCloudflareWorkerProtocolV1(
            mutate(input => {
                const extra = structuredClone(input.beta_version_list.versions[0]);
                extra.id = otherVersionId;
                extra.annotations["workers/tag"] = "unrelated";
                input.beta_version_list.versions.push(extra);
                input.beta_version_list.total_count = 2;
            })
        );
        expect(additional).toEqual({ success: false, code: "version_marker_not_unique" });
    });

    it("rejects identity, ownership, binding, version, module, and runtime mismatches", async () => {
        const cases: Array<[string, unknown, string]> = [
            [
                "identity",
                mutate(input => (input.beta_worker_readback.name = topology.writer_a)),
                "worker_identity_mismatch",
            ],
            ["ownership", mutate(input => (input.beta_worker_readback.tags = ["wrong"])), "worker_ownership_mismatch"],
            [
                "binding",
                mutate(input => (input.classic_version_readback.resources.bindings[0].database_id = otherVersionId)),
                "binding_mismatch",
            ],
            ["version", mutate(input => (input.classic_version_readback.id = otherVersionId)), "version_mismatch"],
            [
                "module",
                mutate(input => (input.beta_version_readback.modules[0].content_base64 = btoa("other"))),
                "module_mismatch",
            ],
            [
                "runtime id",
                mutate(input => (input.runtime_version_metadata.id = otherVersionId)),
                "runtime_version_metadata_mismatch",
            ],
            [
                "runtime tag",
                mutate(input => (input.runtime_version_metadata.tag = "wrong")),
                "runtime_version_metadata_mismatch",
            ],
            [
                "runtime timestamp",
                mutate(input => (input.runtime_version_metadata.timestamp = "2026-08-24T15:16:18.000Z")),
                "runtime_version_metadata_mismatch",
            ],
        ];
        for (const [name, input, code] of cases) {
            const result = await compileUntrustedD1ProbeCloudflareWorkerProtocolV1(input);
            expect(result, name).toEqual({ success: false, code });
        }
    });

    it("rejects every reviewed input substitution that could change the artifact digest chain", async () => {
        const cases: Array<[string, unknown, string]> = [
            ["role", mutate(input => (input.role = "writer_a")), "worker_identity_mismatch"],
            [
                "sink script",
                mutate(input => {
                    input.role = "writer_a";
                    input.beta_worker_readback.name = topology.writer_a;
                    const prefix = `openbot:d1-probe:v1:${operationId}:writer_a`;
                    input.beta_worker_readback.tags = [`${prefix}:owner`];
                    input.topology.sink = "openbot-d1-probe-0000000000000004";
                }),
                "binding_mismatch",
            ],
            [
                "database",
                mutate(input => (input.database_id = "66666666-6666-4666-8666-666666666666")),
                "binding_mismatch",
            ],
            ["module", mutate(input => (input.module_bytes[0] ^= 1)), "module_mismatch"],
            [
                "beta binding",
                mutate(input => (input.beta_version_readback.bindings[0].database_id = otherVersionId)),
                "binding_mismatch",
            ],
            [
                "classic binding",
                mutate(input => (input.classic_version_readback.resources.bindings[0].database_id = otherVersionId)),
                "binding_mismatch",
            ],
        ];
        for (const [name, input, code] of cases) {
            const result = await compileUntrustedD1ProbeCloudflareWorkerProtocolV1(input);
            expect(result, name).toEqual({ success: false, code });
        }
    });

    it("rejects zero, duplicate, additional, and mismatched deployments", async () => {
        const cases: Array<[unknown, string]> = [
            [mutate(input => (input.deployment_list.deployments = [])), "deployment_marker_not_unique"],
            [
                mutate(input =>
                    input.deployment_list.deployments.push(structuredClone(input.deployment_list.deployments[0]))
                ),
                "deployment_marker_not_unique",
            ],
            [
                mutate(input => {
                    const extra = structuredClone(input.deployment_list.deployments[0]);
                    extra.id = "66666666-6666-4666-8666-666666666666";
                    extra.annotations["workers/message"] = "unrelated";
                    input.deployment_list.deployments.push(extra);
                }),
                "deployment_marker_not_unique",
            ],
            [
                mutate(input => (input.deployment_readback.versions[0].version_id = otherVersionId)),
                "deployment_mismatch",
            ],
            [mutate(input => (input.deployment_readback.id = "latest")), "invalid_input"],
        ];
        for (const [input, code] of cases) {
            const result = await compileUntrustedD1ProbeCloudflareWorkerProtocolV1(input);
            expect(result).toEqual({ success: false, code });
        }
    });
});
