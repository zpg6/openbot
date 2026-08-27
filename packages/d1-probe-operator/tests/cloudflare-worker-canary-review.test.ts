import {
    canonicalizeJsonV1,
    digestCanonicalJsonV1,
    type CanonicalJsonValueV1,
} from "@openbot/gate-attestation/internal";
import { describe, expect, it } from "vitest";

import { reviewD1ProbeCloudflareWorkerApiCanaryResultV1 } from "../src/cloudflare-worker-canary-review.js";

const accountId = "a".repeat(32);
const operationId = "b".repeat(32);
const randomSuffix = "0000000000000001";
const scriptName = `openbot-d1-probe-canary-${randomSuffix}`;
const workerId = "worker-fixed-immutable-id";
const versionId = "22222222-2222-4222-8222-222222222222";
const deploymentId = "33333333-3333-4333-8333-333333333333";
const attemptTag = `openbot-canary-attempt-${"0c".repeat(16)}`;
const hmacKeyBase64Url = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const notBefore = Date.parse("2026-08-24T15:00:00.000Z");
const expiresAt = notBefore + 60_000;
const fixedModuleSource = ["export default { fet", "ch() { return new Response(null, { status: 404 }); } };"].join("");
const fixedModuleSha256 = "af90db18d8d6707e755a035fc78d7ebf066147edfaaeb22b95c52fbb654be7db";

const markers = {
    ownership_tag: `openbot-canary-owner-${operationId}`,
    version_tag: `openbot-canary-version-${operationId}`,
    version_message: `openbot canary version ${operationId}`,
    deployment_message: `openbot canary deployment ${operationId}`,
} as const;

const arrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const toHex = (value: ArrayBuffer): string =>
    [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");

const sha256 = async (value: string): Promise<string> =>
    toHex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));

const rawKey = (): Uint8Array =>
    Uint8Array.from(atob(hmacKeyBase64Url.replace(/-/gu, "+").replace(/_/gu, "/")), character =>
        character.charCodeAt(0)
    );

const keyId = async (): Promise<string> => {
    const raw = rawKey();
    const domain = new TextEncoder().encode("openbot.d1-probe.commitment-key-id.v1\u0000");
    const preimage = new Uint8Array(domain.byteLength + raw.byteLength);
    preimage.set(domain);
    preimage.set(raw, domain.byteLength);
    return toHex(await crypto.subtle.digest("SHA-256", preimage));
};

const hmac = async (domain: string, value: string): Promise<string> => {
    const imported = await crypto.subtle.importKey(
        "raw",
        arrayBuffer(rawKey()),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    return toHex(
        await crypto.subtle.sign(
            "HMAC",
            imported,
            new TextEncoder().encode(`${domain}\u0000${canonicalizeJsonV1(value)}`)
        )
    );
};

const makePlan = async () => {
    const projection = {
        schema_version: 1 as const,
        kind: "d1_probe_cloudflare_worker_api_canary_plan" as const,
        account_id: accountId,
        commitment_key_id_digest: await keyId(),
        operation_id: operationId,
        random_suffix: randomSuffix,
        script_name: scriptName,
        markers,
        compatibility_date: "2026-08-22" as const,
        not_before_ms: notBefore,
        expires_at_ms: expiresAt,
        authoritative: false as const,
        eligible_for_attestation: false as const,
        lifecycle_advance_allowed: false as const,
        gate_promotion_allowed: false as const,
    };
    const planDigest = await digestCanonicalJsonV1(
        "openbot.d1-probe.cloudflare-worker-api-canary-plan.v1",
        projection as CanonicalJsonValueV1
    );
    if (planDigest === null) throw new Error("plan digest unavailable");
    return { ...projection, plan_digest: planDigest };
};

type RequestFixture = {
    readonly method: "GET" | "POST" | "DELETE";
    readonly status: 200 | 404;
    readonly path: string;
    readonly body?: CanonicalJsonValueV1;
};

const requests = (): readonly RequestFixture[] => {
    const listWorkers = `/accounts/${accountId}/workers/workers?page=1&per_page=100&order_by=name&order=asc`;
    const workers = `/accounts/${accountId}/workers/workers`;
    const worker = `${workers}/${workerId}`;
    const subdomain = `/accounts/${accountId}/workers/scripts/${scriptName}/subdomain`;
    const versions = `${worker}/versions?page=1&per_page=100`;
    const deployments = `/accounts/${accountId}/workers/scripts/${scriptName}/deployments`;
    const shellBody = {
        name: scriptName,
        logpush: false,
        observability: { enabled: false },
        subdomain: { enabled: false, previews_enabled: false },
        tags: [markers.ownership_tag, attemptTag],
        tail_consumers: [],
    } satisfies CanonicalJsonValueV1;
    const versionBody = {
        main_module: "entry.js",
        compatibility_date: "2026-08-22",
        compatibility_flags: [],
        annotations: {
            "workers/message": markers.version_message,
            "workers/tag": markers.version_tag,
        },
        bindings: [],
        modules: [
            {
                name: "entry.js",
                content_type: "application/javascript+module",
                content_base64: btoa(fixedModuleSource),
            },
        ],
    } satisfies CanonicalJsonValueV1;
    const deploymentBody = {
        strategy: "percentage",
        annotations: { "workers/message": markers.deployment_message },
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
            path: `${workers.replace("/workers/workers", "/workers/scripts")}/${scriptName}/versions/${versionId}`,
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

const makeFixture = async () => {
    const plan = await makePlan();
    const transcript = await Promise.all(
        requests().map(async (request, index) => {
            const requestProjection = {
                method: request.method,
                path: request.path,
                ...(request.body === undefined ? {} : { body: canonicalizeJsonV1(request.body) }),
            };
            const requestDigest = await digestCanonicalJsonV1(
                "openbot.d1-probe.cloudflare-worker-api-canary-request.v1",
                requestProjection as CanonicalJsonValueV1
            );
            if (requestDigest === null) throw new Error("request digest unavailable");
            return {
                sequence: index + 1,
                method: request.method,
                path_digest: await sha256(request.path),
                request_digest: requestDigest,
                response_digest: await sha256(`response-${index + 1}`),
                status: request.status,
                observed_at_ms: notBefore + 1_000 + index,
            };
        })
    );
    const projection = {
        schema_version: 1 as const,
        kind: "untrusted_d1_probe_cloudflare_worker_api_canary_result" as const,
        status: "observed_candidate" as const,
        stage: "worker_absence_readback" as const,
        planned_worker_name: scriptName,
        plan_digest: plan.plan_digest,
        commitment_key_id_digest: plan.commitment_key_id_digest,
        attempt_tag_commitment: await hmac("openbot.identity.cloudflare_worker_canary_attempt_tag.v1", attemptTag),
        account_id_commitment: await hmac("openbot.identity.cloudflare_account_id.v1", accountId),
        worker_id_commitment: await hmac("openbot.identity.cloudflare_worker_script_id.v1", workerId),
        version_id_commitment: await hmac("openbot.identity.cloudflare_worker_version_id.v1", versionId),
        deployment_id_commitment: await hmac("openbot.identity.cloudflare_worker_deployment_id.v1", deploymentId),
        fixed_module_sha256: fixedModuleSha256,
        mutation_attempts: { shell_create: 1, version_create: 1, deployment_create: 1, worker_delete: 1 } as const,
        cleanup_status: "control_plane_absence_observed" as const,
        transcript,
        runtime_identity_verified: false as const,
        caller_mutation_authority: false as const,
        authoritative: false as const,
        eligible_for_upload: false as const,
        eligible_for_attestation: false as const,
        lifecycle_advance_allowed: false as const,
        gate_promotion_allowed: false as const,
    };
    const transcriptDigest = await digestCanonicalJsonV1(
        "openbot.d1-probe.cloudflare-worker-api-canary-transcript.v1",
        projection as unknown as CanonicalJsonValueV1
    );
    if (transcriptDigest === null) throw new Error("transcript digest unavailable");
    return {
        result: { ...projection, transcript_digest: transcriptDigest },
        context: {
            plan,
            hmac_key_base64url: hmacKeyBase64Url,
            account_id: accountId,
            worker_id: workerId,
            version_id: versionId,
            deployment_id: deploymentId,
            attempt_tag: attemptTag,
        },
    };
};

const redigest = async (result: Record<string, any>): Promise<void> => {
    const { transcript_digest: _claimed, ...projection } = result;
    const digest = await digestCanonicalJsonV1(
        "openbot.d1-probe.cloudflare-worker-api-canary-transcript.v1",
        projection as CanonicalJsonValueV1
    );
    if (digest === null) throw new Error("transcript digest unavailable");
    result["transcript_digest"] = digest;
};

describe("Cloudflare Worker API canary offline review", () => {
    it("accepts the exact successful 20-entry observation without granting authority", async () => {
        const fixture = await makeFixture();
        await expect(reviewD1ProbeCloudflareWorkerApiCanaryResultV1(fixture.result, fixture.context)).resolves.toEqual({
            success: true,
            review: {
                schema_version: 1,
                kind: "d1_probe_cloudflare_worker_api_canary_offline_review",
                status: "eligible_for_human_review",
                plan_digest: fixture.result.plan_digest,
                commitment_key_id_digest: fixture.result.commitment_key_id_digest,
                transcript_digest: fixture.result.transcript_digest,
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
        });
    });

    it("returns denials instead of throwing for hostile unknown input", async () => {
        const fixture = await makeFixture();
        const hostile = new Proxy(
            {},
            {
                get: () => {
                    throw new Error("hostile getter");
                },
            }
        );
        await expect(reviewD1ProbeCloudflareWorkerApiCanaryResultV1(hostile, fixture.context)).resolves.toEqual({
            success: false,
            code: "invalid_canary_result",
        });
        await expect(reviewD1ProbeCloudflareWorkerApiCanaryResultV1(fixture.result, hostile)).resolves.toEqual({
            success: false,
            code: "invalid_review_context",
        });
    });

    it.each([
        ["wrong method", (value: any) => (value.transcript[1].method = "GET")],
        ["wrong status", (value: any) => (value.transcript[18].status = 200)],
        ["wrong sequence", (value: any) => (value.transcript[4].sequence = 6)],
        ["backward time", (value: any) => (value.transcript[8].observed_at_ms = notBefore + 1)],
        ["expired time", (value: any) => (value.transcript[19].observed_at_ms = expiresAt)],
        ["wrong path digest", (value: any) => (value.transcript[10].path_digest = "f".repeat(64))],
        ["wrong request digest", (value: any) => (value.transcript[6].request_digest = "f".repeat(64))],
    ])("rejects sequence mutation: %s", async (_label, mutate) => {
        const fixture = await makeFixture();
        const changed = structuredClone(fixture.result) as Record<string, any>;
        mutate(changed);
        await redigest(changed);
        await expect(reviewD1ProbeCloudflareWorkerApiCanaryResultV1(changed, fixture.context)).resolves.toEqual({
            success: false,
            code: "transcript_sequence_mismatch",
        });
    });

    it.each([
        ["mutation count", (value: any) => (value.mutation_attempts.worker_delete = 0)],
        ["cleanup", (value: any) => (value.cleanup_status = "manual_required")],
        ["status", (value: any) => (value.status = "inconclusive")],
        ["module digest", (value: any) => (value.fixed_module_sha256 = "f".repeat(64))],
        ["authority", (value: any) => (value.authoritative = true)],
        ["upload", (value: any) => (value.eligible_for_upload = true)],
        ["attestation", (value: any) => (value.eligible_for_attestation = true)],
        ["lifecycle", (value: any) => (value.lifecycle_advance_allowed = true)],
        ["gate", (value: any) => (value.gate_promotion_allowed = true)],
        ["caller authority", (value: any) => (value.caller_mutation_authority = true)],
        ["runtime identity", (value: any) => (value.runtime_identity_verified = true)],
    ])("rejects result mutation: %s", async (_label, mutate) => {
        const fixture = await makeFixture();
        const changed = structuredClone(fixture.result) as Record<string, any>;
        mutate(changed);
        await redigest(changed);
        const reviewed = await reviewD1ProbeCloudflareWorkerApiCanaryResultV1(changed, fixture.context);
        expect(reviewed).toEqual({ success: false, code: "invalid_canary_result" });
    });

    it("rejects an internally stale transcript digest", async () => {
        const fixture = await makeFixture();
        const changed = structuredClone(fixture.result) as Record<string, any>;
        changed["transcript"][0].response_digest = "f".repeat(64);
        await expect(reviewD1ProbeCloudflareWorkerApiCanaryResultV1(changed, fixture.context)).resolves.toEqual({
            success: false,
            code: "transcript_digest_mismatch",
        });
    });

    it("treats unresolved response digests as shape-bound inputs for human review, never adjudication", async () => {
        const fixture = await makeFixture();
        const changed = structuredClone(fixture.result) as Record<string, any>;
        for (const [index, entry] of changed["transcript"].entries()) {
            entry.response_digest = await sha256(`arbitrary-unresolved-response-${index}`);
        }
        await redigest(changed);

        const reviewed = await reviewD1ProbeCloudflareWorkerApiCanaryResultV1(changed, fixture.context);
        expect(reviewed).toMatchObject({
            success: true,
            review: {
                status: "eligible_for_human_review",
                cleanup_absence_claim_shape_matches: true,
                response_digest_claims_in_transcript_projection: true,
                response_digests_independently_resolved: false,
                adjudicated: false,
                authoritative: false,
                eligible_for_upload: false,
                eligible_for_attestation: false,
                lifecycle_advance_allowed: false,
                gate_promotion_allowed: false,
            },
        });
    });

    it.each([
        ["account", (value: any) => (value.account_id = "c".repeat(32))],
        ["worker", (value: any) => (value.worker_id = "substituted-worker")],
        ["version", (value: any) => (value.version_id = "44444444-4444-4444-8444-444444444444")],
        ["deployment", (value: any) => (value.deployment_id = "55555555-5555-4555-8555-555555555555")],
        ["attempt tag", (value: any) => (value.attempt_tag = `openbot-canary-attempt-${"0d".repeat(16)}`)],
        ["HMAC key", (value: any) => (value.hmac_key_base64url = "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI")],
    ])("rejects operator context substitution: %s", async (_label, mutate) => {
        const fixture = await makeFixture();
        const context = structuredClone(fixture.context) as Record<string, any>;
        mutate(context);
        const reviewed = await reviewD1ProbeCloudflareWorkerApiCanaryResultV1(fixture.result, context);
        expect(reviewed.success).toBe(false);
    });

    it("rejects forbidden fields at every strict boundary", async () => {
        const fixture = await makeFixture();
        const result = structuredClone(fixture.result) as Record<string, any>;
        result["account_id"] = accountId;
        expect(await reviewD1ProbeCloudflareWorkerApiCanaryResultV1(result, fixture.context)).toEqual({
            success: false,
            code: "invalid_canary_result",
        });

        const nested = structuredClone(fixture.result) as Record<string, any>;
        nested["transcript"][0].path = "/forbidden/raw/path";
        expect(await reviewD1ProbeCloudflareWorkerApiCanaryResultV1(nested, fixture.context)).toEqual({
            success: false,
            code: "invalid_canary_result",
        });

        const context = { ...fixture.context, api_token: "forbidden" };
        expect(await reviewD1ProbeCloudflareWorkerApiCanaryResultV1(fixture.result, context)).toEqual({
            success: false,
            code: "invalid_review_context",
        });
    });

    it("never returns operator-held raw values", async () => {
        const fixture = await makeFixture();
        const reviewed = await reviewD1ProbeCloudflareWorkerApiCanaryResultV1(fixture.result, fixture.context);
        expect(reviewed.success).toBe(true);
        const serialized = JSON.stringify(reviewed);
        for (const raw of [
            accountId,
            workerId,
            versionId,
            deploymentId,
            attemptTag,
            hmacKeyBase64Url,
            scriptName,
            operationId,
        ]) {
            expect(serialized).not.toContain(raw);
        }
    });
});
