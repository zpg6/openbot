import { z } from "zod";

import {
    canonicalizeJsonV1,
    digestCanonicalJsonV1,
    type CanonicalJsonValueV1,
} from "@openbot/gate-attestation/internal";

import { D1_PROBE_COMPATIBILITY_DATE_V1, D1ProbeCommitmentKeyV1Schema } from "./contracts.js";
import { D1_PROBE_WORKER_MAIN_MODULE_V1, D1_PROBE_WORKER_MODULE_LIMIT_BYTES_V1 } from "./worker-artifact.js";

const AccountIdV1Schema = z.string().regex(/^[0-9a-f]{32}$/u);
const OperationIdV1Schema = z.string().regex(/^[0-9a-f]{32}$/u);
const WorkerIdV1Schema = z.string().regex(/^[0-9a-f]{32}$/u);
const VersionIdV1Schema = z
    .string()
    .uuid()
    .refine(value => value === value.toLowerCase());
const DeploymentIdV1Schema = z
    .string()
    .uuid()
    .refine(value => value === value.toLowerCase());
const DatabaseIdV1Schema = z
    .string()
    .uuid()
    .refine(value => value === value.toLowerCase());
const ScriptNameV1Schema = z.string().regex(/^openbot-d1-probe-[a-z0-9]{16}$/u);
const TimestampV1Schema = z.string().datetime({ offset: true });
const DigestV1Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const WorkerRoleV1Schema = z.enum(["sink", "writer_a", "writer_b"]);
const AnnotationValueV1Schema = z.string().min(1).max(100);

const WorkerSubdomainV1Schema = z
    .object({
        enabled: z.literal(false),
        previews_enabled: z.literal(false),
    })
    .strict();

const AnnotationV1Schema = z
    .object({
        "workers/message": AnnotationValueV1Schema,
        "workers/tag": AnnotationValueV1Schema,
        "workers/triggered_by": z.literal("openbot-d1-probe-operator"),
    })
    .strict();

const D1BindingV1Schema = z
    .object({
        name: z.literal("PROBE_DB"),
        type: z.literal("d1"),
        database_id: DatabaseIdV1Schema,
    })
    .strict();
const ServiceBindingV1Schema = z
    .object({
        name: z.literal("PROBE_SINK"),
        type: z.literal("service"),
        service: ScriptNameV1Schema,
        entrypoint: z.literal("D1ProbeSinkService"),
    })
    .strict();
const VersionMetadataBindingV1Schema = z
    .object({
        name: z.literal("VERSION_METADATA"),
        type: z.literal("version_metadata"),
    })
    .strict();
const BindingV1Schema = z.union([D1BindingV1Schema, ServiceBindingV1Schema, VersionMetadataBindingV1Schema]);

const ModuleReadbackV1Schema = z
    .object({
        name: z.literal(D1_PROBE_WORKER_MAIN_MODULE_V1),
        content_type: z.literal("application/javascript+module"),
        content_base64: z
            .string()
            .min(4)
            .max(Math.ceil((D1_PROBE_WORKER_MODULE_LIMIT_BYTES_V1 * 4) / 3) + 4),
    })
    .strict();

const BetaVersionListItemV1Schema = z
    .object({
        id: VersionIdV1Schema,
        annotations: AnnotationV1Schema,
        urls: z.tuple([]),
    })
    .strict();

const BetaVersionReadbackV1Schema = z
    .object({
        id: VersionIdV1Schema,
        created_on: TimestampV1Schema,
        annotations: AnnotationV1Schema,
        urls: z.tuple([]),
        main_module: z.literal(D1_PROBE_WORKER_MAIN_MODULE_V1),
        compatibility_date: z.literal(D1_PROBE_COMPATIBILITY_DATE_V1),
        compatibility_flags: z.tuple([]),
        bindings: z.array(BindingV1Schema).min(2).max(3),
        modules: z.tuple([ModuleReadbackV1Schema]),
    })
    .strict();

const ClassicVersionReadbackV1Schema = z
    .object({
        id: VersionIdV1Schema,
        metadata: z.object({ hasPreview: z.literal(false) }).strict(),
        resources: z
            .object({
                bindings: z.array(BindingV1Schema).min(2).max(3),
                script_runtime: z
                    .object({
                        compatibility_date: z.literal(D1_PROBE_COMPATIBILITY_DATE_V1),
                        compatibility_flags: z.tuple([]),
                    })
                    .strict(),
            })
            .strict(),
    })
    .strict();

const DeploymentAnnotationsV1Schema = z
    .object({
        "workers/message": z.string().min(1).max(1_000),
    })
    .strict();
const DeploymentVersionV1Schema = z
    .object({
        version_id: VersionIdV1Schema,
        percentage: z.literal(100),
    })
    .strict();
const DeploymentReadbackV1Schema = z
    .object({
        id: DeploymentIdV1Schema,
        strategy: z.literal("percentage"),
        annotations: DeploymentAnnotationsV1Schema,
        versions: z.tuple([DeploymentVersionV1Schema]),
    })
    .strict();

const CompleteVersionListProjectionV1Schema = z
    .object({
        complete: z.literal(true),
        total_count: z.number().int().min(0).max(100),
        versions: z.array(BetaVersionListItemV1Schema).max(100),
    })
    .strict()
    .refine(value => value.total_count === value.versions.length);

const CompleteDeploymentListProjectionV1Schema = z
    .object({
        complete: z.literal(true),
        deployments: z.array(DeploymentReadbackV1Schema).max(100),
    })
    .strict();

const InputV1Schema = z
    .object({
        schema_version: z.literal(1),
        projection_contract: z.literal("reviewed_cloudflare_fields_only_v1"),
        commitment_key_id_digest: DigestV1Schema,
        account_id: AccountIdV1Schema,
        operation_id: OperationIdV1Schema,
        operation_window: z
            .object({
                dispatch_started_on: TimestampV1Schema,
                dispatch_finished_on: TimestampV1Schema,
                observation_started_on: TimestampV1Schema,
                observation_finished_on: TimestampV1Schema,
            })
            .strict(),
        role: WorkerRoleV1Schema,
        topology: z
            .object({
                sink: ScriptNameV1Schema,
                writer_a: ScriptNameV1Schema,
                writer_b: ScriptNameV1Schema,
            })
            .strict()
            .refine(value => new Set(Object.values(value)).size === 3),
        database_id: DatabaseIdV1Schema,
        module_bytes: z
            .instanceof(Uint8Array)
            .refine(value => value.byteLength > 0 && value.byteLength <= D1_PROBE_WORKER_MODULE_LIMIT_BYTES_V1),
        beta_worker_readback: z
            .object({
                id: WorkerIdV1Schema,
                name: ScriptNameV1Schema,
                created_on: TimestampV1Schema,
                tags: z.array(z.string().min(1).max(100)).min(1).max(16),
                logpush: z.literal(false),
                observability: z.object({ enabled: z.literal(false) }).strict(),
                subdomain: WorkerSubdomainV1Schema,
                tail_consumers: z.tuple([]),
                deployed_on: z.null(),
            })
            .strict(),
        classic_subdomain_readback: WorkerSubdomainV1Schema,
        preupload_beta_version_list: CompleteVersionListProjectionV1Schema,
        preupload_deployment_list: CompleteDeploymentListProjectionV1Schema,
        beta_version_list: CompleteVersionListProjectionV1Schema,
        beta_version_readback: BetaVersionReadbackV1Schema,
        classic_version_readback: ClassicVersionReadbackV1Schema,
        deployment_list: CompleteDeploymentListProjectionV1Schema,
        deployment_readback: DeploymentReadbackV1Schema,
        post_deployment_subdomain_readback: WorkerSubdomainV1Schema,
        runtime_version_metadata: z
            .object({
                id: VersionIdV1Schema,
                tag: AnnotationValueV1Schema,
                timestamp: TimestampV1Schema,
            })
            .strict(),
    })
    .strict();

type BindingV1 = z.infer<typeof BindingV1Schema>;
type InputV1 = z.infer<typeof InputV1Schema>;

export type D1ProbeCloudflareWorkerProtocolDenialV1 =
    | "invalid_input"
    | "invalid_commitment_key"
    | "invalid_operation_window"
    | "worker_identity_mismatch"
    | "worker_ownership_mismatch"
    | "preupload_shell_not_empty"
    | "binding_mismatch"
    | "version_marker_not_unique"
    | "version_mismatch"
    | "module_mismatch"
    | "deployment_marker_not_unique"
    | "deployment_mismatch"
    | "runtime_version_metadata_mismatch"
    | "commitment_unavailable"
    | "digest_unavailable";

const identityCommitmentDomains = Object.freeze({
    account_id: "openbot.identity.cloudflare_account_id.v1" as const,
    database_id: "openbot.identity.cloudflare_d1_database_id.v1" as const,
    worker_script_id: "openbot.identity.cloudflare_worker_script_id.v1" as const,
    worker_version_id: "openbot.identity.cloudflare_worker_version_id.v1" as const,
    worker_deployment_id: "openbot.identity.cloudflare_worker_deployment_id.v1" as const,
});

const D1_PROBE_WORKER_DISPATCH_WINDOW_MAX_MS_V1 = 30_000;
const D1_PROBE_WORKER_OBSERVATION_WINDOW_MAX_MS_V1 = 120_000;
const D1_PROBE_WORKER_OPERATION_WINDOW_MAX_MS_V1 =
    D1_PROBE_WORKER_DISPATCH_WINDOW_MAX_MS_V1 + D1_PROBE_WORKER_OBSERVATION_WINDOW_MAX_MS_V1;

export interface UntrustedD1ProbeCloudflareWorkerProtocolV1 {
    readonly schema_version: 1;
    readonly kind: "untrusted_d1_probe_cloudflare_worker_protocol";
    readonly authoritative: false;
    readonly mutation_allowed: false;
    readonly eligible_for_upload: false;
    readonly eligible_for_attestation: false;
    readonly lifecycle_advance_allowed: false;
    readonly gate: false;
    readonly gate_promotion_allowed: false;
    readonly observation_projection: "reviewed_cloudflare_fields_only_v1";
    readonly commitment_key_id_digest: string;
    readonly identity_commitment_spec: Readonly<{
        commitment_algorithm: "hmac-sha256-v1";
        commitment_key_id_digest: string;
        role_in_preimage: false;
        domains: typeof identityCommitmentDomains;
    }>;
    readonly operation_window: Readonly<{
        dispatch_started_on: string;
        dispatch_finished_on: string;
        observation_started_on: string;
        observation_finished_on: string;
        dispatch_max_ms: typeof D1_PROBE_WORKER_DISPATCH_WINDOW_MAX_MS_V1;
        observation_max_ms: typeof D1_PROBE_WORKER_OBSERVATION_WINDOW_MAX_MS_V1;
        total_max_ms: typeof D1_PROBE_WORKER_OPERATION_WINDOW_MAX_MS_V1;
        shell_created_on: string;
        shell_created_within_window: true;
    }>;
    readonly account_id_commitment: string;
    readonly database_id_commitment: string;
    readonly shell: Readonly<{
        create: Readonly<{
            dispatch_allowed: false;
            method: "POST";
            path: "/accounts/{account_id}/workers/workers";
            body: Readonly<{
                name: string;
                logpush: false;
                observability: Readonly<{ enabled: false }>;
                subdomain: Readonly<{ enabled: false; previews_enabled: false }>;
                tags: readonly [string];
                tail_consumers: readonly [];
            }>;
        }>;
        readback: Readonly<{
            beta_path: "/accounts/{account_id}/workers/workers/{worker_id}";
            classic_subdomain_path: "/accounts/{account_id}/workers/scripts/{script_name}/subdomain";
            worker_id_commitment: string;
            exposure_disabled: true;
            preupload_version_count: 0;
            preupload_deployment_count: 0;
            deployed_on: null;
        }>;
    }>;
    readonly version: Readonly<{
        create: Readonly<{
            dispatch_allowed: false;
            method: "POST";
            path: "/accounts/{account_id}/workers/workers/{worker_id}/versions";
            query: Readonly<{ deploy: false }>;
            request_digest: string;
        }>;
        id_commitment: string;
        created_on: string;
        version_tag_commitment: string;
        module_sha256: string;
        binding_configuration_digest: string;
        beta_list_path: "/accounts/{account_id}/workers/workers/{worker_id}/versions";
        beta_get_path: "/accounts/{account_id}/workers/workers/{worker_id}/versions/{version_id}";
        beta_get_query: Readonly<{ include: "modules" }>;
        classic_get_path: "/accounts/{account_id}/workers/scripts/{script_name}/versions/{version_id}";
        marker_match_count: 1;
        urls: readonly [];
        has_preview: false;
    }>;
    readonly deployment: Readonly<{
        create: Readonly<{
            dispatch_allowed: false;
            method: "POST";
            path: "/accounts/{account_id}/workers/scripts/{script_name}/deployments";
            query: Readonly<{ force: false }>;
            request_digest: string;
        }>;
        id_commitment: string;
        list_path: "/accounts/{account_id}/workers/scripts/{script_name}/deployments";
        get_path: "/accounts/{account_id}/workers/scripts/{script_name}/deployments/{deployment_id}";
        marker_match_count: 1;
        version_count: 1;
        traffic_percentage: 100;
        force: false;
        post_deployment_exposure_disabled: true;
    }>;
    readonly runtime: Readonly<{
        version_id_commitment: string;
        version_tag_commitment: string;
        version_created_on: string;
        matched: true;
    }>;
    readonly cleanup: Readonly<{
        force: false;
        order: readonly ["writer_a", "writer_b", "sink"];
        steps: readonly [
            Readonly<{ role: "writer_a"; method: "DELETE"; path: string; query: Readonly<Record<string, never>> }>,
            Readonly<{ role: "writer_b"; method: "DELETE"; path: string; query: Readonly<Record<string, never>> }>,
            Readonly<{ role: "sink"; method: "DELETE"; path: string; query: Readonly<Record<string, never>> }>,
        ];
    }>;
    readonly protocol_digest: string;
}

const encoder = new TextEncoder();

const safeParse = <T>(
    schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } },
    input: unknown
): T | null => {
    try {
        const result = schema.safeParse(input);
        return result.success ? result.data : null;
    } catch {
        return null;
    }
};

const deepFreeze = <T>(value: T): T => {
    if (typeof value !== "object" || value === null || Object.isFrozen(value) || value instanceof Uint8Array) {
        return value;
    }
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
};

const arrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const toHex = (value: ArrayBuffer): string =>
    [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");

const encodeBase64Url = (bytes: Uint8Array): string =>
    globalThis
        .btoa(String.fromCharCode(...bytes))
        .replace(/=/gu, "")
        .replace(/\+/gu, "-")
        .replace(/\//gu, "_");

const decodeBase64Url = (value: string): Uint8Array | null => {
    try {
        const padding = "=".repeat((4 - (value.length % 4)) % 4);
        const binary = globalThis.atob(value.replace(/-/gu, "+").replace(/_/gu, "/") + padding);
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        return encodeBase64Url(bytes) === value ? bytes : null;
    } catch {
        return null;
    }
};

const importCommitmentKey = async (input: unknown): Promise<CryptoKey | null> => {
    const parsed = safeParse(D1ProbeCommitmentKeyV1Schema, input);
    if (parsed === null) return null;
    const raw = decodeBase64Url(parsed.hmac_key_base64url);
    if (raw === null || raw.byteLength < 32 || raw.byteLength > 64) return null;
    try {
        return await globalThis.crypto.subtle.importKey(
            "raw",
            arrayBuffer(raw),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
        );
    } catch {
        return null;
    } finally {
        raw.fill(0);
    }
};

const hmacValue = async (key: CryptoKey, domain: string, value: CanonicalJsonValueV1): Promise<string | null> => {
    try {
        const bytes = encoder.encode(`${domain}\u0000${canonicalizeJsonV1(value)}`);
        return toHex(await globalThis.crypto.subtle.sign("HMAC", key, arrayBuffer(bytes)));
    } catch {
        return null;
    }
};

const sha256 = async (value: string): Promise<string | null> => {
    try {
        return `sha256:${toHex(await globalThis.crypto.subtle.digest("SHA-256", arrayBuffer(encoder.encode(value))))}`;
    } catch {
        return null;
    }
};

const bytesSha256 = async (value: Uint8Array): Promise<string | null> => {
    try {
        return `sha256:${toHex(await globalThis.crypto.subtle.digest("SHA-256", arrayBuffer(value)))}`;
    } catch {
        return null;
    }
};

const canonicalBase64 = (value: Uint8Array): string => {
    let binary = "";
    const chunkSize = 32_768;
    for (let offset = 0; offset < value.byteLength; offset += chunkSize) {
        binary += String.fromCharCode(...value.subarray(offset, Math.min(offset + chunkSize, value.byteLength)));
    }
    return globalThis.btoa(binary);
};

const exactJson = (left: unknown, right: unknown): boolean => JSON.stringify(left) === JSON.stringify(right);

const timestampEquals = (left: string, right: string): boolean => {
    const leftTime = Date.parse(left);
    const rightTime = Date.parse(right);
    return Number.isFinite(leftTime) && leftTime === rightTime;
};

const operationWindowValid = (input: InputV1): boolean => {
    const dispatchStarted = Date.parse(input.operation_window.dispatch_started_on);
    const dispatchFinished = Date.parse(input.operation_window.dispatch_finished_on);
    const observationStarted = Date.parse(input.operation_window.observation_started_on);
    const observationFinished = Date.parse(input.operation_window.observation_finished_on);
    const shellCreated = Date.parse(input.beta_worker_readback.created_on);
    if (
        ![dispatchStarted, dispatchFinished, observationStarted, observationFinished, shellCreated].every(
            Number.isFinite
        )
    ) {
        return false;
    }
    const dispatchDuration = dispatchFinished - dispatchStarted;
    const observationDuration = observationFinished - observationStarted;
    const totalDuration = observationFinished - dispatchStarted;
    return (
        dispatchDuration > 0 &&
        dispatchDuration <= D1_PROBE_WORKER_DISPATCH_WINDOW_MAX_MS_V1 &&
        observationDuration > 0 &&
        observationDuration <= D1_PROBE_WORKER_OBSERVATION_WINDOW_MAX_MS_V1 &&
        dispatchFinished <= observationStarted &&
        totalDuration <= D1_PROBE_WORKER_OPERATION_WINDOW_MAX_MS_V1 &&
        shellCreated >= dispatchStarted &&
        shellCreated <= observationFinished
    );
};

const markersFor = (input: InputV1) => {
    const prefix = `openbot:d1-probe:v1:${input.operation_id}:${input.role}`;
    return Object.freeze({
        ownership: `${prefix}:owner`,
        version: `${prefix}:version`,
        versionMessage: `${prefix}:first-private-version`,
        deployment: `${prefix}:deployment`,
    });
};

const bindingsFor = (input: InputV1): readonly BindingV1[] =>
    deepFreeze([
        { name: "PROBE_DB", type: "d1", database_id: input.database_id } as const,
        ...(input.role === "sink"
            ? []
            : [
                  {
                      name: "PROBE_SINK",
                      type: "service",
                      service: input.topology.sink,
                      entrypoint: "D1ProbeSinkService",
                  } as const,
              ]),
        { name: "VERSION_METADATA", type: "version_metadata" } as const,
    ]);

const deleteStep = <Role extends "sink" | "writer_a" | "writer_b">(role: Role, scriptName: string) =>
    deepFreeze({
        role,
        method: "DELETE" as const,
        path: `/accounts/{account_id}/workers/scripts/${scriptName}`,
        query: {} as Readonly<Record<string, never>>,
    });

export const compileUntrustedD1ProbeCloudflareWorkerProtocolV1 = async (
    input: unknown,
    commitmentKeyInput: unknown
): Promise<
    | Readonly<{ success: true; protocol: UntrustedD1ProbeCloudflareWorkerProtocolV1 }>
    | Readonly<{ success: false; code: D1ProbeCloudflareWorkerProtocolDenialV1 }>
> => {
    const parsed = safeParse(InputV1Schema, input);
    if (parsed === null) return { success: false, code: "invalid_input" };
    if (!operationWindowValid(parsed)) return { success: false, code: "invalid_operation_window" };
    const commitmentKey = await importCommitmentKey(commitmentKeyInput);
    if (commitmentKey === null) return { success: false, code: "invalid_commitment_key" };
    const scriptName = parsed.topology[parsed.role];
    if (parsed.beta_worker_readback.name !== scriptName) {
        return { success: false, code: "worker_identity_mismatch" };
    }

    const markers = markersFor(parsed);
    if (
        markers.ownership.length > 100 ||
        markers.version.length > 100 ||
        markers.versionMessage.length > 100 ||
        markers.deployment.length > 1_000
    ) {
        return { success: false, code: "invalid_input" };
    }
    if (parsed.beta_worker_readback.tags.length !== 1 || parsed.beta_worker_readback.tags[0] !== markers.ownership) {
        return { success: false, code: "worker_ownership_mismatch" };
    }
    if (
        parsed.preupload_beta_version_list.total_count !== 0 ||
        parsed.preupload_beta_version_list.versions.length !== 0 ||
        parsed.preupload_deployment_list.deployments.length !== 0
    ) {
        return { success: false, code: "preupload_shell_not_empty" };
    }

    const expectedBindings = bindingsFor(parsed);
    if (
        !exactJson(parsed.beta_version_readback.bindings, expectedBindings) ||
        !exactJson(parsed.classic_version_readback.resources.bindings, expectedBindings)
    ) {
        return { success: false, code: "binding_mismatch" };
    }

    const versionMatches = parsed.beta_version_list.versions.filter(
        version => version.annotations["workers/tag"] === markers.version
    );
    if (
        versionMatches.length !== 1 ||
        parsed.beta_version_list.total_count !== 1 ||
        parsed.beta_version_list.versions.length !== 1
    ) {
        return { success: false, code: "version_marker_not_unique" };
    }
    const version = parsed.beta_version_readback;
    const expectedAnnotations = {
        "workers/message": markers.versionMessage,
        "workers/tag": markers.version,
        "workers/triggered_by": "openbot-d1-probe-operator",
    } as const;
    if (
        versionMatches[0]!.id !== version.id ||
        parsed.classic_version_readback.id !== version.id ||
        !exactJson(versionMatches[0]!.annotations, expectedAnnotations) ||
        !exactJson(version.annotations, expectedAnnotations)
    ) {
        return { success: false, code: "version_mismatch" };
    }

    const contentBase64 = canonicalBase64(parsed.module_bytes);
    if (version.modules[0].content_base64 !== contentBase64) {
        return { success: false, code: "module_mismatch" };
    }

    const deploymentMatches = parsed.deployment_list.deployments.filter(
        deployment => deployment.annotations["workers/message"] === markers.deployment
    );
    if (deploymentMatches.length !== 1 || parsed.deployment_list.deployments.length !== 1) {
        return { success: false, code: "deployment_marker_not_unique" };
    }
    const deployment = parsed.deployment_readback;
    const expectedDeployment = {
        strategy: "percentage" as const,
        annotations: { "workers/message": markers.deployment },
        versions: [{ version_id: version.id, percentage: 100 as const }] as const,
    };
    if (
        deploymentMatches[0]!.id !== deployment.id ||
        !exactJson(
            {
                strategy: deploymentMatches[0]!.strategy,
                annotations: deploymentMatches[0]!.annotations,
                versions: deploymentMatches[0]!.versions,
            },
            expectedDeployment
        ) ||
        !exactJson(
            {
                strategy: deployment.strategy,
                annotations: deployment.annotations,
                versions: deployment.versions,
            },
            expectedDeployment
        )
    ) {
        return { success: false, code: "deployment_mismatch" };
    }

    if (
        parsed.runtime_version_metadata.id !== version.id ||
        parsed.runtime_version_metadata.tag !== markers.version ||
        !timestampEquals(parsed.runtime_version_metadata.timestamp, version.created_on)
    ) {
        return { success: false, code: "runtime_version_metadata_mismatch" };
    }

    const module = deepFreeze({
        name: D1_PROBE_WORKER_MAIN_MODULE_V1 as typeof D1_PROBE_WORKER_MAIN_MODULE_V1,
        content_type: "application/javascript+module" as const,
        content_base64: contentBase64,
    });
    const versionCreateBody = deepFreeze({
        main_module: D1_PROBE_WORKER_MAIN_MODULE_V1,
        compatibility_date: D1_PROBE_COMPATIBILITY_DATE_V1,
        compatibility_flags: [] as const,
        annotations: expectedAnnotations,
        bindings: expectedBindings,
        modules: [module] as const,
    });
    const deploymentCreateBody = deepFreeze(expectedDeployment);
    const moduleSha256 = await bytesSha256(parsed.module_bytes);
    if (moduleSha256 === null) return { success: false, code: "digest_unavailable" };
    const [
        accountIdCommitment,
        databaseIdCommitment,
        workerIdCommitment,
        versionIdCommitment,
        deploymentIdCommitment,
        versionTagCommitment,
        bindingConfigurationDigest,
        versionRequestDigest,
        deploymentRequestDigest,
    ] = await Promise.all([
        hmacValue(commitmentKey, identityCommitmentDomains.account_id, parsed.account_id),
        hmacValue(commitmentKey, identityCommitmentDomains.database_id, parsed.database_id),
        hmacValue(commitmentKey, identityCommitmentDomains.worker_script_id, parsed.beta_worker_readback.id),
        hmacValue(commitmentKey, identityCommitmentDomains.worker_version_id, version.id),
        hmacValue(commitmentKey, identityCommitmentDomains.worker_deployment_id, deployment.id),
        sha256(`openbot.d1-probe.cloudflare-version-tag.v1\u0000${markers.version}`),
        sha256(`openbot.d1-probe.cloudflare-worker-bindings.v1\u0000${JSON.stringify(expectedBindings)}`),
        sha256(
            `openbot.d1-probe.cloudflare-version-request.v1\u0000${JSON.stringify({
                method: "POST",
                path: "/accounts/{account_id}/workers/workers/{worker_id}/versions",
                query: { deploy: false },
                body: versionCreateBody,
            })}`
        ),
        sha256(
            `openbot.d1-probe.cloudflare-deployment-request.v1\u0000${JSON.stringify({
                method: "POST",
                path: "/accounts/{account_id}/workers/scripts/{script_name}/deployments",
                query: { force: false },
                body: deploymentCreateBody,
            })}`
        ),
    ]);
    if (
        accountIdCommitment === null ||
        databaseIdCommitment === null ||
        workerIdCommitment === null ||
        versionIdCommitment === null ||
        deploymentIdCommitment === null
    ) {
        return { success: false, code: "commitment_unavailable" };
    }
    if (
        versionTagCommitment === null ||
        bindingConfigurationDigest === null ||
        versionRequestDigest === null ||
        deploymentRequestDigest === null
    ) {
        return { success: false, code: "digest_unavailable" };
    }
    const unsignedProtocol: Omit<UntrustedD1ProbeCloudflareWorkerProtocolV1, "protocol_digest"> = {
        schema_version: 1,
        kind: "untrusted_d1_probe_cloudflare_worker_protocol",
        authoritative: false,
        mutation_allowed: false,
        eligible_for_upload: false,
        eligible_for_attestation: false,
        lifecycle_advance_allowed: false,
        gate: false,
        gate_promotion_allowed: false,
        observation_projection: "reviewed_cloudflare_fields_only_v1",
        commitment_key_id_digest: parsed.commitment_key_id_digest,
        identity_commitment_spec: {
            commitment_algorithm: "hmac-sha256-v1",
            commitment_key_id_digest: parsed.commitment_key_id_digest,
            role_in_preimage: false,
            domains: identityCommitmentDomains,
        },
        operation_window: {
            ...parsed.operation_window,
            dispatch_max_ms: D1_PROBE_WORKER_DISPATCH_WINDOW_MAX_MS_V1,
            observation_max_ms: D1_PROBE_WORKER_OBSERVATION_WINDOW_MAX_MS_V1,
            total_max_ms: D1_PROBE_WORKER_OPERATION_WINDOW_MAX_MS_V1,
            shell_created_on: parsed.beta_worker_readback.created_on,
            shell_created_within_window: true,
        },
        account_id_commitment: accountIdCommitment,
        database_id_commitment: databaseIdCommitment,
        shell: {
            create: {
                dispatch_allowed: false,
                method: "POST",
                path: "/accounts/{account_id}/workers/workers",
                body: {
                    name: scriptName,
                    logpush: false,
                    observability: { enabled: false },
                    subdomain: { enabled: false, previews_enabled: false },
                    tags: [markers.ownership],
                    tail_consumers: [],
                },
            },
            readback: {
                beta_path: "/accounts/{account_id}/workers/workers/{worker_id}",
                classic_subdomain_path: "/accounts/{account_id}/workers/scripts/{script_name}/subdomain",
                worker_id_commitment: workerIdCommitment,
                exposure_disabled: true,
                preupload_version_count: 0,
                preupload_deployment_count: 0,
                deployed_on: null,
            },
        },
        version: {
            create: {
                dispatch_allowed: false,
                method: "POST",
                path: "/accounts/{account_id}/workers/workers/{worker_id}/versions",
                query: { deploy: false },
                request_digest: versionRequestDigest,
            },
            id_commitment: versionIdCommitment,
            created_on: version.created_on,
            version_tag_commitment: versionTagCommitment,
            module_sha256: moduleSha256,
            binding_configuration_digest: bindingConfigurationDigest,
            beta_list_path: "/accounts/{account_id}/workers/workers/{worker_id}/versions",
            beta_get_path: "/accounts/{account_id}/workers/workers/{worker_id}/versions/{version_id}",
            beta_get_query: { include: "modules" },
            classic_get_path: "/accounts/{account_id}/workers/scripts/{script_name}/versions/{version_id}",
            marker_match_count: 1,
            urls: [],
            has_preview: false,
        },
        deployment: {
            create: {
                dispatch_allowed: false,
                method: "POST",
                path: "/accounts/{account_id}/workers/scripts/{script_name}/deployments",
                query: { force: false },
                request_digest: deploymentRequestDigest,
            },
            id_commitment: deploymentIdCommitment,
            list_path: "/accounts/{account_id}/workers/scripts/{script_name}/deployments",
            get_path: "/accounts/{account_id}/workers/scripts/{script_name}/deployments/{deployment_id}",
            marker_match_count: 1,
            version_count: 1,
            traffic_percentage: 100,
            force: false,
            post_deployment_exposure_disabled: true,
        },
        runtime: {
            version_id_commitment: versionIdCommitment,
            version_tag_commitment: versionTagCommitment,
            version_created_on: version.created_on,
            matched: true,
        },
        cleanup: {
            force: false,
            order: ["writer_a", "writer_b", "sink"],
            steps: [
                deleteStep("writer_a", parsed.topology.writer_a),
                deleteStep("writer_b", parsed.topology.writer_b),
                deleteStep("sink", parsed.topology.sink),
            ],
        },
    };
    const protocolDigest = await digestCanonicalJsonV1(
        "openbot.d1-probe.cloudflare-worker-protocol.v1",
        unsignedProtocol as unknown as CanonicalJsonValueV1
    );
    if (protocolDigest === null) return { success: false, code: "digest_unavailable" };
    const protocol: UntrustedD1ProbeCloudflareWorkerProtocolV1 = deepFreeze({
        ...unsignedProtocol,
        protocol_digest: protocolDigest,
    });
    return { success: true, protocol };
};
