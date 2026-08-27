import { describe, expect, it, vi } from "vitest";

import type { D1ProbeCloudflareWorkerCanaryBaseRecoveryV1 } from "../src/cloudflare-worker-canary-base-recovery.js";
import {
    openD1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionWithDependenciesTestOnlyV1,
    type D1ProbeCloudflareWorkerCanaryDurableDriverRecoveryTestOnlyDependenciesV1,
} from "../src/cloudflare-worker-canary-durable-driver-recovery.js";
import type {
    D1ProbeCloudflareWorkerCanaryDurableTranscriptEntryV1,
    D1ProbeCloudflareWorkerCanaryDurableTranscriptV1,
} from "../src/cloudflare-worker-canary-durable-transcript.js";
import type {
    D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1,
    D1ProbeCloudflareWorkerCanaryDriverLeaseV1,
} from "../src/cloudflare-worker-canary-driver-lease.js";
import type { D1ProbeCloudflareWorkerCanaryOperationV1 } from "../src/cloudflare-worker-canary-operation.js";

const digest = (character: string): string => character.repeat(64);
const planDigest = digest("a");
const operationDigest = digest("b");
const executionNonceCommitment = digest("c");
const claimDigest = digest("d");
const cleanupObligationDigest = digest("e");
const transcriptDigest = digest("f");
const driverLeaseDigest = digest("3");

const operation: D1ProbeCloudflareWorkerCanaryOperationV1 = {
    schema_version: 1,
    kind: "d1_probe_cloudflare_worker_api_canary_operation",
    revision: 0,
    state: "prepared",
    plan: { plan_digest: planDigest } as D1ProbeCloudflareWorkerCanaryOperationV1["plan"],
    script_name: "openbot-d1-probe-canary-0123456789abcdef",
    ownership_tag: `openbot-canary-owner-${"1".repeat(32)}`,
    attempt_tag: `openbot-canary-attempt-${"2".repeat(32)}`,
    execution_nonce: "2".repeat(32),
    worker_id: null,
    version_id: null,
    deployment_id: null,
    updated_at_ms: 1,
    authoritative: false,
    eligible_for_attestation: false,
    lifecycle_advance_allowed: false,
    gate_promotion_allowed: false,
};

const recoveryFixture = (
    overrides: Partial<D1ProbeCloudflareWorkerCanaryBaseRecoveryV1> = {}
): D1ProbeCloudflareWorkerCanaryBaseRecoveryV1 => ({
    schema_version: 1,
    kind: "untrusted_d1_probe_cloudflare_worker_api_canary_base_recovery",
    plan_digest: planDigest,
    classification: "prepared_without_effect_claim",
    recovery_requirement: "fresh_lease_and_exact_head_reassertion",
    state_operation_revision: 0,
    state_operation_record_digest: operationDigest,
    claim_journal_revision: null,
    claim_digest: null,
    claim_effect_phase: null,
    claim_cleanup_obligation_digest: null,
    driver_lease_generation: 0,
    driver_lease_record_digest: driverLeaseDigest,
    archive_record_count: 0,
    archive_head_claim_digest: null,
    archive_head_record_digest: null,
    archive_head_cleanup_obligation_digest: null,
    mutation_replay_allowed: false,
    cleanup_authorized: false,
    recovery_action_authorized: false,
    local_records_authenticated: false,
    cloudflare_origin_authenticated: false,
    caller_mutation_authority: false,
    authoritative: false,
    eligible_for_upload: false,
    eligible_for_attestation: false,
    lifecycle_advance_allowed: false,
    gate_promotion_allowed: false,
    ...overrides,
});

const transcriptEntry = (
    latestEffectPhase: D1ProbeCloudflareWorkerCanaryDurableTranscriptEntryV1["latest_effect_phase"]
): D1ProbeCloudflareWorkerCanaryDurableTranscriptEntryV1 =>
    ({
        sequence: 0,
        execution_nonce_commitment: executionNonceCommitment,
        latest_effect_phase: latestEffectPhase,
        cleanup_obligation_digest: cleanupObligationDigest,
    }) as D1ProbeCloudflareWorkerCanaryDurableTranscriptEntryV1;

const transcriptFixture = (
    overrides: Partial<D1ProbeCloudflareWorkerCanaryDurableTranscriptV1> = {}
): D1ProbeCloudflareWorkerCanaryDurableTranscriptV1 => ({
    schema_version: 1,
    kind: "untrusted_d1_probe_cloudflare_worker_api_canary_durable_transcript",
    plan_digest: planDigest,
    classification: "local_history_missing",
    entry_count: 0,
    entries: [],
    journal_head_revision: null,
    journal_head_claim_digest: null,
    archive_record_count: 0,
    transcript_digest: transcriptDigest,
    complete_response_archive_count: 0,
    mutation_replay_allowed: false,
    cleanup_authorized: false,
    transcript_authenticated: false,
    cloudflare_origin_authenticated: false,
    caller_mutation_authority: false,
    authoritative: false,
    eligible_for_upload: false,
    eligible_for_attestation: false,
    lifecycle_advance_allowed: false,
    gate_promotion_allowed: false,
    ...overrides,
});

const driverLeaseFixture = (
    overrides: Partial<D1ProbeCloudflareWorkerCanaryDriverLeaseV1> = {}
): D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1 => ({
    success: true,
    lease: {
        state: "active",
        plan_digest: planDigest,
        execution_nonce_commitment: executionNonceCommitment,
        generation: 0,
        caller_mutation_authority: false,
        authoritative: false,
        eligible_for_upload: false,
        eligible_for_attestation: false,
        lifecycle_advance_allowed: false,
        gate_promotion_allowed: false,
        mutation_authority: false,
        ...overrides,
    } as D1ProbeCloudflareWorkerCanaryDriverLeaseV1,
});

const dependenciesFor = (
    recovery: D1ProbeCloudflareWorkerCanaryBaseRecoveryV1,
    transcript: D1ProbeCloudflareWorkerCanaryDurableTranscriptV1,
    overrides: Partial<D1ProbeCloudflareWorkerCanaryDurableDriverRecoveryTestOnlyDependenciesV1> = {}
): D1ProbeCloudflareWorkerCanaryDurableDriverRecoveryTestOnlyDependenciesV1 => ({
    validate_operation: vi.fn(async input => input as D1ProbeCloudflareWorkerCanaryOperationV1),
    digest_operation: vi.fn(async candidate =>
        candidate.plan.plan_digest === operation.plan.plan_digest &&
        candidate.execution_nonce === operation.execution_nonce &&
        candidate.script_name === operation.script_name &&
        candidate.ownership_tag === operation.ownership_tag &&
        candidate.attempt_tag === operation.attempt_tag &&
        candidate.revision === operation.revision
            ? operationDigest
            : digest("9")
    ),
    commit_execution_nonce: vi.fn(async nonce =>
        nonce === operation.execution_nonce ? executionNonceCommitment : digest("9")
    ),
    read_driver_lease_head_read_only: vi.fn(async () => driverLeaseFixture()),
    digest_driver_lease: vi.fn(async () => driverLeaseDigest),
    read_base_recovery: vi.fn(async () => recovery),
    read_durable_transcript: vi.fn(async () => transcript),
    ...overrides,
});

const claimedHistory = (
    classification: D1ProbeCloudflareWorkerCanaryBaseRecoveryV1["classification"],
    recoveryRequirement: D1ProbeCloudflareWorkerCanaryBaseRecoveryV1["recovery_requirement"],
    transcriptClassification: D1ProbeCloudflareWorkerCanaryDurableTranscriptV1["classification"],
    effectPhase: D1ProbeCloudflareWorkerCanaryDurableTranscriptEntryV1["latest_effect_phase"]
) => ({
    recovery: recoveryFixture({
        classification,
        recovery_requirement: recoveryRequirement,
        claim_journal_revision: 0,
        claim_digest: claimDigest,
        claim_effect_phase: effectPhase,
        claim_cleanup_obligation_digest: cleanupObligationDigest,
    }),
    transcript: transcriptFixture({
        classification: transcriptClassification,
        entry_count: 1,
        entries: [transcriptEntry(effectPhase)],
        journal_head_revision: 0,
        journal_head_claim_digest: claimDigest,
    }),
});

describe("Cloudflare Worker canary durable-driver restart recovery", () => {
    it.each([
        {
            name: "prepared history",
            recovery: recoveryFixture(),
            transcript: transcriptFixture(),
            disposition: "fresh_lease_and_exact_head_reassertion",
        },
        {
            name: "intent-only tail",
            ...claimedHistory(
                "intent_only_requires_dead_owner_takeover",
                "dead_owner_proof_and_takeover_before_abandonment",
                "dispatch_intent_tail",
                "dispatch_intent"
            ),
            disposition: "dead_owner_takeover_before_intent_abandonment",
        },
        {
            name: "started tail",
            ...claimedHistory(
                "mutation_outcome_unknown_no_retry",
                "read_only_remote_reconciliation_only",
                "dispatch_started_tail",
                "dispatch_started"
            ),
            disposition: "read_only_remote_reconciliation",
        },
        {
            name: "ambiguous terminal claim",
            ...claimedHistory(
                "mutation_outcome_unknown_no_retry",
                "read_only_remote_reconciliation_only",
                "durable_prefix_complete",
                "dispatch_ambiguous"
            ),
            disposition: "read_only_remote_reconciliation",
        },
        {
            name: "archive-ahead tail",
            ...claimedHistory(
                "archive_ahead_requires_keyed_reconciliation",
                "keyed_archive_reconciliation_without_mutation_replay",
                "archive_ahead",
                "dispatch_started"
            ),
            disposition: "keyed_archive_reconciliation_without_mutation_replay",
        },
        {
            name: "missing terminal archive",
            ...claimedHistory(
                "terminal_claim_missing_archive",
                "archive_repair_or_manual_stop",
                "terminal_archive_missing",
                "response_observed"
            ),
            disposition: "archive_repair_or_manual_stop",
        },
        {
            name: "pending state transition",
            ...claimedHistory(
                "response_observed_state_transition_pending",
                "state_transition_revalidation",
                "durable_prefix_complete",
                "response_observed"
            ),
            disposition: "state_transition_revalidation",
        },
        {
            name: "aligned local histories",
            ...claimedHistory("local_histories_aligned", "none", "durable_prefix_complete", "response_observed"),
            disposition: "local_histories_aligned",
        },
    ])("opens an observation-only session for $name", async ({ recovery, transcript, disposition }) => {
        const dependencies = dependenciesFor(recovery, transcript);
        const result = await openD1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionWithDependenciesTestOnlyV1(
            { operation },
            dependencies
        );
        expect(result).toMatchObject({
            success: true,
            session: {
                plan_digest: planDigest,
                execution_nonce_commitment: executionNonceCommitment,
                operation_record_digest: operationDigest,
                disposition,
                recovery_observation_only: true,
                lease_acquisition_performed: false,
                lease_takeover_performed: false,
                archive_reconciliation_performed: false,
                operation_transition_performed: false,
                remote_dispatch_authorized: false,
                remote_effect_replay_allowed: false,
                ambiguous_remote_effect_retry_allowed: false,
                mutation_replay_allowed: false,
                cleanup_authorized: false,
                recovery_action_authorized: false,
                caller_mutation_authority: false,
                authoritative: false,
                eligible_for_upload: false,
                eligible_for_attestation: false,
                lifecycle_advance_allowed: false,
                gate_promotion_allowed: false,
            },
        });
        expect(result).toMatchObject({
            remote_dispatch_authorized: false,
            remote_effect_replay_allowed: false,
            ambiguous_remote_effect_retry_allowed: false,
            recovery_action_authorized: false,
        });
        expect(dependencies.read_driver_lease_head_read_only).toHaveBeenCalledTimes(2);
        expect(Object.keys(dependencies)).not.toContain("read_driver_lease");
    });

    it("does not serialize the execution nonce, attempt tag, ownership tag, or script name", async () => {
        const result = await openD1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionWithDependenciesTestOnlyV1(
            { operation },
            dependenciesFor(recoveryFixture(), transcriptFixture())
        );
        expect(result.success).toBe(true);
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain(operation.execution_nonce);
        expect(serialized).not.toContain(operation.attempt_tag);
        expect(serialized).not.toContain(operation.ownership_tag);
        expect(serialized).not.toContain(operation.script_name);
        expect(serialized).not.toContain("owner_nonce");
        expect(serialized).not.toContain("owner_pid");
    });

    it("denies mismatched heads, classifications, operation identity, and upstream authority", async () => {
        const cases = [
            dependenciesFor(recoveryFixture({ state_operation_record_digest: digest("7") }), transcriptFixture()),
            dependenciesFor(
                recoveryFixture({ claim_journal_revision: 0 }),
                transcriptFixture({ journal_head_revision: 1 })
            ),
            dependenciesFor(
                recoveryFixture({ classification: "local_histories_corrupt", recovery_requirement: "manual_stop" }),
                transcriptFixture({ classification: "local_history_corrupt" })
            ),
            dependenciesFor(recoveryFixture(), transcriptFixture({ authoritative: true as false })),
            dependenciesFor(recoveryFixture(), transcriptFixture(), {
                read_driver_lease_head_read_only: async () => driverLeaseFixture({ generation: 1 }),
            }),
            dependenciesFor(recoveryFixture(), transcriptFixture(), {
                read_driver_lease_head_read_only: async () => driverLeaseFixture({ mutation_authority: true as false }),
            }),
        ];
        for (const dependencies of cases) {
            await expect(
                openD1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionWithDependenciesTestOnlyV1(
                    { operation },
                    dependencies
                )
            ).resolves.toMatchObject({
                success: false,
                code: "durable_driver_recovery_denied",
                remote_dispatch_authorized: false,
                remote_effect_replay_allowed: false,
                ambiguous_remote_effect_retry_allowed: false,
                recovery_action_authorized: false,
            });
        }

        for (const substituted of [
            { ...operation, plan: { ...operation.plan, plan_digest: digest("8") } },
            { ...operation, execution_nonce: "8".repeat(32) },
            { ...operation, script_name: `${operation.script_name}x` },
            { ...operation, ownership_tag: `${operation.ownership_tag}x` },
            { ...operation, attempt_tag: `openbot-canary-attempt-${"8".repeat(32)}` },
        ]) {
            await expect(
                openD1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionWithDependenciesTestOnlyV1(
                    { operation: substituted },
                    dependenciesFor(recoveryFixture(), transcriptFixture())
                )
            ).resolves.toMatchObject({ success: false, code: "durable_driver_recovery_denied" });
        }
    });

    it("denies observations that change across the recovery read window", async () => {
        const first = transcriptFixture();
        const second = transcriptFixture({ transcript_digest: digest("8") });
        const readDurableTranscript = vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(second);
        await expect(
            openD1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionWithDependenciesTestOnlyV1(
                { operation },
                dependenciesFor(recoveryFixture(), first, { read_durable_transcript: readDurableTranscript })
            )
        ).resolves.toMatchObject({
            success: false,
            code: "durable_driver_recovery_denied",
            mutation_replay_allowed: false,
        });
        expect(readDurableTranscript).toHaveBeenCalledTimes(2);
    });

    it("returns one fixed denial for extra keys, hostile objects, cyclic data, and dependency failures", async () => {
        const dependencies = dependenciesFor(recoveryFixture(), transcriptFixture());
        const hostile = new Proxy(
            {},
            {
                ownKeys: () => {
                    throw new Error("hostile");
                },
            }
        );
        for (const input of [null, {}, { operation, extra: true }, hostile]) {
            await expect(
                openD1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionWithDependenciesTestOnlyV1(
                    input,
                    dependencies
                )
            ).resolves.toMatchObject({ success: false, code: "durable_driver_recovery_denied" });
        }

        const cyclic = recoveryFixture() as D1ProbeCloudflareWorkerCanaryBaseRecoveryV1 & { self?: unknown };
        cyclic.self = cyclic;
        await expect(
            openD1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionWithDependenciesTestOnlyV1(
                { operation },
                dependenciesFor(cyclic, transcriptFixture())
            )
        ).resolves.toMatchObject({ success: false, code: "durable_driver_recovery_denied" });

        await expect(
            openD1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionWithDependenciesTestOnlyV1(
                { operation },
                dependenciesFor(recoveryFixture(), transcriptFixture(), {
                    read_base_recovery: async () => {
                        throw new Error("unavailable");
                    },
                })
            )
        ).resolves.toMatchObject({
            success: false,
            code: "durable_driver_recovery_denied",
            remote_dispatch_authorized: false,
            cleanup_authorized: false,
        });
    });
});
