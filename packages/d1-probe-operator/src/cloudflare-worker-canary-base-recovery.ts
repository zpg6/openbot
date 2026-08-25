import {
    readD1ProbeCloudflareWorkerCanaryConsistencyV1,
    type D1ProbeCloudflareWorkerCanaryConsistencyV1,
    type D1ProbeCloudflareWorkerCanaryResponseClaimBindingV1,
} from "./cloudflare-worker-canary-consistency.js";
import {
    readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1,
    type D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryRecordV1,
    type D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryResultV1,
} from "./cloudflare-worker-canary-response-archive.js";

const DigestV1 = /^[0-9a-f]{64}$/u;

export type D1ProbeCloudflareWorkerCanaryBaseRecoveryClassificationV1 =
    | "local_histories_missing"
    | "local_histories_unstable"
    | "local_histories_corrupt"
    | "prepared_without_effect_claim"
    | "intent_only_requires_dead_owner_takeover"
    | "mutation_outcome_unknown_no_retry"
    | "archive_ahead_requires_keyed_reconciliation"
    | "terminal_claim_missing_archive"
    | "response_observed_state_transition_pending"
    | "local_histories_aligned";

export type D1ProbeCloudflareWorkerCanaryBaseRecoveryRequirementV1 =
    | "manual_stop"
    | "fresh_lease_and_exact_head_reassertion"
    | "dead_owner_proof_and_takeover_before_abandonment"
    | "read_only_remote_reconciliation_only"
    | "keyed_archive_reconciliation_without_mutation_replay"
    | "archive_repair_or_manual_stop"
    | "state_transition_revalidation"
    | "none";

export interface D1ProbeCloudflareWorkerCanaryBaseRecoveryV1 {
    readonly schema_version: 1;
    readonly kind: "untrusted_d1_probe_cloudflare_worker_api_canary_base_recovery";
    readonly plan_digest: string | null;
    readonly classification: D1ProbeCloudflareWorkerCanaryBaseRecoveryClassificationV1;
    readonly recovery_requirement: D1ProbeCloudflareWorkerCanaryBaseRecoveryRequirementV1;
    readonly state_operation_revision: number | null;
    readonly state_operation_record_digest: string | null;
    readonly claim_journal_revision: number | null;
    readonly claim_digest: string | null;
    readonly claim_effect_phase: string | null;
    readonly driver_lease_generation: number | null;
    readonly driver_lease_record_digest: string | null;
    readonly archive_record_count: number;
    readonly archive_head_claim_digest: string | null;
    readonly archive_head_record_digest: string | null;
    readonly mutation_replay_allowed: false;
    readonly cleanup_authorized: false;
    readonly recovery_action_authorized: false;
    readonly local_records_authenticated: false;
    readonly cloudflare_origin_authenticated: false;
    readonly caller_mutation_authority: false;
    readonly authoritative: false;
    readonly eligible_for_upload: false;
    readonly eligible_for_attestation: false;
    readonly lifecycle_advance_allowed: false;
    readonly gate_promotion_allowed: false;
}

export interface D1ProbeCloudflareWorkerCanaryBaseRecoveryTestOnlyReadersV1 {
    readonly read_consistency: (planDigest: string) => Promise<D1ProbeCloudflareWorkerCanaryConsistencyV1>;
    readonly read_archive_inventory: (
        planDigest: string
    ) => Promise<D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryResultV1>;
}

const fixedReaders: D1ProbeCloudflareWorkerCanaryBaseRecoveryTestOnlyReadersV1 = {
    read_consistency: readD1ProbeCloudflareWorkerCanaryConsistencyV1,
    read_archive_inventory: readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1,
};

const report = (
    planDigest: string | null,
    classification: D1ProbeCloudflareWorkerCanaryBaseRecoveryClassificationV1,
    recoveryRequirement: D1ProbeCloudflareWorkerCanaryBaseRecoveryRequirementV1,
    consistency: D1ProbeCloudflareWorkerCanaryConsistencyV1 | null = null,
    records: readonly D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryRecordV1[] = []
): D1ProbeCloudflareWorkerCanaryBaseRecoveryV1 => {
    const archiveHead = records.at(-1) ?? null;
    return Object.freeze({
        schema_version: 1,
        kind: "untrusted_d1_probe_cloudflare_worker_api_canary_base_recovery",
        plan_digest: planDigest,
        classification,
        recovery_requirement: recoveryRequirement,
        state_operation_revision: consistency?.state_operation_revision ?? null,
        state_operation_record_digest: consistency?.state_operation_record_digest ?? null,
        claim_journal_revision: consistency?.claim_journal_revision ?? null,
        claim_digest: consistency?.claim_digest ?? null,
        claim_effect_phase: consistency?.claim_effect_phase ?? null,
        driver_lease_generation: consistency?.driver_lease_generation ?? null,
        driver_lease_record_digest: consistency?.driver_lease_record_digest ?? null,
        archive_record_count: records.length,
        archive_head_claim_digest: archiveHead?.claim_digest ?? null,
        archive_head_record_digest: archiveHead?.archive_record_digest ?? null,
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
    });
};

const exactArchiveBinding = (
    binding: D1ProbeCloudflareWorkerCanaryResponseClaimBindingV1,
    record: D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryRecordV1
): boolean =>
    binding.journal_revision === record.journal_revision &&
    binding.claim_digest === record.claim_digest &&
    binding.transcript_sequence === record.transcript_sequence &&
    binding.response_status === record.response_status &&
    binding.response_digest === record.response_digest;

const archiveAuthorityFalse = (record: D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryRecordV1): boolean =>
    record.caller_mutation_authority === false &&
    record.cloudflare_origin_authenticated === false &&
    record.archive_key_possession_proven === false &&
    record.archive_decryptability_proven === false &&
    record.effect_claim_persistence_proven === false &&
    record.response_authenticated === false &&
    record.authoritative === false &&
    record.eligible_for_upload === false &&
    record.eligible_for_attestation === false &&
    record.lifecycle_advance_allowed === false &&
    record.gate_promotion_allowed === false;

const stableSignature = (input: unknown): string | null => {
    try {
        return JSON.stringify(input);
    } catch {
        return null;
    }
};

const readStable = async (
    planDigest: string,
    readers: D1ProbeCloudflareWorkerCanaryBaseRecoveryTestOnlyReadersV1
): Promise<
    | { readonly stable: false }
    | {
          readonly stable: true;
          readonly consistency: D1ProbeCloudflareWorkerCanaryConsistencyV1;
          readonly archive: D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryResultV1;
      }
> => {
    const firstConsistency = await readers.read_consistency(planDigest);
    const firstArchive = await readers.read_archive_inventory(planDigest);
    const secondConsistency = await readers.read_consistency(planDigest);
    const secondArchive = await readers.read_archive_inventory(planDigest);
    const firstConsistencySignature = stableSignature(firstConsistency);
    const firstArchiveSignature = stableSignature(firstArchive);
    return firstConsistencySignature !== null &&
        firstArchiveSignature !== null &&
        firstConsistencySignature === stableSignature(secondConsistency) &&
        firstArchiveSignature === stableSignature(secondArchive)
        ? { stable: true, consistency: secondConsistency, archive: secondArchive }
        : { stable: false };
};

const classify = (
    planDigest: string,
    consistency: D1ProbeCloudflareWorkerCanaryConsistencyV1,
    archive: D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryResultV1
): D1ProbeCloudflareWorkerCanaryBaseRecoveryV1 => {
    if (consistency.plan_digest !== planDigest) {
        return report(planDigest, "local_histories_corrupt", "manual_stop", consistency);
    }
    if (consistency.classification === "unstable") {
        return report(planDigest, "local_histories_unstable", "manual_stop", consistency);
    }
    if (consistency.classification === "corrupt") {
        return report(planDigest, "local_histories_corrupt", "manual_stop", consistency);
    }
    if (consistency.classification === "missing") {
        if (
            consistency.missing_component !== "effect_journal" ||
            consistency.state_operation_revision !== 0 ||
            consistency.state_operation_state !== "prepared"
        ) {
            return report(planDigest, "local_histories_missing", "manual_stop", consistency);
        }
    }
    const archiveMissing = !archive.success && archive.code === "archive_not_found";
    if (!archive.success && !archiveMissing) {
        return report(planDigest, "local_histories_corrupt", "manual_stop", consistency);
    }
    const records = archive.success ? archive.inventory.records : [];
    if (
        archive.success &&
        (archive.inventory.plan_digest !== planDigest ||
            archive.inventory.record_count !== records.length ||
            archive.inventory.cloudflare_origin_authenticated !== false ||
            archive.inventory.archive_key_possession_proven !== false ||
            archive.inventory.archive_decryptability_proven !== false ||
            archive.inventory.effect_claim_persistence_proven !== false ||
            archive.inventory.response_authenticated !== false ||
            archive.inventory.authoritative !== false ||
            archive.inventory.eligible_for_upload !== false ||
            archive.inventory.eligible_for_attestation !== false ||
            archive.inventory.lifecycle_advance_allowed !== false ||
            archive.inventory.gate_promotion_allowed !== false ||
            records.some(record => !archiveAuthorityFalse(record)))
    ) {
        return report(planDigest, "local_histories_corrupt", "manual_stop", consistency, records);
    }

    const matchedArchiveDigests = new Set<string>();
    for (const binding of consistency.response_claim_bindings) {
        const record = records.find(candidate => candidate.claim_digest === binding.claim_digest);
        if (record === undefined) {
            return report(
                planDigest,
                "terminal_claim_missing_archive",
                "archive_repair_or_manual_stop",
                consistency,
                records
            );
        }
        if (!exactArchiveBinding(binding, record)) {
            return report(planDigest, "local_histories_corrupt", "manual_stop", consistency, records);
        }
        matchedArchiveDigests.add(record.claim_digest);
    }
    const archiveAhead = records.filter(record => !matchedArchiveDigests.has(record.claim_digest));
    if (archiveAhead.length > 0) {
        const ahead = archiveAhead[0];
        if (
            archiveAhead.length === 1 &&
            ahead !== undefined &&
            consistency.claim_effect_phase === "dispatch_started" &&
            consistency.claim_journal_revision !== null &&
            ahead.journal_revision === consistency.claim_journal_revision + 1
        ) {
            return report(
                planDigest,
                "archive_ahead_requires_keyed_reconciliation",
                "keyed_archive_reconciliation_without_mutation_replay",
                consistency,
                records
            );
        }
        return report(planDigest, "local_histories_corrupt", "manual_stop", consistency, records);
    }

    if (consistency.classification === "missing" || consistency.claim_effect_phase === null) {
        return report(
            planDigest,
            "prepared_without_effect_claim",
            "fresh_lease_and_exact_head_reassertion",
            consistency,
            records
        );
    }
    if (consistency.claim_effect_phase === "dispatch_intent") {
        return report(
            planDigest,
            "intent_only_requires_dead_owner_takeover",
            "dead_owner_proof_and_takeover_before_abandonment",
            consistency,
            records
        );
    }
    if (
        consistency.claim_effect_phase === "dispatch_started" ||
        consistency.claim_effect_phase === "dispatch_ambiguous"
    ) {
        return report(
            planDigest,
            "mutation_outcome_unknown_no_retry",
            "read_only_remote_reconciliation_only",
            consistency,
            records
        );
    }
    if (consistency.claim_effect_phase === "response_observed" && consistency.classification === "state_ahead") {
        return report(planDigest, "local_histories_aligned", "none", consistency, records);
    }
    if (consistency.claim_effect_phase === "response_observed" && consistency.classification === "exact_sync") {
        return report(
            planDigest,
            "response_observed_state_transition_pending",
            "state_transition_revalidation",
            consistency,
            records
        );
    }
    return report(planDigest, "local_histories_corrupt", "manual_stop", consistency, records);
};

const readWithReaders = async (
    planDigestInput: unknown,
    readers: D1ProbeCloudflareWorkerCanaryBaseRecoveryTestOnlyReadersV1
): Promise<D1ProbeCloudflareWorkerCanaryBaseRecoveryV1> => {
    if (typeof planDigestInput !== "string" || !DigestV1.test(planDigestInput)) {
        return report(null, "local_histories_corrupt", "manual_stop");
    }
    try {
        const snapshot = await readStable(planDigestInput, readers);
        return snapshot.stable
            ? classify(planDigestInput, snapshot.consistency, snapshot.archive)
            : report(planDigestInput, "local_histories_unstable", "manual_stop");
    } catch {
        return report(planDigestInput, "local_histories_corrupt", "manual_stop");
    }
};

export const readD1ProbeCloudflareWorkerCanaryBaseRecoveryV1 = async (
    planDigestInput: unknown
): Promise<D1ProbeCloudflareWorkerCanaryBaseRecoveryV1> => await readWithReaders(planDigestInput, fixedReaders);

/** Test-only reader seam. Production callers must use the fixed read-only function. */
export const readD1ProbeCloudflareWorkerCanaryBaseRecoveryWithReadersTestOnlyV1 = async (
    planDigestInput: unknown,
    readers: D1ProbeCloudflareWorkerCanaryBaseRecoveryTestOnlyReadersV1
): Promise<D1ProbeCloudflareWorkerCanaryBaseRecoveryV1> =>
    await readWithReaders(planDigestInput, Object.freeze({ ...readers }));
