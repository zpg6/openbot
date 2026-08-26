import { describe, expect, it, vi } from "vitest";

import type { D1ProbeCloudflareWorkerCanaryBaseRecoveryV1 } from "./cloudflare-worker-canary-base-recovery.js";
import type {
    D1ProbeCloudflareWorkerCanaryDurableDriverRecoveryResultV1,
    D1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionV1,
} from "./cloudflare-worker-canary-durable-driver-recovery.js";
import type {
    D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1,
    D1ProbeCloudflareWorkerCanaryDriverLeaseV1,
} from "./cloudflare-worker-canary-driver-lease.js";
import type { D1ProbeCloudflareWorkerCanaryOperationV1 } from "./cloudflare-worker-canary-operation.js";
import {
    planD1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateWithDependenciesTestOnlyV1,
    type D1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateTestOnlyDependenciesV1,
} from "./cloudflare-worker-canary-recovery-state-transition.js";

const digest = (character: string): string => character.repeat(64);
const planDigest = digest("a");
const operationDigest = digest("b");
const nonceCommitment = digest("c");
const claimDigest = digest("d");
const archiveRecordDigest = digest("e");
const transcriptDigest = digest("f");
const leaseDigest = digest("1");

const operation: D1ProbeCloudflareWorkerCanaryOperationV1 = {
    schema_version: 1,
    kind: "d1_probe_cloudflare_worker_api_canary_operation",
    revision: 1,
    state: "shell_dispatching",
    plan: { plan_digest: planDigest } as D1ProbeCloudflareWorkerCanaryOperationV1["plan"],
    script_name: "openbot-d1-probe-canary-0123456789abcdef",
    ownership_tag: `openbot-canary-owner-${"2".repeat(32)}`,
    attempt_tag: `openbot-canary-attempt-${"3".repeat(32)}`,
    execution_nonce: "3".repeat(32),
    worker_id: null,
    version_id: null,
    deployment_id: null,
    updated_at_ms: 10,
    authoritative: false,
    eligible_for_attestation: false,
    lifecycle_advance_allowed: false,
    gate_promotion_allowed: false,
};

const owner: D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1 = {
    plan_digest: planDigest,
    execution_nonce: operation.execution_nonce,
    generation: 3,
    owner_pid: 7,
    owner_nonce: "A".repeat(43),
};

const falseRecoveryAuthority = {
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
} as const;

const sessionFixture = (
    overrides: Partial<D1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionV1> = {}
): D1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionV1 => ({
    schema_version: 1,
    kind: "d1_probe_cloudflare_worker_api_canary_durable_driver_recovery_session",
    plan_digest: planDigest,
    execution_nonce_commitment: nonceCommitment,
    operation_revision: operation.revision,
    operation_state: operation.state,
    operation_record_digest: operationDigest,
    recovery_classification: "response_observed_state_transition_pending",
    recovery_requirement: "state_transition_revalidation",
    transcript_classification: "durable_prefix_complete",
    transcript_digest: transcriptDigest,
    journal_head_revision: 4,
    journal_head_claim_digest: claimDigest,
    archive_record_count: 2,
    disposition: "state_transition_revalidation",
    recovery_observation_only: true,
    lease_acquisition_performed: false,
    lease_takeover_performed: false,
    archive_reconciliation_performed: false,
    operation_transition_performed: false,
    ...falseRecoveryAuthority,
    ...overrides,
});

const recoveryFixture = (
    overrides: Partial<D1ProbeCloudflareWorkerCanaryBaseRecoveryV1> = {}
): D1ProbeCloudflareWorkerCanaryBaseRecoveryV1 => ({
    schema_version: 1,
    kind: "untrusted_d1_probe_cloudflare_worker_api_canary_base_recovery",
    plan_digest: planDigest,
    classification: "response_observed_state_transition_pending",
    recovery_requirement: "state_transition_revalidation",
    state_operation_revision: operation.revision,
    state_operation_record_digest: operationDigest,
    claim_journal_revision: 4,
    claim_digest: claimDigest,
    claim_effect_phase: "response_observed",
    claim_cleanup_obligation_digest: null,
    driver_lease_generation: owner.generation,
    driver_lease_record_digest: leaseDigest,
    archive_record_count: 2,
    archive_head_claim_digest: claimDigest,
    archive_head_record_digest: archiveRecordDigest,
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

const leaseFixture = (
    overrides: Partial<D1ProbeCloudflareWorkerCanaryDriverLeaseV1> = {}
): D1ProbeCloudflareWorkerCanaryDriverLeaseV1 =>
    ({
        state: "active",
        plan_digest: planDigest,
        execution_nonce_commitment: nonceCommitment,
        generation: owner.generation,
        owner_pid: owner.owner_pid,
        caller_mutation_authority: false,
        mutation_authority: false,
        authoritative: false,
        eligible_for_upload: false,
        eligible_for_attestation: false,
        lifecycle_advance_allowed: false,
        gate_promotion_allowed: false,
        ...overrides,
    }) as D1ProbeCloudflareWorkerCanaryDriverLeaseV1;

const opened = (session: D1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionV1) =>
    ({
        success: true,
        session,
        ...falseRecoveryAuthority,
    }) as D1ProbeCloudflareWorkerCanaryDurableDriverRecoveryResultV1;

const dependenciesFor = (
    session = sessionFixture(),
    recovery = recoveryFixture(),
    overrides: Partial<D1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateTestOnlyDependenciesV1> = {}
): D1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateTestOnlyDependenciesV1 => ({
    validate_operation: vi.fn(async input => input as D1ProbeCloudflareWorkerCanaryOperationV1),
    digest_operation: vi.fn(async () => operationDigest),
    commit_execution_nonce: vi.fn(async () => nonceCommitment),
    open_recovery_session: vi.fn(async () => opened(session)),
    read_base_recovery: vi.fn(async () => recovery),
    assert_current_driver_lease_read_only: vi.fn(async () => ({ success: true, lease: leaseFixture() }) as const),
    digest_driver_lease: vi.fn(async () => leaseDigest),
    ...overrides,
});

const inputFor = (session = sessionFixture()) => ({
    operation,
    recovery_session: session,
    driver_lease_owner: owner,
});

describe("Cloudflare Worker canary recovery state-transition candidate", () => {
    it("returns only a blocked non-authoritative requirement after two exact observations", async () => {
        const dependencies = dependenciesFor();
        const result =
            await planD1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateWithDependenciesTestOnlyV1(
                inputFor(),
                dependencies
            );
        expect(result).toMatchObject({
            success: true,
            candidate: {
                kind: "d1_probe_cloudflare_worker_api_canary_recovery_state_transition_candidate",
                plan_digest: planDigest,
                operation_revision: operation.revision,
                operation_state: operation.state,
                operation_record_digest: operationDigest,
                journal_head_revision: 4,
                journal_head_claim_digest: claimDigest,
                archive_record_count: 2,
                driver_lease_generation: owner.generation,
                candidate_status: "not_compiled",
                transition_requirement: "keyed_response_semantic_projection_required",
                keyed_response_semantic_projection_verified: false,
                operation_transition_authorized: false,
                local_operation_transition_performed: false,
                remote_request_dispatched: false,
                remote_effect_replay_allowed: false,
                mutation_replay_allowed: false,
                cleanup_performed: false,
                archive_reconciliation_performed: false,
                repair_performed: false,
                recovery_action_authorized: false,
                authoritative: false,
            },
            keyed_response_semantic_projection_verified: false,
            operation_transition_authorized: false,
            local_operation_transition_performed: false,
        });
        expect(dependencies.open_recovery_session).toHaveBeenCalledTimes(2);
        expect(dependencies.read_base_recovery).toHaveBeenCalledTimes(2);
        expect(dependencies.assert_current_driver_lease_read_only).toHaveBeenCalledTimes(2);
        expect(Object.keys(dependencies)).not.toContain("transition_state");
        expect(Object.keys(dependencies)).not.toContain("transition_operation");
    });

    it("rejects every caller-supplied target operation instead of compiling resource identity", async () => {
        const dependencies = dependenciesFor();
        await expect(
            planD1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateWithDependenciesTestOnlyV1(
                {
                    ...inputFor(),
                    next_operation: {
                        ...operation,
                        revision: operation.revision + 1,
                        state: "shell_identified",
                        worker_id: "caller-controlled-worker",
                    },
                } as never,
                dependencies
            )
        ).resolves.toMatchObject({
            success: false,
            code: "recovery_state_transition_candidate_denied",
            operation_transition_authorized: false,
            local_operation_transition_performed: false,
        });
        expect(dependencies.open_recovery_session).not.toHaveBeenCalled();
    });

    it("denies lease generation loss between observations without any transition capability", async () => {
        const readLease = vi
            .fn()
            .mockResolvedValueOnce({ success: true as const, lease: leaseFixture() })
            .mockResolvedValueOnce({
                success: true as const,
                lease: leaseFixture({ generation: owner.generation + 1 }),
            });
        const dependencies = dependenciesFor(sessionFixture(), recoveryFixture(), {
            assert_current_driver_lease_read_only: readLease,
        });
        await expect(
            planD1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateWithDependenciesTestOnlyV1(
                inputFor(),
                dependencies
            )
        ).resolves.toMatchObject({
            success: false,
            code: "recovery_state_transition_candidate_denied",
            operation_transition_authorized: false,
            local_operation_transition_performed: false,
        });
        expect(readLease).toHaveBeenCalledTimes(2);
        expect(Object.keys(dependencies)).not.toContain("transition_state");
    });

    it("denies a changed recovery head or substituted supplied observation", async () => {
        const first = recoveryFixture();
        const changed = recoveryFixture({ claim_digest: digest("9") });
        const changedDependencies = dependenciesFor(sessionFixture(), first, {
            read_base_recovery: vi.fn().mockResolvedValueOnce(first).mockResolvedValueOnce(changed),
        });
        await expect(
            planD1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateWithDependenciesTestOnlyV1(
                inputFor(),
                changedDependencies
            )
        ).resolves.toMatchObject({ success: false, code: "recovery_state_transition_candidate_denied" });

        const substitutedDependencies = dependenciesFor();
        await expect(
            planD1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateWithDependenciesTestOnlyV1(
                inputFor(sessionFixture({ journal_head_claim_digest: digest("8") })),
                substitutedDependencies
            )
        ).resolves.toMatchObject({ success: false, code: "recovery_state_transition_candidate_denied" });
    });

    it("denies upstream authority and non-pending recovery", async () => {
        for (const dependencies of [
            dependenciesFor(sessionFixture(), recoveryFixture({ authoritative: true as false })),
            dependenciesFor(
                sessionFixture({
                    recovery_classification: "local_histories_aligned",
                    recovery_requirement: "none",
                    disposition: "local_histories_aligned",
                })
            ),
            dependenciesFor(sessionFixture(), recoveryFixture(), {
                open_recovery_session: vi.fn(async () => ({
                    ...opened(sessionFixture()),
                    authoritative: true as false,
                })),
            }),
        ]) {
            await expect(
                planD1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateWithDependenciesTestOnlyV1(
                    inputFor(),
                    dependencies
                )
            ).resolves.toMatchObject({
                success: false,
                code: "recovery_state_transition_candidate_denied",
                operation_transition_authorized: false,
            });
        }
    });

    it("does not return raw operation or lease-owner identity", async () => {
        const result =
            await planD1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateWithDependenciesTestOnlyV1(
                inputFor(),
                dependenciesFor()
            );
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain(operation.execution_nonce);
        expect(serialized).not.toContain(operation.attempt_tag);
        expect(serialized).not.toContain(operation.ownership_tag);
        expect(serialized).not.toContain(operation.script_name);
        expect(serialized).not.toContain(owner.owner_nonce);
        expect(serialized).not.toContain(String(owner.owner_pid));
        expect(serialized).not.toContain("worker_id");
        expect(serialized).not.toContain("next_operation");
    });
});
