import { digestCanonicalJsonV1, type CanonicalJsonValueV1 } from "@openbot/gate-attestation/internal";

import { D1_PROBE_COMPATIBILITY_DATE_V1 } from "./contracts.js";

export const D1_PROBE_WORKER_NODE_VERSION_V1 = "22.19.0";
export const D1_PROBE_WORKER_PNPM_VERSION_V1 = "11.22.0";
export const D1_PROBE_WORKER_MAIN_MODULE_V1 = "entry.js";
export const D1_PROBE_WORKER_MODULE_LIMIT_BYTES_V1 = 8 * 1024 * 1024;

export type D1ProbeWorkerVersionRoleV1 = "sink" | "writer_a" | "writer_b";

export interface D1ProbeWorkerJsonVersionContractInputV1 {
    readonly role: D1ProbeWorkerVersionRoleV1;
    readonly operation_id: string;
    readonly generated_script_name_commitment: string;
    readonly database_id: string;
    readonly sink_script_name: string;
    readonly module_bytes: Uint8Array;
}

export interface D1ProbeWorkerJsonVersionContractV1 {
    readonly schema_version: 1;
    readonly kind: "beta_worker_json_version_v1";
    readonly role: D1ProbeWorkerVersionRoleV1;
    readonly generated_script_name_commitment: string;
    readonly body: Readonly<{
        main_module: typeof D1_PROBE_WORKER_MAIN_MODULE_V1;
        compatibility_date: typeof D1_PROBE_COMPATIBILITY_DATE_V1;
        compatibility_flags: readonly [];
        annotations: Readonly<{
            "workers/message": string;
            "workers/tag": string;
            "workers/triggered_by": "openbot-d1-probe-operator";
        }>;
        bindings: readonly Readonly<Record<string, string>>[];
        modules: readonly [
            Readonly<{
                name: typeof D1_PROBE_WORKER_MAIN_MODULE_V1;
                content_type: "application/javascript+module";
                content_base64: string;
            }>,
        ];
    }>;
    readonly module_sha256: string;
    readonly binding_configuration_digest: string;
    readonly artifact_digest: string;
    readonly version_request_digest: string;
}

const strictDecoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const arrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const toHex = (value: ArrayBuffer): string =>
    [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");

const deepFreeze = <T>(value: T): T => {
    if (typeof value !== "object" || value === null || Object.isFrozen(value) || value instanceof Uint8Array) {
        return value;
    }
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
};

const canonicalBase64 = (value: Uint8Array): string => {
    let binary = "";
    const chunkSize = 32_768;
    for (let offset = 0; offset < value.byteLength; offset += chunkSize) {
        binary += String.fromCharCode(...value.subarray(offset, Math.min(offset + chunkSize, value.byteLength)));
    }
    return globalThis.btoa(binary);
};

const moduleIsSafe = (bytes: Uint8Array): boolean => {
    if (bytes.byteLength === 0 || bytes.byteLength > D1_PROBE_WORKER_MODULE_LIMIT_BYTES_V1) return false;
    try {
        const text = strictDecoder.decode(bytes);
        return !/(?:[#@]\s*sourceMappingURL\s*=)|(?:file:\/\/\/)|(?:\/(?:Users|home|private|tmp|root|workspace|github\/workspace|var\/folders|opt|mnt)\/)|(?:[A-Za-z]:[\\/])/u.test(
            text
        );
    } catch {
        return false;
    }
};

const bindingsFor = (
    role: D1ProbeWorkerVersionRoleV1,
    databaseId: string,
    sinkScriptName: string
): readonly Readonly<Record<string, string>>[] => [
    { name: "PROBE_DB", type: "d1", database_id: databaseId },
    ...(role === "sink"
        ? []
        : [
              {
                  name: "PROBE_SINK",
                  type: "service",
                  service: sinkScriptName,
                  entrypoint: "D1ProbeSinkService",
              },
          ]),
    { name: "VERSION_METADATA", type: "version_metadata" },
];

export const compileD1ProbeWorkerJsonVersionContractV1 = async (
    input: D1ProbeWorkerJsonVersionContractInputV1
): Promise<D1ProbeWorkerJsonVersionContractV1 | null> => {
    if (
        !["sink", "writer_a", "writer_b"].includes(input.role) ||
        !/^[0-9a-f]{32}$/u.test(input.operation_id) ||
        !/^[0-9a-f]{64}$/u.test(input.generated_script_name_commitment) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(input.database_id) ||
        !/^openbot-d1-probe-[a-z0-9]{16}$/u.test(input.sink_script_name) ||
        !(input.module_bytes instanceof Uint8Array) ||
        !moduleIsSafe(input.module_bytes)
    ) {
        return null;
    }
    const moduleBytes = new Uint8Array(input.module_bytes);
    const bindings = bindingsFor(input.role, input.database_id, input.sink_script_name);
    const markerPrefix = `openbot:d1-probe:v1:${input.operation_id}:${input.role}`;
    const body = deepFreeze({
        main_module: D1_PROBE_WORKER_MAIN_MODULE_V1 as typeof D1_PROBE_WORKER_MAIN_MODULE_V1,
        compatibility_date: D1_PROBE_COMPATIBILITY_DATE_V1 as typeof D1_PROBE_COMPATIBILITY_DATE_V1,
        compatibility_flags: [] as const,
        annotations: {
            "workers/message": `${markerPrefix}:first-private-version`,
            "workers/tag": `${markerPrefix}:version`,
            "workers/triggered_by": "openbot-d1-probe-operator" as const,
        },
        bindings,
        modules: [
            {
                name: D1_PROBE_WORKER_MAIN_MODULE_V1,
                content_type: "application/javascript+module" as const,
                content_base64: canonicalBase64(moduleBytes),
            },
        ] as const,
    });
    try {
        const [moduleDigest, bindingDigest, artifactDigest, versionRequestDigest] = await Promise.all([
            globalThis.crypto.subtle.digest("SHA-256", arrayBuffer(moduleBytes)),
            digestCanonicalJsonV1("openbot.d1-probe.worker-binding-configuration.v1", {
                caller_script_name_commitment: input.generated_script_name_commitment,
                role: input.role,
                bindings: bindings as unknown as CanonicalJsonValueV1[],
            }),
            digestCanonicalJsonV1(
                "openbot.d1-probe.beta-worker-json-version.v1",
                body as unknown as CanonicalJsonValueV1
            ),
            digestCanonicalJsonV1("openbot.d1-probe.cloudflare-version-request.v1", {
                method: "POST",
                path: "/accounts/{account_id}/workers/workers/{worker_id}/versions",
                query: { deploy: false },
                body,
            } as unknown as CanonicalJsonValueV1),
        ]);
        if (bindingDigest === null || artifactDigest === null || versionRequestDigest === null) return null;
        return deepFreeze({
            schema_version: 1 as const,
            kind: "beta_worker_json_version_v1" as const,
            role: input.role,
            generated_script_name_commitment: input.generated_script_name_commitment,
            body,
            module_sha256: `sha256:${toHex(moduleDigest)}`,
            binding_configuration_digest: bindingDigest,
            artifact_digest: artifactDigest,
            version_request_digest: versionRequestDigest,
        });
    } catch {
        return null;
    } finally {
        moduleBytes.fill(0);
    }
};
