import {
    readD1ProbeCloudflareWorkerCanaryBaseRecoveryV1,
    type D1ProbeCloudflareWorkerCanaryBaseRecoveryV1,
} from "./cloudflare-worker-canary-base-recovery.js";
import {
    compileD1ProbeCloudflareWorkerCanaryCleanupObligationV1,
    readD1ProbeCloudflareWorkerCanaryCleanupObligationReadOnlyV1,
    type D1ProbeCloudflareWorkerCanaryCleanupObligationResultV1,
} from "./cloudflare-worker-canary-cleanup-obligation.js";
import {
    readD1ProbeCloudflareWorkerCanaryConsistencyV1,
    type D1ProbeCloudflareWorkerCanaryConsistencyV1,
} from "./cloudflare-worker-canary-consistency.js";

const DigestV1 = /^[0-9a-f]{64}$/u;
const OperationStatesV1 = new Set([
    "prepared",
    "shell_dispatching",
    "shell_identified",
    "version_dispatching",
    "version_identified",
    "deployment_dispatching",
    "deployment_identified",
    "cleanup_reconciling",
    "delete_dispatching",
    "absence_observed",
    "manual_required",
]);
const ForwardOperationStatesV1 = new Set([
    "prepared",
    "shell_dispatching",
    "shell_identified",
    "version_dispatching",
    "version_identified",
    "deployment_dispatching",
    "deployment_identified",
]);
const ForwardWorkflowStepsV1 = new Set([
    "prepared_worker_list",
    "shell_create",
    "shell_dispatch_reconciliation",
    "shell_readback",
    "version_create",
    "version_dispatch_reconciliation",
    "version_readback",
    "deployment_create",
    "deployment_dispatch_reconciliation",
    "deployment_readback",
]);
const CleanupWorkflowStepsV1 = new Set([
    "cleanup_worker_readback",
    "cleanup_worker_list",
    "delete_worker",
    "deleted_worker_readback",
    "deleted_worker_list",
]);
const EffectPhasesV1 = new Set(["dispatch_intent", "dispatch_started", "response_observed", "dispatch_ambiguous"]);

type CleanupResumptionDecisionV1 =
    | "stop"
    | "enter_cleanup_reconciliation"
    | "resume_cleanup_reconciliation"
    | "revalidate_local_state_transition"
    | "read_only_remote_reconciliation"
    | "cleanup_complete";

type CleanupResumptionClassificationV1 =
    | "invalid_input"
    | "local_records_missing"
    | "local_records_unstable"
    | "local_records_corrupt"
    | "local_outcome_ambiguous"
    | "cleanup_entry_ready"
    | "cleanup_resume_ready"
    | "local_state_transition_pending"
    | "remote_observation_required"
    | "cleanup_already_complete"
    | "manual_intervention_required";

type CleanupResumptionRequirementV1 =
    | "manual_stop"
    | "fresh_lease_and_exact_head_reassertion"
    | "state_transition_revalidation"
    | "read_only_remote_reconciliation_only"
    | "none";

interface FalseAuthorityV1 {
    readonly remote_dispatch_authorized: false;
    readonly cleanup_authorized: false;
    readonly mutation_replay_allowed: false;
    readonly recovery_action_authorized: false;
    readonly caller_mutation_authority: false;
    readonly authoritative: false;
    readonly eligible_for_upload: false;
    readonly eligible_for_attestation: false;
    readonly lifecycle_advance_allowed: false;
    readonly gate_promotion_allowed: false;
}

const falseAuthority: FalseAuthorityV1 = Object.freeze({
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

export interface D1ProbeCloudflareWorkerCanaryCleanupResumptionPlanV1 extends FalseAuthorityV1 {
    readonly schema_version: 1;
    readonly kind: "untrusted_d1_probe_cloudflare_worker_api_canary_cleanup_resumption_plan";
    readonly plan_digest: string | null;
    readonly cleanup_obligation_digest: string | null;
    readonly operation_revision: number | null;
    readonly operation_state: string | null;
    readonly lease_generation: number | null;
    readonly lease_state: "active" | "released" | null;
    readonly claim_workflow_step: string | null;
    readonly claim_effect_phase: string | null;
    readonly decision: CleanupResumptionDecisionV1;
    readonly classification: CleanupResumptionClassificationV1;
    readonly resumption_requirement: CleanupResumptionRequirementV1;
}

export interface D1ProbeCloudflareWorkerCanaryCleanupResumptionTestOnlyDependenciesV1 {
    readonly read_consistency: (planDigest: string) => Promise<D1ProbeCloudflareWorkerCanaryConsistencyV1>;
    readonly read_base_recovery: (planDigest: string) => Promise<D1ProbeCloudflareWorkerCanaryBaseRecoveryV1>;
    readonly read_cleanup_obligation: (
        planDigest: string,
        executionNonceCommitment: string
    ) => Promise<D1ProbeCloudflareWorkerCanaryCleanupObligationResultV1>;
    readonly compile_cleanup_obligation: typeof compileD1ProbeCloudflareWorkerCanaryCleanupObligationV1;
}

const fixedDependencies: D1ProbeCloudflareWorkerCanaryCleanupResumptionTestOnlyDependenciesV1 = Object.freeze({
    read_consistency: readD1ProbeCloudflareWorkerCanaryConsistencyV1,
    read_base_recovery: readD1ProbeCloudflareWorkerCanaryBaseRecoveryV1,
    read_cleanup_obligation: readD1ProbeCloudflareWorkerCanaryCleanupObligationReadOnlyV1,
    compile_cleanup_obligation: compileD1ProbeCloudflareWorkerCanaryCleanupObligationV1,
});

const report = (
    planDigest: string | null,
    classification: CleanupResumptionClassificationV1,
    decision: CleanupResumptionDecisionV1 = "stop",
    requirement: CleanupResumptionRequirementV1 = "manual_stop",
    consistency: D1ProbeCloudflareWorkerCanaryConsistencyV1 | null = null,
    cleanupObligationDigest: string | null = null
): D1ProbeCloudflareWorkerCanaryCleanupResumptionPlanV1 =>
    Object.freeze({
        schema_version: 1,
        kind: "untrusted_d1_probe_cloudflare_worker_api_canary_cleanup_resumption_plan",
        plan_digest: planDigest,
        cleanup_obligation_digest: cleanupObligationDigest,
        operation_revision: consistency?.state_operation_revision ?? null,
        operation_state: consistency?.state_operation_state ?? null,
        lease_generation: consistency?.driver_lease_generation ?? null,
        lease_state: consistency?.driver_lease_state ?? null,
        claim_workflow_step: consistency?.claim_workflow_step ?? null,
        claim_effect_phase: consistency?.claim_effect_phase ?? null,
        decision,
        classification,
        resumption_requirement: requirement,
        ...falseAuthority,
    });

interface CleanupResumptionSnapshotV1 {
    readonly consistency: D1ProbeCloudflareWorkerCanaryConsistencyV1;
    readonly recovery: D1ProbeCloudflareWorkerCanaryBaseRecoveryV1;
    readonly obligation: D1ProbeCloudflareWorkerCanaryCleanupObligationResultV1 | null;
}

const stableSignature = (input: unknown): string | null => {
    try {
        return JSON.stringify(input);
    } catch {
        return null;
    }
};

const readSnapshot = async (
    planDigest: string,
    dependencies: D1ProbeCloudflareWorkerCanaryCleanupResumptionTestOnlyDependenciesV1
): Promise<CleanupResumptionSnapshotV1> => {
    const consistency = await dependencies.read_consistency(planDigest);
    const recovery = await dependencies.read_base_recovery(planDigest);
    const nonceCommitment = consistency.state_execution_nonce_commitment;
    const obligation =
        typeof nonceCommitment === "string" && DigestV1.test(nonceCommitment)
            ? await dependencies.read_cleanup_obligation(planDigest, nonceCommitment)
            : null;
    return { consistency, recovery, obligation };
};

const authorityIsFalse = (
    consistency: D1ProbeCloudflareWorkerCanaryConsistencyV1,
    recovery: D1ProbeCloudflareWorkerCanaryBaseRecoveryV1
): boolean =>
    consistency.effect_claims_authenticated === false &&
    consistency.caller_mutation_authority === false &&
    consistency.authoritative === false &&
    consistency.eligible_for_upload === false &&
    consistency.eligible_for_attestation === false &&
    consistency.lifecycle_advance_allowed === false &&
    consistency.gate_promotion_allowed === false &&
    recovery.mutation_replay_allowed === false &&
    recovery.cleanup_authorized === false &&
    recovery.recovery_action_authorized === false &&
    recovery.local_records_authenticated === false &&
    recovery.cloudflare_origin_authenticated === false &&
    recovery.caller_mutation_authority === false &&
    recovery.authoritative === false &&
    recovery.eligible_for_upload === false &&
    recovery.eligible_for_attestation === false &&
    recovery.lifecycle_advance_allowed === false &&
    recovery.gate_promotion_allowed === false;

const recoveryMatchesConsistency = (
    planDigest: string,
    consistency: D1ProbeCloudflareWorkerCanaryConsistencyV1,
    recovery: D1ProbeCloudflareWorkerCanaryBaseRecoveryV1
): boolean =>
    consistency.plan_digest === planDigest &&
    recovery.plan_digest === planDigest &&
    recovery.state_operation_revision === consistency.state_operation_revision &&
    recovery.state_operation_record_digest === consistency.state_operation_record_digest &&
    recovery.claim_journal_revision === consistency.claim_journal_revision &&
    recovery.claim_digest === consistency.claim_digest &&
    recovery.claim_effect_phase === consistency.claim_effect_phase &&
    recovery.claim_cleanup_obligation_digest === consistency.claim_cleanup_obligation_digest &&
    recovery.driver_lease_generation === consistency.driver_lease_generation &&
    recovery.driver_lease_record_digest === consistency.driver_lease_record_digest;

const projectionIsSafe = (consistency: D1ProbeCloudflareWorkerCanaryConsistencyV1): boolean =>
    consistency.state_operation_revision !== null &&
    Number.isSafeInteger(consistency.state_operation_revision) &&
    consistency.state_operation_revision >= 0 &&
    consistency.state_operation_state !== null &&
    OperationStatesV1.has(consistency.state_operation_state) &&
    (consistency.driver_lease_generation === null ||
        (Number.isSafeInteger(consistency.driver_lease_generation) && consistency.driver_lease_generation >= 0)) &&
    (consistency.driver_lease_state === null ||
        consistency.driver_lease_state === "active" ||
        consistency.driver_lease_state === "released") &&
    (consistency.claim_workflow_step === null ||
        ForwardWorkflowStepsV1.has(consistency.claim_workflow_step) ||
        CleanupWorkflowStepsV1.has(consistency.claim_workflow_step)) &&
    (consistency.claim_effect_phase === null || EffectPhasesV1.has(consistency.claim_effect_phase));

const obligationBindingMatchesWorkflow = (
    consistency: D1ProbeCloudflareWorkerCanaryConsistencyV1,
    obligationDigest: string
): boolean => {
    const operationState = consistency.state_operation_state;
    const workflowStep = consistency.claim_workflow_step;
    if (operationState === null || workflowStep === null) return false;
    const forwardBinding =
        ForwardWorkflowStepsV1.has(workflowStep) && consistency.claim_cleanup_obligation_digest === null;
    const cleanupBinding =
        CleanupWorkflowStepsV1.has(workflowStep) && consistency.claim_cleanup_obligation_digest === obligationDigest;
    if (ForwardOperationStatesV1.has(operationState)) return forwardBinding;
    if (operationState === "cleanup_reconciling") {
        const adjacentForwardTransition =
            forwardBinding &&
            consistency.classification === "state_ahead" &&
            consistency.claim_effect_phase === "response_observed" &&
            consistency.state_operation_revision !== null &&
            consistency.claim_operation_revision !== null &&
            consistency.state_operation_revision === consistency.claim_operation_revision + 1;
        return cleanupBinding || adjacentForwardTransition;
    }
    if (["delete_dispatching", "absence_observed"].includes(operationState)) {
        return cleanupBinding;
    }
    return operationState === "manual_required" && (forwardBinding || cleanupBinding);
};

const classify = async (
    planDigest: string,
    snapshot: CleanupResumptionSnapshotV1,
    dependencies: D1ProbeCloudflareWorkerCanaryCleanupResumptionTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryCleanupResumptionPlanV1> => {
    const { consistency, recovery, obligation: obligationResult } = snapshot;
    if (
        consistency.classification === "missing" ||
        (obligationResult?.success === false && obligationResult.code === "obligation_not_found")
    ) {
        return report(planDigest, "local_records_missing");
    }
    if (consistency.classification === "unstable" || recovery.classification === "local_histories_unstable") {
        return report(planDigest, "local_records_unstable");
    }
    if (
        consistency.classification === "corrupt" ||
        recovery.classification === "local_histories_corrupt" ||
        obligationResult === null ||
        !obligationResult.success ||
        !projectionIsSafe(consistency) ||
        !authorityIsFalse(consistency, recovery) ||
        !recoveryMatchesConsistency(planDigest, consistency, recovery)
    ) {
        return report(planDigest, "local_records_corrupt");
    }

    const obligation = obligationResult.obligation;
    let recompiled: D1ProbeCloudflareWorkerCanaryCleanupObligationResultV1;
    try {
        recompiled = await dependencies.compile_cleanup_obligation(obligation.operation, obligation.cleanup_grace);
    } catch {
        return report(planDigest, "local_records_corrupt");
    }
    if (
        !recompiled.success ||
        stableSignature(recompiled.obligation) !== stableSignature(obligation) ||
        obligation.plan_digest !== planDigest ||
        obligation.execution_nonce_commitment !== consistency.state_execution_nonce_commitment ||
        consistency.claim_execution_nonce_commitment !== obligation.execution_nonce_commitment ||
        !obligationBindingMatchesWorkflow(consistency, obligation.obligation_digest)
    ) {
        return report(planDigest, "local_records_corrupt");
    }
    const obligationDigest = obligation.obligation_digest;

    if (consistency.state_operation_state === "manual_required") {
        return report(planDigest, "manual_intervention_required", "stop", "manual_stop", consistency, obligationDigest);
    }
    if (
        recovery.classification === "mutation_outcome_unknown_no_retry" &&
        recovery.recovery_requirement === "read_only_remote_reconciliation_only"
    ) {
        return report(
            planDigest,
            "remote_observation_required",
            "read_only_remote_reconciliation",
            "read_only_remote_reconciliation_only",
            consistency,
            obligationDigest
        );
    }
    if (
        recovery.classification === "response_observed_state_transition_pending" &&
        recovery.recovery_requirement === "state_transition_revalidation"
    ) {
        return report(
            planDigest,
            "local_state_transition_pending",
            "revalidate_local_state_transition",
            "state_transition_revalidation",
            consistency,
            obligationDigest
        );
    }
    if (
        recovery.classification !== "local_histories_aligned" ||
        recovery.recovery_requirement !== "none" ||
        consistency.classification !== "state_ahead" ||
        consistency.claim_effect_phase !== "response_observed"
    ) {
        return report(planDigest, "local_outcome_ambiguous", "stop", "manual_stop", consistency, obligationDigest);
    }
    if (consistency.state_operation_state === "absence_observed") {
        return report(
            planDigest,
            "cleanup_already_complete",
            "cleanup_complete",
            "none",
            consistency,
            obligationDigest
        );
    }
    if (
        consistency.state_operation_state === "cleanup_reconciling" ||
        consistency.state_operation_state === "delete_dispatching"
    ) {
        return report(
            planDigest,
            "cleanup_resume_ready",
            "resume_cleanup_reconciliation",
            "fresh_lease_and_exact_head_reassertion",
            consistency,
            obligationDigest
        );
    }
    return report(
        planDigest,
        "cleanup_entry_ready",
        "enter_cleanup_reconciliation",
        "fresh_lease_and_exact_head_reassertion",
        consistency,
        obligationDigest
    );
};

const planWithDependencies = async (
    input: unknown,
    dependencies: D1ProbeCloudflareWorkerCanaryCleanupResumptionTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryCleanupResumptionPlanV1> => {
    try {
        if (typeof input !== "object" || input === null || Array.isArray(input)) {
            return report(null, "invalid_input");
        }
        const keys = Object.keys(input).sort();
        if (keys.length !== 1 || keys[0] !== "plan_digest") return report(null, "invalid_input");
        const planDigest = Reflect.get(input, "plan_digest") as unknown;
        if (typeof planDigest !== "string" || !DigestV1.test(planDigest)) return report(null, "invalid_input");
        const first = await readSnapshot(planDigest, dependencies);
        const second = await readSnapshot(planDigest, dependencies);
        const firstSignature = stableSignature(first);
        if (firstSignature === null || firstSignature !== stableSignature(second)) {
            return report(planDigest, "local_records_unstable");
        }
        return await classify(planDigest, second, dependencies);
    } catch {
        return report(null, "local_records_corrupt");
    }
};

export const planD1ProbeCloudflareWorkerCanaryCleanupResumptionV1 = async (
    input: unknown
): Promise<D1ProbeCloudflareWorkerCanaryCleanupResumptionPlanV1> =>
    await planWithDependencies(input, fixedDependencies);

/** Test-only dependency seam. Production callers must use the fixed read-only planner. */
export const planD1ProbeCloudflareWorkerCanaryCleanupResumptionWithDependenciesTestOnlyV1 = async (
    input: unknown,
    dependencies: D1ProbeCloudflareWorkerCanaryCleanupResumptionTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryCleanupResumptionPlanV1> =>
    await planWithDependencies(input, Object.freeze({ ...dependencies }));
