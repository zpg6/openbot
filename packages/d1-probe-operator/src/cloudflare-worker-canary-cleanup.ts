import { z } from "zod";

import { canonicalizeJsonV1 } from "@openbot/gate-attestation/internal";

import {
    D1ProbeCloudflareWorkerCanaryCleanupCommandV1Schema,
    validateD1ProbeCloudflareWorkerCanaryCleanupGraceV1,
    validateD1ProbeCloudflareWorkerCanaryPlanForCleanupV1,
} from "./cloudflare-worker-canary-cleanup-grace.js";
import { buildNextD1ProbeCloudflareWorkerCanaryOperationV1 } from "./cloudflare-worker-canary-operation.js";
import {
    readD1ProbeCloudflareWorkerCanaryStateV1,
    transitionD1ProbeCloudflareWorkerCanaryStateV1,
} from "./cloudflare-worker-canary-state.js";
import { D1ProbeCommitmentKeyV1Schema } from "./contracts.js";

const IdentifierV1Schema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const AttemptTagV1Schema = z.string().regex(/^openbot-canary-attempt-[0-9a-f]{32}$/u);
const ApiTokenV1Schema = z.string().regex(/^[A-Za-z0-9_-]{20,256}$/u);

const KEY_ID_DOMAIN_V1 = "openbot.d1-probe.commitment-key-id.v1";
const WORKER_IDENTITY_DOMAIN_V1 = "openbot.identity.cloudflare_worker_script_id.v1";
const ATTEMPT_TAG_IDENTITY_DOMAIN_V1 = "openbot.identity.cloudflare_worker_canary_attempt_tag.v1";
const MAX_RESPONSE_BYTES_V1 = 256 * 1024;
const MAX_AGGREGATE_RESPONSE_BYTES_V1 = 2 * 1024 * 1024;
const MAX_PAGES_V1 = 10;
const API_ROOT_V1 = "https://api.cloudflare.com/client/v4";

export {
    D1ProbeCloudflareWorkerCanaryCleanupCommandV1Schema,
    D1ProbeCloudflareWorkerCanaryCleanupGraceV1Schema,
    compileD1ProbeCloudflareWorkerCanaryCleanupCommandV1,
} from "./cloudflare-worker-canary-cleanup-grace.js";
export type {
    CompileD1ProbeCloudflareWorkerCanaryCleanupCommandDenialV1,
    D1ProbeCloudflareWorkerCanaryCleanupCommandV1,
    D1ProbeCloudflareWorkerCanaryCleanupGraceV1,
} from "./cloudflare-worker-canary-cleanup-grace.js";

const CleanupContextV1Schema = z
    .object({
        attempt_tag: AttemptTagV1Schema,
    })
    .strict();

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
        tags: z.array(z.string()).optional(),
    })
    .passthrough();

const CompleteResultInfoV1Schema = z
    .object({
        page: z.number().int().positive(),
        per_page: z.literal(100),
        count: z.number().int().nonnegative().max(100),
        total_count: z.number().int().nonnegative().max(1_000),
        total_pages: z.number().int().nonnegative().max(MAX_PAGES_V1),
    })
    .passthrough();

const arrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const toHex = (value: ArrayBuffer): string =>
    [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");

const sha256 = async (bytes: Uint8Array): Promise<string> =>
    toHex(await globalThis.crypto.subtle.digest("SHA-256", arrayBuffer(bytes)));

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

export interface D1ProbeCloudflareWorkerCanaryCleanupDependenciesV1 {
    readonly fetch: typeof globalThis.fetch;
    readonly now: () => number;
}

export type D1ProbeCloudflareWorkerCanaryCleanupDenialV1 =
    | "invalid_cleanup_command"
    | "invalid_canary_plan"
    | "invalid_cleanup_grace"
    | "invalid_cleanup_context"
    | "invalid_commitment_key"
    | "commitment_key_id_mismatch"
    | "cleanup_identity_mismatch"
    | "invalid_api_token"
    | "cleanup_not_active"
    | "cleanup_state_unavailable"
    | "delete_dispatch_not_reserved"
    | "absence_state_not_recorded"
    | "initial_worker_list_unavailable"
    | "planned_worker_ambiguous"
    | "planned_worker_readback_mismatch"
    | "worker_delete_unacknowledged"
    | "worker_id_absence_not_observed"
    | "complete_list_absence_not_observed";

export interface D1ProbeCloudflareWorkerCanaryCleanupResultV1 {
    readonly schema_version: 1;
    readonly kind: "untrusted_d1_probe_cloudflare_worker_api_canary_cleanup_result";
    readonly status: "control_plane_absence_observed";
    readonly planned_worker_name: string;
    readonly plan_digest: string;
    readonly cleanup_grace_digest: string;
    readonly cleanup_execution_scope: "automatic_grace_active";
    readonly worker_delete_attempts: 1;
    readonly worker_id_404_observed: true;
    readonly complete_list_absence_observed: true;
    readonly runtime_identity_verified: false;
    readonly caller_mutation_authority: false;
    readonly authoritative: false;
    readonly eligible_for_upload: false;
    readonly eligible_for_attestation: false;
    readonly lifecycle_advance_allowed: false;
    readonly gate_promotion_allowed: false;
}

export const executeD1ProbeCloudflareWorkerCanaryCleanupCommandV1 = async (
    commandInput: unknown,
    contextInput: unknown,
    hmacKeyInput: string,
    apiTokenInput: unknown,
    dependencies: D1ProbeCloudflareWorkerCanaryCleanupDependenciesV1
): Promise<
    | {
          readonly success: false;
          readonly code: D1ProbeCloudflareWorkerCanaryCleanupDenialV1;
          readonly worker_delete_attempts: 0 | 1;
      }
    | { readonly success: true; readonly result: D1ProbeCloudflareWorkerCanaryCleanupResultV1 }
> => {
    let commandRecord: ReturnType<typeof D1ProbeCloudflareWorkerCanaryCleanupCommandV1Schema.safeParse>;
    try {
        commandRecord = D1ProbeCloudflareWorkerCanaryCleanupCommandV1Schema.safeParse(commandInput);
    } catch {
        return { success: false, code: "invalid_cleanup_command", worker_delete_attempts: 0 };
    }
    if (!commandRecord.success) {
        return { success: false, code: "invalid_cleanup_command", worker_delete_attempts: 0 };
    }
    const plan = await validateD1ProbeCloudflareWorkerCanaryPlanForCleanupV1(commandRecord.data.plan);
    if (plan === null) return { success: false, code: "invalid_canary_plan", worker_delete_attempts: 0 };
    const grace = await validateD1ProbeCloudflareWorkerCanaryCleanupGraceV1(commandRecord.data.cleanup_grace, plan);
    if (grace === null) return { success: false, code: "invalid_cleanup_grace", worker_delete_attempts: 0 };

    let context: ReturnType<typeof CleanupContextV1Schema.safeParse>;
    try {
        context = CleanupContextV1Schema.safeParse(contextInput);
    } catch {
        return { success: false, code: "invalid_cleanup_context", worker_delete_attempts: 0 };
    }
    if (!context.success) return { success: false, code: "invalid_cleanup_context", worker_delete_attempts: 0 };
    let keyRecord: ReturnType<typeof D1ProbeCommitmentKeyV1Schema.safeParse>;
    try {
        keyRecord = D1ProbeCommitmentKeyV1Schema.safeParse({ hmac_key_base64url: hmacKeyInput });
    } catch {
        return { success: false, code: "invalid_commitment_key", worker_delete_attempts: 0 };
    }
    if (!keyRecord.success) return { success: false, code: "invalid_commitment_key", worker_delete_attempts: 0 };
    const rawKey = decodeBase64Url(keyRecord.data.hmac_key_base64url);
    if (rawKey === null || rawKey.byteLength < 32 || rawKey.byteLength > 64) {
        rawKey?.fill(0);
        return { success: false, code: "invalid_commitment_key", worker_delete_attempts: 0 };
    }
    let keyId: string;
    let hmacKey: CryptoKey;
    try {
        keyId = await deriveKeyId(rawKey);
        hmacKey = await importHmacKey(rawKey);
    } catch {
        rawKey.fill(0);
        return { success: false, code: "invalid_commitment_key", worker_delete_attempts: 0 };
    }
    rawKey.fill(0);
    if (keyId !== plan.commitment_key_id_digest) {
        return { success: false, code: "commitment_key_id_mismatch", worker_delete_attempts: 0 };
    }
    let attemptCommitment: string;
    let workerCommitment: string | null;
    try {
        attemptCommitment = await hmacIdentity(hmacKey, ATTEMPT_TAG_IDENTITY_DOMAIN_V1, context.data.attempt_tag);
        workerCommitment =
            grace.worker_id === null ? null : await hmacIdentity(hmacKey, WORKER_IDENTITY_DOMAIN_V1, grace.worker_id);
    } catch {
        return { success: false, code: "invalid_commitment_key", worker_delete_attempts: 0 };
    }
    if (workerCommitment !== grace.worker_id_commitment || attemptCommitment !== grace.attempt_tag_commitment) {
        return { success: false, code: "cleanup_identity_mismatch", worker_delete_attempts: 0 };
    }
    if (!ApiTokenV1Schema.safeParse(apiTokenInput).success) {
        return { success: false, code: "invalid_api_token", worker_delete_attempts: 0 };
    }

    const cleanupClock = (): number | null => {
        try {
            const now = dependencies.now();
            return Number.isSafeInteger(now) && now >= plan.not_before_ms && now < grace.automatic_cleanup_expires_at_ms
                ? now
                : null;
        } catch {
            return null;
        }
    };
    const initialCleanupNow = cleanupClock();
    if (initialCleanupNow === null) return { success: false, code: "cleanup_not_active", worker_delete_attempts: 0 };
    const cleanupExecutionScope = "automatic_grace_active" as const;

    const durableState = await readD1ProbeCloudflareWorkerCanaryStateV1(plan.plan_digest);
    if (
        !durableState.success ||
        durableState.operation.state !== "cleanup_reconciling" ||
        durableState.operation.attempt_tag !== context.data.attempt_tag ||
        durableState.operation.worker_id !== grace.worker_id
    ) {
        return { success: false, code: "cleanup_state_unavailable", worker_delete_attempts: 0 };
    }

    let aggregateBytes = 0;
    let workerDeleteAttempts: 0 | 1 = 0;
    const requestJson = async (
        method: "GET" | "DELETE",
        path: string,
        acceptedStatuses: readonly number[] = [200]
    ): Promise<{ ok: true; status: number; json: unknown } | { ok: false }> => {
        if (cleanupClock() === null) return { ok: false };
        try {
            const response = await dependencies.fetch(`${API_ROOT_V1}${path}`, {
                method,
                redirect: "manual",
                signal: AbortSignal.timeout(20_000),
                headers: {
                    Accept: "application/json",
                    "Accept-Encoding": "identity",
                    Authorization: `Bearer ${apiTokenInput as string}`,
                },
            });
            const encoding = response.headers.get("content-encoding");
            const contentType = response.headers.get("content-type") ?? "";
            if (response.type === "opaqueredirect" || (encoding !== null && encoding !== "identity")) {
                return { ok: false };
            }
            const declaredLength = response.headers.get("content-length");
            if (
                declaredLength !== null &&
                (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES_V1)
            ) {
                return { ok: false };
            }
            const reader = response.body?.getReader();
            if (reader === undefined) return { ok: false };
            const chunks: Uint8Array[] = [];
            let responseSize = 0;
            for (;;) {
                const chunk = await reader.read();
                if (chunk.done) break;
                responseSize += chunk.value.byteLength;
                if (responseSize > MAX_RESPONSE_BYTES_V1) {
                    await reader.cancel().catch(() => undefined);
                    return { ok: false };
                }
                chunks.push(chunk.value);
            }
            aggregateBytes += responseSize;
            if (aggregateBytes > MAX_AGGREGATE_RESPONSE_BYTES_V1 || cleanupClock() === null) return { ok: false };
            if (
                !acceptedStatuses.includes(response.status) ||
                !contentType.toLowerCase().startsWith("application/json")
            ) {
                return { ok: false };
            }
            const bytes = new Uint8Array(responseSize);
            let offset = 0;
            for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.byteLength;
            }
            try {
                return {
                    ok: true,
                    status: response.status,
                    json: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown,
                };
            } catch {
                return { ok: false };
            }
        } catch {
            return { ok: false };
        }
    };

    const parseEnvelope = (input: unknown) => {
        const parsed = EnvelopeV1Schema.safeParse(input);
        return parsed.success ? parsed.data : null;
    };

    const listWorkers = async (): Promise<z.infer<typeof WorkerV1Schema>[] | null> => {
        const workers: z.infer<typeof WorkerV1Schema>[] = [];
        let expectedTotalCount: number | null = null;
        let expectedTotalPages: number | null = null;
        for (let page = 1; page <= MAX_PAGES_V1; page += 1) {
            const response = await requestJson(
                "GET",
                `/accounts/${plan.account_id}/workers/workers?page=${page}&per_page=100&order_by=name&order=asc`
            );
            if (!response.ok) return null;
            const envelope = parseEnvelope(response.json);
            const pageWorkers = z.array(WorkerV1Schema).safeParse(envelope?.result);
            const resultInfo = CompleteResultInfoV1Schema.safeParse(envelope?.result_info);
            if (!pageWorkers.success || !resultInfo.success) return null;
            const effectiveTotalPages =
                resultInfo.data.total_pages === 0 && resultInfo.data.total_count === 0
                    ? 1
                    : resultInfo.data.total_pages;
            if (
                resultInfo.data.page !== page ||
                resultInfo.data.count !== pageWorkers.data.length ||
                effectiveTotalPages !== Math.max(1, Math.ceil(resultInfo.data.total_count / 100)) ||
                page > effectiveTotalPages ||
                (expectedTotalCount !== null && expectedTotalCount !== resultInfo.data.total_count) ||
                (expectedTotalPages !== null && expectedTotalPages !== effectiveTotalPages)
            ) {
                return null;
            }
            expectedTotalCount ??= resultInfo.data.total_count;
            expectedTotalPages ??= effectiveTotalPages;
            workers.push(...pageWorkers.data);
            if (new Set(workers.map(worker => worker.id)).size !== workers.length) return null;
            if (page === effectiveTotalPages) {
                return workers.length === resultInfo.data.total_count ? workers : null;
            }
        }
        return null;
    };

    const workerOwnedByPlan = (worker: z.infer<typeof WorkerV1Schema>, expectedWorkerId: string): boolean =>
        worker.id === expectedWorkerId &&
        worker.name === plan.script_name &&
        worker.tags !== undefined &&
        worker.tags.length === 2 &&
        new Set(worker.tags).size === 2 &&
        worker.tags.includes(plan.markers.ownership_tag) &&
        worker.tags.includes(context.data.attempt_tag);

    const initialWorkers = await listWorkers();
    if (initialWorkers === null) {
        return { success: false, code: "initial_worker_list_unavailable", worker_delete_attempts: 0 };
    }
    const correlatedWorkers = initialWorkers.filter(
        worker =>
            (grace.worker_id !== null && worker.id === grace.worker_id) ||
            worker.name === plan.script_name ||
            worker.tags?.includes(plan.markers.ownership_tag) === true ||
            worker.tags?.includes(context.data.attempt_tag) === true
    );
    if (correlatedWorkers.length !== 1) {
        return { success: false, code: "planned_worker_ambiguous", worker_delete_attempts: 0 };
    }
    const discoveredWorkerId = correlatedWorkers[0]?.id;
    if (
        discoveredWorkerId === undefined ||
        (grace.worker_id !== null && discoveredWorkerId !== grace.worker_id) ||
        !workerOwnedByPlan(correlatedWorkers[0] as z.infer<typeof WorkerV1Schema>, discoveredWorkerId)
    ) {
        return { success: false, code: "planned_worker_ambiguous", worker_delete_attempts: 0 };
    }

    const exactPath = `/accounts/${plan.account_id}/workers/workers/${discoveredWorkerId}`;
    const readback = await requestJson("GET", exactPath);
    const readbackEnvelope = readback.ok ? parseEnvelope(readback.json) : null;
    const exactWorker = WorkerV1Schema.safeParse(readbackEnvelope?.result);
    if (!exactWorker.success || !workerOwnedByPlan(exactWorker.data, discoveredWorkerId)) {
        return { success: false, code: "planned_worker_readback_mismatch", worker_delete_attempts: 0 };
    }

    const deleteDispatchCandidate = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(
        durableState.operation,
        "delete_dispatching",
        cleanupClock() ?? durableState.operation.updated_at_ms,
        { worker_id: discoveredWorkerId }
    );
    const deleteDispatch = await transitionD1ProbeCloudflareWorkerCanaryStateV1(
        plan.plan_digest,
        durableState.operation.revision,
        deleteDispatchCandidate
    );
    if (!deleteDispatch.success) {
        return { success: false, code: "delete_dispatch_not_reserved", worker_delete_attempts: 0 };
    }
    workerDeleteAttempts = 1;
    const deletion = await requestJson("DELETE", exactPath);
    const deletionEnvelope = deletion.ok ? parseEnvelope(deletion.json) : null;
    if (deletionEnvelope === null) {
        return { success: false, code: "worker_delete_unacknowledged", worker_delete_attempts: workerDeleteAttempts };
    }
    const exactAbsence = await requestJson("GET", exactPath, [404]);
    if (!exactAbsence.ok || exactAbsence.status !== 404) {
        return { success: false, code: "worker_id_absence_not_observed", worker_delete_attempts: workerDeleteAttempts };
    }
    const finalWorkers = await listWorkers();
    if (
        finalWorkers === null ||
        finalWorkers.some(
            worker =>
                worker.id === discoveredWorkerId ||
                worker.name === plan.script_name ||
                worker.tags?.includes(plan.markers.ownership_tag) === true ||
                worker.tags?.includes(context.data.attempt_tag) === true
        )
    ) {
        return {
            success: false,
            code: "complete_list_absence_not_observed",
            worker_delete_attempts: workerDeleteAttempts,
        };
    }

    const absenceCandidate = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(
        deleteDispatch.operation,
        "absence_observed",
        cleanupClock() ?? deleteDispatch.operation.updated_at_ms
    );
    const absence = await transitionD1ProbeCloudflareWorkerCanaryStateV1(
        plan.plan_digest,
        deleteDispatch.operation.revision,
        absenceCandidate
    );
    if (!absence.success) {
        return { success: false, code: "absence_state_not_recorded", worker_delete_attempts: 1 };
    }

    return {
        success: true,
        result: {
            schema_version: 1,
            kind: "untrusted_d1_probe_cloudflare_worker_api_canary_cleanup_result",
            status: "control_plane_absence_observed",
            planned_worker_name: plan.script_name,
            plan_digest: plan.plan_digest,
            cleanup_grace_digest: grace.cleanup_grace_digest,
            cleanup_execution_scope: cleanupExecutionScope,
            worker_delete_attempts: 1,
            worker_id_404_observed: true,
            complete_list_absence_observed: true,
            runtime_identity_verified: false,
            caller_mutation_authority: false,
            authoritative: false,
            eligible_for_upload: false,
            eligible_for_attestation: false,
            lifecycle_advance_allowed: false,
            gate_promotion_allowed: false,
        },
    };
};
