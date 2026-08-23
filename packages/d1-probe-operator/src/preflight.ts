import {
    canonicalizeJsonV1,
    digestCanonicalJsonV1,
    type CanonicalJsonValueV1,
} from "@openbot/gate-attestation/internal";

import {
    D1_PROBE_CLEANUP_STEPS_V1,
    D1_PROBE_COMPATIBILITY_DATE_V1,
    D1_PROBE_CREATE_STEPS_V1,
    D1_PROBE_RESOURCE_KINDS_V1,
    D1_PROBE_RESOURCE_PREFIX_V1,
    D1_PROBE_WRANGLER_VERSION_V1,
    D1ProbeCommitmentKeyV1Schema,
    D1ProbePreflightPlanV1Schema,
    D1ProbePreflightRequestV1Schema,
    type D1ProbePreflightPlanV1,
} from "./contracts.js";

const encoder = new TextEncoder();

const arrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

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

const toHex = (bytes: ArrayBuffer): string =>
    [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");

const hmac = async (key: CryptoKey, domain: string, value: CanonicalJsonValueV1): Promise<string | null> => {
    try {
        const bytes = encoder.encode(`${domain}\u0000${canonicalizeJsonV1(value)}`);
        return toHex(await globalThis.crypto.subtle.sign("HMAC", key, arrayBuffer(bytes)));
    } catch {
        return null;
    }
};

export type D1ProbePreflightDenialV1 =
    | "invalid_preflight_request"
    | "invalid_commitment_key"
    | "commitment_unavailable"
    | "plan_digest_unavailable"
    | "invalid_preflight_plan";

export const compileD1ProbePreflightPlanV1 = async (
    requestInput: unknown,
    keyInput: unknown
): Promise<{ success: true; plan: D1ProbePreflightPlanV1 } | { success: false; code: D1ProbePreflightDenialV1 }> => {
    let request: ReturnType<typeof D1ProbePreflightRequestV1Schema.safeParse>;
    let keyRecord: ReturnType<typeof D1ProbeCommitmentKeyV1Schema.safeParse>;
    try {
        request = D1ProbePreflightRequestV1Schema.safeParse(requestInput);
        keyRecord = D1ProbeCommitmentKeyV1Schema.safeParse(keyInput);
    } catch {
        return { success: false, code: "invalid_preflight_request" };
    }
    if (!request.success) return { success: false, code: "invalid_preflight_request" };
    if (!keyRecord.success) return { success: false, code: "invalid_commitment_key" };
    const rawKey = decodeBase64Url(keyRecord.data.hmac_key_base64url);
    if (rawKey === null || rawKey.byteLength < 32 || rawKey.byteLength > 64) {
        return { success: false, code: "invalid_commitment_key" };
    }
    let key: CryptoKey;
    try {
        key = await globalThis.crypto.subtle.importKey(
            "raw",
            arrayBuffer(rawKey),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
        );
    } catch {
        return { success: false, code: "invalid_commitment_key" };
    }

    const accountCommitment = await hmac(key, "openbot.identity.cloudflare_account_id.v1", request.data.account_id);
    const zoneCommitment = await hmac(key, "openbot.identity.cloudflare_zone_id.v1", request.data.zone_id);
    const denyListCommitment = await hmac(
        key,
        "openbot.d1-probe.operator-database-deny-list.v1",
        [...request.data.operator_database_deny_list].sort()
    );
    const denyIdCommitments = await Promise.all(
        [...request.data.operator_database_deny_list]
            .sort()
            .map(databaseId => hmac(key, "openbot.identity.cloudflare_d1_database_id.v1", databaseId))
    );
    const resources = await Promise.all(
        D1_PROBE_RESOURCE_KINDS_V1.map(async resourceKind => {
            const generatedName = `${D1_PROBE_RESOURCE_PREFIX_V1}${request.data.resource_suffixes[resourceKind]}`;
            return {
                resource_kind: resourceKind,
                generated_name: generatedName,
                generated_name_commitment: await hmac(
                    key,
                    `openbot.d1-probe.generated-resource-name.${resourceKind}.v1`,
                    generatedName
                ),
            };
        })
    );
    if (
        accountCommitment === null ||
        zoneCommitment === null ||
        denyListCommitment === null ||
        denyIdCommitments.some(commitment => commitment === null) ||
        resources.some(resource => resource.generated_name_commitment === null)
    ) {
        return { success: false, code: "commitment_unavailable" };
    }
    const unsignedPlan = {
        schema_version: 1 as const,
        kind: "d1_probe_preflight_plan" as const,
        authoritative: false as const,
        deploy_performed: false as const,
        gate_promotion_allowed: false as const,
        resource_prefix: D1_PROBE_RESOURCE_PREFIX_V1,
        compatibility_date: D1_PROBE_COMPATIBILITY_DATE_V1,
        wrangler_version: D1_PROBE_WRANGLER_VERSION_V1,
        account_id_commitment: accountCommitment,
        zone_id_commitment: zoneCommitment,
        installation_digest: request.data.installation_digest,
        environment_digest: request.data.environment_digest,
        configuration_digest: request.data.configuration_digest,
        probe_definition_digest: request.data.probe_definition_digest,
        collector_build_digest: request.data.collector_build_digest,
        commitment_key_id_digest: request.data.commitment_key_id_digest,
        operator_database_deny_list_commitment: denyListCommitment,
        operator_database_deny_id_commitments: (denyIdCommitments as string[]).sort(),
        resources: resources.map(resource => ({
            ...resource,
            generated_name_commitment: resource.generated_name_commitment as string,
        })),
        create_steps: [...D1_PROBE_CREATE_STEPS_V1],
        cleanup_steps: [...D1_PROBE_CLEANUP_STEPS_V1],
    };
    const planDigest = await digestCanonicalJsonV1(
        "openbot.d1-probe-preflight-plan.v1",
        unsignedPlan as CanonicalJsonValueV1
    );
    if (planDigest === null) return { success: false, code: "plan_digest_unavailable" };
    let plan: ReturnType<typeof D1ProbePreflightPlanV1Schema.safeParse>;
    try {
        plan = D1ProbePreflightPlanV1Schema.safeParse({ ...unsignedPlan, plan_digest: planDigest });
    } catch {
        return { success: false, code: "invalid_preflight_plan" };
    }
    return plan.success ? { success: true, plan: plan.data } : { success: false, code: "invalid_preflight_plan" };
};
