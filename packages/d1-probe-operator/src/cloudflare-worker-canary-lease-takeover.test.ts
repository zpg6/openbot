import { describe, expect, it, vi } from "vitest";

import type { D1ProbeCloudflareWorkerCanaryBaseRecoveryV1 } from "./cloudflare-worker-canary-base-recovery.js";
import type { D1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionV1 } from "./cloudflare-worker-canary-durable-driver-recovery.js";
import type {
    D1ProbeCloudflareWorkerCanaryDriverLeaseOwnedResultV1,
    D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1,
    D1ProbeCloudflareWorkerCanaryDriverLeaseV1,
} from "./cloudflare-worker-canary-driver-lease.js";
import {
    executeD1ProbeCloudflareWorkerCanaryLeaseTakeoverWithDependenciesTestOnlyV1,
    type D1ProbeCloudflareWorkerCanaryLeaseTakeoverTestOnlyDependenciesV1,
} from "./cloudflare-worker-canary-lease-takeover.js";
import type { D1ProbeCloudflareWorkerCanaryOperationV1 } from "./cloudflare-worker-canary-operation.js";

const digest = (character: string): string => character.repeat(64);
const planDigest = digest("a");
const operationDigest = digest("b");
const executionNonceCommitment = digest("c");
const claimDigest = digest("d");
const previousLeaseDigest = digest("e");
const takeoverLeaseDigest = digest("f");

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

const falseRecoveryAuthority = {
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
} as const;

const recoveryFixture = (
    overrides: Partial<D1ProbeCloudflareWorkerCanaryBaseRecoveryV1> = {}
): D1ProbeCloudflareWorkerCanaryBaseRecoveryV1 => ({
    schema_version: 1,
    kind: "untrusted_d1_probe_cloudflare_worker_api_canary_base_recovery",
    plan_digest: planDigest,
    classification: "intent_only_requires_dead_owner_takeover",
    recovery_requirement: "dead_owner_proof_and_takeover_before_abandonment",
    state_operation_revision: 0,
    state_operation_record_digest: operationDigest,
    claim_journal_revision: 4,
    claim_digest: claimDigest,
    claim_effect_phase: "dispatch_intent",
    claim_cleanup_obligation_digest: digest("4"),
    driver_lease_generation: 7,
    driver_lease_record_digest: previousLeaseDigest,
    archive_record_count: 0,
    archive_head_claim_digest: null,
    archive_head_record_digest: null,
    archive_head_cleanup_obligation_digest: null,
    ...falseRecoveryAuthority,
    ...overrides,
});

const sessionFixture = (
    overrides: Partial<D1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionV1> = {}
): D1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionV1 => ({
    schema_version: 1,
    kind: "d1_probe_cloudflare_worker_api_canary_durable_driver_recovery_session",
    plan_digest: planDigest,
    execution_nonce_commitment: executionNonceCommitment,
    operation_revision: 0,
    operation_state: "prepared",
    operation_record_digest: operationDigest,
    recovery_classification: "intent_only_requires_dead_owner_takeover",
    recovery_requirement: "dead_owner_proof_and_takeover_before_abandonment",
    transcript_classification: "dispatch_intent_tail",
    transcript_digest: digest("3"),
    journal_head_revision: 4,
    journal_head_claim_digest: claimDigest,
    archive_record_count: 0,
    disposition: "dead_owner_takeover_before_intent_abandonment",
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
    ...overrides,
});

const leaseFixture = (
    overrides: Partial<D1ProbeCloudflareWorkerCanaryDriverLeaseV1> = {}
): D1ProbeCloudflareWorkerCanaryDriverLeaseV1 => ({
    schema_version: 1,
    kind: "d1_probe_cloudflare_worker_api_canary_driver_lease",
    transition: "renewed",
    state: "active",
    plan_digest: planDigest,
    execution_nonce_commitment: executionNonceCommitment,
    generation: 7,
    previous_record_digest: digest("6"),
    owner_pid: 111,
    owner_nonce_commitment: digest("7"),
    prior_owner_liveness: "not_checked",
    issued_at_ms: 1,
    heartbeat_at_ms: 2,
    expires_at_ms: 3,
    caller_mutation_authority: false,
    authoritative: false,
    eligible_for_upload: false,
    eligible_for_attestation: false,
    lifecycle_advance_allowed: false,
    gate_promotion_allowed: false,
    mutation_authority: false,
    ...overrides,
});

const previousLease = leaseFixture();
const takeoverLease = leaseFixture({
    transition: "taken_over",
    generation: 8,
    previous_record_digest: previousLeaseDigest,
    owner_pid: 222,
    owner_nonce_commitment: digest("8"),
    prior_owner_liveness: "esrch",
    issued_at_ms: 4,
    heartbeat_at_ms: 4,
    expires_at_ms: 1004,
});

const ownedTakeover = (
    lease: D1ProbeCloudflareWorkerCanaryDriverLeaseV1 = takeoverLease
): D1ProbeCloudflareWorkerCanaryDriverLeaseOwnedResultV1 => ({
    success: true,
    lease,
    owner: {
        plan_digest: planDigest,
        execution_nonce: operation.execution_nonce,
        generation: lease.generation,
        owner_pid: lease.owner_pid,
        owner_nonce: "A".repeat(43),
    },
});

const dependenciesFor = (
    overrides: Partial<D1ProbeCloudflareWorkerCanaryLeaseTakeoverTestOnlyDependenciesV1> = {}
): D1ProbeCloudflareWorkerCanaryLeaseTakeoverTestOnlyDependenciesV1 => {
    let leaseReadCount = 0;
    let recoveryReadCount = 0;
    return {
        validate_operation: vi.fn(async input => input as D1ProbeCloudflareWorkerCanaryOperationV1),
        digest_operation: vi.fn(async () => operationDigest),
        commit_execution_nonce: vi.fn(async () => executionNonceCommitment),
        read_recovery: vi.fn(async () => {
            recoveryReadCount += 1;
            return recoveryFixture(
                recoveryReadCount <= 2
                    ? {}
                    : {
                          driver_lease_generation: takeoverLease.generation,
                          driver_lease_record_digest: takeoverLeaseDigest,
                      }
            );
        }),
        read_lease: vi.fn(async (): Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1> => {
            leaseReadCount += 1;
            return { success: true, lease: leaseReadCount <= 2 ? previousLease : takeoverLease };
        }),
        digest_lease: vi.fn(async lease => (lease.generation === 7 ? previousLeaseDigest : takeoverLeaseDigest)),
        takeover_expected_lease: vi.fn(async () => ownedTakeover()),
        ...overrides,
    };
};

const request = (recoverySession: D1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionV1 = sessionFixture()) => ({
    operation,
    recovery_session: recoverySession,
    lease_duration_ms: 1_000,
});

describe("Cloudflare Worker canary reviewed lease takeover", () => {
    it("takes over one exact expired, dead-owner lease head and returns a redacted receipt", async () => {
        const dependencies = dependenciesFor();
        const result = await executeD1ProbeCloudflareWorkerCanaryLeaseTakeoverWithDependenciesTestOnlyV1(
            request(),
            dependencies
        );

        expect(dependencies.read_recovery).toHaveBeenCalledTimes(4);
        expect(dependencies.read_lease).toHaveBeenCalledTimes(4);
        expect(dependencies.digest_lease).toHaveBeenCalledTimes(5);
        expect(result).toMatchObject({
            success: true,
            remote_dispatch_authorized: false,
            remote_effect_replay_allowed: false,
            ambiguous_remote_effect_retry_allowed: false,
            mutation_replay_allowed: false,
            cleanup_authorized: false,
            recovery_action_authorized: false,
            operation_transition_authorized: false,
            caller_mutation_authority: false,
            authoritative: false,
            eligible_for_upload: false,
            eligible_for_attestation: false,
            lifecycle_advance_allowed: false,
            gate_promotion_allowed: false,
            receipt: {
                plan_digest: planDigest,
                execution_nonce_commitment: executionNonceCommitment,
                operation_revision: 0,
                operation_record_digest: operationDigest,
                journal_head_revision: 4,
                journal_head_claim_digest: claimDigest,
                previous_lease_generation: 7,
                previous_lease_record_digest: previousLeaseDigest,
                takeover_lease_generation: 8,
                takeover_lease_record_digest: takeoverLeaseDigest,
                prior_owner_liveness: "esrch",
                lease_takeover_performed: true,
                lease_mutation_attempted: true,
                local_lease_mutation_count_upper_bound: 1,
                local_lease_mutation_outcome: "performed",
                remote_dispatch_authorized: false,
                remote_effect_replay_allowed: false,
                ambiguous_remote_effect_retry_allowed: false,
                mutation_replay_allowed: false,
                cleanup_authorized: false,
                recovery_action_authorized: false,
                operation_transition_authorized: false,
                caller_mutation_authority: false,
                authoritative: false,
                eligible_for_upload: false,
                eligible_for_attestation: false,
                lifecycle_advance_allowed: false,
                gate_promotion_allowed: false,
            },
        });
        expect(dependencies.takeover_expected_lease).toHaveBeenCalledTimes(1);
        expect(dependencies.takeover_expected_lease).toHaveBeenCalledWith({
            plan_digest: planDigest,
            execution_nonce: operation.execution_nonce,
            lease_duration_ms: 1_000,
            expected_generation: 7,
            expected_record_digest: previousLeaseDigest,
        });

        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain(operation.execution_nonce);
        expect(serialized).not.toContain(operation.attempt_tag);
        expect(serialized).not.toContain(operation.ownership_tag);
        expect(serialized).not.toContain(operation.script_name);
        expect(serialized).not.toContain("owner_nonce");
        expect(serialized).not.toContain("owner_pid");
    });

    it("also permits exact prepared-head reassertion through the same strict takeover store", async () => {
        const recovery = recoveryFixture({
            classification: "prepared_without_effect_claim",
            recovery_requirement: "fresh_lease_and_exact_head_reassertion",
            claim_journal_revision: null,
            claim_digest: null,
            claim_effect_phase: null,
            claim_cleanup_obligation_digest: null,
        });
        const session = sessionFixture({
            recovery_classification: "prepared_without_effect_claim",
            recovery_requirement: "fresh_lease_and_exact_head_reassertion",
            transcript_classification: "local_history_missing",
            journal_head_revision: null,
            journal_head_claim_digest: null,
            disposition: "fresh_lease_and_exact_head_reassertion",
        });
        let recoveryReads = 0;
        const dependencies = dependenciesFor({
            read_recovery: vi.fn(async () => {
                recoveryReads += 1;
                return recoveryReads <= 2
                    ? recovery
                    : {
                          ...recovery,
                          driver_lease_generation: takeoverLease.generation,
                          driver_lease_record_digest: takeoverLeaseDigest,
                      };
            }),
        });
        const result = await executeD1ProbeCloudflareWorkerCanaryLeaseTakeoverWithDependenciesTestOnlyV1(
            request(session),
            dependencies
        );

        expect(result.success).toBe(true);
        expect(dependencies.takeover_expected_lease).toHaveBeenCalledTimes(1);
    });

    it("denies unstable or mismatched recovery, operation, journal, lease, and authority bindings before mutation", async () => {
        const cases: Array<{
            readonly session?: D1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionV1;
            readonly dependencies: D1ProbeCloudflareWorkerCanaryLeaseTakeoverTestOnlyDependenciesV1;
        }> = [
            { dependencies: dependenciesFor({ digest_operation: vi.fn(async () => digest("9")) }) },
            { dependencies: dependenciesFor({ commit_execution_nonce: vi.fn(async () => digest("9")) }) },
            { session: sessionFixture({ journal_head_claim_digest: digest("9") }), dependencies: dependenciesFor() },
            {
                dependencies: dependenciesFor({
                    read_recovery: vi.fn(async () => recoveryFixture({ driver_lease_record_digest: digest("9") })),
                }),
            },
            {
                dependencies: dependenciesFor({
                    read_recovery: vi.fn(async () => recoveryFixture({ authoritative: true as false })),
                }),
            },
            {
                dependencies: dependenciesFor({
                    read_lease: vi.fn(async (): Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1> => ({
                        success: true,
                        lease: leaseFixture({ execution_nonce_commitment: digest("9") }),
                    })),
                }),
            },
        ];

        for (const testCase of cases) {
            const result = await executeD1ProbeCloudflareWorkerCanaryLeaseTakeoverWithDependenciesTestOnlyV1(
                request(testCase.session),
                testCase.dependencies
            );
            expect(result).toMatchObject({
                success: false,
                code: "takeover_precondition_denied",
                lease_mutation_attempted: false,
                local_lease_mutation_count_upper_bound: 0,
                local_lease_mutation_outcome: "not_attempted",
                lease_takeover_performed: false,
            });
            expect(testCase.dependencies.takeover_expected_lease).not.toHaveBeenCalled();
        }
    });

    it("denies a changing pre-mutation lease head without calling the mutator", async () => {
        let reads = 0;
        const dependencies = dependenciesFor({
            read_lease: vi.fn(async (): Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1> => {
                reads += 1;
                return { success: true, lease: leaseFixture({ heartbeat_at_ms: reads }) };
            }),
        });
        const result = await executeD1ProbeCloudflareWorkerCanaryLeaseTakeoverWithDependenciesTestOnlyV1(
            request(),
            dependencies
        );

        expect(result).toMatchObject({ success: false, code: "takeover_precondition_denied" });
        expect(dependencies.takeover_expected_lease).not.toHaveBeenCalled();
    });

    it("calls the lease mutator at most once and reports a failed mutation as ambiguous", async () => {
        const dependencies = dependenciesFor({
            takeover_expected_lease: vi.fn(
                async (): Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseOwnedResultV1> => ({
                    success: false,
                    code: "concurrent_lease_write",
                })
            ),
        });
        const result = await executeD1ProbeCloudflareWorkerCanaryLeaseTakeoverWithDependenciesTestOnlyV1(
            request(),
            dependencies
        );

        expect(result).toMatchObject({
            success: false,
            code: "lease_takeover_denied",
            lease_mutation_attempted: true,
            local_lease_mutation_count_upper_bound: 1,
            local_lease_mutation_outcome: "ambiguous",
            lease_takeover_performed: false,
            remote_dispatch_authorized: false,
            cleanup_authorized: false,
            lifecycle_advance_allowed: false,
        });
        expect(dependencies.takeover_expected_lease).toHaveBeenCalledTimes(1);
    });

    it("treats a thrown mutator result as an unverified one-mutation outcome", async () => {
        const dependencies = dependenciesFor({
            takeover_expected_lease: vi.fn(async () => {
                throw new Error("store result unavailable");
            }),
        });
        const result = await executeD1ProbeCloudflareWorkerCanaryLeaseTakeoverWithDependenciesTestOnlyV1(
            request(),
            dependencies
        );

        expect(result).toMatchObject({
            success: false,
            code: "lease_takeover_outcome_unverified",
            lease_mutation_attempted: true,
            local_lease_mutation_count_upper_bound: 1,
            local_lease_mutation_outcome: "ambiguous",
            lease_takeover_performed: false,
        });
        expect(dependencies.takeover_expected_lease).toHaveBeenCalledTimes(1);
    });

    it("fails closed when the written generation does not become the exact observed head", async () => {
        const dependencies = dependenciesFor({
            read_lease: vi.fn(async (): Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1> => ({
                success: true,
                lease: previousLease,
            })),
        });
        const result = await executeD1ProbeCloudflareWorkerCanaryLeaseTakeoverWithDependenciesTestOnlyV1(
            request(),
            dependencies
        );

        expect(result).toMatchObject({
            success: false,
            code: "lease_takeover_outcome_unverified",
            lease_mutation_attempted: true,
            local_lease_mutation_count_upper_bound: 1,
            local_lease_mutation_outcome: "ambiguous",
            lease_takeover_performed: false,
        });
        expect(dependencies.takeover_expected_lease).toHaveBeenCalledTimes(1);
    });

    it("fails closed when any operation, journal, or archive fact changes after takeover", async () => {
        let recoveryReads = 0;
        const dependencies = dependenciesFor({
            read_recovery: vi.fn(async () => {
                recoveryReads += 1;
                if (recoveryReads <= 2) return recoveryFixture();
                return recoveryFixture({
                    driver_lease_generation: takeoverLease.generation,
                    driver_lease_record_digest: takeoverLeaseDigest,
                    archive_record_count: 1,
                });
            }),
        });
        const result = await executeD1ProbeCloudflareWorkerCanaryLeaseTakeoverWithDependenciesTestOnlyV1(
            request(),
            dependencies
        );

        expect(result).toMatchObject({
            success: false,
            code: "lease_takeover_outcome_unverified",
            lease_mutation_attempted: true,
            local_lease_mutation_count_upper_bound: 1,
            local_lease_mutation_outcome: "ambiguous",
            lease_takeover_performed: false,
        });
        expect(dependencies.takeover_expected_lease).toHaveBeenCalledTimes(1);
    });

    it("rejects fresh acquisition, skipped generations, and wrong predecessor digests after mutation", async () => {
        const cases = [
            takeoverLease,
            leaseFixture({ transition: "acquired", generation: 0, previous_record_digest: null }),
            leaseFixture({ transition: "taken_over", generation: 9, previous_record_digest: previousLeaseDigest }),
            leaseFixture({ transition: "taken_over", generation: 8, previous_record_digest: digest("9") }),
        ];

        for (const badLease of cases.slice(1)) {
            const dependencies = dependenciesFor({
                takeover_expected_lease: vi.fn(async () => ownedTakeover(badLease)),
                read_lease: vi
                    .fn()
                    .mockResolvedValueOnce({ success: true, lease: previousLease })
                    .mockResolvedValueOnce({ success: true, lease: previousLease })
                    .mockResolvedValueOnce({ success: true, lease: badLease }),
                digest_lease: vi.fn(async lease =>
                    lease.generation === previousLease.generation ? previousLeaseDigest : takeoverLeaseDigest
                ),
            });
            const result = await executeD1ProbeCloudflareWorkerCanaryLeaseTakeoverWithDependenciesTestOnlyV1(
                request(),
                dependencies
            );
            expect(result).toMatchObject({ success: false, code: "lease_takeover_outcome_unverified" });
            expect(dependencies.takeover_expected_lease).toHaveBeenCalledTimes(1);
        }
    });

    it("rejects malformed and overbroad requests before any read or mutation", async () => {
        const dependencies = dependenciesFor();
        for (const input of [
            null,
            {},
            { ...request(), lease_duration_ms: 0 },
            { ...request(), lease_duration_ms: 300_001 },
            { ...request(), extra: true },
            request(sessionFixture({ remote_dispatch_authorized: true as false })),
            request({
                ...sessionFixture(),
                owner_nonce: "secret",
            } as D1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionV1),
        ]) {
            const result = await executeD1ProbeCloudflareWorkerCanaryLeaseTakeoverWithDependenciesTestOnlyV1(
                input,
                dependencies
            );
            expect(result).toMatchObject({ success: false, code: "invalid_takeover_request" });
        }
        expect(dependencies.read_recovery).not.toHaveBeenCalled();
        expect(dependencies.read_lease).not.toHaveBeenCalled();
        expect(dependencies.takeover_expected_lease).not.toHaveBeenCalled();
    });

    it("denies hostile input and recovery-session proxies without touching dependencies", async () => {
        const dependencies = dependenciesFor();
        const hostileInput = new Proxy(request(), {
            ownKeys: () => {
                throw new Error("ownKeys denied");
            },
        });
        const hostileSession = new Proxy(sessionFixture(), {
            get: () => {
                throw new Error("property denied");
            },
        });

        await expect(
            executeD1ProbeCloudflareWorkerCanaryLeaseTakeoverWithDependenciesTestOnlyV1(hostileInput, dependencies)
        ).resolves.toMatchObject({ success: false, code: "invalid_takeover_request" });
        await expect(
            executeD1ProbeCloudflareWorkerCanaryLeaseTakeoverWithDependenciesTestOnlyV1(
                request(hostileSession),
                dependencies
            )
        ).resolves.toMatchObject({ success: false, code: "invalid_takeover_request" });
        expect(dependencies.validate_operation).not.toHaveBeenCalled();
        expect(dependencies.read_recovery).not.toHaveBeenCalled();
        expect(dependencies.read_lease).not.toHaveBeenCalled();
        expect(dependencies.takeover_expected_lease).not.toHaveBeenCalled();
    });
});
