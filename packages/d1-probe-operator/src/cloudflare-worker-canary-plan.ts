import { z } from "zod";

import { digestCanonicalJsonV1, type CanonicalJsonValueV1 } from "@openbot/gate-attestation/internal";

import {
    D1ProbeCloudflareWorkerApiCanaryPlanV1Schema,
    type D1ProbeCloudflareWorkerApiCanaryPlanV1,
} from "./cloudflare-worker-interoperability-canary.js";
import { D1ProbeCommitmentKeyV1Schema } from "./contracts.js";

const KEY_ID_DOMAIN_V1 = "openbot.d1-probe.commitment-key-id.v1";
const PLAN_DIGEST_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-api-canary-plan.v1";
const PLAN_WINDOW_MS_V1 = 300_000;
const SUFFIX_ALPHABET_V1 = "abcdefghijklmnopqrstuvwxyz0123456789";
const SUFFIX_ACCEPTED_BYTE_LIMIT_V1 = 252;
const SUFFIX_RANDOM_BATCH_BYTES_V1 = 32;
const SUFFIX_RANDOM_BATCH_LIMIT_V1 = 8;

export const D1ProbeCloudflareWorkerApiCanaryPlanRequestV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("d1_probe_cloudflare_worker_api_canary_plan_request"),
        account_id: z.string().regex(/^[0-9a-f]{32}$/u),
    })
    .strict();

export type D1ProbeCloudflareWorkerApiCanaryPlanRequestV1 = z.infer<
    typeof D1ProbeCloudflareWorkerApiCanaryPlanRequestV1Schema
>;

export interface D1ProbeCloudflareWorkerApiCanaryPlanGeneratorDependenciesV1 {
    readonly now: () => number;
    readonly randomBytes: (byteLength: number) => Uint8Array;
}

export type GenerateD1ProbeCloudflareWorkerApiCanaryCommandDenialV1 =
    | "invalid_canary_plan_request"
    | "invalid_commitment_key"
    | "clock_unavailable"
    | "randomness_unavailable"
    | "digest_unavailable";

export interface D1ProbeCloudflareWorkerApiCanaryCommandV1 {
    readonly schema_version: 1;
    readonly kind: "d1_probe_cloudflare_worker_api_canary_command";
    readonly plan: D1ProbeCloudflareWorkerApiCanaryPlanV1;
}

const arrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const toHex = (bytes: Uint8Array): string => [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");

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

const takeRandomBytes = (
    dependencies: D1ProbeCloudflareWorkerApiCanaryPlanGeneratorDependenciesV1,
    byteLength: number
): Uint8Array | null => {
    try {
        const bytes = dependencies.randomBytes(byteLength);
        if (!(bytes instanceof Uint8Array) || bytes.byteLength !== byteLength) return null;
        return Uint8Array.from(bytes);
    } catch {
        return null;
    }
};

const generateSuffix = (dependencies: D1ProbeCloudflareWorkerApiCanaryPlanGeneratorDependenciesV1): string | null => {
    let suffix = "";
    for (let batch = 0; batch < SUFFIX_RANDOM_BATCH_LIMIT_V1 && suffix.length < 16; batch += 1) {
        const bytes = takeRandomBytes(dependencies, SUFFIX_RANDOM_BATCH_BYTES_V1);
        if (bytes === null) return null;
        for (const byte of bytes) {
            if (byte >= SUFFIX_ACCEPTED_BYTE_LIMIT_V1) continue;
            suffix += SUFFIX_ALPHABET_V1[byte % SUFFIX_ALPHABET_V1.length] ?? "";
            if (suffix.length === 16) break;
        }
        bytes.fill(0);
    }
    return suffix.length === 16 ? suffix : null;
};

const deriveCommitmentKeyId = async (hmacKeyInput: unknown): Promise<string | null> => {
    let parsed: ReturnType<typeof D1ProbeCommitmentKeyV1Schema.safeParse>;
    try {
        parsed = D1ProbeCommitmentKeyV1Schema.safeParse(hmacKeyInput);
    } catch {
        return null;
    }
    if (!parsed.success) return null;
    const raw = decodeBase64Url(parsed.data.hmac_key_base64url);
    if (raw === null) return null;
    if (raw.byteLength < 32 || raw.byteLength > 64) {
        raw.fill(0);
        return null;
    }
    let preimage: Uint8Array | null = null;
    try {
        const domain = new TextEncoder().encode(`${KEY_ID_DOMAIN_V1}\u0000`);
        preimage = new Uint8Array(domain.byteLength + raw.byteLength);
        preimage.set(domain);
        preimage.set(raw, domain.byteLength);
        const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", arrayBuffer(preimage)));
        return toHex(digest);
    } catch {
        return null;
    } finally {
        preimage?.fill(0);
        raw.fill(0);
    }
};

export const generateD1ProbeCloudflareWorkerApiCanaryCommandV1 = async (
    requestInput: unknown,
    hmacKeyInput: unknown,
    dependencies: D1ProbeCloudflareWorkerApiCanaryPlanGeneratorDependenciesV1
): Promise<
    | { readonly success: false; readonly code: GenerateD1ProbeCloudflareWorkerApiCanaryCommandDenialV1 }
    | { readonly success: true; readonly command: D1ProbeCloudflareWorkerApiCanaryCommandV1 }
> => {
    let request: D1ProbeCloudflareWorkerApiCanaryPlanRequestV1 | null = null;
    try {
        const parsed = D1ProbeCloudflareWorkerApiCanaryPlanRequestV1Schema.safeParse(requestInput);
        request = parsed.success ? parsed.data : null;
    } catch {
        request = null;
    }
    if (request === null) return { success: false, code: "invalid_canary_plan_request" };

    let now: number;
    try {
        now = dependencies.now();
    } catch {
        return { success: false, code: "clock_unavailable" };
    }
    if (!Number.isSafeInteger(now) || now < 0 || now + PLAN_WINDOW_MS_V1 > Number.MAX_SAFE_INTEGER) {
        return { success: false, code: "clock_unavailable" };
    }

    const commitmentKeyId = await deriveCommitmentKeyId(hmacKeyInput);
    if (commitmentKeyId === null) return { success: false, code: "invalid_commitment_key" };

    const operationBytes = takeRandomBytes(dependencies, 16);
    if (operationBytes === null) return { success: false, code: "randomness_unavailable" };
    const operationId = toHex(operationBytes);
    operationBytes.fill(0);
    const randomSuffix = generateSuffix(dependencies);
    if (randomSuffix === null) return { success: false, code: "randomness_unavailable" };

    const unsignedPlan = {
        schema_version: 1 as const,
        kind: "d1_probe_cloudflare_worker_api_canary_plan" as const,
        account_id: request.account_id,
        commitment_key_id_digest: commitmentKeyId,
        operation_id: operationId,
        random_suffix: randomSuffix,
        script_name: `openbot-d1-probe-canary-${randomSuffix}`,
        markers: {
            ownership_tag: `openbot-canary-owner-${operationId}`,
            version_tag: `openbot-canary-version-${operationId}`,
            version_message: `openbot canary version ${operationId}`,
            deployment_message: `openbot canary deployment ${operationId}`,
        },
        compatibility_date: "2026-08-22" as const,
        not_before_ms: now,
        expires_at_ms: now + PLAN_WINDOW_MS_V1,
        authoritative: false as const,
        eligible_for_attestation: false as const,
        lifecycle_advance_allowed: false as const,
        gate_promotion_allowed: false as const,
    };
    const planDigest = await digestCanonicalJsonV1(PLAN_DIGEST_DOMAIN_V1, unsignedPlan as CanonicalJsonValueV1);
    if (planDigest === null) return { success: false, code: "digest_unavailable" };
    const plan = D1ProbeCloudflareWorkerApiCanaryPlanV1Schema.safeParse({
        ...unsignedPlan,
        plan_digest: planDigest,
    });
    if (!plan.success) return { success: false, code: "digest_unavailable" };
    return {
        success: true,
        command: {
            schema_version: 1,
            kind: "d1_probe_cloudflare_worker_api_canary_command",
            plan: plan.data,
        },
    };
};
