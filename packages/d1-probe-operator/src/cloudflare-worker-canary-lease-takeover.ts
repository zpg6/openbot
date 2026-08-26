import {
    readD1ProbeCloudflareWorkerCanaryBaseRecoveryV1,
    type D1ProbeCloudflareWorkerCanaryBaseRecoveryV1,
} from "./cloudflare-worker-canary-base-recovery.js";
import type { D1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionV1 } from "./cloudflare-worker-canary-durable-driver-recovery.js";
import {
    commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1,
    digestD1ProbeCloudflareWorkerCanaryOperationRecordV1,
} from "./cloudflare-worker-canary-effect-journal.js";
import {
    digestD1ProbeCloudflareWorkerCanaryDriverLeaseRecordV1,
    readD1ProbeCloudflareWorkerCanaryDriverLeaseHeadReadOnlyV1,
    takeoverExpectedD1ProbeCloudflareWorkerCanaryDriverLeaseV1,
    type D1ProbeCloudflareWorkerCanaryDriverLeaseOwnedResultV1,
    type D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1,
} from "./cloudflare-worker-canary-driver-lease.js";
import {
    validateD1ProbeCloudflareWorkerCanaryOperationV1,
    type D1ProbeCloudflareWorkerCanaryOperationV1,
} from "./cloudflare-worker-canary-operation.js";

const DigestV1 = /^[0-9a-f]{64}$/u;
const RecoveryDispositionsV1 = new Set([
    "fresh_lease_and_exact_head_reassertion",
    "dead_owner_takeover_before_intent_abandonment",
]);
const RecoverySessionKeysV1 = new Set([
    "schema_version",
    "kind",
    "plan_digest",
    "execution_nonce_commitment",
    "operation_revision",
    "operation_state",
    "operation_record_digest",
    "recovery_classification",
    "recovery_requirement",
    "transcript_classification",
    "transcript_digest",
    "journal_head_revision",
    "journal_head_claim_digest",
    "archive_record_count",
    "disposition",
    "recovery_observation_only",
    "lease_acquisition_performed",
    "lease_takeover_performed",
    "archive_reconciliation_performed",
    "operation_transition_performed",
    "remote_dispatch_authorized",
    "remote_effect_replay_allowed",
    "ambiguous_remote_effect_retry_allowed",
    "mutation_replay_allowed",
    "cleanup_authorized",
    "recovery_action_authorized",
    "caller_mutation_authority",
    "authoritative",
    "eligible_for_upload",
    "eligible_for_attestation",
    "lifecycle_advance_allowed",
    "gate_promotion_allowed",
]);

interface FalseTakeoverAuthorityV1 {
    readonly remote_dispatch_authorized: false;
    readonly remote_effect_replay_allowed: false;
    readonly ambiguous_remote_effect_retry_allowed: false;
    readonly mutation_replay_allowed: false;
    readonly cleanup_authorized: false;
    readonly recovery_action_authorized: false;
    readonly operation_transition_authorized: false;
    readonly caller_mutation_authority: false;
    readonly authoritative: false;
    readonly eligible_for_upload: false;
    readonly eligible_for_attestation: false;
    readonly lifecycle_advance_allowed: false;
    readonly gate_promotion_allowed: false;
}

const falseAuthority: FalseTakeoverAuthorityV1 = Object.freeze({
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
});

export type D1ProbeCloudflareWorkerCanaryLeaseTakeoverDenialV1 =
    | "invalid_takeover_request"
    | "takeover_precondition_denied"
    | "lease_takeover_denied"
    | "lease_takeover_outcome_unverified";

interface TakeoverAttemptFactsV1 {
    readonly lease_mutation_attempted: boolean;
    readonly local_lease_mutation_count_upper_bound: 0 | 1;
    readonly local_lease_mutation_outcome: "not_attempted" | "ambiguous" | "performed";
}

export interface D1ProbeCloudflareWorkerCanaryLeaseTakeoverReceiptV1 extends FalseTakeoverAuthorityV1 {
    readonly schema_version: 1;
    readonly kind: "d1_probe_cloudflare_worker_api_canary_lease_takeover_receipt";
    readonly plan_digest: string;
    readonly execution_nonce_commitment: string;
    readonly operation_revision: number;
    readonly operation_record_digest: string;
    readonly recovery_classification: D1ProbeCloudflareWorkerCanaryBaseRecoveryV1["classification"];
    readonly recovery_requirement: D1ProbeCloudflareWorkerCanaryBaseRecoveryV1["recovery_requirement"];
    readonly journal_head_revision: number | null;
    readonly journal_head_claim_digest: string | null;
    readonly previous_lease_generation: number;
    readonly previous_lease_record_digest: string;
    readonly takeover_lease_generation: number;
    readonly takeover_lease_record_digest: string;
    readonly prior_owner_liveness: "esrch";
    readonly lease_takeover_performed: true;
    readonly lease_mutation_attempted: true;
    readonly local_lease_mutation_count_upper_bound: 1;
    readonly local_lease_mutation_outcome: "performed";
}

export type D1ProbeCloudflareWorkerCanaryLeaseTakeoverResultV1 =
    | ({
          readonly success: false;
          readonly code: D1ProbeCloudflareWorkerCanaryLeaseTakeoverDenialV1;
          readonly lease_takeover_performed: false;
      } & TakeoverAttemptFactsV1 &
          FalseTakeoverAuthorityV1)
    | ({
          readonly success: true;
          readonly receipt: D1ProbeCloudflareWorkerCanaryLeaseTakeoverReceiptV1;
      } & FalseTakeoverAuthorityV1);

export interface D1ProbeCloudflareWorkerCanaryLeaseTakeoverTestOnlyDependenciesV1 {
    readonly validate_operation: typeof validateD1ProbeCloudflareWorkerCanaryOperationV1;
    readonly digest_operation: typeof digestD1ProbeCloudflareWorkerCanaryOperationRecordV1;
    readonly commit_execution_nonce: typeof commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1;
    readonly read_recovery: (planDigest: string) => Promise<D1ProbeCloudflareWorkerCanaryBaseRecoveryV1>;
    readonly read_lease: (planDigest: string) => Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1>;
    readonly digest_lease: typeof digestD1ProbeCloudflareWorkerCanaryDriverLeaseRecordV1;
    readonly takeover_expected_lease: (
        input: unknown
    ) => Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseOwnedResultV1>;
}

const fixedDependencies: D1ProbeCloudflareWorkerCanaryLeaseTakeoverTestOnlyDependenciesV1 = Object.freeze({
    validate_operation: validateD1ProbeCloudflareWorkerCanaryOperationV1,
    digest_operation: digestD1ProbeCloudflareWorkerCanaryOperationRecordV1,
    commit_execution_nonce: commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1,
    read_recovery: readD1ProbeCloudflareWorkerCanaryBaseRecoveryV1,
    read_lease: readD1ProbeCloudflareWorkerCanaryDriverLeaseHeadReadOnlyV1,
    digest_lease: digestD1ProbeCloudflareWorkerCanaryDriverLeaseRecordV1,
    takeover_expected_lease: takeoverExpectedD1ProbeCloudflareWorkerCanaryDriverLeaseV1,
});

const denied = (
    code: D1ProbeCloudflareWorkerCanaryLeaseTakeoverDenialV1,
    mutationAttempted = false
): D1ProbeCloudflareWorkerCanaryLeaseTakeoverResultV1 =>
    Object.freeze({
        success: false,
        code,
        lease_takeover_performed: false,
        lease_mutation_attempted: mutationAttempted,
        local_lease_mutation_count_upper_bound: mutationAttempted ? 1 : 0,
        local_lease_mutation_outcome: mutationAttempted ? "ambiguous" : "not_attempted",
        ...falseAuthority,
    });

const exactInput = (
    input: unknown
): input is {
    readonly operation: unknown;
    readonly recovery_session: unknown;
    readonly lease_duration_ms: number;
} => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
    const keys = Object.keys(input);
    const candidate = input as Record<string, unknown>;
    return (
        keys.length === 3 &&
        keys.includes("operation") &&
        keys.includes("recovery_session") &&
        keys.includes("lease_duration_ms") &&
        Number.isSafeInteger(candidate["lease_duration_ms"]) &&
        (candidate["lease_duration_ms"] as number) > 0 &&
        (candidate["lease_duration_ms"] as number) <= 300_000
    );
};

const sessionAuthorityFalse = (session: D1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionV1): boolean =>
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
    session.gate_promotion_allowed === false &&
    session.recovery_observation_only === true &&
    session.lease_acquisition_performed === false &&
    session.lease_takeover_performed === false &&
    session.archive_reconciliation_performed === false &&
    session.operation_transition_performed === false;

const recoveryAuthorityFalse = (recovery: D1ProbeCloudflareWorkerCanaryBaseRecoveryV1): boolean =>
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

const leaseAuthorityFalse = (
    lease: Extract<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1, { readonly success: true }>["lease"]
): boolean =>
    lease.caller_mutation_authority === false &&
    lease.authoritative === false &&
    lease.eligible_for_upload === false &&
    lease.eligible_for_attestation === false &&
    lease.lifecycle_advance_allowed === false &&
    lease.gate_promotion_allowed === false &&
    lease.mutation_authority === false;

const exactRecoverySession = (input: unknown): input is D1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionV1 => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
    const session = input as D1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionV1;
    const keys = Object.keys(input);
    return (
        keys.length === RecoverySessionKeysV1.size &&
        keys.every(key => RecoverySessionKeysV1.has(key)) &&
        session.schema_version === 1 &&
        session.kind === "d1_probe_cloudflare_worker_api_canary_durable_driver_recovery_session" &&
        typeof session.plan_digest === "string" &&
        DigestV1.test(session.plan_digest) &&
        typeof session.execution_nonce_commitment === "string" &&
        DigestV1.test(session.execution_nonce_commitment) &&
        Number.isSafeInteger(session.operation_revision) &&
        session.operation_revision >= 0 &&
        typeof session.operation_record_digest === "string" &&
        DigestV1.test(session.operation_record_digest) &&
        typeof session.transcript_digest === "string" &&
        DigestV1.test(session.transcript_digest) &&
        RecoveryDispositionsV1.has(session.disposition) &&
        (session.journal_head_revision === null ||
            (Number.isSafeInteger(session.journal_head_revision) && session.journal_head_revision >= 0)) &&
        (session.journal_head_claim_digest === null || DigestV1.test(session.journal_head_claim_digest)) &&
        Number.isSafeInteger(session.archive_record_count) &&
        session.archive_record_count >= 0 &&
        sessionAuthorityFalse(session)
    );
};

const stableSignature = (input: unknown): string | null => {
    try {
        return JSON.stringify(input, (_key, value: unknown) =>
            typeof value === "object" && value !== null && !Array.isArray(value)
                ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)))
                : value
        );
    } catch {
        return null;
    }
};

const exactStableValue = (left: unknown, right: unknown): boolean => {
    const leftSignature = stableSignature(left);
    return leftSignature !== null && leftSignature === stableSignature(right);
};

interface TakeoverSnapshotV1 {
    readonly recovery: D1ProbeCloudflareWorkerCanaryBaseRecoveryV1;
    readonly lease: Extract<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1, { readonly success: true }>["lease"];
    readonly leaseDigest: string;
}

const readSnapshot = async (
    planDigest: string,
    dependencies: D1ProbeCloudflareWorkerCanaryLeaseTakeoverTestOnlyDependenciesV1
): Promise<TakeoverSnapshotV1 | null> => {
    const [recovery, leaseRead] = await Promise.all([
        dependencies.read_recovery(planDigest),
        dependencies.read_lease(planDigest),
    ]);
    if (!leaseRead.success) return null;
    const leaseDigest = await dependencies.digest_lease(leaseRead.lease);
    return leaseDigest !== null && DigestV1.test(leaseDigest)
        ? { recovery, lease: leaseRead.lease, leaseDigest }
        : null;
};

const readStableSnapshot = async (
    planDigest: string,
    dependencies: D1ProbeCloudflareWorkerCanaryLeaseTakeoverTestOnlyDependenciesV1
): Promise<TakeoverSnapshotV1 | null> => {
    const first = await readSnapshot(planDigest, dependencies);
    const second = await readSnapshot(planDigest, dependencies);
    if (first === null || second === null) return null;
    const firstSignature = stableSignature(first);
    return firstSignature !== null && firstSignature === stableSignature(second) ? second : null;
};

const recoveryMatchesSession = (
    operation: D1ProbeCloudflareWorkerCanaryOperationV1,
    operationDigest: string,
    session: D1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionV1,
    snapshot: TakeoverSnapshotV1
): boolean =>
    session.plan_digest === operation.plan.plan_digest &&
    session.operation_revision === operation.revision &&
    session.operation_state === operation.state &&
    session.operation_record_digest === operationDigest &&
    snapshot.recovery.plan_digest === session.plan_digest &&
    snapshot.recovery.state_operation_revision === session.operation_revision &&
    snapshot.recovery.state_operation_record_digest === session.operation_record_digest &&
    snapshot.recovery.classification === session.recovery_classification &&
    snapshot.recovery.recovery_requirement === session.recovery_requirement &&
    snapshot.recovery.claim_journal_revision === session.journal_head_revision &&
    snapshot.recovery.claim_digest === session.journal_head_claim_digest &&
    snapshot.recovery.archive_record_count === session.archive_record_count &&
    snapshot.recovery.driver_lease_generation === snapshot.lease.generation &&
    snapshot.recovery.driver_lease_record_digest === snapshot.leaseDigest;

const eligibleTakeover = (
    session: D1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionV1,
    recovery: D1ProbeCloudflareWorkerCanaryBaseRecoveryV1
): boolean => {
    if (
        session.disposition === "fresh_lease_and_exact_head_reassertion" &&
        recovery.classification === "prepared_without_effect_claim" &&
        recovery.recovery_requirement === "fresh_lease_and_exact_head_reassertion"
    ) {
        return (
            session.transcript_classification === "local_history_missing" &&
            recovery.claim_journal_revision === null &&
            recovery.claim_digest === null
        );
    }
    return (
        session.disposition === "dead_owner_takeover_before_intent_abandonment" &&
        recovery.classification === "intent_only_requires_dead_owner_takeover" &&
        recovery.recovery_requirement === "dead_owner_proof_and_takeover_before_abandonment" &&
        session.transcript_classification === "dispatch_intent_tail" &&
        recovery.claim_effect_phase === "dispatch_intent" &&
        recovery.claim_journal_revision !== null &&
        recovery.claim_digest !== null
    );
};

const recoveryHasOnlyExpectedLeaseChange = (
    before: D1ProbeCloudflareWorkerCanaryBaseRecoveryV1,
    after: D1ProbeCloudflareWorkerCanaryBaseRecoveryV1,
    takeoverGeneration: number,
    takeoverDigest: string
): boolean =>
    exactStableValue(after, {
        ...before,
        driver_lease_generation: takeoverGeneration,
        driver_lease_record_digest: takeoverDigest,
    });

const executeWithDependencies = async (
    input: unknown,
    dependencies: D1ProbeCloudflareWorkerCanaryLeaseTakeoverTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryLeaseTakeoverResultV1> => {
    let request: {
        readonly operation: unknown;
        readonly recovery_session: D1ProbeCloudflareWorkerCanaryDurableDriverRecoverySessionV1;
        readonly lease_duration_ms: number;
    };
    try {
        if (!exactInput(input) || !exactRecoverySession(input.recovery_session)) {
            return denied("invalid_takeover_request");
        }
        request = {
            operation: input.operation,
            recovery_session: input.recovery_session,
            lease_duration_ms: input.lease_duration_ms,
        };
    } catch {
        return denied("invalid_takeover_request");
    }
    let mutationAttempted = false;
    try {
        const operation = await dependencies.validate_operation(structuredClone(request.operation));
        if (operation === null) return denied("takeover_precondition_denied");
        const session = structuredClone(request.recovery_session);
        const [operationDigest, executionNonceCommitment, snapshot] = await Promise.all([
            dependencies.digest_operation(structuredClone(operation)),
            dependencies.commit_execution_nonce(operation.execution_nonce),
            readStableSnapshot(operation.plan.plan_digest, dependencies),
        ]);
        if (
            operationDigest === null ||
            executionNonceCommitment === null ||
            snapshot === null ||
            !DigestV1.test(operationDigest) ||
            !DigestV1.test(executionNonceCommitment) ||
            session.execution_nonce_commitment !== executionNonceCommitment ||
            !sessionAuthorityFalse(session) ||
            !recoveryAuthorityFalse(snapshot.recovery) ||
            !recoveryMatchesSession(operation, operationDigest, session, snapshot) ||
            !eligibleTakeover(session, snapshot.recovery) ||
            snapshot.lease.plan_digest !== session.plan_digest ||
            snapshot.lease.execution_nonce_commitment !== executionNonceCommitment ||
            snapshot.lease.state !== "active" ||
            !leaseAuthorityFalse(snapshot.lease)
        ) {
            return denied("takeover_precondition_denied");
        }

        mutationAttempted = true;
        const acquired = await dependencies.takeover_expected_lease({
            plan_digest: session.plan_digest,
            execution_nonce: operation.execution_nonce,
            lease_duration_ms: request.lease_duration_ms,
            expected_generation: snapshot.lease.generation,
            expected_record_digest: snapshot.leaseDigest,
        });
        if (!acquired.success) return denied("lease_takeover_denied", true);

        const [takeoverLeaseDigest, postSnapshot] = await Promise.all([
            dependencies.digest_lease(acquired.lease),
            readStableSnapshot(session.plan_digest, dependencies),
        ]);
        if (
            takeoverLeaseDigest === null ||
            postSnapshot === null ||
            !DigestV1.test(takeoverLeaseDigest) ||
            takeoverLeaseDigest !== postSnapshot.leaseDigest ||
            acquired.lease.transition !== "taken_over" ||
            acquired.lease.state !== "active" ||
            acquired.lease.plan_digest !== session.plan_digest ||
            acquired.lease.execution_nonce_commitment !== executionNonceCommitment ||
            acquired.lease.generation !== snapshot.lease.generation + 1 ||
            acquired.lease.previous_record_digest !== snapshot.leaseDigest ||
            acquired.lease.prior_owner_liveness !== "esrch" ||
            acquired.lease.owner_pid === snapshot.lease.owner_pid ||
            acquired.lease.owner_nonce_commitment === snapshot.lease.owner_nonce_commitment ||
            acquired.lease.issued_at_ms !== acquired.lease.heartbeat_at_ms ||
            acquired.lease.issued_at_ms < snapshot.lease.expires_at_ms ||
            acquired.lease.expires_at_ms <= acquired.lease.heartbeat_at_ms ||
            !leaseAuthorityFalse(acquired.lease) ||
            !exactStableValue(postSnapshot.lease, acquired.lease) ||
            !leaseAuthorityFalse(postSnapshot.lease) ||
            !recoveryAuthorityFalse(postSnapshot.recovery) ||
            !recoveryHasOnlyExpectedLeaseChange(
                snapshot.recovery,
                postSnapshot.recovery,
                acquired.lease.generation,
                takeoverLeaseDigest
            )
        ) {
            return denied("lease_takeover_outcome_unverified", true);
        }

        const receipt: D1ProbeCloudflareWorkerCanaryLeaseTakeoverReceiptV1 = Object.freeze({
            schema_version: 1,
            kind: "d1_probe_cloudflare_worker_api_canary_lease_takeover_receipt",
            plan_digest: session.plan_digest,
            execution_nonce_commitment: executionNonceCommitment,
            operation_revision: operation.revision,
            operation_record_digest: operationDigest,
            recovery_classification: snapshot.recovery.classification,
            recovery_requirement: snapshot.recovery.recovery_requirement,
            journal_head_revision: session.journal_head_revision,
            journal_head_claim_digest: session.journal_head_claim_digest,
            previous_lease_generation: snapshot.lease.generation,
            previous_lease_record_digest: snapshot.leaseDigest,
            takeover_lease_generation: acquired.lease.generation,
            takeover_lease_record_digest: takeoverLeaseDigest,
            prior_owner_liveness: "esrch",
            lease_takeover_performed: true,
            lease_mutation_attempted: true,
            local_lease_mutation_count_upper_bound: 1,
            local_lease_mutation_outcome: "performed",
            ...falseAuthority,
        });
        return Object.freeze({ success: true, receipt, ...falseAuthority });
    } catch {
        return mutationAttempted
            ? denied("lease_takeover_outcome_unverified", true)
            : denied("takeover_precondition_denied");
    }
};

export const executeD1ProbeCloudflareWorkerCanaryLeaseTakeoverV1 = async (
    input: unknown
): Promise<D1ProbeCloudflareWorkerCanaryLeaseTakeoverResultV1> =>
    await executeWithDependencies(input, fixedDependencies);

/** Test-only dependency seam. Production callers use the fixed recovery, lease, and operation functions. */
export const executeD1ProbeCloudflareWorkerCanaryLeaseTakeoverWithDependenciesTestOnlyV1 = async (
    input: unknown,
    dependencies: D1ProbeCloudflareWorkerCanaryLeaseTakeoverTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryLeaseTakeoverResultV1> =>
    await executeWithDependencies(input, Object.freeze({ ...dependencies }));
