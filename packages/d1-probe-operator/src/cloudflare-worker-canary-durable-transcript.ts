import { digestCanonicalJsonV1, type CanonicalJsonValueV1 } from "@openbot/gate-attestation/internal";

import {
    readD1ProbeCloudflareWorkerCanaryConsistencyV1,
    type D1ProbeCloudflareWorkerCanaryConsistencyV1,
} from "./cloudflare-worker-canary-consistency.js";
import {
    readD1ProbeCloudflareWorkerCanaryEffectJournalReadOnlyV1,
    validateD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    type D1ProbeCloudflareWorkerCanaryEffectJournalReadResultV1,
    type D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
} from "./cloudflare-worker-canary-effect-journal.js";
import {
    readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1,
    type D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryRecordV1,
    type D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryResultV1,
} from "./cloudflare-worker-canary-response-archive.js";

const DigestV1 = /^[0-9a-f]{64}$/u;
const TRANSCRIPT_DIGEST_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-canary-durable-transcript.v1";

export type D1ProbeCloudflareWorkerCanaryDurableTranscriptClassificationV1 =
    | "local_history_missing"
    | "local_history_unstable"
    | "local_history_corrupt"
    | "durable_prefix_complete"
    | "dispatch_intent_tail"
    | "dispatch_started_tail"
    | "archive_ahead"
    | "terminal_archive_missing";

export interface D1ProbeCloudflareWorkerCanaryDurableTranscriptEntryV1 {
    readonly sequence: number;
    readonly workflow_step: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1["workflow_step"];
    readonly request_kind: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1["request_kind"];
    readonly method: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1["request_method"];
    readonly request_digest: string;
    readonly request_path_digest: string;
    readonly operation_revision: number;
    readonly operation_state: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1["operation_state"];
    readonly operation_record_digest: string;
    readonly execution_nonce_commitment: string;
    readonly lease_generation: number;
    readonly lease_record_digest: string;
    readonly cleanup_obligation_digest: string | null;
    readonly intent_observed_at_ms: number;
    readonly dispatch_started_at_ms: number | null;
    readonly latest_effect_phase: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1["effect_phase"];
    readonly ambiguity_classification: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1["ambiguity_classification"];
    readonly intent_claim_digest: string;
    readonly started_claim_digest: string | null;
    readonly terminal_claim_digest: string | null;
    readonly response_status: number | null;
    readonly response_digest: string | null;
    readonly caller_asserted_response_observed_at_ms: number | null;
    readonly response_archive_record_digest: string | null;
}

export interface D1ProbeCloudflareWorkerCanaryDurableTranscriptV1 {
    readonly schema_version: 1;
    readonly kind: "untrusted_d1_probe_cloudflare_worker_api_canary_durable_transcript";
    readonly plan_digest: string | null;
    readonly classification: D1ProbeCloudflareWorkerCanaryDurableTranscriptClassificationV1;
    readonly entry_count: number;
    readonly entries: readonly D1ProbeCloudflareWorkerCanaryDurableTranscriptEntryV1[];
    readonly journal_head_revision: number | null;
    readonly journal_head_claim_digest: string | null;
    readonly archive_record_count: number;
    readonly transcript_digest: string | null;
    readonly complete_response_archive_count: number;
    readonly mutation_replay_allowed: false;
    readonly cleanup_authorized: false;
    readonly transcript_authenticated: false;
    readonly cloudflare_origin_authenticated: false;
    readonly caller_mutation_authority: false;
    readonly authoritative: false;
    readonly eligible_for_upload: false;
    readonly eligible_for_attestation: false;
    readonly lifecycle_advance_allowed: false;
    readonly gate_promotion_allowed: false;
}

export interface D1ProbeCloudflareWorkerCanaryDurableTranscriptTestOnlyReadersV1 {
    readonly read_consistency: (planDigest: string) => Promise<D1ProbeCloudflareWorkerCanaryConsistencyV1>;
    readonly read_effect_journal: (
        planDigest: string
    ) => Promise<D1ProbeCloudflareWorkerCanaryEffectJournalReadResultV1>;
    readonly read_archive_inventory: (
        planDigest: string
    ) => Promise<D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryResultV1>;
}

const fixedReaders: D1ProbeCloudflareWorkerCanaryDurableTranscriptTestOnlyReadersV1 = {
    read_consistency: readD1ProbeCloudflareWorkerCanaryConsistencyV1,
    read_effect_journal: readD1ProbeCloudflareWorkerCanaryEffectJournalReadOnlyV1,
    read_archive_inventory: readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1,
};

const frozenEntries = (
    entries: readonly D1ProbeCloudflareWorkerCanaryDurableTranscriptEntryV1[]
): readonly D1ProbeCloudflareWorkerCanaryDurableTranscriptEntryV1[] =>
    Object.freeze(entries.map(entry => Object.freeze({ ...entry })));

const report = async (
    planDigest: string | null,
    classification: D1ProbeCloudflareWorkerCanaryDurableTranscriptClassificationV1,
    entries: readonly D1ProbeCloudflareWorkerCanaryDurableTranscriptEntryV1[] = [],
    journalHead: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1 | null = null,
    archiveRecordCount = 0,
    completeResponseArchiveCount = 0
): Promise<D1ProbeCloudflareWorkerCanaryDurableTranscriptV1> => {
    const safeEntries = frozenEntries(entries);
    const transcriptDigest =
        planDigest === null
            ? null
            : await digestCanonicalJsonV1(TRANSCRIPT_DIGEST_DOMAIN_V1, {
                  schema_version: 1,
                  kind: "d1_probe_cloudflare_worker_api_canary_durable_transcript_projection",
                  plan_digest: planDigest,
                  entries: safeEntries,
              } as unknown as CanonicalJsonValueV1);
    return Object.freeze({
        schema_version: 1,
        kind: "untrusted_d1_probe_cloudflare_worker_api_canary_durable_transcript",
        plan_digest: planDigest,
        classification,
        entry_count: safeEntries.length,
        entries: safeEntries,
        journal_head_revision: journalHead?.journal_revision ?? null,
        journal_head_claim_digest: journalHead?.claim_digest ?? null,
        archive_record_count: archiveRecordCount,
        transcript_digest: transcriptDigest,
        complete_response_archive_count: completeResponseArchiveCount,
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
    });
};

const stableSignature = (input: unknown): string | null => {
    try {
        return JSON.stringify(input);
    } catch {
        return null;
    }
};

interface StableSnapshotV1 {
    readonly consistency: D1ProbeCloudflareWorkerCanaryConsistencyV1;
    readonly journal: D1ProbeCloudflareWorkerCanaryEffectJournalReadResultV1;
    readonly archive: D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryResultV1;
}

const readStable = async (
    planDigest: string,
    readers: D1ProbeCloudflareWorkerCanaryDurableTranscriptTestOnlyReadersV1
): Promise<StableSnapshotV1 | null> => {
    const first = await Promise.all([
        readers.read_consistency(planDigest),
        readers.read_effect_journal(planDigest),
        readers.read_archive_inventory(planDigest),
    ]);
    const second = await Promise.all([
        readers.read_consistency(planDigest),
        readers.read_effect_journal(planDigest),
        readers.read_archive_inventory(planDigest),
    ]);
    const firstSignature = stableSignature(first);
    return firstSignature !== null && firstSignature === stableSignature(second)
        ? { consistency: second[0], journal: second[1], archive: second[2] }
        : null;
};

const authorityFieldsFalse = (input: {
    readonly authoritative: unknown;
    readonly eligible_for_upload: unknown;
    readonly eligible_for_attestation: unknown;
    readonly lifecycle_advance_allowed: unknown;
    readonly gate_promotion_allowed: unknown;
}): boolean =>
    input.authoritative === false &&
    input.eligible_for_upload === false &&
    input.eligible_for_attestation === false &&
    input.lifecycle_advance_allowed === false &&
    input.gate_promotion_allowed === false;

const exactArchiveBinding = (
    claim: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    record: D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryRecordV1
): boolean =>
    claim.effect_phase === "response_observed" &&
    claim.response_status !== null &&
    claim.response_digest !== null &&
    record.claim_digest === claim.claim_digest &&
    record.journal_revision === claim.journal_revision &&
    record.transcript_sequence === claim.transcript_sequence &&
    record.response_status === claim.response_status &&
    record.response_digest === claim.response_digest &&
    record.cleanup_obligation_digest === claim.cleanup_obligation_digest &&
    record.caller_mutation_authority === false &&
    record.cloudflare_origin_authenticated === false &&
    record.archive_key_possession_proven === false &&
    record.archive_decryptability_proven === false &&
    record.effect_claim_persistence_proven === false &&
    record.response_authenticated === false &&
    record.caller_mutation_authority === false &&
    authorityFieldsFalse(record);

const archiveRecordAuthorityFalse = (record: D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryRecordV1): boolean =>
    record.cloudflare_origin_authenticated === false &&
    record.archive_key_possession_proven === false &&
    record.archive_decryptability_proven === false &&
    record.effect_claim_persistence_proven === false &&
    record.response_authenticated === false &&
    authorityFieldsFalse(record);

interface MutableEntryV1 {
    sequence: number;
    workflow_step: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1["workflow_step"];
    request_kind: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1["request_kind"];
    method: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1["request_method"];
    request_digest: string;
    request_path_digest: string;
    operation_revision: number;
    operation_state: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1["operation_state"];
    operation_record_digest: string;
    execution_nonce_commitment: string;
    lease_generation: number;
    lease_record_digest: string;
    cleanup_obligation_digest: string | null;
    intent_observed_at_ms: number;
    dispatch_started_at_ms: number | null;
    latest_effect_phase: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1["effect_phase"];
    ambiguity_classification: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1["ambiguity_classification"];
    intent_claim_digest: string;
    started_claim_digest: string | null;
    terminal_claim_digest: string | null;
    response_status: number | null;
    response_digest: string | null;
    caller_asserted_response_observed_at_ms: number | null;
    response_archive_record_digest: string | null;
}

const sameRequest = (entry: MutableEntryV1, claim: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1): boolean =>
    entry.sequence === claim.transcript_sequence &&
    entry.workflow_step === claim.workflow_step &&
    entry.request_kind === claim.request_kind &&
    entry.method === claim.request_method &&
    entry.request_digest === claim.request_digest &&
    entry.request_path_digest === claim.request_path_digest &&
    entry.operation_revision === claim.operation_revision &&
    entry.operation_state === claim.operation_state &&
    entry.operation_record_digest === claim.operation_record_digest &&
    entry.execution_nonce_commitment === claim.execution_nonce_commitment &&
    entry.lease_generation === claim.lease_generation &&
    entry.lease_record_digest === claim.lease_record_digest &&
    entry.cleanup_obligation_digest === claim.cleanup_obligation_digest &&
    entry.intent_observed_at_ms === claim.intent_observed_at_ms;

const consistencyMatches = (
    consistency: D1ProbeCloudflareWorkerCanaryConsistencyV1,
    claims: readonly D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1[]
): boolean => {
    const head = claims.at(-1);
    if (
        head === undefined ||
        consistency.claim_journal_revision !== head.journal_revision ||
        consistency.claim_digest !== head.claim_digest ||
        consistency.claim_operation_revision !== head.operation_revision ||
        consistency.claim_operation_state !== head.operation_state ||
        consistency.claim_operation_record_digest !== head.operation_record_digest ||
        consistency.claim_execution_nonce_commitment !== head.execution_nonce_commitment ||
        consistency.claim_lease_generation !== head.lease_generation ||
        consistency.claim_lease_record_digest !== head.lease_record_digest ||
        consistency.claim_cleanup_obligation_digest !== head.cleanup_obligation_digest ||
        consistency.claim_workflow_step !== head.workflow_step ||
        consistency.claim_effect_phase !== head.effect_phase ||
        consistency.claim_ambiguity_classification !== head.ambiguity_classification
    ) {
        return false;
    }
    const responseClaims = claims.filter(claim => claim.effect_phase === "response_observed");
    return (
        responseClaims.length === consistency.response_claim_bindings.length &&
        responseClaims.every((claim, index) => {
            const binding = consistency.response_claim_bindings[index];
            return (
                binding !== undefined &&
                binding.journal_revision === claim.journal_revision &&
                binding.claim_digest === claim.claim_digest &&
                binding.transcript_sequence === claim.transcript_sequence &&
                binding.response_status === claim.response_status &&
                binding.response_digest === claim.response_digest &&
                binding.cleanup_obligation_digest === claim.cleanup_obligation_digest
            );
        })
    );
};

const projectStable = async (
    planDigest: string,
    snapshot: StableSnapshotV1
): Promise<D1ProbeCloudflareWorkerCanaryDurableTranscriptV1> => {
    const { consistency, journal, archive } = snapshot;
    if (
        consistency.plan_digest !== planDigest ||
        consistency.effect_claims_authenticated !== false ||
        consistency.caller_mutation_authority !== false ||
        !authorityFieldsFalse(consistency)
    ) {
        return await report(planDigest, "local_history_corrupt");
    }
    if (consistency.classification === "unstable") return await report(planDigest, "local_history_unstable");
    if (consistency.classification === "corrupt") return await report(planDigest, "local_history_corrupt");
    if (!journal.success) {
        return journal.code === "journal_not_found" &&
            consistency.missing_component === "effect_journal" &&
            !archive.success &&
            archive.code === "archive_not_found"
            ? await report(planDigest, "local_history_missing")
            : await report(planDigest, "local_history_corrupt");
    }
    if (consistency.classification === "missing" || !consistencyMatches(consistency, journal.claims)) {
        return await report(planDigest, "local_history_corrupt");
    }
    for (const [index, claim] of journal.claims.entries()) {
        const previous = journal.claims[index - 1];
        if (
            (await validateD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1(claim)) === null ||
            claim.plan_digest !== planDigest ||
            claim.journal_revision !== index ||
            (index === 0
                ? claim.previous_claim_digest !== null ||
                  claim.transcript_sequence !== 1 ||
                  claim.effect_phase !== "dispatch_intent"
                : previous === undefined || claim.previous_claim_digest !== previous.claim_digest)
        ) {
            return await report(planDigest, "local_history_corrupt");
        }
    }
    const head = journal.claims.at(-1);
    if (
        head === undefined ||
        (head.effect_phase === "dispatch_intent" && consistency.classification !== "claim_behind") ||
        ((head.effect_phase === "dispatch_started" || head.effect_phase === "dispatch_ambiguous") &&
            consistency.classification !== "ambiguous_dispatch") ||
        (head.effect_phase === "response_observed" &&
            consistency.classification !== "exact_sync" &&
            consistency.classification !== "state_ahead")
    ) {
        return await report(planDigest, "local_history_corrupt");
    }

    const archiveMissing = !archive.success && archive.code === "archive_not_found";
    if (!archive.success && !archiveMissing) return await report(planDigest, "local_history_corrupt");
    const archiveRecords = archive.success ? archive.inventory.records : [];
    if (
        archive.success &&
        (archive.inventory.plan_digest !== planDigest ||
            archive.inventory.record_count !== archiveRecords.length ||
            archive.inventory.cloudflare_origin_authenticated !== false ||
            archive.inventory.archive_key_possession_proven !== false ||
            archive.inventory.archive_decryptability_proven !== false ||
            archive.inventory.effect_claim_persistence_proven !== false ||
            archive.inventory.response_authenticated !== false ||
            !authorityFieldsFalse(archive.inventory) ||
            archiveRecords.some(record => !archiveRecordAuthorityFalse(record)))
    ) {
        return await report(planDigest, "local_history_corrupt");
    }

    const entries: MutableEntryV1[] = [];
    const responseClaims = new Map<string, D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1>();
    for (const claim of journal.claims) {
        let entry = entries.at(-1);
        if (entry === undefined || entry.sequence !== claim.transcript_sequence) {
            if (claim.effect_phase !== "dispatch_intent" || claim.transcript_sequence !== entries.length + 1) {
                return await report(planDigest, "local_history_corrupt");
            }
            entry = {
                sequence: claim.transcript_sequence,
                workflow_step: claim.workflow_step,
                request_kind: claim.request_kind,
                method: claim.request_method,
                request_digest: claim.request_digest,
                request_path_digest: claim.request_path_digest,
                operation_revision: claim.operation_revision,
                operation_state: claim.operation_state,
                operation_record_digest: claim.operation_record_digest,
                execution_nonce_commitment: claim.execution_nonce_commitment,
                lease_generation: claim.lease_generation,
                lease_record_digest: claim.lease_record_digest,
                cleanup_obligation_digest: claim.cleanup_obligation_digest,
                intent_observed_at_ms: claim.intent_observed_at_ms,
                dispatch_started_at_ms: null,
                latest_effect_phase: claim.effect_phase,
                ambiguity_classification: claim.ambiguity_classification,
                intent_claim_digest: claim.claim_digest,
                started_claim_digest: null,
                terminal_claim_digest: null,
                response_status: null,
                response_digest: null,
                caller_asserted_response_observed_at_ms: null,
                response_archive_record_digest: null,
            };
            entries.push(entry);
            continue;
        }
        if (!sameRequest(entry, claim)) return await report(planDigest, "local_history_corrupt");
        if (claim.effect_phase === "dispatch_started" && entry.started_claim_digest === null) {
            entry.dispatch_started_at_ms = claim.dispatch_started_at_ms;
            entry.latest_effect_phase = claim.effect_phase;
            entry.ambiguity_classification = claim.ambiguity_classification;
            entry.started_claim_digest = claim.claim_digest;
            continue;
        }
        if (
            (claim.effect_phase === "response_observed" || claim.effect_phase === "dispatch_ambiguous") &&
            entry.started_claim_digest !== null &&
            entry.terminal_claim_digest === null
        ) {
            entry.latest_effect_phase = claim.effect_phase;
            entry.ambiguity_classification = claim.ambiguity_classification;
            entry.terminal_claim_digest = claim.claim_digest;
            entry.response_status = claim.response_status;
            entry.response_digest = claim.response_digest;
            if (claim.effect_phase === "response_observed") responseClaims.set(claim.claim_digest, claim);
            continue;
        }
        return await report(planDigest, "local_history_corrupt");
    }

    const matchedArchives = new Set<string>();
    for (const entry of entries) {
        if (entry.terminal_claim_digest === null || entry.latest_effect_phase !== "response_observed") continue;
        const claim = responseClaims.get(entry.terminal_claim_digest);
        const archiveRecord = archiveRecords.find(record => record.claim_digest === entry.terminal_claim_digest);
        if (claim === undefined || archiveRecord === undefined) {
            return await report(
                planDigest,
                "terminal_archive_missing",
                entries,
                journal.claims.at(-1) ?? null,
                archiveRecords.length,
                matchedArchives.size
            );
        }
        if (!exactArchiveBinding(claim, archiveRecord)) {
            return await report(planDigest, "local_history_corrupt");
        }
        entry.caller_asserted_response_observed_at_ms = archiveRecord.caller_asserted_response_observed_at_ms;
        entry.response_archive_record_digest = archiveRecord.archive_record_digest;
        matchedArchives.add(archiveRecord.claim_digest);
    }

    const unmatchedArchives = archiveRecords.filter(record => !matchedArchives.has(record.claim_digest));
    const tail = entries.at(-1);
    const journalHead = head;
    if (unmatchedArchives.length > 0) {
        const ahead = unmatchedArchives[0];
        if (
            unmatchedArchives.length === 1 &&
            ahead !== undefined &&
            tail !== undefined &&
            tail.latest_effect_phase === "dispatch_started" &&
            ahead.journal_revision === journalHead.journal_revision + 1 &&
            ahead.transcript_sequence === tail.sequence &&
            ahead.cleanup_obligation_digest === tail.cleanup_obligation_digest
        ) {
            return await report(
                planDigest,
                "archive_ahead",
                entries,
                journalHead,
                archiveRecords.length,
                matchedArchives.size
            );
        }
        return await report(planDigest, "local_history_corrupt");
    }
    if (tail === undefined) return await report(planDigest, "local_history_missing");
    const classification =
        tail.latest_effect_phase === "dispatch_intent"
            ? "dispatch_intent_tail"
            : tail.latest_effect_phase === "dispatch_started"
              ? "dispatch_started_tail"
              : "durable_prefix_complete";
    return await report(planDigest, classification, entries, journalHead, archiveRecords.length, matchedArchives.size);
};

const readWithReaders = async (
    planDigestInput: unknown,
    readers: D1ProbeCloudflareWorkerCanaryDurableTranscriptTestOnlyReadersV1
): Promise<D1ProbeCloudflareWorkerCanaryDurableTranscriptV1> => {
    if (typeof planDigestInput !== "string" || !DigestV1.test(planDigestInput)) {
        return await report(null, "local_history_corrupt");
    }
    try {
        const snapshot = await readStable(planDigestInput, readers);
        return snapshot === null
            ? await report(planDigestInput, "local_history_unstable")
            : await projectStable(planDigestInput, snapshot);
    } catch {
        return await report(planDigestInput, "local_history_corrupt");
    }
};

export const readD1ProbeCloudflareWorkerCanaryDurableTranscriptV1 = async (
    planDigestInput: unknown
): Promise<D1ProbeCloudflareWorkerCanaryDurableTranscriptV1> => await readWithReaders(planDigestInput, fixedReaders);

/** Test-only reader seam. Production callers use the fixed read-only histories. */
export const readD1ProbeCloudflareWorkerCanaryDurableTranscriptWithReadersTestOnlyV1 = async (
    planDigestInput: unknown,
    readers: D1ProbeCloudflareWorkerCanaryDurableTranscriptTestOnlyReadersV1
): Promise<D1ProbeCloudflareWorkerCanaryDurableTranscriptV1> =>
    await readWithReaders(planDigestInput, Object.freeze({ ...readers }));
