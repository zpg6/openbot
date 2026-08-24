import { z } from "zod";

import {
    canonicalizeJsonV1,
    digestCanonicalJsonV1,
    type CanonicalJsonValueV1,
} from "@openbot/gate-attestation/internal";

import { D1ProbeCommitmentKeyV1Schema } from "./contracts.js";

const DigestV1Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const AccountIdV1Schema = z.string().regex(/^[0-9a-f]{32}$/u);
const IdentifierV1Schema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const UuidV1Schema = z.string().uuid();
const SafeTimeV1Schema = z.number().int().safe().nonnegative();

const KEY_ID_DOMAIN_V1 = "openbot.d1-probe.commitment-key-id.v1";
const PLAN_DIGEST_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-api-canary-plan.v1";
const TRANSCRIPT_DIGEST_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-api-canary-transcript.v1";
const FIXED_MODULE_SOURCE_V1 = "export default { fetch() { return new Response(null, { status: 404 }); } };";
const FIXED_MODULE_NAME_V1 = "entry.js";
const FIXED_COMPATIBILITY_DATE_V1 = "2026-08-22";
const MAX_WINDOW_MS_V1 = 300_000;
const MAX_RESPONSE_BYTES_V1 = 256 * 1024;
const MAX_AGGREGATE_RESPONSE_BYTES_V1 = 2 * 1024 * 1024;
const MAX_PAGES_V1 = 10;
const API_ROOT_V1 = "https://api.cloudflare.com/client/v4";

export const D1ProbeCloudflareWorkerApiCanaryPlanV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("d1_probe_cloudflare_worker_api_canary_plan"),
        account_id: AccountIdV1Schema,
        commitment_key_id_digest: DigestV1Schema,
        operation_id: z.string().regex(/^[0-9a-f]{32}$/u),
        random_suffix: z.string().regex(/^[a-z0-9]{16}$/u),
        script_name: z.string().regex(/^openbot-d1-probe-canary-[a-z0-9]{16}$/u),
        markers: z
            .object({
                ownership_tag: z.string().min(1).max(100),
                version_tag: z.string().min(1).max(100),
                version_message: z.string().min(1).max(1_000),
                deployment_message: z.string().min(1).max(1_000),
            })
            .strict(),
        compatibility_date: z.literal(FIXED_COMPATIBILITY_DATE_V1),
        not_before_ms: SafeTimeV1Schema,
        expires_at_ms: SafeTimeV1Schema,
        authoritative: z.literal(false),
        eligible_for_attestation: z.literal(false),
        lifecycle_advance_allowed: z.literal(false),
        gate_promotion_allowed: z.literal(false),
        plan_digest: DigestV1Schema,
    })
    .strict()
    .superRefine((plan, context) => {
        const expectedName = `openbot-d1-probe-canary-${plan.random_suffix}`;
        const expectedMarkers = {
            ownership_tag: `openbot-canary-owner-${plan.operation_id}`,
            version_tag: `openbot-canary-version-${plan.operation_id}`,
            version_message: `openbot canary version ${plan.operation_id}`,
            deployment_message: `openbot canary deployment ${plan.operation_id}`,
        };
        if (plan.script_name !== expectedName) {
            context.addIssue({ code: "custom", message: "script_name does not match random_suffix" });
        }
        if (canonicalizeJsonV1(plan.markers) !== canonicalizeJsonV1(expectedMarkers)) {
            context.addIssue({ code: "custom", message: "markers do not match operation_id" });
        }
        if (plan.expires_at_ms <= plan.not_before_ms || plan.expires_at_ms - plan.not_before_ms > MAX_WINDOW_MS_V1) {
            context.addIssue({ code: "custom", message: "invalid operation window" });
        }
    });

export type D1ProbeCloudflareWorkerApiCanaryPlanV1 = z.infer<typeof D1ProbeCloudflareWorkerApiCanaryPlanV1Schema>;

const CredentialsV1Schema = z.object({ api_token: z.string().regex(/^[A-Za-z0-9_-]{20,256}$/u) }).strict();

const EnvelopeV1Schema = z
    .object({
        success: z.literal(true),
        errors: z.array(z.unknown()).length(0),
        messages: z.array(z.unknown()).length(0),
        result: z.unknown().optional(),
        result_info: z.unknown().optional(),
    })
    .passthrough();

const WorkerV1Schema = z
    .object({
        id: IdentifierV1Schema,
        name: z.string(),
        created_on: z.string().datetime({ offset: true }),
        deployed_on: z.string().datetime({ offset: true }).nullable(),
        logpush: z.boolean(),
        observability: z.object({ enabled: z.boolean() }).passthrough(),
        subdomain: z.object({ enabled: z.boolean(), previews_enabled: z.boolean() }).passthrough(),
        tags: z.array(z.string()),
        tail_consumers: z.array(z.unknown()).length(0),
        references: z.record(z.string(), z.array(z.unknown())),
    })
    .passthrough();

const VersionSummaryV1Schema = z
    .object({
        id: UuidV1Schema,
        created_on: z.string().datetime({ offset: true }),
        annotations: z
            .object({
                "workers/tag": z.string().optional(),
                "workers/message": z.string().optional(),
            })
            .passthrough(),
        urls: z.array(z.string()),
    })
    .passthrough();

const VersionDetailV1Schema = VersionSummaryV1Schema.extend({
    main_module: z.literal(FIXED_MODULE_NAME_V1),
    compatibility_date: z.literal(FIXED_COMPATIBILITY_DATE_V1),
    compatibility_flags: z.array(z.string()).length(0),
    bindings: z.array(z.unknown()).length(0),
    modules: z
        .array(
            z
                .object({
                    name: z.literal(FIXED_MODULE_NAME_V1),
                    content_type: z.literal("application/javascript+module"),
                    content_base64: z.string(),
                })
                .strict()
        )
        .length(1),
});

const ClassicVersionV1Schema = z
    .object({
        id: UuidV1Schema,
        metadata: z.object({ hasPreview: z.literal(false) }).passthrough(),
    })
    .passthrough();

const DeploymentV1Schema = z
    .object({
        id: UuidV1Schema,
        created_on: z.string().datetime({ offset: true }),
        strategy: z.literal("percentage"),
        annotations: z.object({ "workers/message": z.string() }).passthrough(),
        versions: z.array(z.object({ version_id: UuidV1Schema, percentage: z.literal(100) }).strict()).length(1),
    })
    .passthrough();

const arrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const toHex = (value: ArrayBuffer): string =>
    [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");

const sha256 = async (bytes: Uint8Array): Promise<string> =>
    toHex(await globalThis.crypto.subtle.digest("SHA-256", arrayBuffer(bytes)));

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

const deriveKeyId = async (raw: Uint8Array): Promise<string> => {
    const domain = new TextEncoder().encode(`${KEY_ID_DOMAIN_V1}\u0000`);
    const preimage = new Uint8Array(domain.byteLength + raw.byteLength);
    preimage.set(domain);
    preimage.set(raw, domain.byteLength);
    try {
        return await sha256(preimage);
    } finally {
        preimage.fill(0);
    }
};

const importHmacKey = async (raw: Uint8Array): Promise<CryptoKey> =>
    await globalThis.crypto.subtle.importKey("raw", arrayBuffer(raw), { name: "HMAC", hash: "SHA-256" }, false, [
        "sign",
    ]);

const hmacIdentity = async (key: CryptoKey, domain: string, value: string): Promise<string> => {
    const bytes = new TextEncoder().encode(`${domain}\u0000${canonicalizeJsonV1(value)}`);
    return toHex(await globalThis.crypto.subtle.sign("HMAC", key, arrayBuffer(bytes)));
};

const canonicalRequest = (method: string, path: string, body?: CanonicalJsonValueV1) => ({
    method,
    path,
    ...(body === undefined ? {} : { body: canonicalizeJsonV1(body) }),
});

type TranscriptEntryV1 = {
    readonly sequence: number;
    readonly method: string;
    readonly path_digest: string;
    readonly request_digest: string;
    readonly response_digest: string | null;
    readonly status: number | null;
    readonly observed_at_ms: number;
};

export interface UntrustedD1ProbeCloudflareWorkerApiCanaryResultV1 {
    readonly schema_version: 1;
    readonly kind: "untrusted_d1_probe_cloudflare_worker_api_canary_result";
    readonly status: "observed_candidate" | "inconclusive" | "manual_required";
    readonly stage: string;
    readonly planned_worker_name: string;
    readonly plan_digest: string;
    readonly commitment_key_id_digest: string;
    readonly attempt_tag_commitment: string;
    readonly account_id_commitment: string;
    readonly worker_id_commitment: string | null;
    readonly version_id_commitment: string | null;
    readonly deployment_id_commitment: string | null;
    readonly fixed_module_sha256: string;
    readonly mutation_attempts: {
        readonly shell_create: 0 | 1;
        readonly version_create: 0 | 1;
        readonly deployment_create: 0 | 1;
        readonly worker_delete: 0 | 1;
    };
    readonly cleanup_status: "not_needed" | "control_plane_absence_observed" | "manual_required";
    readonly transcript: readonly TranscriptEntryV1[];
    readonly transcript_digest: string;
    readonly runtime_identity_verified: false;
    readonly caller_mutation_authority: false;
    readonly authoritative: false;
    readonly eligible_for_upload: false;
    readonly eligible_for_attestation: false;
    readonly lifecycle_advance_allowed: false;
    readonly gate_promotion_allowed: false;
}

export type D1ProbeCloudflareWorkerApiCanaryDenialV1 =
    | "invalid_canary_plan"
    | "invalid_credentials"
    | "invalid_commitment_key"
    | "commitment_key_id_mismatch"
    | "canary_plan_not_active";

export interface D1ProbeCloudflareWorkerApiCanaryDependenciesV1 {
    readonly fetch: typeof globalThis.fetch;
    readonly now: () => number;
    readonly randomBytes?: (bytes: Uint8Array) => Uint8Array;
    readonly shouldTerminate?: () => boolean;
}

type MutableStateV1 = {
    stage: string;
    workerId: string | null;
    versionId: string | null;
    deploymentId: string | null;
    mutationAttempts: { shell_create: 0 | 1; version_create: 0 | 1; deployment_create: 0 | 1; worker_delete: 0 | 1 };
    transcript: TranscriptEntryV1[];
    aggregateBytes: number;
};

const timestampInside = (value: string, plan: D1ProbeCloudflareWorkerApiCanaryPlanV1): boolean => {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && timestamp >= plan.not_before_ms && timestamp <= plan.expires_at_ms;
};

const workerMatches = (
    worker: z.infer<typeof WorkerV1Schema>,
    plan: D1ProbeCloudflareWorkerApiCanaryPlanV1,
    attemptTag: string
) =>
    worker.name === plan.script_name &&
    worker.logpush === false &&
    worker.observability.enabled === false &&
    worker.subdomain.enabled === false &&
    worker.subdomain.previews_enabled === false &&
    worker.tags.length === 2 &&
    new Set(worker.tags).size === 2 &&
    worker.tags.includes(plan.markers.ownership_tag) &&
    worker.tags.includes(attemptTag) &&
    worker.tail_consumers.length === 0 &&
    worker.deployed_on === null &&
    timestampInside(worker.created_on, plan) &&
    Object.values(worker.references).every(values => values.length === 0);

const ownedWorkerMatches = (
    worker: z.infer<typeof WorkerV1Schema>,
    plan: D1ProbeCloudflareWorkerApiCanaryPlanV1,
    workerId: string,
    attemptTag: string
) =>
    worker.id === workerId &&
    worker.name === plan.script_name &&
    worker.logpush === false &&
    worker.observability.enabled === false &&
    worker.subdomain.enabled === false &&
    worker.subdomain.previews_enabled === false &&
    worker.tags.length === 2 &&
    new Set(worker.tags).size === 2 &&
    worker.tags.includes(plan.markers.ownership_tag) &&
    worker.tags.includes(attemptTag) &&
    worker.tail_consumers.length === 0 &&
    timestampInside(worker.created_on, plan) &&
    Object.values(worker.references).every(values => values.length === 0);

const deployedWorkerMatches = (
    worker: z.infer<typeof WorkerV1Schema>,
    plan: D1ProbeCloudflareWorkerApiCanaryPlanV1,
    workerId: string,
    attemptTag: string
) =>
    ownedWorkerMatches(worker, plan, workerId, attemptTag) &&
    worker.deployed_on !== null &&
    timestampInside(worker.deployed_on, plan);

const parsePlan = async (input: unknown): Promise<D1ProbeCloudflareWorkerApiCanaryPlanV1 | null> => {
    let parsed: ReturnType<typeof D1ProbeCloudflareWorkerApiCanaryPlanV1Schema.safeParse>;
    try {
        parsed = D1ProbeCloudflareWorkerApiCanaryPlanV1Schema.safeParse(input);
    } catch {
        return null;
    }
    if (!parsed.success) return null;
    const { plan_digest: _claimed, ...projection } = parsed.data;
    const digest = await digestCanonicalJsonV1(PLAN_DIGEST_DOMAIN_V1, projection as CanonicalJsonValueV1);
    return digest === parsed.data.plan_digest ? parsed.data : null;
};

export const runD1ProbeCloudflareWorkerApiCanaryV1 = async (
    planInput: unknown,
    credentialsInput: unknown,
    commitmentKeyInput: unknown,
    dependencies: D1ProbeCloudflareWorkerApiCanaryDependenciesV1
): Promise<
    | { readonly success: false; readonly code: D1ProbeCloudflareWorkerApiCanaryDenialV1 }
    | { readonly success: true; readonly result: UntrustedD1ProbeCloudflareWorkerApiCanaryResultV1 }
> => {
    const plan = await parsePlan(planInput);
    if (plan === null) return { success: false, code: "invalid_canary_plan" };
    let credentials: ReturnType<typeof CredentialsV1Schema.safeParse>;
    try {
        credentials = CredentialsV1Schema.safeParse(credentialsInput);
    } catch {
        return { success: false, code: "invalid_credentials" };
    }
    if (!credentials.success) return { success: false, code: "invalid_credentials" };
    let keyRecord: ReturnType<typeof D1ProbeCommitmentKeyV1Schema.safeParse>;
    try {
        keyRecord = D1ProbeCommitmentKeyV1Schema.safeParse(commitmentKeyInput);
    } catch {
        return { success: false, code: "invalid_commitment_key" };
    }
    if (!keyRecord.success) return { success: false, code: "invalid_commitment_key" };
    const rawKey = decodeBase64Url(keyRecord.data.hmac_key_base64url);
    if (rawKey === null || rawKey.byteLength < 32 || rawKey.byteLength > 64) {
        rawKey?.fill(0);
        return { success: false, code: "invalid_commitment_key" };
    }
    let keyId: string;
    let hmacKey: CryptoKey;
    try {
        keyId = await deriveKeyId(rawKey);
        hmacKey = await importHmacKey(rawKey);
    } catch {
        rawKey.fill(0);
        return { success: false, code: "invalid_commitment_key" };
    }
    if (keyId !== plan.commitment_key_id_digest) {
        rawKey.fill(0);
        return { success: false, code: "commitment_key_id_mismatch" };
    }
    rawKey.fill(0);

    let initialNow: number;
    try {
        initialNow = dependencies.now();
    } catch {
        return { success: false, code: "canary_plan_not_active" };
    }
    if (!Number.isSafeInteger(initialNow) || initialNow < plan.not_before_ms || initialNow >= plan.expires_at_ms) {
        return { success: false, code: "canary_plan_not_active" };
    }

    const state: MutableStateV1 = {
        stage: "preflight_worker_absence",
        workerId: null,
        versionId: null,
        deploymentId: null,
        mutationAttempts: { shell_create: 0, version_create: 0, deployment_create: 0, worker_delete: 0 },
        transcript: [],
        aggregateBytes: 0,
    };
    const attemptBytes = new Uint8Array(16);
    try {
        (dependencies.randomBytes ?? globalThis.crypto.getRandomValues.bind(globalThis.crypto))(attemptBytes);
    } catch {
        return { success: false, code: "canary_plan_not_active" };
    }
    const attemptTag = `openbot-canary-attempt-${toHex(arrayBuffer(attemptBytes))}`;
    attemptBytes.fill(0);
    const accountCommitment = await hmacIdentity(hmacKey, "openbot.identity.cloudflare_account_id.v1", plan.account_id);
    const attemptTagCommitment = await hmacIdentity(
        hmacKey,
        "openbot.identity.cloudflare_worker_canary_attempt_tag.v1",
        attemptTag
    );
    const fixedModuleBytes = new TextEncoder().encode(FIXED_MODULE_SOURCE_V1);
    const fixedModuleSha256 = await sha256(fixedModuleBytes);

    const requestJson = async (
        method: string,
        path: string,
        body?: CanonicalJsonValueV1,
        acceptedStatuses: readonly number[] = [200]
    ): Promise<{ ok: true; status: number; json: unknown } | { ok: false; status: number | null }> => {
        const observedAt = dependencies.now();
        if (!Number.isSafeInteger(observedAt) || observedAt < plan.not_before_ms || observedAt >= plan.expires_at_ms) {
            return { ok: false, status: null };
        }
        const requestProjection = canonicalRequest(method, path, body);
        const requestDigest = await digestCanonicalJsonV1(
            "openbot.d1-probe.cloudflare-worker-api-canary-request.v1",
            requestProjection as CanonicalJsonValueV1
        );
        if (requestDigest === null) return { ok: false, status: null };
        const pathDigest = await sha256(new TextEncoder().encode(path));
        const entry: TranscriptEntryV1 = {
            sequence: state.transcript.length + 1,
            method,
            path_digest: pathDigest,
            request_digest: requestDigest,
            response_digest: null,
            status: null,
            observed_at_ms: observedAt,
        };
        state.transcript.push(entry);
        try {
            const remainingMs = plan.expires_at_ms - observedAt;
            if (remainingMs <= 0) return { ok: false, status: null };
            const response = await dependencies.fetch(`${API_ROOT_V1}${path}`, {
                method,
                redirect: "manual",
                signal: AbortSignal.timeout(Math.max(1, Math.min(20_000, remainingMs))),
                headers: {
                    Accept: "application/json",
                    "Accept-Encoding": "identity",
                    Authorization: `Bearer ${credentials.data.api_token}`,
                    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
                },
                ...(body === undefined ? {} : { body: canonicalizeJsonV1(body) }),
            });
            const encoding = response.headers.get("content-encoding");
            const contentType = response.headers.get("content-type") ?? "";
            if (response.type === "opaqueredirect" || (encoding !== null && encoding !== "identity"))
                return { ok: false, status: response.status };
            const declaredLength = response.headers.get("content-length");
            if (
                declaredLength !== null &&
                (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES_V1)
            ) {
                return { ok: false, status: response.status };
            }
            const reader = response.body?.getReader();
            if (reader === undefined) return { ok: false, status: response.status };
            const chunks: Uint8Array[] = [];
            let responseSize = 0;
            for (;;) {
                const chunk = await reader.read();
                if (chunk.done) break;
                responseSize += chunk.value.byteLength;
                if (responseSize > MAX_RESPONSE_BYTES_V1) {
                    await reader.cancel().catch(() => undefined);
                    return { ok: false, status: response.status };
                }
                chunks.push(chunk.value);
            }
            const bytes = new Uint8Array(responseSize);
            let offset = 0;
            for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.byteLength;
            }
            state.aggregateBytes += bytes.byteLength;
            const responseObservedAt = dependencies.now();
            state.transcript[state.transcript.length - 1] = {
                ...entry,
                response_digest: await sha256(bytes),
                status: response.status,
                observed_at_ms: responseObservedAt,
            };
            if (
                !Number.isSafeInteger(responseObservedAt) ||
                responseObservedAt < plan.not_before_ms ||
                responseObservedAt >= plan.expires_at_ms ||
                state.aggregateBytes > MAX_AGGREGATE_RESPONSE_BYTES_V1 ||
                !acceptedStatuses.includes(response.status)
            ) {
                return { ok: false, status: response.status };
            }
            if (!contentType.toLowerCase().startsWith("application/json")) {
                return { ok: false, status: response.status };
            }
            let json: unknown;
            try {
                json = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
            } catch {
                return { ok: false, status: response.status };
            }
            return { ok: true, status: response.status, json };
        } catch {
            return { ok: false, status: null };
        }
    };

    const parseEnvelope = (input: unknown): z.infer<typeof EnvelopeV1Schema> | null => {
        const parsed = EnvelopeV1Schema.safeParse(input);
        return parsed.success ? parsed.data : null;
    };

    const listWorkers = async (): Promise<z.infer<typeof WorkerV1Schema>[] | null> => {
        const all: z.infer<typeof WorkerV1Schema>[] = [];
        let expectedTotalCount: number | null = null;
        let expectedTotalPages: number | null = null;
        for (let page = 1; page <= MAX_PAGES_V1; page += 1) {
            const response = await requestJson(
                "GET",
                `/accounts/${plan.account_id}/workers/workers?page=${page}&per_page=100&order_by=name&order=asc`
            );
            if (!response.ok) return null;
            const envelope = parseEnvelope(response.json);
            if (envelope === null || !Array.isArray(envelope.result)) return null;
            const workers = z.array(WorkerV1Schema).safeParse(envelope.result);
            const info = z
                .object({
                    page: z.number().int().positive(),
                    per_page: z.literal(100),
                    count: z.number().int().nonnegative(),
                    total_count: z.number().int().nonnegative(),
                    total_pages: z.number().int().nonnegative(),
                })
                .strict()
                .safeParse(envelope.result_info);
            if (
                !workers.success ||
                !info.success ||
                info.data.page !== page ||
                info.data.count !== workers.data.length
            ) {
                return null;
            }
            if (expectedTotalCount === null) {
                expectedTotalCount = info.data.total_count;
                expectedTotalPages = info.data.total_pages;
            } else if (info.data.total_count !== expectedTotalCount || info.data.total_pages !== expectedTotalPages) {
                return null;
            }
            all.push(...workers.data);
            if (new Set(all.map(worker => worker.id)).size !== all.length) return null;
            const effectivePages =
                info.data.total_pages === 0 && info.data.total_count === 0 ? 1 : info.data.total_pages;
            if (effectivePages > MAX_PAGES_V1 || info.data.total_count < all.length) return null;
            if (page === effectivePages) return all.length === info.data.total_count ? all : null;
        }
        return null;
    };

    const getWorker = async (workerId: string): Promise<z.infer<typeof WorkerV1Schema> | null> => {
        const response = await requestJson("GET", `/accounts/${plan.account_id}/workers/workers/${workerId}`);
        if (!response.ok) return null;
        const envelope = parseEnvelope(response.json);
        const parsed = WorkerV1Schema.safeParse(envelope?.result);
        return parsed.success ? parsed.data : null;
    };

    const listVersions = async (workerId: string): Promise<z.infer<typeof VersionSummaryV1Schema>[] | null> => {
        const response = await requestJson(
            "GET",
            `/accounts/${plan.account_id}/workers/workers/${workerId}/versions?page=1&per_page=100`
        );
        if (!response.ok) return null;
        const envelope = parseEnvelope(response.json);
        const versions = z.array(VersionSummaryV1Schema).safeParse(envelope?.result);
        const info = z
            .object({
                page: z.literal(1),
                per_page: z.literal(100),
                count: z.number().int().nonnegative(),
                total_count: z.number().int().nonnegative(),
                total_pages: z.number().int().nonnegative(),
            })
            .strict()
            .safeParse(envelope?.result_info);
        if (!versions.success || !info.success) return null;
        const effectivePages = info.data.total_pages === 0 && info.data.total_count === 0 ? 1 : info.data.total_pages;
        return effectivePages === 1 &&
            info.data.count === versions.data.length &&
            info.data.total_count === versions.data.length
            ? versions.data
            : null;
    };

    const listDeployments = async (): Promise<z.infer<typeof DeploymentV1Schema>[] | null> => {
        const response = await requestJson(
            "GET",
            `/accounts/${plan.account_id}/workers/scripts/${plan.script_name}/deployments`
        );
        if (!response.ok) return null;
        const envelope = parseEnvelope(response.json);
        const parsed = z
            .object({ deployments: z.array(DeploymentV1Schema) })
            .strict()
            .safeParse(envelope?.result);
        return parsed.success ? parsed.data.deployments : null;
    };

    const result = async (
        status: UntrustedD1ProbeCloudflareWorkerApiCanaryResultV1["status"],
        cleanupStatus: UntrustedD1ProbeCloudflareWorkerApiCanaryResultV1["cleanup_status"]
    ): Promise<UntrustedD1ProbeCloudflareWorkerApiCanaryResultV1> => {
        const workerCommitment =
            state.workerId === null
                ? null
                : await hmacIdentity(hmacKey, "openbot.identity.cloudflare_worker_script_id.v1", state.workerId);
        const versionCommitment =
            state.versionId === null
                ? null
                : await hmacIdentity(hmacKey, "openbot.identity.cloudflare_worker_version_id.v1", state.versionId);
        const deploymentCommitment =
            state.deploymentId === null
                ? null
                : await hmacIdentity(
                      hmacKey,
                      "openbot.identity.cloudflare_worker_deployment_id.v1",
                      state.deploymentId
                  );
        const projection = {
            schema_version: 1,
            kind: "untrusted_d1_probe_cloudflare_worker_api_canary_result",
            status,
            stage: state.stage,
            planned_worker_name: plan.script_name,
            plan_digest: plan.plan_digest,
            commitment_key_id_digest: plan.commitment_key_id_digest,
            attempt_tag_commitment: attemptTagCommitment,
            account_id_commitment: accountCommitment,
            worker_id_commitment: workerCommitment,
            version_id_commitment: versionCommitment,
            deployment_id_commitment: deploymentCommitment,
            fixed_module_sha256: fixedModuleSha256,
            mutation_attempts: state.mutationAttempts,
            cleanup_status: cleanupStatus,
            transcript: state.transcript,
            runtime_identity_verified: false,
            caller_mutation_authority: false,
            authoritative: false,
            eligible_for_upload: false,
            eligible_for_attestation: false,
            lifecycle_advance_allowed: false,
            gate_promotion_allowed: false,
        } as const;
        const transcriptDigest = await digestCanonicalJsonV1(
            TRANSCRIPT_DIGEST_DOMAIN_V1,
            projection as unknown as CanonicalJsonValueV1
        );
        if (transcriptDigest === null) throw new Error("canary transcript digest unavailable");
        return {
            ...projection,
            transcript_digest: transcriptDigest,
        };
    };

    const cleanup = async (): Promise<"control_plane_absence_observed" | "manual_required"> => {
        if (state.workerId === null) return "manual_required";
        if (state.mutationAttempts.worker_delete === 1) return "manual_required";
        state.stage = "worker_cleanup_ownership_readback";
        const ownedWorker = await getWorker(state.workerId);
        if (ownedWorker === null || !ownedWorkerMatches(ownedWorker, plan, state.workerId, attemptTag)) {
            return "manual_required";
        }
        state.stage = "worker_delete";
        state.mutationAttempts.worker_delete = 1;
        const deletion = await requestJson("DELETE", `/accounts/${plan.account_id}/workers/workers/${state.workerId}`);
        const deletionAcknowledged = deletion.ok && parseEnvelope(deletion.json) !== null;
        state.stage = "worker_absence_readback";
        const exactAbsence = await requestJson(
            "GET",
            `/accounts/${plan.account_id}/workers/workers/${state.workerId}`,
            undefined,
            [404]
        );
        if (!exactAbsence.ok || exactAbsence.status !== 404) return "manual_required";
        const workers = await listWorkers();
        if (workers === null) return "manual_required";
        return deletionAcknowledged &&
            !workers.some(worker => worker.id === state.workerId || worker.name === plan.script_name)
            ? "control_plane_absence_observed"
            : "manual_required";
    };

    const operationalFailure = async (): Promise<{
        success: true;
        result: UntrustedD1ProbeCloudflareWorkerApiCanaryResultV1;
    }> => {
        if (state.workerId === null && state.mutationAttempts.shell_create === 1) {
            const workers = await listWorkers();
            const matches = workers?.filter(worker => workerMatches(worker, plan, attemptTag)) ?? [];
            if (matches.length === 1) state.workerId = matches[0]?.id ?? null;
            else return { success: true, result: await result("manual_required", "manual_required") };
        }
        if (state.workerId === null) return { success: true, result: await result("inconclusive", "not_needed") };
        const cleanupStatus = await cleanup();
        return {
            success: true,
            result: await result(
                cleanupStatus === "manual_required" ? "manual_required" : "inconclusive",
                cleanupStatus
            ),
        };
    };

    try {
        const initialWorkers = await listWorkers();
        if (initialWorkers === null || initialWorkers.some(worker => worker.name === plan.script_name)) {
            return { success: true, result: await result("inconclusive", "not_needed") };
        }
        if (dependencies.shouldTerminate?.() === true) {
            return { success: true, result: await result("inconclusive", "not_needed") };
        }

        state.stage = "shell_create";
        state.mutationAttempts.shell_create = 1;
        const shellBody = {
            name: plan.script_name,
            logpush: false,
            observability: { enabled: false },
            subdomain: { enabled: false, previews_enabled: false },
            tags: [plan.markers.ownership_tag, attemptTag],
            tail_consumers: [],
        } satisfies CanonicalJsonValueV1;
        const shellResponse = await requestJson("POST", `/accounts/${plan.account_id}/workers/workers`, shellBody);
        if (!shellResponse.ok) {
            if (shellResponse.status !== null && shellResponse.status >= 400 && shellResponse.status < 500) {
                return { success: true, result: await result("inconclusive", "not_needed") };
            }
            return await operationalFailure();
        }
        const shellEnvelope = parseEnvelope(shellResponse.json);
        const shell = WorkerV1Schema.safeParse(shellEnvelope?.result);
        if (!shell.success || !workerMatches(shell.data, plan, attemptTag)) return await operationalFailure();
        state.workerId = shell.data.id;

        state.stage = "shell_readback";
        const shellReadback = await getWorker(state.workerId);
        const subdomain = await requestJson(
            "GET",
            `/accounts/${plan.account_id}/workers/scripts/${plan.script_name}/subdomain`
        );
        const subdomainEnvelope = subdomain.ok ? parseEnvelope(subdomain.json) : null;
        const subdomainResult = z
            .object({ enabled: z.literal(false), previews_enabled: z.literal(false) })
            .strict()
            .safeParse(subdomainEnvelope?.result);
        const emptyVersions = await listVersions(state.workerId);
        const emptyDeployments = await listDeployments();
        if (
            shellReadback === null ||
            !workerMatches(shellReadback, plan, attemptTag) ||
            !subdomainResult.success ||
            emptyVersions?.length !== 0 ||
            emptyDeployments?.length !== 0
        ) {
            return await operationalFailure();
        }
        if (dependencies.shouldTerminate?.() === true) return await operationalFailure();

        state.stage = "version_create";
        state.mutationAttempts.version_create = 1;
        const versionBody = {
            main_module: FIXED_MODULE_NAME_V1,
            compatibility_date: FIXED_COMPATIBILITY_DATE_V1,
            compatibility_flags: [],
            annotations: {
                "workers/message": plan.markers.version_message,
                "workers/tag": plan.markers.version_tag,
            },
            bindings: [],
            modules: [
                {
                    name: FIXED_MODULE_NAME_V1,
                    content_type: "application/javascript+module",
                    content_base64: globalThis.btoa(FIXED_MODULE_SOURCE_V1),
                },
            ],
        } satisfies CanonicalJsonValueV1;
        const versionResponse = await requestJson(
            "POST",
            `/accounts/${plan.account_id}/workers/workers/${state.workerId}/versions?deploy=false`,
            versionBody
        );
        if (!versionResponse.ok) return await operationalFailure();
        const versionEnvelope = parseEnvelope(versionResponse.json);
        const version = VersionDetailV1Schema.safeParse(versionEnvelope?.result);
        if (
            !version.success ||
            version.data.annotations["workers/tag"] !== plan.markers.version_tag ||
            version.data.annotations["workers/message"] !== plan.markers.version_message ||
            version.data.urls.length !== 0 ||
            version.data.modules[0]?.content_base64 !== globalThis.btoa(FIXED_MODULE_SOURCE_V1) ||
            !timestampInside(version.data.created_on, plan)
        ) {
            return await operationalFailure();
        }
        state.versionId = version.data.id;

        state.stage = "version_readback";
        const versions = await listVersions(state.workerId);
        if (
            versions?.length !== 1 ||
            versions[0]?.id !== state.versionId ||
            versions[0]?.annotations["workers/tag"] !== plan.markers.version_tag
        ) {
            return await operationalFailure();
        }
        const betaVersion = await requestJson(
            "GET",
            `/accounts/${plan.account_id}/workers/workers/${state.workerId}/versions/${state.versionId}?include=modules`
        );
        const betaDetail = VersionDetailV1Schema.safeParse(
            parseEnvelope(betaVersion.ok ? betaVersion.json : null)?.result
        );
        const classicVersion = await requestJson(
            "GET",
            `/accounts/${plan.account_id}/workers/scripts/${plan.script_name}/versions/${state.versionId}`
        );
        const classicDetail = ClassicVersionV1Schema.safeParse(
            parseEnvelope(classicVersion.ok ? classicVersion.json : null)?.result
        );
        const stillEmptyDeployments = await listDeployments();
        if (
            !betaDetail.success ||
            betaDetail.data.id !== state.versionId ||
            betaDetail.data.modules[0]?.content_base64 !== globalThis.btoa(FIXED_MODULE_SOURCE_V1) ||
            !classicDetail.success ||
            classicDetail.data.id !== state.versionId ||
            stillEmptyDeployments?.length !== 0
        ) {
            return await operationalFailure();
        }
        if (dependencies.shouldTerminate?.() === true) return await operationalFailure();

        state.stage = "deployment_create";
        state.mutationAttempts.deployment_create = 1;
        const deploymentBody = {
            strategy: "percentage",
            annotations: { "workers/message": plan.markers.deployment_message },
            versions: [{ version_id: state.versionId, percentage: 100 }],
        } satisfies CanonicalJsonValueV1;
        const deploymentResponse = await requestJson(
            "POST",
            `/accounts/${plan.account_id}/workers/scripts/${plan.script_name}/deployments?force=false`,
            deploymentBody
        );
        if (!deploymentResponse.ok) return await operationalFailure();
        const deployment = DeploymentV1Schema.safeParse(parseEnvelope(deploymentResponse.json)?.result);
        if (
            !deployment.success ||
            deployment.data.annotations["workers/message"] !== plan.markers.deployment_message ||
            deployment.data.versions[0]?.version_id !== state.versionId ||
            !timestampInside(deployment.data.created_on, plan)
        ) {
            return await operationalFailure();
        }
        state.deploymentId = deployment.data.id;

        state.stage = "deployment_readback";
        const deployments = await listDeployments();
        const deploymentReadback = await requestJson(
            "GET",
            `/accounts/${plan.account_id}/workers/scripts/${plan.script_name}/deployments/${state.deploymentId}`
        );
        const deploymentDetail = DeploymentV1Schema.safeParse(
            parseEnvelope(deploymentReadback.ok ? deploymentReadback.json : null)?.result
        );
        const deployedWorker = await getWorker(state.workerId);
        const finalSubdomain = await requestJson(
            "GET",
            `/accounts/${plan.account_id}/workers/scripts/${plan.script_name}/subdomain`
        );
        const finalSubdomainResult = z
            .object({ enabled: z.literal(false), previews_enabled: z.literal(false) })
            .strict()
            .safeParse(parseEnvelope(finalSubdomain.ok ? finalSubdomain.json : null)?.result);
        if (
            deployments?.length !== 1 ||
            deployments[0]?.id !== state.deploymentId ||
            deployments[0]?.annotations["workers/message"] !== plan.markers.deployment_message ||
            deployments[0]?.versions[0]?.version_id !== state.versionId ||
            !deploymentDetail.success ||
            deploymentDetail.data.id !== state.deploymentId ||
            deploymentDetail.data.created_on !== deployment.data.created_on ||
            deploymentDetail.data.annotations["workers/message"] !== plan.markers.deployment_message ||
            deploymentDetail.data.versions[0]?.version_id !== state.versionId ||
            deployedWorker === null ||
            !deployedWorkerMatches(deployedWorker, plan, state.workerId, attemptTag) ||
            Date.parse(deployedWorker.deployed_on as string) < Date.parse(deployment.data.created_on) ||
            !finalSubdomainResult.success
        ) {
            return await operationalFailure();
        }

        const cleanupStatus = await cleanup();
        return {
            success: true,
            result: await result(
                cleanupStatus === "control_plane_absence_observed" ? "observed_candidate" : "manual_required",
                cleanupStatus
            ),
        };
    } catch {
        return await operationalFailure();
    }
};
