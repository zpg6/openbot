import { digestCanonicalJsonV1, type CanonicalJsonValueV1 } from "@openbot/gate-attestation/internal";
import { z } from "zod";

import {
    D1ProbeCloudflareWorkerApiCanaryPlanV1Schema,
    type D1ProbeCloudflareWorkerApiCanaryPlanV1,
} from "./cloudflare-worker-interoperability-canary.js";

const DigestV1Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const IdentifierV1Schema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const SafeTimeV1Schema = z.number().int().safe().nonnegative();
const PLAN_DIGEST_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-api-canary-plan.v1";
const CLEANUP_GRACE_DIGEST_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-api-canary-cleanup-grace.v1";

export const D1_PROBE_CLOUDFLARE_WORKER_CANARY_POST_PLAN_CLEANUP_GRACE_MS_V1 = 600_000;
export const D1_PROBE_CLOUDFLARE_WORKER_CANARY_MAX_CLEANUP_GRACE_SPAN_MS_V1 = 900_000;
export const D1_PROBE_CLOUDFLARE_WORKER_CANARY_CLEANUP_GRACE_AUTHORITY_V1 = false as const;

export const D1ProbeCloudflareWorkerCanaryCleanupGraceV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("d1_probe_cloudflare_worker_api_canary_cleanup_grace"),
        plan_digest: DigestV1Schema,
        worker_id: IdentifierV1Schema.nullable(),
        worker_id_commitment: DigestV1Schema.nullable(),
        attempt_tag_commitment: DigestV1Schema,
        automatic_cleanup_not_before_ms: SafeTimeV1Schema,
        automatic_cleanup_expires_at_ms: SafeTimeV1Schema,
        authoritative: z.literal(false),
        eligible_for_attestation: z.literal(false),
        lifecycle_advance_allowed: z.literal(false),
        gate_promotion_allowed: z.literal(false),
        cleanup_grace_digest: DigestV1Schema,
    })
    .strict()
    .superRefine((grace, context) => {
        if (
            grace.automatic_cleanup_expires_at_ms <= grace.automatic_cleanup_not_before_ms ||
            grace.automatic_cleanup_expires_at_ms - grace.automatic_cleanup_not_before_ms >
                D1_PROBE_CLOUDFLARE_WORKER_CANARY_MAX_CLEANUP_GRACE_SPAN_MS_V1
        ) {
            context.addIssue({ code: "custom", message: "invalid cleanup grace window" });
        }
        if ((grace.worker_id === null) !== (grace.worker_id_commitment === null)) {
            context.addIssue({ code: "custom", message: "worker ID and commitment must be retained together" });
        }
    });

export type D1ProbeCloudflareWorkerCanaryCleanupGraceV1 = z.infer<
    typeof D1ProbeCloudflareWorkerCanaryCleanupGraceV1Schema
>;

export const D1ProbeCloudflareWorkerCanaryCleanupCommandV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("d1_probe_cloudflare_worker_api_canary_cleanup_command"),
        plan: D1ProbeCloudflareWorkerApiCanaryPlanV1Schema,
        cleanup_grace: D1ProbeCloudflareWorkerCanaryCleanupGraceV1Schema,
    })
    .strict();

export type D1ProbeCloudflareWorkerCanaryCleanupCommandV1 = z.infer<
    typeof D1ProbeCloudflareWorkerCanaryCleanupCommandV1Schema
>;

export const validateD1ProbeCloudflareWorkerCanaryPlanForCleanupV1 = async (
    input: unknown
): Promise<D1ProbeCloudflareWorkerApiCanaryPlanV1 | null> => {
    try {
        const parsed = D1ProbeCloudflareWorkerApiCanaryPlanV1Schema.safeParse(input);
        if (!parsed.success) return null;
        const { plan_digest: _claimed, ...unsigned } = parsed.data;
        const digest = await digestCanonicalJsonV1(PLAN_DIGEST_DOMAIN_V1, unsigned as CanonicalJsonValueV1);
        return digest === parsed.data.plan_digest ? parsed.data : null;
    } catch {
        return null;
    }
};

export const validateD1ProbeCloudflareWorkerCanaryCleanupGraceV1 = async (
    input: unknown,
    planInput: unknown
): Promise<D1ProbeCloudflareWorkerCanaryCleanupGraceV1 | null> => {
    try {
        const plan = await validateD1ProbeCloudflareWorkerCanaryPlanForCleanupV1(planInput);
        if (plan === null) return null;
        const parsed = D1ProbeCloudflareWorkerCanaryCleanupGraceV1Schema.safeParse(input);
        if (!parsed.success) return null;
        const { cleanup_grace_digest: _claimed, ...unsigned } = parsed.data;
        const digest = await digestCanonicalJsonV1(CLEANUP_GRACE_DIGEST_DOMAIN_V1, unsigned as CanonicalJsonValueV1);
        return digest === parsed.data.cleanup_grace_digest &&
            parsed.data.plan_digest === plan.plan_digest &&
            parsed.data.automatic_cleanup_not_before_ms === plan.not_before_ms &&
            parsed.data.automatic_cleanup_expires_at_ms ===
                plan.expires_at_ms + D1_PROBE_CLOUDFLARE_WORKER_CANARY_POST_PLAN_CLEANUP_GRACE_MS_V1
            ? parsed.data
            : null;
    } catch {
        return null;
    }
};

export type CompileD1ProbeCloudflareWorkerCanaryCleanupCommandDenialV1 =
    "invalid_canary_plan" | "invalid_cleanup_identity" | "cleanup_grace_unavailable";

export const compileD1ProbeCloudflareWorkerCanaryCleanupCommandV1 = async (
    planInput: unknown,
    identityInput: unknown
): Promise<
    | { readonly success: false; readonly code: CompileD1ProbeCloudflareWorkerCanaryCleanupCommandDenialV1 }
    | { readonly success: true; readonly command: D1ProbeCloudflareWorkerCanaryCleanupCommandV1 }
> => {
    const plan = await validateD1ProbeCloudflareWorkerCanaryPlanForCleanupV1(planInput);
    if (plan === null) return { success: false, code: "invalid_canary_plan" };
    const identitySchema = z
        .object({
            worker_id: IdentifierV1Schema.nullable(),
            worker_id_commitment: DigestV1Schema.nullable(),
            attempt_tag_commitment: DigestV1Schema,
        })
        .strict()
        .superRefine((identity, context) => {
            if ((identity.worker_id === null) !== (identity.worker_id_commitment === null)) {
                context.addIssue({ code: "custom", message: "worker ID and commitment must be retained together" });
            }
        });
    let identity: ReturnType<typeof identitySchema.safeParse>;
    try {
        identity = identitySchema.safeParse(identityInput);
    } catch {
        return { success: false, code: "invalid_cleanup_identity" };
    }
    if (!identity.success) return { success: false, code: "invalid_cleanup_identity" };
    if (
        plan.expires_at_ms + D1_PROBE_CLOUDFLARE_WORKER_CANARY_POST_PLAN_CLEANUP_GRACE_MS_V1 >
        Number.MAX_SAFE_INTEGER
    ) {
        return { success: false, code: "cleanup_grace_unavailable" };
    }
    const unsigned = {
        schema_version: 1 as const,
        kind: "d1_probe_cloudflare_worker_api_canary_cleanup_grace" as const,
        plan_digest: plan.plan_digest,
        ...identity.data,
        automatic_cleanup_not_before_ms: plan.not_before_ms,
        automatic_cleanup_expires_at_ms:
            plan.expires_at_ms + D1_PROBE_CLOUDFLARE_WORKER_CANARY_POST_PLAN_CLEANUP_GRACE_MS_V1,
        authoritative: false as const,
        eligible_for_attestation: false as const,
        lifecycle_advance_allowed: false as const,
        gate_promotion_allowed: false as const,
    };
    const cleanupGraceDigest = await digestCanonicalJsonV1(
        CLEANUP_GRACE_DIGEST_DOMAIN_V1,
        unsigned as CanonicalJsonValueV1
    );
    if (cleanupGraceDigest === null) return { success: false, code: "cleanup_grace_unavailable" };
    return {
        success: true,
        command: {
            schema_version: 1,
            kind: "d1_probe_cloudflare_worker_api_canary_cleanup_command",
            plan,
            cleanup_grace: { ...unsigned, cleanup_grace_digest: cleanupGraceDigest },
        },
    };
};
