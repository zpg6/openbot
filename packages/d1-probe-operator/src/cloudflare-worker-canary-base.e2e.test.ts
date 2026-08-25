import { createHmac } from "node:crypto";
import { lstat, readdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { readD1ProbeCloudflareWorkerCanaryBaseRecoveryV1 } from "./cloudflare-worker-canary-base-recovery.js";
import { compileD1ProbeCloudflareWorkerCanaryCleanupCommandV1 } from "./cloudflare-worker-canary-cleanup-grace.js";
import { D1_PROBE_CLOUDFLARE_WORKER_CANARY_CLEANUP_OBLIGATION_ROOT_V1 } from "./cloudflare-worker-canary-cleanup-obligation.js";
import { D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1 } from "./cloudflare-worker-canary-driver-lease.js";
import {
    createD1ProbeCloudflareWorkerCanaryDurableDriverV1,
    type D1ProbeCloudflareWorkerCanaryDurableDriverSessionV1,
} from "./cloudflare-worker-canary-durable-driver.js";
import { readD1ProbeCloudflareWorkerCanaryDurableTranscriptV1 } from "./cloudflare-worker-canary-durable-transcript.js";
import {
    D1_PROBE_CLOUDFLARE_WORKER_CANARY_EFFECT_JOURNAL_ROOT_V1,
    readD1ProbeCloudflareWorkerCanaryEffectJournalReadOnlyV1,
} from "./cloudflare-worker-canary-effect-journal.js";
import {
    buildNextD1ProbeCloudflareWorkerCanaryOperationV1,
    prepareD1ProbeCloudflareWorkerCanaryOperationV1,
    type D1ProbeCloudflareWorkerCanaryOperationV1,
} from "./cloudflare-worker-canary-operation.js";
import { generateD1ProbeCloudflareWorkerApiCanaryCommandV1 } from "./cloudflare-worker-canary-plan.js";
import {
    D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_ROOT_V1,
    readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1,
} from "./cloudflare-worker-canary-response-archive.js";
import {
    D1_PROBE_CLOUDFLARE_WORKER_CANARY_STATE_ROOT_V1,
    createD1ProbeCloudflareWorkerCanaryStateV1,
    readD1ProbeCloudflareWorkerCanaryStateReadOnlyV1,
    transitionD1ProbeCloudflareWorkerCanaryStateV1,
} from "./cloudflare-worker-canary-state.js";
import {
    createD1ProbeCloudflareWorkerCanaryTransportV1,
    type D1ProbeCloudflareWorkerCanaryPreparedDispatchV1,
    type D1ProbeCloudflareWorkerCanaryTransportV1,
} from "./cloudflare-worker-canary-transport.js";

const CONFIG_LIMITS = Object.freeze({
    operations: { default: 3, minimum: 1, maximum: 128 },
    concurrency: { default: 2, minimum: 1, maximum: 16 },
    response_bytes: { default: 4_096, minimum: 32, maximum: 256 * 1024 },
});
const PLAN_ACCOUNT_ID = "b".repeat(32);
const HMAC_KEY_BYTES = Uint8Array.from({ length: 32 }, (_, index) => 64 + index);
const HMAC_KEY_BASE64URL = Buffer.from(HMAC_KEY_BYTES).toString("base64url");
const ATTEMPT_TAG_DOMAIN = "openbot.identity.cloudflare_worker_canary_attempt_tag.v1";
const SYNTHETIC_API_TOKEN = "base-layer-e2e-injected-fetch-only";
const ROOTS = [
    D1_PROBE_CLOUDFLARE_WORKER_CANARY_STATE_ROOT_V1,
    D1_PROBE_CLOUDFLARE_WORKER_CANARY_DRIVER_LEASE_ROOT_V1,
    D1_PROBE_CLOUDFLARE_WORKER_CANARY_EFFECT_JOURNAL_ROOT_V1,
    D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_ROOT_V1,
    D1_PROBE_CLOUDFLARE_WORKER_CANARY_CLEANUP_OBLIGATION_ROOT_V1,
] as const;

const benchmarkPlanDigests = new Set<string>();

const readBoundedInteger = (
    name: "OPENBOT_BASE_E2E_OPERATIONS" | "OPENBOT_BASE_E2E_CONCURRENCY" | "OPENBOT_BASE_E2E_RESPONSE_BYTES",
    limits: { readonly default: number; readonly minimum: number; readonly maximum: number }
): number => {
    const raw = process.env[name];
    if (raw === undefined) return limits.default;
    if (!/^\d+$/u.test(raw)) throw new Error(`${name} must be a decimal integer`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < limits.minimum || value > limits.maximum) {
        throw new Error(`${name} must be between ${limits.minimum} and ${limits.maximum}`);
    }
    return value;
};

const scale = Object.freeze({
    operations: readBoundedInteger("OPENBOT_BASE_E2E_OPERATIONS", CONFIG_LIMITS.operations),
    concurrency: readBoundedInteger("OPENBOT_BASE_E2E_CONCURRENCY", CONFIG_LIMITS.concurrency),
    response_bytes: readBoundedInteger("OPENBOT_BASE_E2E_RESPONSE_BYTES", CONFIG_LIMITS.response_bytes),
});

const round = (value: number): number => Math.round(value * 1_000) / 1_000;

const percentile = (values: readonly number[], fraction: number): number => {
    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
    return round(sorted[index] ?? 0);
};

const latencySummary = (values: readonly number[]) => ({
    minimum: round(Math.min(...values)),
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
    maximum: round(Math.max(...values)),
    mean: round(values.reduce((total, value) => total + value, 0) / values.length),
});

const deterministicRandom = (operationIndex: number) => {
    let draw = 0;
    return (byteLength: number): Uint8Array => {
        const bytes = new Uint8Array(byteLength);
        if (draw === 0 && byteLength === 16) {
            bytes.fill(17);
            new DataView(bytes.buffer).setUint32(12, operationIndex + 1);
        } else {
            const suffix = (operationIndex + 1).toString(36).padStart(8, "0") + "basee2e0";
            const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
            for (let index = 0; index < Math.min(16, byteLength); index += 1) {
                bytes[index] = alphabet.indexOf(suffix[index] ?? "a");
            }
        }
        draw += 1;
        return bytes;
    };
};

const attemptTagFor = (operationIndex: number): string =>
    `openbot-canary-attempt-${(operationIndex + 1_000_000).toString(16).padStart(32, "0")}`;

const archiveKeyFor = (operationIndex: number): Uint8Array =>
    Uint8Array.from({ length: 32 }, (_, index) => (operationIndex * 29 + index * 7 + 1) % 256);

const attemptTagCommitment = (attemptTag: string): string =>
    createHmac("sha256", HMAC_KEY_BYTES)
        .update(`${ATTEMPT_TAG_DOMAIN}\u0000${JSON.stringify(attemptTag)}`)
        .digest("hex");

const responseBody = (targetBytes: number): string => {
    const empty = JSON.stringify({ payload: "" });
    return JSON.stringify({ payload: "x".repeat(targetBytes - Buffer.byteLength(empty)) });
};

const removePlanRecords = async (planDigest: string): Promise<void> => {
    if (!/^[0-9a-f]{64}$/u.test(planDigest)) throw new Error("invalid benchmark plan digest");
    for (const root of ROOTS) {
        let names: string[];
        try {
            names = await readdir(root);
        } catch (error) {
            if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") continue;
            throw error;
        }
        for (const name of names.filter(candidate => candidate.startsWith(`${planDigest}.`))) {
            const path = resolve(root, name);
            let stat: Awaited<ReturnType<typeof lstat>>;
            try {
                stat = await lstat(path);
            } catch (error) {
                if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
                    continue;
                }
                throw error;
            }
            if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("unsafe benchmark record cleanup target");
            await unlink(path).catch(error => {
                if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "ENOENT") {
                    throw error;
                }
            });
        }
    }
};

interface OperationMeasurements {
    readonly total_ms: number;
    readonly setup_ms: number;
    readonly prepared_read_ms: number;
    readonly shell_create_ms: number;
    readonly cleanup_read_ms: number;
    readonly recovery_ms: number;
    readonly record_cleanup_ms: number;
}

const transition = async (
    operation: D1ProbeCloudflareWorkerCanaryOperationV1,
    state: "shell_dispatching" | "cleanup_reconciling" | "delete_dispatching"
): Promise<D1ProbeCloudflareWorkerCanaryOperationV1> => {
    const next = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(
        operation,
        state,
        Date.now(),
        state === "cleanup_reconciling" ? { worker_id: "benchmark-worker" } : {}
    );
    const result = await transitionD1ProbeCloudflareWorkerCanaryStateV1(
        operation.plan.plan_digest,
        operation.revision,
        next
    );
    if (!result.success) throw new Error(`state transition failed: ${result.code}`);
    return result.operation;
};

const dispatch = async (
    transport: D1ProbeCloudflareWorkerCanaryTransportV1,
    driver: D1ProbeCloudflareWorkerCanaryDurableDriverSessionV1,
    operation: D1ProbeCloudflareWorkerCanaryOperationV1,
    workflowStep: "prepared_worker_list" | "shell_create" | "cleanup_worker_readback",
    prepared: D1ProbeCloudflareWorkerCanaryPreparedDispatchV1 | null,
    archiveKey: Uint8Array
): Promise<void> => {
    if (prepared === null) throw new Error("request preparation failed");
    const claims = await driver.create_request_session({
        operation,
        workflow_step: workflowStep,
        archive_key: archiveKey,
    });
    if (!claims.success) throw new Error(`response claim session failed: ${claims.code}`);
    try {
        const result = await transport.dispatch(
            prepared,
            claims.record_dispatch_and_bind,
            claims.capture_response_preimage
        );
        if (!result.ok || result.status !== 200) throw new Error("composed request session failed");
    } finally {
        claims.discard();
    }
};

const runOperation = async (operationIndex: number, targetResponseBytes: number): Promise<OperationMeasurements> => {
    const totalStarted = performance.now();
    let planDigest: string | null = null;
    try {
        const setupStarted = performance.now();
        const generated = await generateD1ProbeCloudflareWorkerApiCanaryCommandV1(
            {
                schema_version: 1,
                kind: "d1_probe_cloudflare_worker_api_canary_plan_request",
                account_id: PLAN_ACCOUNT_ID,
            },
            { hmac_key_base64url: HMAC_KEY_BASE64URL },
            { now: Date.now, randomBytes: deterministicRandom(operationIndex) }
        );
        if (!generated.success) throw new Error(`plan generation failed: ${generated.code}`);
        const plan = generated.command.plan;
        planDigest = plan.plan_digest;
        benchmarkPlanDigests.add(planDigest);
        const attemptTag = attemptTagFor(operationIndex);
        const preparedOperation = await prepareD1ProbeCloudflareWorkerCanaryOperationV1(
            plan,
            attemptTag,
            plan.not_before_ms
        );
        if (!preparedOperation.success) throw new Error(`operation preparation failed: ${preparedOperation.code}`);
        let operation = preparedOperation.operation;
        const cleanupCommand = await compileD1ProbeCloudflareWorkerCanaryCleanupCommandV1(plan, {
            worker_id: null,
            worker_id_commitment: null,
            attempt_tag_commitment: attemptTagCommitment(attemptTag),
        });
        if (!cleanupCommand.success) throw new Error(`cleanup grace compilation failed: ${cleanupCommand.code}`);
        const durableDriver = await createD1ProbeCloudflareWorkerCanaryDurableDriverV1({
            operation,
            cleanup_grace: cleanupCommand.command.cleanup_grace,
            lease_duration_ms: 300_000,
        });
        if (!durableDriver.success) throw new Error(`durable driver failed: ${durableDriver.code}`);
        const cleanupObligationDigest = durableDriver.session.cleanup_obligation_digest;
        const body = responseBody(targetResponseBytes);
        const transport = createD1ProbeCloudflareWorkerCanaryTransportV1({
            api_token: SYNTHETIC_API_TOKEN,
            fetch: async (input, init) => {
                if (
                    typeof input !== "string" ||
                    !input.startsWith("https://api.cloudflare.com/client/v4/accounts/") ||
                    init?.headers === undefined ||
                    !JSON.stringify(init.headers).includes(SYNTHETIC_API_TOKEN)
                ) {
                    throw new Error("benchmark transport escaped its injected responder");
                }
                return new Response(body, {
                    status: 200,
                    headers: {
                        "Content-Type": "application/json",
                        "Content-Length": String(Buffer.byteLength(body)),
                    },
                });
            },
            now: Date.now,
            forward_window: { not_before_ms: plan.not_before_ms, expires_at_ms: plan.expires_at_ms },
            cleanup_window: {
                not_before_ms: cleanupCommand.command.cleanup_grace.automatic_cleanup_not_before_ms,
                expires_at_ms: cleanupCommand.command.cleanup_grace.automatic_cleanup_expires_at_ms,
            },
        });
        const setupMs = performance.now() - setupStarted;

        const preparedReadStarted = performance.now();
        await dispatch(
            transport,
            durableDriver.session,
            operation,
            "prepared_worker_list",
            await transport.prepare.forward.get(`/accounts/${PLAN_ACCOUNT_ID}/workers/workers?page=1&per_page=100`),
            archiveKeyFor(operationIndex)
        );
        const preparedReadMs = performance.now() - preparedReadStarted;

        operation = await transition(operation, "shell_dispatching");
        const shellCreateStarted = performance.now();
        await dispatch(
            transport,
            durableDriver.session,
            operation,
            "shell_create",
            await transport.prepare.forward.post(
                `/accounts/${PLAN_ACCOUNT_ID}/workers/workers`,
                { benchmark_marker: "fixed-local-response" },
                [200]
            ),
            archiveKeyFor(operationIndex)
        );
        const shellCreateMs = performance.now() - shellCreateStarted;

        operation = await transition(operation, "cleanup_reconciling");
        const cleanupReadStarted = performance.now();
        await dispatch(
            transport,
            durableDriver.session,
            operation,
            "cleanup_worker_readback",
            await transport.prepare.cleanup.get(`/accounts/${PLAN_ACCOUNT_ID}/workers/workers/benchmark-worker`),
            archiveKeyFor(operationIndex)
        );
        const cleanupReadMs = performance.now() - cleanupReadStarted;
        operation = await transition(operation, "delete_dispatching");

        const recoveryStarted = performance.now();
        const [recovery, durableTranscript, state, journal, archive] = await Promise.all([
            readD1ProbeCloudflareWorkerCanaryBaseRecoveryV1(planDigest),
            readD1ProbeCloudflareWorkerCanaryDurableTranscriptV1(planDigest),
            readD1ProbeCloudflareWorkerCanaryStateReadOnlyV1(planDigest),
            readD1ProbeCloudflareWorkerCanaryEffectJournalReadOnlyV1(planDigest),
            readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1(planDigest),
        ]);
        const recoveryMs = performance.now() - recoveryStarted;
        if (
            recovery.classification !== "local_histories_aligned" ||
            recovery.recovery_requirement !== "none" ||
            recovery.archive_record_count !== 3 ||
            recovery.claim_cleanup_obligation_digest !== cleanupObligationDigest ||
            recovery.archive_head_cleanup_obligation_digest !== cleanupObligationDigest ||
            recovery.mutation_replay_allowed !== false ||
            recovery.cleanup_authorized !== false ||
            recovery.recovery_action_authorized !== false ||
            durableTranscript.classification !== "durable_prefix_complete" ||
            durableTranscript.entry_count !== 3 ||
            durableTranscript.complete_response_archive_count !== 3 ||
            durableTranscript.transcript_digest === null ||
            durableTranscript.mutation_replay_allowed !== false ||
            durableTranscript.cleanup_authorized !== false ||
            durableTranscript.entries.some((entry, index) => {
                const volatileEntry = transport.transcript[index];
                return (
                    volatileEntry === undefined ||
                    entry.sequence !== volatileEntry.sequence ||
                    entry.method !== volatileEntry.method ||
                    entry.request_digest !== volatileEntry.request_digest ||
                    entry.request_path_digest !== volatileEntry.path_digest ||
                    entry.response_status !== volatileEntry.status ||
                    entry.response_digest !== volatileEntry.response_digest
                );
            }) ||
            !state.success ||
            state.operation.revision !== 3 ||
            state.operation.state !== "delete_dispatching" ||
            !journal.success ||
            journal.claims.length !== 9 ||
            journal.claims.slice(0, 6).some(claim => claim.cleanup_obligation_digest !== null) ||
            journal.claims.slice(6).some(claim => claim.cleanup_obligation_digest !== cleanupObligationDigest) ||
            !archive.success ||
            archive.inventory.records.length !== 3 ||
            archive.inventory.records[0]?.cleanup_obligation_digest !== null ||
            archive.inventory.records[1]?.cleanup_obligation_digest !== null ||
            archive.inventory.records[2]?.cleanup_obligation_digest !== cleanupObligationDigest ||
            transport.transcript.length !== 3 ||
            transport.transcript.some(entry => entry.status !== 200 || entry.response_digest === null)
        ) {
            throw new Error(
                `base-layer convergence failed: ${JSON.stringify({
                    recovery: [recovery.classification, recovery.recovery_requirement, recovery.archive_record_count],
                    durable_transcript: [
                        durableTranscript.classification,
                        durableTranscript.entry_count,
                        durableTranscript.complete_response_archive_count,
                    ],
                    state: state.success ? [state.operation.revision, state.operation.state] : state.code,
                    journal: journal.success
                        ? journal.claims.map(claim => [
                              claim.journal_revision,
                              claim.workflow_step,
                              claim.effect_phase,
                              claim.cleanup_obligation_digest === null,
                          ])
                        : journal.code,
                    archive: archive.success
                        ? archive.inventory.records.map(record => [
                              record.journal_revision,
                              record.transcript_sequence,
                              record.cleanup_obligation_digest === null,
                          ])
                        : archive.code,
                    transcript: transport.transcript.map(entry => [entry.sequence, entry.status]),
                })}`
            );
        }

        const cleanupStarted = performance.now();
        await removePlanRecords(planDigest);
        benchmarkPlanDigests.delete(planDigest);
        const recordCleanupMs = performance.now() - cleanupStarted;
        return {
            total_ms: performance.now() - totalStarted,
            setup_ms: setupMs,
            prepared_read_ms: preparedReadMs,
            shell_create_ms: shellCreateMs,
            cleanup_read_ms: cleanupReadMs,
            recovery_ms: recoveryMs,
            record_cleanup_ms: recordCleanupMs,
        };
    } finally {
        if (planDigest !== null && benchmarkPlanDigests.has(planDigest)) {
            await removePlanRecords(planDigest);
            benchmarkPlanDigests.delete(planDigest);
        }
    }
};

const runPool = async (operations: number, concurrency: number, targetResponseBytes: number) => {
    const results = new Array<OperationMeasurements>(operations);
    const failures: unknown[] = [];
    let next = 0;
    await Promise.all(
        Array.from({ length: Math.min(operations, concurrency) }, async () => {
            for (;;) {
                const index = next;
                next += 1;
                if (index >= operations) return;
                try {
                    results[index] = await runOperation(index, targetResponseBytes);
                } catch (error) {
                    failures.push(error);
                }
            }
        })
    );
    if (failures.length > 0) throw failures[0];
    return results;
};

let throughputReport: Record<string, unknown> | null = null;
let contentionReport: Record<string, unknown> | null = null;
let durableSessionContentionReport: Record<string, unknown> | null = null;

describe("Cloudflare Worker canary base-layer E2E benchmark", () => {
    it("runs the durable state, lease, effect, archive, obligation, and recovery path at configurable scale", async () => {
        const started = performance.now();
        const measurements = await runPool(scale.operations, scale.concurrency, scale.response_bytes);
        const durationMs = performance.now() - started;
        expect(measurements).toHaveLength(scale.operations);
        expect(measurements.every(value => value.total_ms > 0)).toBe(true);
        throughputReport = {
            workload: "worker_canary_local_durability_v1",
            operations: scale.operations,
            concurrency: Math.min(scale.operations, scale.concurrency),
            requests: scale.operations * 3,
            state_records: scale.operations * 4,
            effect_claims: scale.operations * 9,
            encrypted_response_archives: scale.operations * 3,
            durable_transcripts_reconstructed: scale.operations,
            driver_bootstraps: scale.operations,
            cleanup_obligations: scale.operations,
            response_body_bytes_per_request: scale.response_bytes,
            duration_ms: round(durationMs),
            operations_per_second: round((scale.operations * 1_000) / durationMs),
            response_mebibytes_per_second: round(
                (scale.operations * 3 * scale.response_bytes * 1_000) / durationMs / (1024 * 1024)
            ),
            operation_latency_ms: latencySummary(measurements.map(value => value.total_ms)),
            phase_mean_ms: {
                setup: latencySummary(measurements.map(value => value.setup_ms)).mean,
                prepared_read: latencySummary(measurements.map(value => value.prepared_read_ms)).mean,
                shell_create: latencySummary(measurements.map(value => value.shell_create_ms)).mean,
                cleanup_read: latencySummary(measurements.map(value => value.cleanup_read_ms)).mean,
                recovery: latencySummary(measurements.map(value => value.recovery_ms)).mean,
                record_cleanup: latencySummary(measurements.map(value => value.record_cleanup_ms)).mean,
            },
        };
    }, 600_000);

    it("keeps one state revision-zero winner under same-plan publication contention", async () => {
        const operationIndex = 900_000;
        const generated = await generateD1ProbeCloudflareWorkerApiCanaryCommandV1(
            {
                schema_version: 1,
                kind: "d1_probe_cloudflare_worker_api_canary_plan_request",
                account_id: PLAN_ACCOUNT_ID,
            },
            { hmac_key_base64url: HMAC_KEY_BASE64URL },
            { now: Date.now, randomBytes: deterministicRandom(operationIndex) }
        );
        expect(generated.success).toBe(true);
        if (!generated.success) return;
        const prepared = await prepareD1ProbeCloudflareWorkerCanaryOperationV1(
            generated.command.plan,
            attemptTagFor(operationIndex),
            generated.command.plan.not_before_ms
        );
        expect(prepared.success).toBe(true);
        if (!prepared.success) return;
        const planDigest = generated.command.plan.plan_digest;
        benchmarkPlanDigests.add(planDigest);
        const contenders = Math.min(64, Math.max(8, scale.concurrency * 4));
        const started = performance.now();
        try {
            const results = await Promise.all(
                Array.from(
                    { length: contenders },
                    async () => await createD1ProbeCloudflareWorkerCanaryStateV1(prepared.operation)
                )
            );
            const durationMs = performance.now() - started;
            const winners = results.filter(result => result.success);
            const denials = results.filter(result => !result.success);
            expect(winners).toHaveLength(1);
            expect(
                denials.every(
                    result =>
                        !result.success &&
                        (result.code === "state_already_exists" || result.code === "concurrent_state_write")
                )
            ).toBe(true);
            const stored = await readD1ProbeCloudflareWorkerCanaryStateReadOnlyV1(planDigest);
            expect(stored.success).toBe(true);
            expect(stored.success ? stored.operation.revision : null).toBe(0);
            contentionReport = {
                workload: "worker_canary_state_revision_zero_contention_v1",
                contenders,
                winners: winners.length,
                safe_denials: denials.length,
                duration_ms: round(durationMs),
                attempts_per_second: round((contenders * 1_000) / durationMs),
            };
        } finally {
            await removePlanRecords(planDigest);
            benchmarkPlanDigests.delete(planDigest);
        }
    }, 120_000);

    it("opens exact request sessions and rejects identity substitutions under parallel load", async () => {
        const operationIndex = 910_000;
        const generated = await generateD1ProbeCloudflareWorkerApiCanaryCommandV1(
            {
                schema_version: 1,
                kind: "d1_probe_cloudflare_worker_api_canary_plan_request",
                account_id: PLAN_ACCOUNT_ID,
            },
            { hmac_key_base64url: HMAC_KEY_BASE64URL },
            { now: Date.now, randomBytes: deterministicRandom(operationIndex) }
        );
        expect(generated.success).toBe(true);
        if (!generated.success) return;
        const prepared = await prepareD1ProbeCloudflareWorkerCanaryOperationV1(
            generated.command.plan,
            attemptTagFor(operationIndex),
            generated.command.plan.not_before_ms
        );
        expect(prepared.success).toBe(true);
        if (!prepared.success) return;
        const operation = prepared.operation;
        const planDigest = operation.plan.plan_digest;
        benchmarkPlanDigests.add(planDigest);
        try {
            const cleanupCommand = await compileD1ProbeCloudflareWorkerCanaryCleanupCommandV1(operation.plan, {
                worker_id: null,
                worker_id_commitment: null,
                attempt_tag_commitment: attemptTagCommitment(operation.attempt_tag),
            });
            expect(cleanupCommand.success).toBe(true);
            if (!cleanupCommand.success) return;
            const durableDriver = await createD1ProbeCloudflareWorkerCanaryDurableDriverV1({
                operation,
                cleanup_grace: cleanupCommand.command.cleanup_grace,
                lease_duration_ms: 300_000,
            });
            expect(durableDriver.success).toBe(true);
            if (!durableDriver.success) return;

            const exactContenders = Math.min(256, Math.max(16, scale.operations * 2, scale.concurrency * 8));
            const identitySubstitutions = [
                {
                    field: "plan_digest",
                    operation: {
                        ...operation,
                        plan: { ...operation.plan, plan_digest: "f".repeat(64) },
                    },
                },
                { field: "execution_nonce", operation: { ...operation, execution_nonce: "f".repeat(32) } },
                { field: "script_name", operation: { ...operation, script_name: `${operation.script_name}-foreign` } },
                {
                    field: "ownership_tag",
                    operation: { ...operation, ownership_tag: `${operation.ownership_tag}-foreign` },
                },
                {
                    field: "attempt_tag",
                    operation: { ...operation, attempt_tag: `openbot-canary-attempt-${"f".repeat(32)}` },
                },
            ] as const;
            const adversarialContenders = exactContenders;
            const started = performance.now();
            const [exactResults, adversarialResults] = await Promise.all([
                Promise.all(
                    Array.from({ length: exactContenders }, (_, index) =>
                        durableDriver.session.create_request_session({
                            operation,
                            workflow_step: "prepared_worker_list",
                            archive_key: archiveKeyFor(operationIndex + index),
                        })
                    )
                ),
                Promise.all(
                    Array.from({ length: adversarialContenders }, (_, index) =>
                        durableDriver.session.create_request_session({
                            operation: identitySubstitutions[index % identitySubstitutions.length]?.operation,
                            workflow_step: "prepared_worker_list",
                            archive_key: archiveKeyFor(operationIndex + exactContenders + index),
                        })
                    )
                ),
            ]);
            const durationMs = performance.now() - started;
            expect(
                exactResults.every(
                    result =>
                        result.success &&
                        result.durable_claim_recording_ready === true &&
                        result.remote_dispatch_authorized === false &&
                        result.cleanup_authorized === false &&
                        result.caller_mutation_authority === false &&
                        result.authoritative === false &&
                        result.eligible_for_upload === false &&
                        result.eligible_for_attestation === false &&
                        result.lifecycle_advance_allowed === false &&
                        result.gate_promotion_allowed === false
                )
            ).toBe(true);
            expect(
                adversarialResults.every(
                    result =>
                        !result.success &&
                        result.code === "invalid_request_session" &&
                        result.remote_dispatch_authorized === false &&
                        result.cleanup_authorized === false &&
                        result.caller_mutation_authority === false &&
                        result.authoritative === false &&
                        result.eligible_for_upload === false &&
                        result.eligible_for_attestation === false &&
                        result.lifecycle_advance_allowed === false &&
                        result.gate_promotion_allowed === false
                )
            ).toBe(true);
            for (const result of exactResults) if (result.success) result.discard();

            const [state, journal, archive] = await Promise.all([
                readD1ProbeCloudflareWorkerCanaryStateReadOnlyV1(planDigest),
                readD1ProbeCloudflareWorkerCanaryEffectJournalReadOnlyV1(planDigest),
                readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1(planDigest),
            ]);
            expect(state.success).toBe(true);
            expect(state.success ? [state.operation.revision, state.operation.state] : null).toEqual([0, "prepared"]);
            expect(journal).toMatchObject({ success: false, code: "journal_not_found" });
            expect(archive).toMatchObject({ success: true, inventory: { record_count: 0, records: [] } });
            durableSessionContentionReport = {
                workload: "worker_canary_durable_session_identity_contention_v1",
                concurrency: exactContenders + adversarialContenders,
                exact_identity_attempts: exactContenders,
                exact_identity_sessions_created: exactResults.filter(result => result.success).length,
                identity_substitution_attempts: adversarialContenders,
                identity_substitution_safe_denials: adversarialResults.filter(result => !result.success).length,
                immutable_identity_fields_challenged: identitySubstitutions.map(substitution => substitution.field),
                sessions_discarded_without_hook_execution: exactResults.filter(result => result.success).length,
                effect_claims_written: 0,
                response_archives_written: 0,
                state_revision_after_contention: state.success ? state.operation.revision : null,
                duration_ms: round(durationMs),
                attempts_per_second: round(((exactContenders + adversarialContenders) * 1_000) / durationMs),
            };
        } finally {
            await removePlanRecords(planDigest);
            benchmarkPlanDigests.delete(planDigest);
        }
    }, 120_000);
});

afterAll(async () => {
    for (const planDigest of benchmarkPlanDigests) await removePlanRecords(planDigest);
    benchmarkPlanDigests.clear();
    if (process.env["OPENBOT_BASE_E2E_REPORT"] === "1") {
        console.info(
            `OPENBOT_BASE_LAYER_BENCHMARK ${JSON.stringify({
                schema_version: 1,
                kind: "openbot_base_layer_e2e_benchmark",
                authority: false,
                throughput: throughputReport,
                contention: contentionReport,
                durable_session_contention: durableSessionContentionReport,
            })}`
        );
    }
});
