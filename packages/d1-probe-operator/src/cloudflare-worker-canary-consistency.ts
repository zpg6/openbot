import {
    commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1,
    digestD1ProbeCloudflareWorkerCanaryOperationRecordV1,
    readD1ProbeCloudflareWorkerCanaryEffectJournalReadOnlyV1,
    type D1ProbeCloudflareWorkerCanaryEffectJournalReadResultV1,
    type D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
} from "./cloudflare-worker-canary-effect-journal.js";
import {
    readD1ProbeCloudflareWorkerCanaryStateHistoryReadOnlyV1,
    type D1ProbeCloudflareWorkerCanaryStateHistoryResultV1,
} from "./cloudflare-worker-canary-state.js";
import {
    digestD1ProbeCloudflareWorkerCanaryDriverLeaseRecordV1,
    readD1ProbeCloudflareWorkerCanaryDriverLeaseHistoryReadOnlyV1,
    type D1ProbeCloudflareWorkerCanaryDriverLeaseHistoryResultV1,
} from "./cloudflare-worker-canary-driver-lease.js";

const DigestV1 = /^[0-9a-f]{64}$/u;

export type D1ProbeCloudflareWorkerCanaryConsistencyClassificationV1 =
    "exact_sync" | "claim_behind" | "state_ahead" | "ambiguous_dispatch" | "unstable" | "corrupt" | "missing";

export interface D1ProbeCloudflareWorkerCanaryResponseClaimBindingV1 {
    readonly journal_revision: number;
    readonly claim_digest: string;
    readonly transcript_sequence: number;
    readonly response_status: number;
    readonly response_digest: string;
}

export interface D1ProbeCloudflareWorkerCanaryConsistencyV1 {
    readonly schema_version: 1;
    readonly kind: "untrusted_d1_probe_cloudflare_worker_api_canary_consistency";
    readonly plan_digest: string | null;
    readonly classification: D1ProbeCloudflareWorkerCanaryConsistencyClassificationV1;
    readonly missing_component: "state" | "effect_journal" | "driver_lease" | "multiple" | null;
    readonly corrupt_component: "input" | "state" | "effect_journal" | "driver_lease" | "bindings" | null;
    readonly state_operation_revision: number | null;
    readonly state_operation_state: string | null;
    readonly state_operation_record_digest: string | null;
    readonly state_execution_nonce_commitment: string | null;
    readonly driver_lease_generation: number | null;
    readonly driver_lease_record_digest: string | null;
    readonly driver_lease_state: "active" | "released" | null;
    readonly claim_journal_revision: number | null;
    readonly claim_digest: string | null;
    readonly claim_operation_revision: number | null;
    readonly claim_operation_state: string | null;
    readonly claim_operation_record_digest: string | null;
    readonly claim_execution_nonce_commitment: string | null;
    readonly claim_lease_generation: number | null;
    readonly claim_lease_record_digest: string | null;
    readonly claim_workflow_step: string | null;
    readonly claim_effect_phase: string | null;
    readonly claim_ambiguity_classification: string | null;
    readonly response_claim_bindings: readonly D1ProbeCloudflareWorkerCanaryResponseClaimBindingV1[];
    readonly effect_claims_authenticated: false;
    readonly caller_mutation_authority: false;
    readonly authoritative: false;
    readonly eligible_for_upload: false;
    readonly eligible_for_attestation: false;
    readonly lifecycle_advance_allowed: false;
    readonly gate_promotion_allowed: false;
}

interface StateProjectionV1 {
    readonly revision: number;
    readonly state: string;
    readonly operation_digest: string;
    readonly nonce_commitment: string;
}

interface ClaimProjectionV1 {
    readonly journal_revision: number;
    readonly claim_digest: string;
    readonly operation_revision: number;
    readonly operation_state: string;
    readonly operation_digest: string;
    readonly nonce_commitment: string;
    readonly lease_generation: number;
    readonly lease_record_digest: string;
    readonly workflow_step: string;
    readonly effect_phase: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1["effect_phase"];
    readonly ambiguity_classification: string;
}

interface LeaseProjectionV1 {
    readonly generation: number;
    readonly record_digest: string;
    readonly state: "active" | "released";
}

export interface D1ProbeCloudflareWorkerCanaryConsistencyTestOnlyReadersV1 {
    readonly read_state_history: (planDigest: string) => Promise<D1ProbeCloudflareWorkerCanaryStateHistoryResultV1>;
    readonly read_effect_journal: (
        planDigest: string
    ) => Promise<D1ProbeCloudflareWorkerCanaryEffectJournalReadResultV1>;
    readonly read_driver_lease_history: (
        planDigest: string
    ) => Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseHistoryResultV1>;
}

const fixedReaders: D1ProbeCloudflareWorkerCanaryConsistencyTestOnlyReadersV1 = {
    read_state_history: readD1ProbeCloudflareWorkerCanaryStateHistoryReadOnlyV1,
    read_effect_journal: readD1ProbeCloudflareWorkerCanaryEffectJournalReadOnlyV1,
    read_driver_lease_history: readD1ProbeCloudflareWorkerCanaryDriverLeaseHistoryReadOnlyV1,
};

const allowedStateAdvance: Readonly<Record<string, readonly string[]>> = {
    prepared: ["shell_dispatching", "cleanup_reconciling"],
    shell_dispatching: ["shell_identified", "cleanup_reconciling"],
    shell_identified: ["version_dispatching", "cleanup_reconciling"],
    version_dispatching: ["version_identified", "cleanup_reconciling"],
    version_identified: ["deployment_dispatching", "cleanup_reconciling"],
    deployment_dispatching: ["deployment_identified", "cleanup_reconciling"],
    deployment_identified: ["cleanup_reconciling"],
    cleanup_reconciling: ["delete_dispatching", "absence_observed", "manual_required"],
    delete_dispatching: ["absence_observed", "manual_required"],
    absence_observed: [],
    manual_required: [],
};

const report = (
    planDigest: string | null,
    classification: D1ProbeCloudflareWorkerCanaryConsistencyClassificationV1,
    missingComponent: D1ProbeCloudflareWorkerCanaryConsistencyV1["missing_component"],
    corruptComponent: D1ProbeCloudflareWorkerCanaryConsistencyV1["corrupt_component"],
    state: StateProjectionV1 | null = null,
    claim: ClaimProjectionV1 | null = null,
    lease: LeaseProjectionV1 | null = null,
    responseClaimBindings: readonly D1ProbeCloudflareWorkerCanaryResponseClaimBindingV1[] = []
): D1ProbeCloudflareWorkerCanaryConsistencyV1 => ({
    schema_version: 1,
    kind: "untrusted_d1_probe_cloudflare_worker_api_canary_consistency",
    plan_digest: planDigest,
    classification,
    missing_component: missingComponent,
    corrupt_component: corruptComponent,
    state_operation_revision: state?.revision ?? null,
    state_operation_state: state?.state ?? null,
    state_operation_record_digest: state?.operation_digest ?? null,
    state_execution_nonce_commitment: state?.nonce_commitment ?? null,
    driver_lease_generation: lease?.generation ?? null,
    driver_lease_record_digest: lease?.record_digest ?? null,
    driver_lease_state: lease?.state ?? null,
    claim_journal_revision: claim?.journal_revision ?? null,
    claim_digest: claim?.claim_digest ?? null,
    claim_operation_revision: claim?.operation_revision ?? null,
    claim_operation_state: claim?.operation_state ?? null,
    claim_operation_record_digest: claim?.operation_digest ?? null,
    claim_execution_nonce_commitment: claim?.nonce_commitment ?? null,
    claim_lease_generation: claim?.lease_generation ?? null,
    claim_lease_record_digest: claim?.lease_record_digest ?? null,
    claim_workflow_step: claim?.workflow_step ?? null,
    claim_effect_phase: claim?.effect_phase ?? null,
    claim_ambiguity_classification: claim?.ambiguity_classification ?? null,
    response_claim_bindings: Object.freeze([...responseClaimBindings]),
    effect_claims_authenticated: false,
    caller_mutation_authority: false,
    authoritative: false,
    eligible_for_upload: false,
    eligible_for_attestation: false,
    lifecycle_advance_allowed: false,
    gate_promotion_allowed: false,
});

const projectHistory = async (
    result: Extract<D1ProbeCloudflareWorkerCanaryStateHistoryResultV1, { success: true }>
): Promise<readonly StateProjectionV1[] | null> => {
    const projections: StateProjectionV1[] = [];
    for (const operation of result.operations) {
        const [operationDigest, nonceCommitment] = await Promise.all([
            digestD1ProbeCloudflareWorkerCanaryOperationRecordV1(operation),
            commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1(operation.execution_nonce),
        ]);
        if (operationDigest === null || nonceCommitment === null) return null;
        projections.push({
            revision: operation.revision,
            state: operation.state,
            operation_digest: operationDigest,
            nonce_commitment: nonceCommitment,
        });
    }
    return projections;
};

const projectClaim = (claim: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1): ClaimProjectionV1 => ({
    journal_revision: claim.journal_revision,
    claim_digest: claim.claim_digest,
    operation_revision: claim.operation_revision,
    operation_state: claim.operation_state,
    operation_digest: claim.operation_record_digest,
    nonce_commitment: claim.execution_nonce_commitment,
    lease_generation: claim.lease_generation,
    lease_record_digest: claim.lease_record_digest,
    workflow_step: claim.workflow_step,
    effect_phase: claim.effect_phase,
    ambiguity_classification: claim.ambiguity_classification,
});

const stateSignature = async (result: D1ProbeCloudflareWorkerCanaryStateHistoryResultV1): Promise<string> => {
    if (!result.success) return `error:${result.code}`;
    const history = await projectHistory(result);
    const head = history?.at(-1);
    return head === undefined ? "error:empty" : `ok:${history?.length ?? 0}:${head.revision}:${head.operation_digest}`;
};

const journalSignature = (result: D1ProbeCloudflareWorkerCanaryEffectJournalReadResultV1): string => {
    if (!result.success) return `error:${result.code}`;
    const head = result.claims.at(-1);
    return head === undefined
        ? "error:empty"
        : `ok:${result.claims.length}:${head.journal_revision}:${head.claim_digest}`;
};

const leaseSignature = async (result: D1ProbeCloudflareWorkerCanaryDriverLeaseHistoryResultV1): Promise<string> => {
    if (!result.success) return `error:${result.code}`;
    const head = result.leases.at(-1);
    const digest = head === undefined ? null : await digestD1ProbeCloudflareWorkerCanaryDriverLeaseRecordV1(head);
    return head === undefined || digest === null
        ? "error:empty"
        : `ok:${result.leases.length}:${head.generation}:${digest}`;
};

const readStableSnapshot = async (
    planDigest: string,
    readers: D1ProbeCloudflareWorkerCanaryConsistencyTestOnlyReadersV1
): Promise<
    | { readonly stable: false }
    | {
          readonly stable: true;
          readonly state: D1ProbeCloudflareWorkerCanaryStateHistoryResultV1;
          readonly journal: D1ProbeCloudflareWorkerCanaryEffectJournalReadResultV1;
          readonly lease: D1ProbeCloudflareWorkerCanaryDriverLeaseHistoryResultV1;
      }
> => {
    const [firstState, firstJournal, firstLease] = await Promise.all([
        readers.read_state_history(planDigest),
        readers.read_effect_journal(planDigest),
        readers.read_driver_lease_history(planDigest),
    ]);
    const [firstStateSignature, firstJournalSignature, firstLeaseSignature] = await Promise.all([
        stateSignature(firstState),
        Promise.resolve(journalSignature(firstJournal)),
        leaseSignature(firstLease),
    ]);
    const [secondState, secondJournal, secondLease] = await Promise.all([
        readers.read_state_history(planDigest),
        readers.read_effect_journal(planDigest),
        readers.read_driver_lease_history(planDigest),
    ]);
    const [secondStateSignature, secondJournalSignature, secondLeaseSignature] = await Promise.all([
        stateSignature(secondState),
        Promise.resolve(journalSignature(secondJournal)),
        leaseSignature(secondLease),
    ]);
    return firstStateSignature === secondStateSignature &&
        firstJournalSignature === secondJournalSignature &&
        firstLeaseSignature === secondLeaseSignature
        ? { stable: true, state: secondState, journal: secondJournal, lease: secondLease }
        : { stable: false };
};

const classifyStableSnapshot = async (
    planDigest: string,
    stateResult: D1ProbeCloudflareWorkerCanaryStateHistoryResultV1,
    journalResult: D1ProbeCloudflareWorkerCanaryEffectJournalReadResultV1,
    leaseResult: D1ProbeCloudflareWorkerCanaryDriverLeaseHistoryResultV1
): Promise<D1ProbeCloudflareWorkerCanaryConsistencyV1> => {
    const stateMissing = !stateResult.success && stateResult.code === "state_not_found";
    const journalMissing = !journalResult.success && journalResult.code === "journal_not_found";
    const leaseMissing = !leaseResult.success && leaseResult.code === "lease_not_found";
    if (
        (!stateResult.success && !stateMissing) ||
        (!journalResult.success && !journalMissing) ||
        (!leaseResult.success && !leaseMissing)
    ) {
        return report(
            planDigest,
            "corrupt",
            null,
            !stateResult.success && !stateMissing
                ? "state"
                : !journalResult.success && !journalMissing
                  ? "effect_journal"
                  : "driver_lease"
        );
    }

    const history = stateResult.success ? await projectHistory(stateResult) : null;
    const stateHead = history?.at(-1) ?? null;
    const claims = journalResult.success ? journalResult.claims : null;
    const claimHead = claims?.at(-1);
    const claimProjection = claimHead === undefined ? null : projectClaim(claimHead);
    if (stateResult.success && (history === null || stateHead === null)) {
        return report(planDigest, "corrupt", null, "state", null, claimProjection);
    }
    if (stateMissing && journalMissing && leaseMissing) return report(planDigest, "missing", "multiple", null);
    if (stateMissing) return report(planDigest, "corrupt", "state", "bindings", null, claimProjection);
    if (leaseMissing) return report(planDigest, "corrupt", "driver_lease", "bindings", stateHead, claimProjection);
    if (journalMissing) {
        return stateHead?.revision === 0 && stateHead.state === "prepared"
            ? report(planDigest, "missing", "effect_journal", null, stateHead)
            : report(planDigest, "corrupt", "effect_journal", "bindings", stateHead);
    }
    if (history === null || stateHead === null || claims === null || claimHead === undefined) {
        return report(planDigest, "corrupt", null, "bindings", stateHead, claimProjection);
    }

    if (!leaseResult.success) return report(planDigest, "corrupt", null, "driver_lease", stateHead, claimProjection);
    const leaseDigests = await Promise.all(
        leaseResult.leases.map(async lease => await digestD1ProbeCloudflareWorkerCanaryDriverLeaseRecordV1(lease))
    );
    if (leaseDigests.some(digest => digest === null)) {
        return report(planDigest, "corrupt", null, "driver_lease", stateHead, claimProjection);
    }
    const leaseHeadRecord = leaseResult.leases.at(-1);
    const leaseHeadDigest = leaseDigests.at(-1);
    if (leaseHeadRecord === undefined || leaseHeadDigest === undefined || leaseHeadDigest === null) {
        return report(planDigest, "corrupt", null, "driver_lease", stateHead, claimProjection);
    }
    const leaseHead: LeaseProjectionV1 = {
        generation: leaseHeadRecord.generation,
        record_digest: leaseHeadDigest,
        state: leaseHeadRecord.state,
    };
    const responseClaimBindings: D1ProbeCloudflareWorkerCanaryResponseClaimBindingV1[] = [];

    for (const claim of claims) {
        if (claim.plan_digest !== planDigest) return report(planDigest, "corrupt", null, "bindings", stateHead);
        const persisted = history[claim.operation_revision];
        if (persisted === undefined) {
            return report(planDigest, "corrupt", null, "bindings", stateHead, claimProjection);
        }
        if (
            claim.operation_state !== persisted.state ||
            claim.operation_record_digest !== persisted.operation_digest ||
            claim.execution_nonce_commitment !== persisted.nonce_commitment
        ) {
            return report(planDigest, "corrupt", null, "bindings", stateHead, claimProjection);
        }
        if (claim.effect_phase === "response_observed") {
            if (claim.response_status === null || claim.response_digest === null) {
                return report(planDigest, "corrupt", null, "bindings", stateHead, claimProjection);
            }
            responseClaimBindings.push(
                Object.freeze({
                    journal_revision: claim.journal_revision,
                    claim_digest: claim.claim_digest,
                    transcript_sequence: claim.transcript_sequence,
                    response_status: claim.response_status,
                    response_digest: claim.response_digest,
                })
            );
        }
        const lease = leaseResult.leases[claim.lease_generation];
        if (
            lease === undefined ||
            leaseDigests[claim.lease_generation] !== claim.lease_record_digest ||
            lease.plan_digest !== claim.plan_digest ||
            lease.execution_nonce_commitment !== claim.execution_nonce_commitment ||
            lease.state !== "active" ||
            claim.intent_observed_at_ms < lease.heartbeat_at_ms ||
            (claim.dispatch_started_at_ms !== null && claim.dispatch_started_at_ms >= lease.expires_at_ms)
        ) {
            return report(planDigest, "corrupt", null, "bindings", stateHead, claimProjection);
        }
    }

    const latest = projectClaim(claimHead);
    const exactHead = stateHead.revision === claimHead.operation_revision;
    const stateOneAhead =
        stateHead.revision === claimHead.operation_revision + 1 &&
        (allowedStateAdvance[claimHead.operation_state]?.includes(stateHead.state) ?? false);
    if (!exactHead && !stateOneAhead) {
        return report(planDigest, "corrupt", null, "bindings", stateHead, latest);
    }
    if (
        stateOneAhead &&
        claimHead.effect_phase !== "response_observed" &&
        claimHead.effect_phase !== "dispatch_ambiguous"
    ) {
        return report(planDigest, "corrupt", null, "bindings", stateHead, latest);
    }
    if (claimHead.effect_phase === "dispatch_started" || claimHead.effect_phase === "dispatch_ambiguous") {
        return report(
            planDigest,
            "ambiguous_dispatch",
            null,
            null,
            stateHead,
            latest,
            leaseHead,
            responseClaimBindings
        );
    }
    if (stateOneAhead) {
        return report(planDigest, "state_ahead", null, null, stateHead, latest, leaseHead, responseClaimBindings);
    }
    if (claimHead.effect_phase === "dispatch_intent") {
        return report(planDigest, "claim_behind", null, null, stateHead, latest, leaseHead, responseClaimBindings);
    }
    return report(planDigest, "exact_sync", null, null, stateHead, latest, leaseHead, responseClaimBindings);
};

export const readD1ProbeCloudflareWorkerCanaryConsistencyWithReadersTestOnlyV1 = async (
    planDigestInput: unknown,
    readers: D1ProbeCloudflareWorkerCanaryConsistencyTestOnlyReadersV1
): Promise<D1ProbeCloudflareWorkerCanaryConsistencyV1> => {
    if (typeof planDigestInput !== "string" || !DigestV1.test(planDigestInput)) {
        return report(null, "corrupt", null, "input");
    }
    try {
        const snapshot = await readStableSnapshot(planDigestInput, readers);
        return snapshot.stable
            ? await classifyStableSnapshot(planDigestInput, snapshot.state, snapshot.journal, snapshot.lease)
            : report(planDigestInput, "unstable", null, null);
    } catch {
        return report(planDigestInput, "corrupt", null, "bindings");
    }
};

export const readD1ProbeCloudflareWorkerCanaryConsistencyV1 = async (
    planDigestInput: unknown
): Promise<D1ProbeCloudflareWorkerCanaryConsistencyV1> =>
    await readD1ProbeCloudflareWorkerCanaryConsistencyWithReadersTestOnlyV1(planDigestInput, fixedReaders);
