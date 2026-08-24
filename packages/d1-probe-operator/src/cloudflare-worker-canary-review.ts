import { z } from "zod";

import {
    canonicalizeJsonV1,
    digestCanonicalJsonV1,
    type CanonicalJsonValueV1,
} from "@openbot/gate-attestation/internal";

import {
    D1ProbeCloudflareWorkerApiCanaryPlanV1Schema,
    type D1ProbeCloudflareWorkerApiCanaryPlanV1,
} from "./cloudflare-worker-interoperability-canary.js";

const DigestV1Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const AccountIdV1Schema = z.string().regex(/^[0-9a-f]{32}$/u);
const IdentifierV1Schema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const UuidV1Schema = z.string().uuid();
const SafeTimeV1Schema = z.number().int().safe().nonnegative();

const KEY_ID_DOMAIN_V1 = "openbot.d1-probe.commitment-key-id.v1";
const PLAN_DIGEST_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-api-canary-plan.v1";
const REQUEST_DIGEST_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-api-canary-request.v1";
const TRANSCRIPT_DIGEST_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-api-canary-transcript.v1";
const FIXED_MODULE_SOURCE_V1 = ["export default { fet", "ch() { return new Response(null, { status: 404 }); } };"].join(
    ""
);
const FIXED_MODULE_SHA256_V1 = "af90db18d8d6707e755a035fc78d7ebf066147edfaaeb22b95c52fbb654be7db";

const TranscriptEntryV1Schema = z
    .object({
        sequence: z.number().int().min(1).max(20),
        method: z.enum(["GET", "POST", "DELETE"]),
        path_digest: DigestV1Schema,
        request_digest: DigestV1Schema,
        response_digest: DigestV1Schema,
        status: z.number().int().min(100).max(599),
        observed_at_ms: SafeTimeV1Schema,
    })
    .strict();

const SuccessfulResultV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("untrusted_d1_probe_cloudflare_worker_api_canary_result"),
        status: z.literal("observed_candidate"),
        stage: z.literal("worker_absence_readback"),
        planned_worker_name: z.string().regex(/^openbot-d1-probe-canary-[a-z0-9]{16}$/u),
        plan_digest: DigestV1Schema,
        commitment_key_id_digest: DigestV1Schema,
        attempt_tag_commitment: DigestV1Schema,
        account_id_commitment: DigestV1Schema,
        worker_id_commitment: DigestV1Schema,
        version_id_commitment: DigestV1Schema,
        deployment_id_commitment: DigestV1Schema,
        fixed_module_sha256: z.literal(FIXED_MODULE_SHA256_V1),
        mutation_attempts: z
            .object({
                shell_create: z.literal(1),
                version_create: z.literal(1),
                deployment_create: z.literal(1),
                worker_delete: z.literal(1),
            })
            .strict(),
        cleanup_status: z.literal("control_plane_absence_observed"),
        transcript: z.array(TranscriptEntryV1Schema).length(20),
        transcript_digest: DigestV1Schema,
        runtime_identity_verified: z.literal(false),
        caller_mutation_authority: z.literal(false),
        authoritative: z.literal(false),
        eligible_for_upload: z.literal(false),
        eligible_for_attestation: z.literal(false),
        lifecycle_advance_allowed: z.literal(false),
        gate_promotion_allowed: z.literal(false),
    })
    .strict();

const ReviewContextV1Schema = z
    .object({
        plan: D1ProbeCloudflareWorkerApiCanaryPlanV1Schema,
        hmac_key_base64url: z.string().regex(/^[A-Za-z0-9_-]{43,86}$/u),
        account_id: AccountIdV1Schema,
        worker_id: IdentifierV1Schema,
        version_id: UuidV1Schema,
        deployment_id: UuidV1Schema,
        attempt_tag: z.string().regex(/^openbot-canary-attempt-[0-9a-f]{32}$/u),
    })
    .strict();

export type D1ProbeCloudflareWorkerCanaryReviewDenialV1 =
    | "invalid_review_context"
    | "invalid_canary_result"
    | "plan_context_mismatch"
    | "commitment_context_mismatch"
    | "transcript_sequence_mismatch"
    | "transcript_digest_mismatch";

export interface D1ProbeCloudflareWorkerCanaryReviewContextV1 {
    readonly plan: D1ProbeCloudflareWorkerApiCanaryPlanV1;
    readonly hmac_key_base64url: string;
    readonly account_id: string;
    readonly worker_id: string;
    readonly version_id: string;
    readonly deployment_id: string;
    readonly attempt_tag: string;
}

export interface D1ProbeCloudflareWorkerCanaryOfflineReviewV1 {
    readonly schema_version: 1;
    readonly kind: "d1_probe_cloudflare_worker_api_canary_offline_review";
    readonly status: "eligible_for_human_review";
    readonly plan_digest: string;
    readonly commitment_key_id_digest: string;
    readonly transcript_digest: string;
    readonly request_claim_sequence_matches: true;
    readonly operator_context_commitment_claims_match: true;
    readonly cleanup_absence_claim_shape_matches: true;
    readonly response_digest_claims_in_transcript_projection: true;
    readonly response_digests_independently_resolved: false;
    readonly adjudicated: false;
    readonly runtime_identity_verified: false;
    readonly authoritative: false;
    readonly eligible_for_upload: false;
    readonly eligible_for_attestation: false;
    readonly lifecycle_advance_allowed: false;
    readonly gate_promotion_allowed: false;
}

const arrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const toHex = (value: ArrayBuffer): string =>
    [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");

const decodeBase64Url = (value: string): Uint8Array | null => {
    try {
        const padding = "=".repeat((4 - (value.length % 4)) % 4);
        const binary = globalThis.atob(value.replace(/-/gu, "+").replace(/_/gu, "/") + padding);
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        const canonical = globalThis
            .btoa(String.fromCharCode(...bytes))
            .replace(/=/gu, "")
            .replace(/\+/gu, "-")
            .replace(/\//gu, "_");
        return canonical === value ? bytes : null;
    } catch {
        return null;
    }
};

const sha256 = async (value: string): Promise<string> =>
    toHex(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

const deriveKeyId = async (raw: Uint8Array): Promise<string> => {
    const domain = new TextEncoder().encode(`${KEY_ID_DOMAIN_V1}\u0000`);
    const preimage = new Uint8Array(domain.byteLength + raw.byteLength);
    preimage.set(domain);
    preimage.set(raw, domain.byteLength);
    try {
        return toHex(await globalThis.crypto.subtle.digest("SHA-256", arrayBuffer(preimage)));
    } finally {
        preimage.fill(0);
    }
};

const hmacIdentity = async (key: CryptoKey, domain: string, value: string): Promise<string> =>
    toHex(
        await globalThis.crypto.subtle.sign(
            "HMAC",
            key,
            new TextEncoder().encode(`${domain}\u0000${canonicalizeJsonV1(value)}`)
        )
    );

const canonicalRequest = (method: string, path: string, body?: CanonicalJsonValueV1) => ({
    method,
    path,
    ...(body === undefined ? {} : { body: canonicalizeJsonV1(body) }),
});

type ExpectedRequestV1 = {
    readonly method: "GET" | "POST" | "DELETE";
    readonly status: 200 | 404;
    readonly path: string;
    readonly body?: CanonicalJsonValueV1;
};

const expectedRequests = (context: z.infer<typeof ReviewContextV1Schema>): readonly ExpectedRequestV1[] => {
    const {
        plan,
        account_id: accountId,
        worker_id: workerId,
        version_id: versionId,
        deployment_id: deploymentId,
    } = context;
    const listWorkers = `/accounts/${accountId}/workers/workers?page=1&per_page=100&order_by=name&order=asc`;
    const workers = `/accounts/${accountId}/workers/workers`;
    const worker = `${workers}/${workerId}`;
    const subdomain = `/accounts/${accountId}/workers/scripts/${plan.script_name}/subdomain`;
    const versions = `${worker}/versions?page=1&per_page=100`;
    const deployments = `/accounts/${accountId}/workers/scripts/${plan.script_name}/deployments`;
    const shellBody = {
        name: plan.script_name,
        logpush: false,
        observability: { enabled: false },
        subdomain: { enabled: false, previews_enabled: false },
        tags: [plan.markers.ownership_tag, context.attempt_tag],
        tail_consumers: [],
    } satisfies CanonicalJsonValueV1;
    const versionBody = {
        main_module: "entry.js",
        compatibility_date: "2026-08-22",
        compatibility_flags: [],
        annotations: {
            "workers/message": plan.markers.version_message,
            "workers/tag": plan.markers.version_tag,
        },
        bindings: [],
        modules: [
            {
                name: "entry.js",
                content_type: "application/javascript+module",
                content_base64: globalThis.btoa(FIXED_MODULE_SOURCE_V1),
            },
        ],
    } satisfies CanonicalJsonValueV1;
    const deploymentBody = {
        strategy: "percentage",
        annotations: { "workers/message": plan.markers.deployment_message },
        versions: [{ version_id: versionId, percentage: 100 }],
    } satisfies CanonicalJsonValueV1;

    return [
        { method: "GET", status: 200, path: listWorkers },
        { method: "POST", status: 200, path: workers, body: shellBody },
        { method: "GET", status: 200, path: worker },
        { method: "GET", status: 200, path: subdomain },
        { method: "GET", status: 200, path: versions },
        { method: "GET", status: 200, path: deployments },
        { method: "POST", status: 200, path: `${worker}/versions?deploy=false`, body: versionBody },
        { method: "GET", status: 200, path: versions },
        { method: "GET", status: 200, path: `${worker}/versions/${versionId}?include=modules` },
        {
            method: "GET",
            status: 200,
            path: `/accounts/${accountId}/workers/scripts/${plan.script_name}/versions/${versionId}`,
        },
        { method: "GET", status: 200, path: deployments },
        { method: "POST", status: 200, path: `${deployments}?force=false`, body: deploymentBody },
        { method: "GET", status: 200, path: deployments },
        { method: "GET", status: 200, path: `${deployments}/${deploymentId}` },
        { method: "GET", status: 200, path: worker },
        { method: "GET", status: 200, path: subdomain },
        { method: "GET", status: 200, path: worker },
        { method: "DELETE", status: 200, path: worker },
        { method: "GET", status: 404, path: worker },
        { method: "GET", status: 200, path: listWorkers },
    ];
};

const parseStrict = <T>(schema: z.ZodType<T>, input: unknown): T | null => {
    try {
        const parsed = schema.safeParse(input);
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
};

export const reviewD1ProbeCloudflareWorkerApiCanaryResultV1 = async (
    resultInput: unknown,
    contextInput: unknown
): Promise<
    | { readonly success: false; readonly code: D1ProbeCloudflareWorkerCanaryReviewDenialV1 }
    | { readonly success: true; readonly review: D1ProbeCloudflareWorkerCanaryOfflineReviewV1 }
> => {
    const context = parseStrict(ReviewContextV1Schema, contextInput);
    if (context === null) return { success: false, code: "invalid_review_context" };
    const result = parseStrict(SuccessfulResultV1Schema, resultInput);
    if (result === null) return { success: false, code: "invalid_canary_result" };

    try {
        const { plan_digest: _claimedPlanDigest, ...unsignedPlan } = context.plan;
        const planDigest = await digestCanonicalJsonV1(
            PLAN_DIGEST_DOMAIN_V1,
            unsignedPlan as unknown as CanonicalJsonValueV1
        );
        if (
            planDigest === null ||
            planDigest !== context.plan.plan_digest ||
            context.account_id !== context.plan.account_id ||
            result.plan_digest !== context.plan.plan_digest ||
            result.planned_worker_name !== context.plan.script_name
        ) {
            return { success: false, code: "plan_context_mismatch" };
        }

        const rawKey = decodeBase64Url(context.hmac_key_base64url);
        if (rawKey === null || rawKey.byteLength < 32 || rawKey.byteLength > 64) {
            rawKey?.fill(0);
            return { success: false, code: "invalid_review_context" };
        }
        let keyId: string;
        let hmacKey: CryptoKey;
        try {
            keyId = await deriveKeyId(rawKey);
            hmacKey = await globalThis.crypto.subtle.importKey(
                "raw",
                arrayBuffer(rawKey),
                { name: "HMAC", hash: "SHA-256" },
                false,
                ["sign"]
            );
        } finally {
            rawKey.fill(0);
        }
        const expectedCommitments = {
            attempt_tag_commitment: await hmacIdentity(
                hmacKey,
                "openbot.identity.cloudflare_worker_canary_attempt_tag.v1",
                context.attempt_tag
            ),
            account_id_commitment: await hmacIdentity(
                hmacKey,
                "openbot.identity.cloudflare_account_id.v1",
                context.account_id
            ),
            worker_id_commitment: await hmacIdentity(
                hmacKey,
                "openbot.identity.cloudflare_worker_script_id.v1",
                context.worker_id
            ),
            version_id_commitment: await hmacIdentity(
                hmacKey,
                "openbot.identity.cloudflare_worker_version_id.v1",
                context.version_id
            ),
            deployment_id_commitment: await hmacIdentity(
                hmacKey,
                "openbot.identity.cloudflare_worker_deployment_id.v1",
                context.deployment_id
            ),
        };
        if (
            keyId !== context.plan.commitment_key_id_digest ||
            keyId !== result.commitment_key_id_digest ||
            Object.entries(expectedCommitments).some(
                ([field, expected]) => result[field as keyof typeof expectedCommitments] !== expected
            )
        ) {
            return { success: false, code: "commitment_context_mismatch" };
        }

        const requests = expectedRequests(context);
        for (const [index, entry] of result.transcript.entries()) {
            const expected = requests[index];
            if (
                expected === undefined ||
                entry.sequence !== index + 1 ||
                entry.method !== expected.method ||
                entry.status !== expected.status ||
                entry.observed_at_ms < context.plan.not_before_ms ||
                entry.observed_at_ms >= context.plan.expires_at_ms ||
                (index > 0 && entry.observed_at_ms < (result.transcript[index - 1]?.observed_at_ms ?? 0)) ||
                entry.path_digest !== (await sha256(expected.path))
            ) {
                return { success: false, code: "transcript_sequence_mismatch" };
            }
            const expectedRequestDigest = await digestCanonicalJsonV1(
                REQUEST_DIGEST_DOMAIN_V1,
                canonicalRequest(expected.method, expected.path, expected.body) as CanonicalJsonValueV1
            );
            if (expectedRequestDigest === null || entry.request_digest !== expectedRequestDigest) {
                return { success: false, code: "transcript_sequence_mismatch" };
            }
        }

        const { transcript_digest: _claimedTranscriptDigest, ...transcriptProjection } = result;
        const transcriptDigest = await digestCanonicalJsonV1(
            TRANSCRIPT_DIGEST_DOMAIN_V1,
            transcriptProjection as unknown as CanonicalJsonValueV1
        );
        if (transcriptDigest === null || transcriptDigest !== result.transcript_digest) {
            return { success: false, code: "transcript_digest_mismatch" };
        }

        return {
            success: true,
            review: {
                schema_version: 1,
                kind: "d1_probe_cloudflare_worker_api_canary_offline_review",
                status: "eligible_for_human_review",
                plan_digest: result.plan_digest,
                commitment_key_id_digest: result.commitment_key_id_digest,
                transcript_digest: result.transcript_digest,
                request_claim_sequence_matches: true,
                operator_context_commitment_claims_match: true,
                cleanup_absence_claim_shape_matches: true,
                response_digest_claims_in_transcript_projection: true,
                response_digests_independently_resolved: false,
                adjudicated: false,
                runtime_identity_verified: false,
                authoritative: false,
                eligible_for_upload: false,
                eligible_for_attestation: false,
                lifecycle_advance_allowed: false,
                gate_promotion_allowed: false,
            },
        };
    } catch {
        return { success: false, code: "invalid_review_context" };
    }
};
