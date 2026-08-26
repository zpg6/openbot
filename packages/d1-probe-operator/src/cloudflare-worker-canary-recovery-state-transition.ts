import {
    readD1ProbeCloudflareWorkerCanaryBaseRecoveryV1,
    type D1ProbeCloudflareWorkerCanaryBaseRecoveryV1,
} from "./cloudflare-worker-canary-base-recovery.js";
import {
    openD1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionV1,
    type D1ProbeCloudflareWorkerCanaryDurableDriverRecoveryResultV1,
    type D1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionV1,
} from "./cloudflare-worker-canary-durable-driver-recovery.js";
import {
    assertCurrentD1ProbeCloudflareWorkerCanaryDriverLeaseReadOnlyV1,
    digestD1ProbeCloudflareWorkerCanaryDriverLeaseRecordV1,
    type D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1,
    type D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1,
} from "./cloudflare-worker-canary-driver-lease.js";
import {
    commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1,
    digestD1ProbeCloudflareWorkerCanaryOperationRecordV1,
} from "./cloudflare-worker-canary-effect-journal.js";
import {
    validateD1ProbeCloudflareWorkerCanaryOperationV1,
    type D1ProbeCloudflareWorkerCanaryOperationV1,
} from "./cloudflare-worker-canary-operation.js";

const DigestV1 = /^[0-9a-f]{64}$/u;
const ExecutionNonceV1 = /^[0-9a-f]{32}$/u;
const OwnerNonceV1 = /^[A-Za-z0-9_-]{43}$/u;

interface FalseTransitionAuthorityV1 {
    readonly keyed_response_semantic_projection_verified: false;
    readonly operation_transition_authorized: false;
    readonly local_operation_transition_performed: false;
    readonly remote_request_dispatched: false;
    readonly remote_effect_replay_allowed: false;
    readonly ambiguous_remote_effect_retry_allowed: false;
    readonly mutation_replay_allowed: false;
    readonly cleanup_performed: false;
    readonly cleanup_authorized: false;
    readonly archive_reconciliation_performed: false;
    readonly repair_performed: false;
    readonly recovery_action_authorized: false;
    readonly caller_mutation_authority: false;
    readonly authoritative: false;
    readonly eligible_for_upload: false;
    readonly eligible_for_attestation: false;
    readonly lifecycle_advance_allowed: false;
    readonly gate_promotion_allowed: false;
}

const falseAuthority: FalseTransitionAuthorityV1 = Object.freeze({
    keyed_response_semantic_projection_verified: false,
    operation_transition_authorized: false,
    local_operation_transition_performed: false,
    remote_request_dispatched: false,
    remote_effect_replay_allowed: false,
    ambiguous_remote_effect_retry_allowed: false,
    mutation_replay_allowed: false,
    cleanup_performed: false,
    cleanup_authorized: false,
    archive_reconciliation_performed: false,
    repair_performed: false,
    recovery_action_authorized: false,
    caller_mutation_authority: false,
    authoritative: false,
    eligible_for_upload: false,
    eligible_for_attestation: false,
    lifecycle_advance_allowed: false,
    gate_promotion_allowed: false,
});

export interface D1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateInputV1 {
    readonly operation: unknown;
    readonly recovery_session: unknown;
    readonly driver_lease_owner: unknown;
}

export interface D1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateV1 extends FalseTransitionAuthorityV1 {
    readonly schema_version: 1;
    readonly kind: "d1_probe_cloudflare_worker_api_canary_recovery_state_transition_candidate";
    readonly plan_digest: string;
    readonly execution_nonce_commitment: string;
    readonly operation_revision: number;
    readonly operation_state: D1ProbeCloudflareWorkerCanaryOperationV1["state"];
    readonly operation_record_digest: string;
    readonly journal_head_revision: number;
    readonly journal_head_claim_digest: string;
    readonly archive_record_count: number;
    readonly driver_lease_generation: number;
    readonly candidate_status: "not_compiled";
    readonly transition_requirement: "keyed_response_semantic_projection_required";
}

export type D1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateResultV1 =
    | ({
          readonly success: false;
          readonly code: "recovery_state_transition_candidate_denied";
      } & FalseTransitionAuthorityV1)
    | ({
          readonly success: true;
          readonly candidate: D1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateV1;
      } & FalseTransitionAuthorityV1);

export interface D1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateTestOnlyDependenciesV1 {
    readonly validate_operation: typeof validateD1ProbeCloudflareWorkerCanaryOperationV1;
    readonly digest_operation: typeof digestD1ProbeCloudflareWorkerCanaryOperationRecordV1;
    readonly commit_execution_nonce: typeof commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1;
    readonly open_recovery_session: (
        input: unknown
    ) => Promise<D1ProbeCloudflareWorkerCanaryDurableDriverRecoveryResultV1>;
    readonly read_base_recovery: (planDigest: string) => Promise<D1ProbeCloudflareWorkerCanaryBaseRecoveryV1>;
    readonly assert_current_driver_lease_read_only: (
        owner: D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1
    ) => Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1>;
    readonly digest_driver_lease: typeof digestD1ProbeCloudflareWorkerCanaryDriverLeaseRecordV1;
}

const fixedDependencies: D1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateTestOnlyDependenciesV1 =
    Object.freeze({
        validate_operation: validateD1ProbeCloudflareWorkerCanaryOperationV1,
        digest_operation: digestD1ProbeCloudflareWorkerCanaryOperationRecordV1,
        commit_execution_nonce: commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1,
        open_recovery_session: openD1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionV1,
        read_base_recovery: readD1ProbeCloudflareWorkerCanaryBaseRecoveryV1,
        assert_current_driver_lease_read_only: assertCurrentD1ProbeCloudflareWorkerCanaryDriverLeaseReadOnlyV1,
        digest_driver_lease: digestD1ProbeCloudflareWorkerCanaryDriverLeaseRecordV1,
    });

const denied = (): D1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateResultV1 =>
    Object.freeze({ success: false, code: "recovery_state_transition_candidate_denied", ...falseAuthority });

const exactKeys = (value: Record<string, unknown>, expectedKeys: readonly string[]): boolean => {
    const keys = Object.keys(value).sort();
    const expected = [...expectedKeys].sort();
    return keys.length === expected.length && keys.every((key, index) => key === expected[index]);
};

const stableSignature = (input: unknown): string | null => {
    try {
        return JSON.stringify(input);
    } catch {
        return null;
    }
};

const ownerFrom = (input: unknown): D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1 | null => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
    const owner = input as Record<string, unknown>;
    if (!exactKeys(owner, ["plan_digest", "execution_nonce", "generation", "owner_pid", "owner_nonce"])) {
        return null;
    }
    return typeof owner["plan_digest"] === "string" &&
        DigestV1.test(owner["plan_digest"]) &&
        typeof owner["execution_nonce"] === "string" &&
        ExecutionNonceV1.test(owner["execution_nonce"]) &&
        typeof owner["generation"] === "number" &&
        Number.isSafeInteger(owner["generation"]) &&
        owner["generation"] >= 0 &&
        typeof owner["owner_pid"] === "number" &&
        Number.isSafeInteger(owner["owner_pid"]) &&
        owner["owner_pid"] > 0 &&
        owner["owner_pid"] <= 2_147_483_647 &&
        typeof owner["owner_nonce"] === "string" &&
        OwnerNonceV1.test(owner["owner_nonce"])
        ? (Object.freeze({ ...owner }) as unknown as D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1)
        : null;
};

const falseSessionAuthority = (session: D1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionV1): boolean =>
    session.recovery_observation_only === true &&
    session.lease_acquisition_performed === false &&
    session.lease_takeover_performed === false &&
    session.archive_reconciliation_performed === false &&
    session.operation_transition_performed === false &&
    session.remote_dispatch_authorized === false &&
    session.remote_effect_replay_allowed === false &&
    session.ambiguous_remote_effect_retry_allowed === false &&
    session.mutation_replay_allowed === false &&
    session.cleanup_authorized === false &&
    session.recovery_action_authorized === false &&
    session.caller_mutation_authority === false &&
    session.authoritative === false &&
    session.eligible_for_upload === false &&
    session.eligible_for_attestation === false &&
    session.lifecycle_advance_allowed === false &&
    session.gate_promotion_allowed === false;

const falseOpenedAuthority = (
    opened: Extract<D1ProbeCloudflareWorkerCanaryDurableDriverRecoveryResultV1, { success: true }>
): boolean =>
    opened.remote_dispatch_authorized === false &&
    opened.remote_effect_replay_allowed === false &&
    opened.ambiguous_remote_effect_retry_allowed === false &&
    opened.mutation_replay_allowed === false &&
    opened.cleanup_authorized === false &&
    opened.recovery_action_authorized === false &&
    opened.caller_mutation_authority === false &&
    opened.authoritative === false &&
    opened.eligible_for_upload === false &&
    opened.eligible_for_attestation === false &&
    opened.lifecycle_advance_allowed === false &&
    opened.gate_promotion_allowed === false;

const falseRecoveryAuthority = (recovery: D1ProbeCloudflareWorkerCanaryBaseRecoveryV1): boolean =>
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

const exactPendingObservation = (
    session: D1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionV1,
    recovery: D1ProbeCloudflareWorkerCanaryBaseRecoveryV1,
    operation: D1ProbeCloudflareWorkerCanaryOperationV1,
    operationDigest: string,
    nonceCommitment: string
): boolean =>
    session.schema_version === 1 &&
    session.kind === "d1_probe_cloudflare_worker_api_canary_durable_driver_recovery_session" &&
    session.plan_digest === operation.plan.plan_digest &&
    session.execution_nonce_commitment === nonceCommitment &&
    session.operation_revision === operation.revision &&
    session.operation_state === operation.state &&
    session.operation_record_digest === operationDigest &&
    session.recovery_classification === "response_observed_state_transition_pending" &&
    session.recovery_requirement === "state_transition_revalidation" &&
    session.transcript_classification === "durable_prefix_complete" &&
    DigestV1.test(session.transcript_digest) &&
    session.journal_head_revision !== null &&
    session.journal_head_claim_digest !== null &&
    DigestV1.test(session.journal_head_claim_digest) &&
    session.archive_record_count > 0 &&
    session.disposition === "state_transition_revalidation" &&
    falseSessionAuthority(session) &&
    recovery.schema_version === 1 &&
    recovery.kind === "untrusted_d1_probe_cloudflare_worker_api_canary_base_recovery" &&
    recovery.plan_digest === session.plan_digest &&
    recovery.classification === session.recovery_classification &&
    recovery.recovery_requirement === session.recovery_requirement &&
    recovery.state_operation_revision === operation.revision &&
    recovery.state_operation_record_digest === operationDigest &&
    recovery.claim_journal_revision === session.journal_head_revision &&
    recovery.claim_digest === session.journal_head_claim_digest &&
    recovery.claim_effect_phase === "response_observed" &&
    recovery.archive_record_count === session.archive_record_count &&
    recovery.archive_head_claim_digest === session.journal_head_claim_digest &&
    recovery.archive_head_record_digest !== null &&
    DigestV1.test(recovery.archive_head_record_digest) &&
    recovery.archive_head_cleanup_obligation_digest === recovery.claim_cleanup_obligation_digest &&
    recovery.driver_lease_generation !== null &&
    recovery.driver_lease_record_digest !== null &&
    DigestV1.test(recovery.driver_lease_record_digest) &&
    falseRecoveryAuthority(recovery);

const exactLease = async (
    dependencies: D1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateTestOnlyDependenciesV1,
    owner: D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1,
    recovery: D1ProbeCloudflareWorkerCanaryBaseRecoveryV1,
    nonceCommitment: string
): Promise<boolean> => {
    const current = await dependencies.assert_current_driver_lease_read_only(owner);
    if (
        !current.success ||
        current.lease.state !== "active" ||
        current.lease.plan_digest !== owner.plan_digest ||
        current.lease.execution_nonce_commitment !== nonceCommitment ||
        current.lease.generation !== owner.generation ||
        current.lease.generation !== recovery.driver_lease_generation ||
        current.lease.owner_pid !== owner.owner_pid ||
        current.lease.caller_mutation_authority !== false ||
        current.lease.mutation_authority !== false ||
        current.lease.authoritative !== false ||
        current.lease.eligible_for_upload !== false ||
        current.lease.eligible_for_attestation !== false ||
        current.lease.lifecycle_advance_allowed !== false ||
        current.lease.gate_promotion_allowed !== false
    ) {
        return false;
    }
    const digest = await dependencies.digest_driver_lease(current.lease);
    return digest !== null && DigestV1.test(digest) && digest === recovery.driver_lease_record_digest;
};

const readObservation = async (
    dependencies: D1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateTestOnlyDependenciesV1,
    operation: D1ProbeCloudflareWorkerCanaryOperationV1
) => {
    const [opened, recovery] = await Promise.all([
        dependencies.open_recovery_session({ operation: structuredClone(operation) }),
        dependencies.read_base_recovery(operation.plan.plan_digest),
    ]);
    return opened.success && falseOpenedAuthority(opened) ? { session: opened.session, recovery } : null;
};

const planWithDependencies = async (
    input: D1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateInputV1,
    dependencies: D1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateResultV1> => {
    try {
        if (typeof input !== "object" || input === null || Array.isArray(input)) return denied();
        const raw = input as unknown as Record<string, unknown>;
        if (!exactKeys(raw, ["operation", "recovery_session", "driver_lease_owner"])) return denied();
        const operation = await dependencies.validate_operation(structuredClone(raw["operation"]));
        const owner = ownerFrom(raw["driver_lease_owner"]);
        if (
            operation === null ||
            owner === null ||
            owner.plan_digest !== operation.plan.plan_digest ||
            owner.execution_nonce !== operation.execution_nonce
        ) {
            return denied();
        }
        const [operationDigest, nonceCommitment] = await Promise.all([
            dependencies.digest_operation(operation),
            dependencies.commit_execution_nonce(operation.execution_nonce),
        ]);
        if (
            operationDigest === null ||
            nonceCommitment === null ||
            !DigestV1.test(operationDigest) ||
            !DigestV1.test(nonceCommitment)
        ) {
            return denied();
        }
        const suppliedSessionSignature = stableSignature(structuredClone(raw["recovery_session"]));
        if (suppliedSessionSignature === null) return denied();

        const first = await readObservation(dependencies, operation);
        if (
            first === null ||
            suppliedSessionSignature !== stableSignature(first.session) ||
            !exactPendingObservation(first.session, first.recovery, operation, operationDigest, nonceCommitment) ||
            !(await exactLease(dependencies, owner, first.recovery, nonceCommitment))
        ) {
            return denied();
        }
        const firstSignature = stableSignature(first);
        const second = await readObservation(dependencies, operation);
        if (
            firstSignature === null ||
            second === null ||
            firstSignature !== stableSignature(second) ||
            !exactPendingObservation(second.session, second.recovery, operation, operationDigest, nonceCommitment) ||
            !(await exactLease(dependencies, owner, second.recovery, nonceCommitment))
        ) {
            return denied();
        }
        const journalHeadRevision = second.session.journal_head_revision;
        const journalHeadClaimDigest = second.session.journal_head_claim_digest;
        if (journalHeadRevision === null || journalHeadClaimDigest === null) return denied();

        const candidate: D1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateV1 = Object.freeze({
            schema_version: 1,
            kind: "d1_probe_cloudflare_worker_api_canary_recovery_state_transition_candidate",
            plan_digest: operation.plan.plan_digest,
            execution_nonce_commitment: nonceCommitment,
            operation_revision: operation.revision,
            operation_state: operation.state,
            operation_record_digest: operationDigest,
            journal_head_revision: journalHeadRevision,
            journal_head_claim_digest: journalHeadClaimDigest,
            archive_record_count: second.session.archive_record_count,
            driver_lease_generation: owner.generation,
            candidate_status: "not_compiled",
            transition_requirement: "keyed_response_semantic_projection_required",
            ...falseAuthority,
        });
        return Object.freeze({ success: true, candidate, ...falseAuthority });
    } catch {
        return denied();
    }
};

export const planD1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateV1 = async (
    input: D1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateInputV1
): Promise<D1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateResultV1> =>
    await planWithDependencies(input, fixedDependencies);

/** Test-only dependency seam. Production callers use fixed recovery and lease readers. */
export const planD1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateWithDependenciesTestOnlyV1 = async (
    input: D1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateInputV1,
    dependencies: D1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryRecoveryStateTransitionCandidateResultV1> =>
    await planWithDependencies(input, Object.freeze({ ...dependencies }));
