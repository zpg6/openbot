import { z } from "zod";

import {
    canonicalizeJsonV1,
    digestCanonicalJsonV1,
    type CanonicalJsonValueV1,
} from "@openbot/gate-attestation/internal";

import { D1_PROBE_COMPATIBILITY_DATE_V1, D1_PROBE_WRANGLER_VERSION_V1 } from "./contracts.js";
import {
    resolveInitializedD1ProbeDatabaseV1,
    type InitializedD1ProbeDatabaseV1,
} from "./cloudflare-database-bootstrap.js";
import { resolveCreatedD1ProbeDatabaseV1 } from "./cloudflare-database.js";
import { resolveVerifiedD1ProbePreflightV1 } from "./verified-preflight.js";

export const D1_PROBE_WORKER_NODE_VERSION_V1 = "22.19.0";
export const D1_PROBE_WORKER_PNPM_VERSION_V1 = "11.22.0";
export const D1_PROBE_WORKER_MAIN_MODULE_V1 = "entry.js";
export const D1_PROBE_WORKER_MODULE_LIMIT_BYTES_V1 = 8 * 1024 * 1024;

const Sha256Schema = z.string().regex(/^sha256:[0-9a-f]{64}$/u);
const WorkerRoleV1Schema = z.enum(["sink", "writer_a", "writer_b"]);
export type D1ProbeWorkerArtifactRoleV1 = z.infer<typeof WorkerRoleV1Schema>;

const DependencyDigestsV1Schema = z
    .object({
        pnpm_lock_sha256: Sha256Schema,
        root_package_json_sha256: Sha256Schema,
        pnpm_workspace_sha256: Sha256Schema,
        worker_build_script_sha256: Sha256Schema,
        sink_package_json_sha256: Sha256Schema,
        writer_package_json_sha256: Sha256Schema,
        rpc_package_json_sha256: Sha256Schema,
    })
    .strict();

const WorkerBuildProjectionV1Schema = z
    .object({
        role: WorkerRoleV1Schema,
        source_entrypoint: z.enum([
            "apps/d1-probe-sink/entry.ts",
            "apps/d1-probe-writer/entry.a.ts",
            "apps/d1-probe-writer/entry.b.ts",
        ]),
        main_module: z.literal(D1_PROBE_WORKER_MAIN_MODULE_V1),
        selected_entrypoint: z.enum(["D1ProbeSinkService", "D1ProbeWriterAService", "D1ProbeWriterBService"]),
        public_fetch_contract: z.enum([
            "access_readback_v1",
            "access_writer_a_trigger_v1",
            "access_writer_b_trigger_v1",
        ]),
        runtime_version_metadata_response_contract: z.literal("required_not_observed"),
        exports: z.array(z.string()).min(1).max(3),
        external_imports: z.tuple([z.literal("cloudflare:workers")]),
        output_byte_length: z.number().int().positive().max(D1_PROBE_WORKER_MODULE_LIMIT_BYTES_V1),
        module_format: z.literal("esm"),
        additional_module_count: z.literal(0),
        asset_count: z.literal(0),
        source_map_emitted: z.literal(false),
        source_map_comment: z.literal(false),
    })
    .strict();

const WorkerBuildObservationV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("d1_probe_worker_build_observation"),
        node_version: z.literal(D1_PROBE_WORKER_NODE_VERSION_V1),
        pnpm_version: z.literal(D1_PROBE_WORKER_PNPM_VERSION_V1),
        wrangler_version: z.literal(D1_PROBE_WRANGLER_VERSION_V1),
        compatibility_date: z.literal(D1_PROBE_COMPATIBILITY_DATE_V1),
        compatibility_flags: z.tuple([]),
        workers_dev: z.literal(false),
        preview_urls: z.literal(false),
        observability: z.literal(false),
        route_count: z.literal(0),
        asset_count: z.literal(0),
        additional_module_count: z.literal(0),
        variable_binding_count: z.literal(0),
        secret_binding_count: z.literal(0),
        tail_consumer_count: z.literal(0),
        worker_build_recipe_digest: Sha256Schema,
        dependency_digests: DependencyDigestsV1Schema,
        workers: z.tuple([WorkerBuildProjectionV1Schema, WorkerBuildProjectionV1Schema, WorkerBuildProjectionV1Schema]),
    })
    .strict();

const WorkerModuleInputV1Schema = z
    .object({
        role: WorkerRoleV1Schema,
        bytes: z.instanceof(Uint8Array).refine(bytes => bytes.byteLength > 0, "Worker module must not be empty"),
    })
    .strict();

const CompileInputV1Schema = z
    .object({
        build: WorkerBuildObservationV1Schema,
        modules: z.tuple([WorkerModuleInputV1Schema, WorkerModuleInputV1Schema, WorkerModuleInputV1Schema]),
    })
    .strict();

type WorkerBuildObservationV1 = z.infer<typeof WorkerBuildObservationV1Schema>;
type ResourcePlanV1 = Readonly<{
    resources: readonly Readonly<{
        resource_kind: string;
        generated_name: string;
        generated_name_commitment: string;
    }>[];
}>;

export interface D1ProbeWorkerMultipartPartV1 {
    readonly part_index: 0 | 1;
    readonly form_name: "metadata" | typeof D1_PROBE_WORKER_MAIN_MODULE_V1;
    readonly file_name: typeof D1_PROBE_WORKER_MAIN_MODULE_V1 | null;
    readonly content_type: "application/json" | "application/javascript+module";
    readonly byte_length: number;
    readonly sha256: string;
}

export interface D1ProbeWorkerArtifactManifestV1 {
    readonly role: D1ProbeWorkerArtifactRoleV1;
    readonly generated_script_name: string;
    readonly generated_script_name_commitment: string;
    readonly main_module: typeof D1_PROBE_WORKER_MAIN_MODULE_V1;
    readonly selected_entrypoint: "D1ProbeSinkService" | "D1ProbeWriterAService" | "D1ProbeWriterBService";
    readonly module_byte_length: number;
    readonly module_sha256: string;
    readonly metadata_byte_length: number;
    readonly metadata_sha256: string;
    readonly binding_configuration_digest: string;
    readonly eligible_for_upload: false;
    readonly deployment_ready: false;
    readonly multipart_parts: readonly [D1ProbeWorkerMultipartPartV1, D1ProbeWorkerMultipartPartV1];
    readonly artifact_digest: string;
}

export interface UntrustedD1ProbeWorkerArtifactCandidateV1 {
    readonly schema_version: 1;
    readonly kind: "untrusted_d1_probe_worker_artifact_candidate";
    readonly authoritative: false;
    readonly deploy_performed: false;
    readonly upload_performed: false;
    readonly lifecycle_advanced: false;
    readonly eligible_for_upload: false;
    readonly deployment_ready: false;
    readonly upload_metadata_credentials_present: false;
    readonly routes_present: false;
    readonly eligible_for_attestation: false;
    readonly gate_promotion_allowed: false;
    readonly plan_digest: string;
    readonly database_id_commitment: string;
    readonly database_name_commitment: string;
    readonly compatibility_date: typeof D1_PROBE_COMPATIBILITY_DATE_V1;
    readonly compatibility_flags: readonly [];
    readonly wrangler_version: typeof D1_PROBE_WRANGLER_VERSION_V1;
    readonly node_version: typeof D1_PROBE_WORKER_NODE_VERSION_V1;
    readonly pnpm_version: typeof D1_PROBE_WORKER_PNPM_VERSION_V1;
    readonly build_observation_digest: string;
    readonly dependency_digest: string;
    readonly artifacts: readonly [
        D1ProbeWorkerArtifactManifestV1,
        D1ProbeWorkerArtifactManifestV1,
        D1ProbeWorkerArtifactManifestV1,
    ];
    readonly candidate_digest: string;
}

export type CompileD1ProbeWorkerArtifactsDenialV1 =
    | "invalid_initialized_database"
    | "invalid_worker_build_observation"
    | "invalid_worker_modules"
    | "worker_build_binding_mismatch"
    | "worker_module_invalid"
    | "digest_unavailable";

type InternalArtifactV1 = Readonly<{
    manifest: D1ProbeWorkerArtifactManifestV1;
}>;
const encoder = new TextEncoder();
const strictDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const arrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const toHex = (value: ArrayBuffer): string =>
    [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");

const rawSha256 = async (bytes: Uint8Array): Promise<string | null> => {
    try {
        return `sha256:${toHex(await globalThis.crypto.subtle.digest("SHA-256", arrayBuffer(bytes)))}`;
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

const expectedBuildProjection = Object.freeze({
    sink: Object.freeze({
        source_entrypoint: "apps/d1-probe-sink/entry.ts" as const,
        selected_entrypoint: "D1ProbeSinkService" as const,
        public_fetch_contract: "access_readback_v1" as const,
        exports: Object.freeze(["D1ProbeSinkService", "default"]),
    }),
    writer_a: Object.freeze({
        source_entrypoint: "apps/d1-probe-writer/entry.a.ts" as const,
        selected_entrypoint: "D1ProbeWriterAService" as const,
        public_fetch_contract: "access_writer_a_trigger_v1" as const,
        exports: Object.freeze(["D1ProbeWriterAService", "default"]),
    }),
    writer_b: Object.freeze({
        source_entrypoint: "apps/d1-probe-writer/entry.b.ts" as const,
        selected_entrypoint: "D1ProbeWriterBService" as const,
        public_fetch_contract: "access_writer_b_trigger_v1" as const,
        exports: Object.freeze(["D1ProbeWriterBService", "default"]),
    }),
});

const exactArray = (actual: readonly string[], expected: readonly string[]): boolean =>
    actual.length === expected.length && actual.every((value, index) => value === expected[index]);

const buildMatches = (build: WorkerBuildObservationV1): boolean => {
    const roles = WorkerRoleV1Schema.options;
    return build.workers.every((worker, index) => {
        const role = roles[index];
        if (role === undefined || worker.role !== role) return false;
        const expected = expectedBuildProjection[role];
        return (
            worker.source_entrypoint === expected.source_entrypoint &&
            worker.selected_entrypoint === expected.selected_entrypoint &&
            worker.public_fetch_contract === expected.public_fetch_contract &&
            exactArray(worker.exports, expected.exports)
        );
    });
};

const safeModuleText = (bytes: Uint8Array): string | null => {
    if (bytes.byteLength === 0 || bytes.byteLength > D1_PROBE_WORKER_MODULE_LIMIT_BYTES_V1) return null;
    try {
        const text = strictDecoder.decode(bytes);
        if (
            /(?:[#@]\s*sourceMappingURL\s*=)|(?:file:\/\/\/)|(?:\/(?:Users|home|private|tmp|root|workspace|github\/workspace|var\/folders|opt|mnt)\/)|(?:[A-Za-z]:[\\/])/u.test(
                text
            )
        ) {
            return null;
        }
        return text;
    } catch {
        return null;
    }
};

const resource = (plan: ResourcePlanV1, kind: "sink_script" | "writer_a_script" | "writer_b_script") =>
    plan.resources.find(candidate => candidate.resource_kind === kind) ?? null;

const bindingsFor = (
    role: D1ProbeWorkerArtifactRoleV1,
    databaseId: string,
    sinkScriptName: string
): CanonicalJsonValueV1[] => [
    { type: "d1", name: "PROBE_DB", database_id: databaseId },
    ...(role === "sink"
        ? []
        : [
              {
                  type: "service",
                  name: "PROBE_SINK",
                  service: sinkScriptName,
                  entrypoint: "D1ProbeSinkService",
              },
          ]),
    { type: "version_metadata", name: "VERSION_METADATA" },
];

const metadataFor = (
    role: D1ProbeWorkerArtifactRoleV1,
    databaseId: string,
    sinkScriptName: string
): CanonicalJsonValueV1 => ({
    main_module: D1_PROBE_WORKER_MAIN_MODULE_V1,
    compatibility_date: D1_PROBE_COMPATIBILITY_DATE_V1,
    compatibility_flags: [],
    bindings: bindingsFor(role, databaseId, sinkScriptName),
});

const artifactFor = async (
    role: D1ProbeWorkerArtifactRoleV1,
    scriptName: string,
    scriptNameCommitment: string,
    databaseId: string,
    sinkScriptName: string,
    moduleBytesInput: Uint8Array,
    build: WorkerBuildObservationV1
): Promise<InternalArtifactV1 | null> => {
    const workerIndex = WorkerRoleV1Schema.options.indexOf(role);
    const observed = build.workers[workerIndex];
    if (observed === undefined || observed.output_byte_length !== moduleBytesInput.byteLength) return null;
    if (safeModuleText(moduleBytesInput) === null) return null;
    const moduleBytes = new Uint8Array(moduleBytesInput);
    const metadataBytes = encoder.encode(canonicalizeJsonV1(metadataFor(role, databaseId, sinkScriptName)));
    const [moduleSha256, metadataSha256, bindingConfigurationDigest] = await Promise.all([
        rawSha256(moduleBytes),
        rawSha256(metadataBytes),
        digestCanonicalJsonV1("openbot.d1-probe.worker-binding-configuration.v1", {
            caller_script_name_commitment: scriptNameCommitment,
            role,
            bindings: bindingsFor(role, databaseId, sinkScriptName),
        }),
    ]);
    if (moduleSha256 === null || metadataSha256 === null || bindingConfigurationDigest === null) return null;
    const multipartParts = [
        {
            part_index: 0 as const,
            form_name: "metadata" as const,
            file_name: null,
            content_type: "application/json" as const,
            byte_length: metadataBytes.byteLength,
            sha256: metadataSha256,
        },
        {
            part_index: 1 as const,
            form_name: D1_PROBE_WORKER_MAIN_MODULE_V1,
            file_name: D1_PROBE_WORKER_MAIN_MODULE_V1,
            content_type: "application/javascript+module" as const,
            byte_length: moduleBytes.byteLength,
            sha256: moduleSha256,
        },
    ] as const;
    const unsignedManifest = {
        role,
        generated_script_name: scriptName,
        generated_script_name_commitment: scriptNameCommitment,
        main_module: D1_PROBE_WORKER_MAIN_MODULE_V1 as typeof D1_PROBE_WORKER_MAIN_MODULE_V1,
        selected_entrypoint: expectedBuildProjection[role].selected_entrypoint,
        module_byte_length: moduleBytes.byteLength,
        module_sha256: moduleSha256,
        metadata_byte_length: metadataBytes.byteLength,
        metadata_sha256: metadataSha256,
        binding_configuration_digest: bindingConfigurationDigest,
        eligible_for_upload: false as const,
        deployment_ready: false as const,
        multipart_parts: multipartParts,
    };
    const artifactDigest = await digestCanonicalJsonV1(
        "openbot.d1-probe.worker-version-artifact.v1",
        unsignedManifest as unknown as CanonicalJsonValueV1
    );
    if (artifactDigest === null) return null;
    return {
        manifest: deepFreeze({ ...unsignedManifest, artifact_digest: artifactDigest }),
    };
};

const publicManifest = (artifact: InternalArtifactV1): D1ProbeWorkerArtifactManifestV1 =>
    deepFreeze(structuredClone(artifact.manifest));

export const compileUntrustedD1ProbeWorkerArtifactCandidateV1 = async (
    initializedDatabase: InitializedD1ProbeDatabaseV1,
    input: unknown
): Promise<
    | Readonly<{
          success: true;
          candidate: UntrustedD1ProbeWorkerArtifactCandidateV1;
      }>
    | Readonly<{ success: false; code: CompileD1ProbeWorkerArtifactsDenialV1 }>
> => {
    const initialized = resolveInitializedD1ProbeDatabaseV1(initializedDatabase);
    if (initialized === null) return { success: false, code: "invalid_initialized_database" };
    const created = resolveCreatedD1ProbeDatabaseV1(initialized.created_database);
    if (created === null) return { success: false, code: "invalid_initialized_database" };
    const preflight = resolveVerifiedD1ProbePreflightV1(created.verified_preflight);
    if (preflight === null || preflight.plan.plan_digest !== initialized.plan_digest) {
        return { success: false, code: "invalid_initialized_database" };
    }
    const parsed = safeParse(CompileInputV1Schema, input);
    if (parsed === null) return { success: false, code: "invalid_worker_build_observation" };
    if (!buildMatches(parsed.build)) {
        return { success: false, code: "worker_build_binding_mismatch" };
    }
    const roles = WorkerRoleV1Schema.options;
    if (!parsed.modules.every((module, index) => module.role === roles[index])) {
        return { success: false, code: "invalid_worker_modules" };
    }
    const sink = resource(preflight.plan, "sink_script");
    const writerA = resource(preflight.plan, "writer_a_script");
    const writerB = resource(preflight.plan, "writer_b_script");
    if (
        sink === null ||
        writerA === null ||
        writerB === null ||
        created.database_name !== resourceName(preflight.plan)
    ) {
        return { success: false, code: "worker_build_binding_mismatch" };
    }
    const resources = [sink, writerA, writerB] as const;
    const modules = [parsed.modules[0]!, parsed.modules[1]!, parsed.modules[2]!] as const;
    const artifacts = await Promise.all(
        roles.map((role, index) =>
            artifactFor(
                role,
                resources[index]!.generated_name,
                resources[index]!.generated_name_commitment,
                created.database_id,
                sink.generated_name,
                modules[index]!.bytes,
                parsed.build
            )
        )
    );
    if (artifacts.some(artifact => artifact === null)) return { success: false, code: "worker_module_invalid" };
    const exactArtifacts = artifacts as [InternalArtifactV1, InternalArtifactV1, InternalArtifactV1];
    const [buildObservationDigest, dependencyDigest] = await Promise.all([
        digestCanonicalJsonV1(
            "openbot.d1-probe.worker-build-observation.v1",
            parsed.build as unknown as CanonicalJsonValueV1
        ),
        digestCanonicalJsonV1(
            "openbot.d1-probe.worker-build-dependencies.v1",
            parsed.build.dependency_digests as unknown as CanonicalJsonValueV1
        ),
    ]);
    if (buildObservationDigest === null || dependencyDigest === null) {
        return { success: false, code: "digest_unavailable" };
    }
    const candidateDigest = await digestCanonicalJsonV1("openbot.d1-probe.worker-artifact-candidate.v1", {
        plan_digest: preflight.plan.plan_digest,
        database_id_commitment: initialized.database_id_commitment,
        database_name_commitment: initialized.database_name_commitment,
        build_observation_digest: buildObservationDigest,
        dependency_digest: dependencyDigest,
        artifact_digests: exactArtifacts.map(artifact => artifact.manifest.artifact_digest),
    });
    if (candidateDigest === null) return { success: false, code: "digest_unavailable" };
    const candidate = deepFreeze({
        schema_version: 1 as const,
        kind: "untrusted_d1_probe_worker_artifact_candidate" as const,
        authoritative: false as const,
        deploy_performed: false as const,
        upload_performed: false as const,
        lifecycle_advanced: false as const,
        eligible_for_upload: false as const,
        deployment_ready: false as const,
        upload_metadata_credentials_present: false as const,
        routes_present: false as const,
        eligible_for_attestation: false as const,
        gate_promotion_allowed: false as const,
        plan_digest: preflight.plan.plan_digest,
        database_id_commitment: initialized.database_id_commitment,
        database_name_commitment: initialized.database_name_commitment,
        compatibility_date: D1_PROBE_COMPATIBILITY_DATE_V1 as typeof D1_PROBE_COMPATIBILITY_DATE_V1,
        compatibility_flags: [] as const,
        wrangler_version: D1_PROBE_WRANGLER_VERSION_V1 as typeof D1_PROBE_WRANGLER_VERSION_V1,
        node_version: D1_PROBE_WORKER_NODE_VERSION_V1 as typeof D1_PROBE_WORKER_NODE_VERSION_V1,
        pnpm_version: D1_PROBE_WORKER_PNPM_VERSION_V1 as typeof D1_PROBE_WORKER_PNPM_VERSION_V1,
        build_observation_digest: buildObservationDigest,
        dependency_digest: dependencyDigest,
        artifacts: exactArtifacts.map(
            publicManifest
        ) as unknown as UntrustedD1ProbeWorkerArtifactCandidateV1["artifacts"],
        candidate_digest: candidateDigest,
    });
    return { success: true, candidate };
};

const resourceName = (plan: ResourcePlanV1): string | null =>
    plan.resources.find(candidate => candidate.resource_kind === "database")?.generated_name ?? null;
