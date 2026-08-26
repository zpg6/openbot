import {
    readD1ProbeCloudflareWorkerCanaryBaseRecoveryV1,
    type D1ProbeCloudflareWorkerCanaryBaseRecoveryV1,
} from "./cloudflare-worker-canary-base-recovery.js";
import {
    readD1ProbeCloudflareWorkerCanaryDurableTranscriptV1,
    type D1ProbeCloudflareWorkerCanaryDurableTranscriptV1,
} from "./cloudflare-worker-canary-durable-transcript.js";
import {
    commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1,
    digestD1ProbeCloudflareWorkerCanaryOperationRecordV1,
} from "./cloudflare-worker-canary-effect-journal.js";
import {
    digestD1ProbeCloudflareWorkerCanaryDriverLeaseRecordV1,
    readD1ProbeCloudflareWorkerCanaryDriverLeaseHeadReadOnlyV1,
    type D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1,
} from "./cloudflare-worker-canary-driver-lease.js";
import {
    validateD1ProbeCloudflareWorkerCanaryOperationV1,
    type D1ProbeCloudflareWorkerCanaryOperationV1,
} from "./cloudflare-worker-canary-operation.js";

const DigestV1 = /^[0-9a-f]{64}$/u;

interface FalseRecoveryAuthorityV1 {
    readonly remote_dispatch_authorized: false;
    readonly remote_effect_replay_allowed: false;
    readonly ambiguous_remote_effect_retry_allowed: false;
    readonly mutation_replay_allowed: false;
    readonly cleanup_authorized: false;
    readonly recovery_action_authorized: false;
    readonly caller_mutation_authority: false;
    readonly authoritative: false;
    readonly eligible_for_upload: false;
    readonly eligible_for_attestation: false;
    readonly lifecycle_advance_allowed: false;
    readonly gate_promotion_allowed: false;
}

const falseAuthority: FalseRecoveryAuthorityV1 = Object.freeze({
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
});

export type D1ProbeCloudflareWorkerCanaryDurableDriverRecoveryDispositionV1 =
    | "fresh_lease_and_exact_head_reassertion"
    | "dead_owner_takeover_before_intent_abandonment"
    | "read_only_remote_reconciliation"
    | "keyed_archive_reconciliation_without_mutation_replay"
    | "archive_repair_or_manual_stop"
    | "state_transition_revalidation"
    | "local_histories_aligned";

export interface D1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionV1 extends FalseRecoveryAuthorityV1 {
    readonly schema_version: 1;
    readonly kind: "d1_probe_cloudflare_worker_api_canary_durable_driver_recovery_session";
    readonly plan_digest: string;
    readonly execution_nonce_commitment: string;
    readonly operation_revision: number;
    readonly operation_state: D1ProbeCloudflareWorkerCanaryOperationV1["state"];
    readonly operation_record_digest: string;
    readonly recovery_classification: D1ProbeCloudflareWorkerCanaryBaseRecoveryV1["classification"];
    readonly recovery_requirement: D1ProbeCloudflareWorkerCanaryBaseRecoveryV1["recovery_requirement"];
    readonly transcript_classification: D1ProbeCloudflareWorkerCanaryDurableTranscriptV1["classification"];
    readonly transcript_digest: string;
    readonly journal_head_revision: number | null;
    readonly journal_head_claim_digest: string | null;
    readonly archive_record_count: number;
    readonly disposition: D1ProbeCloudflareWorkerCanaryDurableDriverRecoveryDispositionV1;
    readonly recovery_observation_only: true;
    readonly lease_acquisition_performed: false;
    readonly lease_takeover_performed: false;
    readonly archive_reconciliation_performed: false;
    readonly operation_transition_performed: false;
}

export type D1ProbeCloudflareWorkerCanaryDurableDriverRecoveryResultV1 =
    | ({
          readonly success: false;
          readonly code: "durable_driver_recovery_denied";
      } & FalseRecoveryAuthorityV1)
    | ({
          readonly success: true;
          readonly session: D1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionV1;
      } & FalseRecoveryAuthorityV1);

export interface D1ProbeCloudflareWorkerCanaryDurableDriverRecoveryTestOnlyDependenciesV1 {
    readonly validate_operation: typeof validateD1ProbeCloudflareWorkerCanaryOperationV1;
    readonly digest_operation: typeof digestD1ProbeCloudflareWorkerCanaryOperationRecordV1;
    readonly commit_execution_nonce: typeof commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1;
    readonly read_driver_lease_head_read_only: (
        planDigest: string
    ) => Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1>;
    readonly digest_driver_lease: typeof digestD1ProbeCloudflareWorkerCanaryDriverLeaseRecordV1;
    readonly read_base_recovery: (planDigest: string) => Promise<D1ProbeCloudflareWorkerCanaryBaseRecoveryV1>;
    readonly read_durable_transcript: (planDigest: string) => Promise<D1ProbeCloudflareWorkerCanaryDurableTranscriptV1>;
}

const fixedDependencies: D1ProbeCloudflareWorkerCanaryDurableDriverRecoveryTestOnlyDependenciesV1 = Object.freeze({
    validate_operation: validateD1ProbeCloudflareWorkerCanaryOperationV1,
    digest_operation: digestD1ProbeCloudflareWorkerCanaryOperationRecordV1,
    commit_execution_nonce: commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1,
    read_driver_lease_head_read_only: readD1ProbeCloudflareWorkerCanaryDriverLeaseHeadReadOnlyV1,
    digest_driver_lease: digestD1ProbeCloudflareWorkerCanaryDriverLeaseRecordV1,
    read_base_recovery: readD1ProbeCloudflareWorkerCanaryBaseRecoveryV1,
    read_durable_transcript: readD1ProbeCloudflareWorkerCanaryDurableTranscriptV1,
});

const denied = (): D1ProbeCloudflareWorkerCanaryDurableDriverRecoveryResultV1 => ({
    success: false,
    code: "durable_driver_recovery_denied",
    ...falseAuthority,
});

const exactInput = (input: unknown): input is { readonly operation: unknown } => {
    try {
        if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
        const keys = Object.keys(input);
        return keys.length === 1 && keys[0] === "operation";
    } catch {
        return false;
    }
};

const stableSignature = (input: unknown): string | null => {
    try {
        return JSON.stringify(input);
    } catch {
        return null;
    }
};

interface RecoverySnapshotV1 {
    readonly recovery: D1ProbeCloudflareWorkerCanaryBaseRecoveryV1;
    readonly transcript: D1ProbeCloudflareWorkerCanaryDurableTranscriptV1;
    readonly driverLease: D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1;
}

const readStableSnapshot = async (
    planDigest: string,
    dependencies: D1ProbeCloudflareWorkerCanaryDurableDriverRecoveryTestOnlyDependenciesV1
): Promise<RecoverySnapshotV1 | null> => {
    const first = await Promise.all([
        dependencies.read_base_recovery(planDigest),
        dependencies.read_durable_transcript(planDigest),
        dependencies.read_driver_lease_head_read_only(planDigest),
    ]);
    const second = await Promise.all([
        dependencies.read_base_recovery(planDigest),
        dependencies.read_durable_transcript(planDigest),
        dependencies.read_driver_lease_head_read_only(planDigest),
    ]);
    const firstSignature = stableSignature(first);
    return firstSignature !== null && firstSignature === stableSignature(second)
        ? { recovery: second[0], transcript: second[1], driverLease: second[2] }
        : null;
};

const upstreamAuthorityFalse = (
    recovery: D1ProbeCloudflareWorkerCanaryBaseRecoveryV1,
    transcript: D1ProbeCloudflareWorkerCanaryDurableTranscriptV1
): boolean =>
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
    recovery.gate_promotion_allowed === false &&
    transcript.mutation_replay_allowed === false &&
    transcript.cleanup_authorized === false &&
    transcript.transcript_authenticated === false &&
    transcript.cloudflare_origin_authenticated === false &&
    transcript.caller_mutation_authority === false &&
    transcript.authoritative === false &&
    transcript.eligible_for_upload === false &&
    transcript.eligible_for_attestation === false &&
    transcript.lifecycle_advance_allowed === false &&
    transcript.gate_promotion_allowed === false;

const driverLeaseAuthorityFalse = (
    driverLease: Extract<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1, { readonly success: true }>
): boolean =>
    driverLease.lease.caller_mutation_authority === false &&
    driverLease.lease.authoritative === false &&
    driverLease.lease.eligible_for_upload === false &&
    driverLease.lease.eligible_for_attestation === false &&
    driverLease.lease.lifecycle_advance_allowed === false &&
    driverLease.lease.gate_promotion_allowed === false &&
    driverLease.lease.mutation_authority === false;

const dispositionFor = (
    recovery: D1ProbeCloudflareWorkerCanaryBaseRecoveryV1,
    transcript: D1ProbeCloudflareWorkerCanaryDurableTranscriptV1
): D1ProbeCloudflareWorkerCanaryDurableDriverRecoveryDispositionV1 | null => {
    switch (recovery.classification) {
        case "prepared_without_effect_claim":
            return recovery.recovery_requirement === "fresh_lease_and_exact_head_reassertion" &&
                transcript.classification === "local_history_missing"
                ? "fresh_lease_and_exact_head_reassertion"
                : null;
        case "intent_only_requires_dead_owner_takeover":
            return recovery.recovery_requirement === "dead_owner_proof_and_takeover_before_abandonment" &&
                transcript.classification === "dispatch_intent_tail"
                ? "dead_owner_takeover_before_intent_abandonment"
                : null;
        case "mutation_outcome_unknown_no_retry":
            return recovery.recovery_requirement === "read_only_remote_reconciliation_only" &&
                (transcript.classification === "dispatch_started_tail" ||
                    transcript.classification === "durable_prefix_complete")
                ? "read_only_remote_reconciliation"
                : null;
        case "archive_ahead_requires_keyed_reconciliation":
            return recovery.recovery_requirement === "keyed_archive_reconciliation_without_mutation_replay" &&
                transcript.classification === "archive_ahead"
                ? "keyed_archive_reconciliation_without_mutation_replay"
                : null;
        case "terminal_claim_missing_archive":
            return recovery.recovery_requirement === "archive_repair_or_manual_stop" &&
                transcript.classification === "terminal_archive_missing"
                ? "archive_repair_or_manual_stop"
                : null;
        case "response_observed_state_transition_pending":
            return recovery.recovery_requirement === "state_transition_revalidation" &&
                transcript.classification === "durable_prefix_complete"
                ? "state_transition_revalidation"
                : null;
        case "local_histories_aligned":
            return recovery.recovery_requirement === "none" && transcript.classification === "durable_prefix_complete"
                ? "local_histories_aligned"
                : null;
        default:
            return null;
    }
};

const exactHistoryBinding = (
    operation: D1ProbeCloudflareWorkerCanaryOperationV1,
    operationDigest: string,
    executionNonceCommitment: string,
    recovery: D1ProbeCloudflareWorkerCanaryBaseRecoveryV1,
    transcript: D1ProbeCloudflareWorkerCanaryDurableTranscriptV1
): boolean => {
    if (
        recovery.plan_digest !== operation.plan.plan_digest ||
        transcript.plan_digest !== operation.plan.plan_digest ||
        recovery.state_operation_revision !== operation.revision ||
        recovery.state_operation_record_digest !== operationDigest ||
        transcript.transcript_digest === null ||
        !DigestV1.test(transcript.transcript_digest) ||
        recovery.claim_journal_revision !== transcript.journal_head_revision ||
        recovery.claim_digest !== transcript.journal_head_claim_digest ||
        recovery.archive_record_count !== transcript.archive_record_count ||
        transcript.entry_count !== transcript.entries.length ||
        transcript.entries.some(entry => entry.execution_nonce_commitment !== executionNonceCommitment)
    ) {
        return false;
    }
    const tail = transcript.entries.at(-1);
    if (recovery.claim_digest === null) {
        return (
            tail === undefined &&
            recovery.claim_effect_phase === null &&
            recovery.claim_cleanup_obligation_digest === null
        );
    }
    return (
        tail !== undefined &&
        tail.latest_effect_phase === recovery.claim_effect_phase &&
        tail.cleanup_obligation_digest === recovery.claim_cleanup_obligation_digest
    );
};

const openWithDependencies = async (
    input: unknown,
    dependencies: D1ProbeCloudflareWorkerCanaryDurableDriverRecoveryTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryDurableDriverRecoveryResultV1> => {
    if (!exactInput(input)) return denied();
    try {
        const operationInput = structuredClone(input.operation);
        const operation = await dependencies.validate_operation(operationInput);
        if (operation === null) return denied();
        const planDigest = operation.plan.plan_digest;
        const operationRevision = operation.revision;
        const operationState = operation.state;
        const executionNonce = operation.execution_nonce;
        const [operationDigest, executionNonceCommitment, snapshot] = await Promise.all([
            dependencies.digest_operation(structuredClone(operation)),
            dependencies.commit_execution_nonce(executionNonce),
            readStableSnapshot(planDigest, dependencies),
        ]);
        if (
            operationDigest === null ||
            executionNonceCommitment === null ||
            snapshot === null ||
            !DigestV1.test(operationDigest) ||
            !DigestV1.test(executionNonceCommitment) ||
            !snapshot.driverLease.success ||
            !upstreamAuthorityFalse(snapshot.recovery, snapshot.transcript) ||
            !driverLeaseAuthorityFalse(snapshot.driverLease) ||
            !exactHistoryBinding(
                operation,
                operationDigest,
                executionNonceCommitment,
                snapshot.recovery,
                snapshot.transcript
            )
        ) {
            return denied();
        }
        const driverLeaseDigest = await dependencies.digest_driver_lease(snapshot.driverLease.lease);
        if (
            driverLeaseDigest === null ||
            driverLeaseDigest !== snapshot.recovery.driver_lease_record_digest ||
            snapshot.driverLease.lease.plan_digest !== planDigest ||
            snapshot.driverLease.lease.execution_nonce_commitment !== executionNonceCommitment ||
            snapshot.driverLease.lease.generation !== snapshot.recovery.driver_lease_generation ||
            snapshot.driverLease.lease.state !== "active"
        ) {
            return denied();
        }
        const disposition = dispositionFor(snapshot.recovery, snapshot.transcript);
        const transcriptDigest = snapshot.transcript.transcript_digest;
        if (disposition === null || transcriptDigest === null) return denied();
        const session: D1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionV1 = Object.freeze({
            schema_version: 1,
            kind: "d1_probe_cloudflare_worker_api_canary_durable_driver_recovery_session",
            plan_digest: planDigest,
            execution_nonce_commitment: executionNonceCommitment,
            operation_revision: operationRevision,
            operation_state: operationState,
            operation_record_digest: operationDigest,
            recovery_classification: snapshot.recovery.classification,
            recovery_requirement: snapshot.recovery.recovery_requirement,
            transcript_classification: snapshot.transcript.classification,
            transcript_digest: transcriptDigest,
            journal_head_revision: snapshot.transcript.journal_head_revision,
            journal_head_claim_digest: snapshot.transcript.journal_head_claim_digest,
            archive_record_count: snapshot.transcript.archive_record_count,
            disposition,
            recovery_observation_only: true,
            lease_acquisition_performed: false,
            lease_takeover_performed: false,
            archive_reconciliation_performed: false,
            operation_transition_performed: false,
            ...falseAuthority,
        });
        return Object.freeze({ success: true, session, ...falseAuthority });
    } catch {
        return denied();
    }
};

export const openD1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionV1 = async (
    input: unknown
): Promise<D1ProbeCloudflareWorkerCanaryDurableDriverRecoveryResultV1> =>
    await openWithDependencies(input, fixedDependencies);

/** Test-only dependency seam. Production callers use fixed read-only recovery and transcript readers. */
export const openD1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionWithDependenciesTestOnlyV1 = async (
    input: unknown,
    dependencies: D1ProbeCloudflareWorkerCanaryDurableDriverRecoveryTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryDurableDriverRecoveryResultV1> =>
    await openWithDependencies(input, Object.freeze({ ...dependencies }));
