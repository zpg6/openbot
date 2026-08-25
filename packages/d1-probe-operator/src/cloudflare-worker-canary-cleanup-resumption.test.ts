import { digestCanonicalJsonV1, type CanonicalJsonValueV1 } from "@openbot/gate-attestation/internal";
import { describe, expect, it } from "vitest";

import type { D1ProbeCloudflareWorkerCanaryBaseRecoveryV1 } from "./cloudflare-worker-canary-base-recovery.js";
import { compileD1ProbeCloudflareWorkerCanaryCleanupCommandV1 } from "./cloudflare-worker-canary-cleanup-grace.js";
import {
    compileD1ProbeCloudflareWorkerCanaryCleanupObligationV1,
    type D1ProbeCloudflareWorkerCanaryCleanupObligationV1,
} from "./cloudflare-worker-canary-cleanup-obligation.js";
import {
    planD1ProbeCloudflareWorkerCanaryCleanupResumptionWithDependenciesTestOnlyV1,
    type D1ProbeCloudflareWorkerCanaryCleanupResumptionTestOnlyDependenciesV1,
} from "./cloudflare-worker-canary-cleanup-resumption.js";
import type { D1ProbeCloudflareWorkerCanaryConsistencyV1 } from "./cloudflare-worker-canary-consistency.js";
import { prepareD1ProbeCloudflareWorkerCanaryOperationV1 } from "./cloudflare-worker-canary-operation.js";

const digest = (character: string): string => character.repeat(64);
const executionNonce = "1f".repeat(16);
const attemptTag = `openbot-canary-attempt-${executionNonce}`;
const notBefore = Date.parse("2026-08-24T20:00:00.000Z");

const makeObligation = async (): Promise<D1ProbeCloudflareWorkerCanaryCleanupObligationV1> => {
    const operationId = "e".repeat(32);
    const randomSuffix = "base000000000001";
    const unsigned = {
        schema_version: 1 as const,
        kind: "d1_probe_cloudflare_worker_api_canary_plan" as const,
        account_id: "d".repeat(32),
        commitment_key_id_digest: digest("a"),
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
        not_before_ms: notBefore,
        expires_at_ms: notBefore + 60_000,
        authoritative: false as const,
        eligible_for_attestation: false as const,
        lifecycle_advance_allowed: false as const,
        gate_promotion_allowed: false as const,
    };
    const planDigest = await digestCanonicalJsonV1(
        "openbot.d1-probe.cloudflare-worker-api-canary-plan.v1",
        unsigned as CanonicalJsonValueV1
    );
    if (planDigest === null) throw new Error("plan digest unavailable");
    const plan = { ...unsigned, plan_digest: planDigest };
    const prepared = await prepareD1ProbeCloudflareWorkerCanaryOperationV1(plan, attemptTag, notBefore + 1);
    if (!prepared.success) throw new Error(prepared.code);
    const cleanup = await compileD1ProbeCloudflareWorkerCanaryCleanupCommandV1(plan, {
        worker_id: null,
        worker_id_commitment: null,
        attempt_tag_commitment: digest("b"),
    });
    if (!cleanup.success) throw new Error(cleanup.code);
    const obligation = await compileD1ProbeCloudflareWorkerCanaryCleanupObligationV1(
        prepared.operation,
        cleanup.command.cleanup_grace
    );
    if (!obligation.success) throw new Error(obligation.code);
    return obligation.obligation;
};

const consistency = (
    obligation: D1ProbeCloudflareWorkerCanaryCleanupObligationV1,
    overrides: Partial<D1ProbeCloudflareWorkerCanaryConsistencyV1> = {}
): D1ProbeCloudflareWorkerCanaryConsistencyV1 => ({
    schema_version: 1,
    kind: "untrusted_d1_probe_cloudflare_worker_api_canary_consistency",
    plan_digest: obligation.plan_digest,
    classification: "state_ahead",
    missing_component: null,
    corrupt_component: null,
    state_operation_revision: 7,
    state_operation_state: "delete_dispatching",
    state_operation_record_digest: digest("c"),
    state_execution_nonce_commitment: obligation.execution_nonce_commitment,
    driver_lease_generation: 2,
    driver_lease_record_digest: digest("d"),
    driver_lease_state: "released",
    claim_journal_revision: 11,
    claim_digest: digest("e"),
    claim_operation_revision: 6,
    claim_operation_state: "cleanup_reconciling",
    claim_operation_record_digest: digest("f"),
    claim_execution_nonce_commitment: obligation.execution_nonce_commitment,
    claim_lease_generation: 2,
    claim_lease_record_digest: digest("d"),
    claim_cleanup_obligation_digest: obligation.obligation_digest,
    claim_workflow_step: "cleanup_worker_list",
    claim_effect_phase: "response_observed",
    claim_ambiguity_classification: "none",
    response_claim_bindings: [],
    effect_claims_authenticated: false,
    caller_mutation_authority: false,
    authoritative: false,
    eligible_for_upload: false,
    eligible_for_attestation: false,
    lifecycle_advance_allowed: false,
    gate_promotion_allowed: false,
    ...overrides,
});

const recovery = (
    current: D1ProbeCloudflareWorkerCanaryConsistencyV1,
    overrides: Partial<D1ProbeCloudflareWorkerCanaryBaseRecoveryV1> = {}
): D1ProbeCloudflareWorkerCanaryBaseRecoveryV1 => ({
    schema_version: 1,
    kind: "untrusted_d1_probe_cloudflare_worker_api_canary_base_recovery",
    plan_digest: current.plan_digest,
    classification: "local_histories_aligned",
    recovery_requirement: "none",
    state_operation_revision: current.state_operation_revision,
    state_operation_record_digest: current.state_operation_record_digest,
    claim_journal_revision: current.claim_journal_revision,
    claim_digest: current.claim_digest,
    claim_effect_phase: current.claim_effect_phase,
    claim_cleanup_obligation_digest: current.claim_cleanup_obligation_digest,
    driver_lease_generation: current.driver_lease_generation,
    driver_lease_record_digest: current.driver_lease_record_digest,
    archive_record_count: 1,
    archive_head_claim_digest: current.claim_digest,
    archive_head_record_digest: digest("1"),
    archive_head_cleanup_obligation_digest: current.claim_cleanup_obligation_digest,
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

const dependencies = (
    obligation: D1ProbeCloudflareWorkerCanaryCleanupObligationV1,
    current: D1ProbeCloudflareWorkerCanaryConsistencyV1,
    currentRecovery: D1ProbeCloudflareWorkerCanaryBaseRecoveryV1 = recovery(current)
): D1ProbeCloudflareWorkerCanaryCleanupResumptionTestOnlyDependenciesV1 => ({
    read_consistency: async () => current,
    read_base_recovery: async () => currentRecovery,
    read_cleanup_obligation: async () => ({ success: true, obligation }),
    compile_cleanup_obligation: compileD1ProbeCloudflareWorkerCanaryCleanupObligationV1,
});

const plan = async (
    obligation: D1ProbeCloudflareWorkerCanaryCleanupObligationV1,
    current: D1ProbeCloudflareWorkerCanaryConsistencyV1,
    currentRecovery: D1ProbeCloudflareWorkerCanaryBaseRecoveryV1 = recovery(current)
) =>
    await planD1ProbeCloudflareWorkerCanaryCleanupResumptionWithDependenciesTestOnlyV1(
        { plan_digest: obligation.plan_digest },
        dependencies(obligation, current, currentRecovery)
    );

describe("Cloudflare Worker canary cleanup resumption planning", () => {
    it("returns a digest-only cleanup resumption candidate without granting authority", async () => {
        const obligation = await makeObligation();
        const result = await plan(obligation, consistency(obligation));
        expect(result).toMatchObject({
            plan_digest: obligation.plan_digest,
            cleanup_obligation_digest: obligation.obligation_digest,
            operation_revision: 7,
            operation_state: "delete_dispatching",
            lease_generation: 2,
            lease_state: "released",
            decision: "resume_cleanup_reconciliation",
            classification: "cleanup_resume_ready",
            resumption_requirement: "fresh_lease_and_exact_head_reassertion",
            remote_dispatch_authorized: false,
            cleanup_authorized: false,
            mutation_replay_allowed: false,
            recovery_action_authorized: false,
            caller_mutation_authority: false,
            authoritative: false,
            eligible_for_upload: false,
            eligible_for_attestation: false,
            lifecycle_advance_allowed: false,
            gate_promotion_allowed: false,
        });
        expect(JSON.stringify(result)).not.toMatch(
            /execution_nonce|attempt_tag|ownership_tag|script_name|worker_id|version_id|deployment_id|owner_nonce|api_token/iu
        );
    });

    it("separates cleanup entry, completed cleanup, local transition, and read-only reconciliation", async () => {
        const obligation = await makeObligation();
        const entry = consistency(obligation, {
            state_operation_state: "deployment_identified",
            claim_operation_state: "deployment_dispatching",
            claim_workflow_step: "deployment_readback",
            claim_cleanup_obligation_digest: null,
        });
        await expect(plan(obligation, entry)).resolves.toMatchObject({
            decision: "enter_cleanup_reconciliation",
            classification: "cleanup_entry_ready",
        });

        const complete = consistency(obligation, {
            state_operation_state: "absence_observed",
            claim_workflow_step: "deleted_worker_list",
        });
        await expect(plan(obligation, complete)).resolves.toMatchObject({
            decision: "cleanup_complete",
            classification: "cleanup_already_complete",
            resumption_requirement: "none",
        });

        const pending = consistency(obligation, {
            classification: "exact_sync",
            state_operation_state: "cleanup_reconciling",
            claim_operation_revision: 7,
            claim_operation_state: "cleanup_reconciling",
            claim_workflow_step: "cleanup_worker_list",
        });
        await expect(
            plan(
                obligation,
                pending,
                recovery(pending, {
                    classification: "response_observed_state_transition_pending",
                    recovery_requirement: "state_transition_revalidation",
                })
            )
        ).resolves.toMatchObject({
            decision: "revalidate_local_state_transition",
            resumption_requirement: "state_transition_revalidation",
        });

        const uncertain = consistency(obligation, {
            classification: "ambiguous_dispatch",
            state_operation_state: "delete_dispatching",
            claim_operation_revision: 7,
            claim_operation_state: "delete_dispatching",
            claim_workflow_step: "delete_worker",
            claim_effect_phase: "dispatch_ambiguous",
            claim_ambiguity_classification: "dispatch_outcome_unknown",
        });
        await expect(
            plan(
                obligation,
                uncertain,
                recovery(uncertain, {
                    classification: "mutation_outcome_unknown_no_retry",
                    recovery_requirement: "read_only_remote_reconciliation_only",
                })
            )
        ).resolves.toMatchObject({
            decision: "read_only_remote_reconciliation",
            resumption_requirement: "read_only_remote_reconciliation_only",
            mutation_replay_allowed: false,
            cleanup_authorized: false,
        });
    });

    it("resumes after the cleanup state transition only from one adjacent observed forward claim", async () => {
        const obligation = await makeObligation();
        const afterTransition = consistency(obligation, {
            state_operation_state: "cleanup_reconciling",
            claim_operation_revision: 6,
            claim_operation_state: "deployment_identified",
            claim_workflow_step: "deployment_readback",
            claim_cleanup_obligation_digest: null,
        });
        await expect(plan(obligation, afterTransition)).resolves.toMatchObject({
            decision: "resume_cleanup_reconciliation",
            classification: "cleanup_resume_ready",
            resumption_requirement: "fresh_lease_and_exact_head_reassertion",
            cleanup_authorized: false,
        });

        for (const candidate of [
            consistency(obligation, {
                state_operation_state: "cleanup_reconciling",
                claim_operation_revision: 6,
                claim_operation_state: "deployment_identified",
                claim_workflow_step: "deployment_readback",
                claim_effect_phase: "dispatch_intent",
                claim_ambiguity_classification: "not_dispatched",
                claim_cleanup_obligation_digest: null,
            }),
            consistency(obligation, {
                state_operation_state: "cleanup_reconciling",
                claim_operation_revision: 6,
                claim_operation_state: "deployment_identified",
                claim_workflow_step: "deployment_readback",
                claim_effect_phase: "dispatch_started",
                claim_ambiguity_classification: "may_have_dispatched",
                claim_cleanup_obligation_digest: null,
            }),
            consistency(obligation, {
                state_operation_revision: 9,
                state_operation_state: "cleanup_reconciling",
                claim_operation_revision: 6,
                claim_operation_state: "deployment_identified",
                claim_workflow_step: "deployment_readback",
                claim_cleanup_obligation_digest: null,
            }),
        ]) {
            await expect(plan(obligation, candidate)).resolves.toMatchObject({
                decision: "stop",
                classification: "local_records_corrupt",
                cleanup_authorized: false,
            });
        }
    });

    it("rejects substituted record bindings and authority claims", async () => {
        const obligation = await makeObligation();
        const current = consistency(obligation);
        const cases = [
            {
                current: consistency(obligation, { claim_cleanup_obligation_digest: digest("9") }),
                currentRecovery: undefined,
            },
            {
                current: consistency(obligation, {
                    state_operation_state: "deployment_identified",
                    claim_operation_state: "deployment_dispatching",
                    claim_workflow_step: "deployment_readback",
                    claim_cleanup_obligation_digest: digest("9"),
                }),
                currentRecovery: undefined,
            },
            {
                current,
                currentRecovery: recovery(current, { plan_digest: digest("8") }),
            },
            {
                current: consistency(obligation, { caller_mutation_authority: true as never }),
                currentRecovery: undefined,
            },
        ];
        for (const testCase of cases) {
            const candidateRecovery = testCase.currentRecovery ?? recovery(testCase.current);
            await expect(plan(obligation, testCase.current, candidateRecovery)).resolves.toMatchObject({
                decision: "stop",
                classification: "local_records_corrupt",
                cleanup_authorized: false,
            });
        }

        const substitutedObligation = {
            ...obligation,
            cleanup_grace: { ...obligation.cleanup_grace, automatic_cleanup_expires_at_ms: notBefore + 1 },
        } as D1ProbeCloudflareWorkerCanaryCleanupObligationV1;
        await expect(
            planD1ProbeCloudflareWorkerCanaryCleanupResumptionWithDependenciesTestOnlyV1(
                { plan_digest: obligation.plan_digest },
                dependencies(substitutedObligation, current)
            )
        ).resolves.toMatchObject({ decision: "stop", classification: "local_records_corrupt" });
    });

    it("fails closed on unstable snapshots, missing records, throwing dependencies, extras, and proxies", async () => {
        const obligation = await makeObligation();
        const current = consistency(obligation);
        let reads = 0;
        await expect(
            planD1ProbeCloudflareWorkerCanaryCleanupResumptionWithDependenciesTestOnlyV1(
                { plan_digest: obligation.plan_digest },
                {
                    ...dependencies(obligation, current),
                    read_consistency: async () =>
                        ++reads === 1 ? current : { ...current, driver_lease_generation: 3 },
                }
            )
        ).resolves.toMatchObject({ decision: "stop", classification: "local_records_unstable" });

        await expect(
            planD1ProbeCloudflareWorkerCanaryCleanupResumptionWithDependenciesTestOnlyV1(
                { plan_digest: obligation.plan_digest },
                {
                    ...dependencies(obligation, current),
                    read_cleanup_obligation: async () => ({ success: false, code: "obligation_not_found" }),
                }
            )
        ).resolves.toMatchObject({ decision: "stop", classification: "local_records_missing" });

        await expect(
            planD1ProbeCloudflareWorkerCanaryCleanupResumptionWithDependenciesTestOnlyV1(
                { plan_digest: obligation.plan_digest },
                {
                    ...dependencies(obligation, current),
                    compile_cleanup_obligation: async () => {
                        throw new Error("digest failed");
                    },
                }
            )
        ).resolves.toMatchObject({ decision: "stop", classification: "local_records_corrupt" });

        await expect(
            planD1ProbeCloudflareWorkerCanaryCleanupResumptionWithDependenciesTestOnlyV1(
                { plan_digest: obligation.plan_digest },
                {
                    ...dependencies(obligation, current),
                    read_base_recovery: async () => {
                        throw new Error("reader failed");
                    },
                }
            )
        ).resolves.toMatchObject({ decision: "stop", classification: "local_records_corrupt" });

        const baseDependencies = dependencies(obligation, current);
        for (const input of [
            { plan_digest: obligation.plan_digest, extra: true },
            new Proxy(
                { plan_digest: obligation.plan_digest },
                {
                    ownKeys: () => {
                        throw new Error("hostile keys");
                    },
                }
            ),
        ]) {
            const result = await planD1ProbeCloudflareWorkerCanaryCleanupResumptionWithDependenciesTestOnlyV1(
                input,
                baseDependencies
            );
            expect(result).toMatchObject({ decision: "stop", cleanup_authorized: false });
        }
    });
});
