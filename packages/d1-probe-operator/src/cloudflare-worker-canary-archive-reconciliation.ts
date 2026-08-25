import {
    appendD1ProbeCloudflareWorkerCanaryEffectJournalV1,
    commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1,
    digestD1ProbeCloudflareWorkerCanaryOperationRecordV1,
    readD1ProbeCloudflareWorkerCanaryEffectJournalReadOnlyV1,
    type D1ProbeCloudflareWorkerCanaryEffectJournalAppendResultV1,
    type D1ProbeCloudflareWorkerCanaryEffectJournalReadResultV1,
    type D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
} from "./cloudflare-worker-canary-effect-journal.js";
import {
    assertCurrentD1ProbeCloudflareWorkerCanaryDriverLeaseV1,
    digestD1ProbeCloudflareWorkerCanaryDriverLeaseRecordV1,
    type D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1,
    type D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1,
} from "./cloudflare-worker-canary-driver-lease.js";
import {
    matchesD1ProbeCloudflareWorkerCanaryCleanupObligationContextV1,
    readD1ProbeCloudflareWorkerCanaryCleanupObligationReadOnlyV1,
    type D1ProbeCloudflareWorkerCanaryCleanupObligationResultV1,
    type D1ProbeCloudflareWorkerCanaryCleanupObligationV1,
} from "./cloudflare-worker-canary-cleanup-obligation.js";
import {
    readD1ProbeCloudflareWorkerCanaryConsistencyV1,
    type D1ProbeCloudflareWorkerCanaryConsistencyV1,
} from "./cloudflare-worker-canary-consistency.js";
import {
    validateD1ProbeCloudflareWorkerCanaryOperationV1,
    type D1ProbeCloudflareWorkerCanaryOperationV1,
} from "./cloudflare-worker-canary-operation.js";
import {
    readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1,
    resolveD1ProbeCloudflareWorkerCanaryResponseArchiveAheadV1,
    type D1ProbeCloudflareWorkerCanaryKeyedArchiveResolutionResultV1,
    type D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryRecordV1,
    type D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryResultV1,
} from "./cloudflare-worker-canary-response-archive.js";

const DigestV1 = /^[0-9a-f]{64}$/u;
const ExecutionNonceV1 = /^[0-9a-f]{32}$/u;
const OwnerNonceV1 = /^[A-Za-z0-9_-]{43}$/u;

export interface D1ProbeCloudflareWorkerCanaryArchiveAheadReconciliationInputV1 {
    readonly operation: unknown;
    readonly driver_lease_owner: unknown;
    readonly archive_key: unknown;
}

interface ReconciliationAuthorityV1 {
    readonly mutation_replay_allowed: false;
    readonly cleanup_authorized: false;
    readonly remote_request_dispatched: false;
    readonly cloudflare_origin_authenticated: false;
    readonly effect_claim_authenticated: false;
    readonly caller_mutation_authority: false;
    readonly authoritative: false;
    readonly eligible_for_upload: false;
    readonly eligible_for_attestation: false;
    readonly lifecycle_advance_allowed: false;
    readonly gate_promotion_allowed: false;
}

export type D1ProbeCloudflareWorkerCanaryArchiveAheadReconciliationResultV1 =
    | ({ readonly success: false; readonly code: "archive_ahead_reconciliation_denied" } & ReconciliationAuthorityV1)
    | ({
          readonly success: true;
          readonly plan_digest: string;
          readonly cleanup_obligation_digest: string | null;
          readonly claim_digest: string;
          readonly journal_revision: number;
          readonly transcript_sequence: number;
          readonly archive_record_digest: string;
          readonly response_claim_appended: true;
          readonly local_archive_key_matched: true;
          readonly local_ciphertext_integrity_matched: true;
          readonly local_plaintext_digest_matched: true;
          readonly plaintext_exported: false;
      } & ReconciliationAuthorityV1);

export interface D1ProbeCloudflareWorkerCanaryArchiveAheadReconciliationTestOnlyDependenciesV1 {
    readonly assert_current_driver_lease: (
        owner: D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1
    ) => Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1>;
    readonly read_consistency: (planDigest: string) => Promise<D1ProbeCloudflareWorkerCanaryConsistencyV1>;
    readonly read_effect_journal: (
        planDigest: string
    ) => Promise<D1ProbeCloudflareWorkerCanaryEffectJournalReadResultV1>;
    readonly read_archive_inventory: (
        planDigest: string
    ) => Promise<D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryResultV1>;
    readonly resolve_archive_ahead: (
        startedClaim: unknown,
        inventoryRecord: unknown,
        planExpiresAtMs: unknown,
        archiveKey: unknown
    ) => Promise<D1ProbeCloudflareWorkerCanaryKeyedArchiveResolutionResultV1>;
    readonly append_effect_claim: (
        claim: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1
    ) => Promise<D1ProbeCloudflareWorkerCanaryEffectJournalAppendResultV1>;
    readonly read_cleanup_obligation: (
        planDigest: string,
        executionNonceCommitment: string
    ) => Promise<D1ProbeCloudflareWorkerCanaryCleanupObligationResultV1>;
}

const fixedDependencies: D1ProbeCloudflareWorkerCanaryArchiveAheadReconciliationTestOnlyDependenciesV1 = {
    assert_current_driver_lease: assertCurrentD1ProbeCloudflareWorkerCanaryDriverLeaseV1,
    read_consistency: readD1ProbeCloudflareWorkerCanaryConsistencyV1,
    read_effect_journal: readD1ProbeCloudflareWorkerCanaryEffectJournalReadOnlyV1,
    read_archive_inventory: readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1,
    resolve_archive_ahead: resolveD1ProbeCloudflareWorkerCanaryResponseArchiveAheadV1,
    append_effect_claim: appendD1ProbeCloudflareWorkerCanaryEffectJournalV1,
    read_cleanup_obligation: readD1ProbeCloudflareWorkerCanaryCleanupObligationReadOnlyV1,
};

const authority = Object.freeze({
    mutation_replay_allowed: false,
    cleanup_authorized: false,
    remote_request_dispatched: false,
    cloudflare_origin_authenticated: false,
    effect_claim_authenticated: false,
    caller_mutation_authority: false,
    authoritative: false,
    eligible_for_upload: false,
    eligible_for_attestation: false,
    lifecycle_advance_allowed: false,
    gate_promotion_allowed: false,
} as const);

const denied = (): D1ProbeCloudflareWorkerCanaryArchiveAheadReconciliationResultV1 => ({
    success: false,
    code: "archive_ahead_reconciliation_denied",
    ...authority,
});

const exactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const ownerFrom = (input: unknown): D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1 | null => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
    const value = input as Record<string, unknown>;
    if (!exactKeys(value, ["plan_digest", "execution_nonce", "generation", "owner_pid", "owner_nonce"])) return null;
    return typeof value["plan_digest"] === "string" &&
        DigestV1.test(value["plan_digest"]) &&
        typeof value["execution_nonce"] === "string" &&
        ExecutionNonceV1.test(value["execution_nonce"]) &&
        typeof value["generation"] === "number" &&
        Number.isSafeInteger(value["generation"]) &&
        value["generation"] >= 0 &&
        typeof value["owner_pid"] === "number" &&
        Number.isSafeInteger(value["owner_pid"]) &&
        value["owner_pid"] > 0 &&
        typeof value["owner_nonce"] === "string" &&
        OwnerNonceV1.test(value["owner_nonce"])
        ? (value as unknown as D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1)
        : null;
};

const stableSignature = (input: unknown): string | null => {
    try {
        return JSON.stringify(input);
    } catch {
        return null;
    }
};

const exactRecordBinding = (
    record: D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryRecordV1,
    binding: D1ProbeCloudflareWorkerCanaryConsistencyV1["response_claim_bindings"][number]
): boolean =>
    record.claim_digest === binding.claim_digest &&
    record.cleanup_obligation_digest === binding.cleanup_obligation_digest &&
    record.journal_revision === binding.journal_revision &&
    record.transcript_sequence === binding.transcript_sequence &&
    record.response_status === binding.response_status &&
    record.response_digest === binding.response_digest;

const exactStartedHead = (
    consistency: D1ProbeCloudflareWorkerCanaryConsistencyV1,
    operation: D1ProbeCloudflareWorkerCanaryOperationV1,
    operationDigest: string,
    nonceCommitment: string,
    head: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    leaseGeneration: number,
    leaseRecordDigest: string,
    cleanupObligation: D1ProbeCloudflareWorkerCanaryCleanupObligationV1 | null
): boolean =>
    consistency.plan_digest === operation.plan.plan_digest &&
    consistency.classification === "ambiguous_dispatch" &&
    consistency.missing_component === null &&
    consistency.corrupt_component === null &&
    consistency.state_operation_revision === operation.revision &&
    consistency.state_operation_state === operation.state &&
    consistency.state_operation_record_digest === operationDigest &&
    consistency.state_execution_nonce_commitment === nonceCommitment &&
    consistency.driver_lease_generation === leaseGeneration &&
    consistency.driver_lease_record_digest === leaseRecordDigest &&
    consistency.driver_lease_state === "active" &&
    consistency.claim_journal_revision === head.journal_revision &&
    consistency.claim_digest === head.claim_digest &&
    consistency.claim_lease_generation === head.lease_generation &&
    consistency.claim_lease_record_digest === head.lease_record_digest &&
    consistency.claim_cleanup_obligation_digest === head.cleanup_obligation_digest &&
    consistency.claim_effect_phase === "dispatch_started" &&
    head.effect_phase === "dispatch_started" &&
    head.plan_digest === operation.plan.plan_digest &&
    head.operation_revision === operation.revision &&
    head.operation_state === operation.state &&
    head.operation_record_digest === operationDigest &&
    head.execution_nonce_commitment === nonceCommitment &&
    head.cleanup_obligation_digest === (cleanupObligation?.obligation_digest ?? null) &&
    head.journal_revision < 255 &&
    head.intent_observed_at_ms >=
        Math.max(
            operation.updated_at_ms,
            cleanupObligation?.cleanup_grace.automatic_cleanup_not_before_ms ?? operation.plan.not_before_ms
        ) &&
    head.dispatch_started_at_ms !== null &&
    head.dispatch_started_at_ms >= head.intent_observed_at_ms &&
    head.dispatch_started_at_ms <
        (cleanupObligation?.cleanup_grace.automatic_cleanup_expires_at_ms ?? operation.plan.expires_at_ms);

const currentLeaseEpoch = async (
    dependencies: D1ProbeCloudflareWorkerCanaryArchiveAheadReconciliationTestOnlyDependenciesV1,
    owner: D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1
): Promise<{ readonly generation: number; readonly record_digest: string } | null> => {
    const current = await dependencies.assert_current_driver_lease(owner);
    if (
        !current.success ||
        current.lease.state !== "active" ||
        current.lease.plan_digest !== owner.plan_digest ||
        current.lease.generation !== owner.generation ||
        current.lease.owner_pid !== owner.owner_pid
    ) {
        return null;
    }
    const recordDigest = await digestD1ProbeCloudflareWorkerCanaryDriverLeaseRecordV1(current.lease);
    return recordDigest === null ? null : { generation: current.lease.generation, record_digest: recordDigest };
};

const readLocalHeads = async (
    dependencies: D1ProbeCloudflareWorkerCanaryArchiveAheadReconciliationTestOnlyDependenciesV1,
    planDigest: string
) => {
    const consistency = await dependencies.read_consistency(planDigest);
    const journal = await dependencies.read_effect_journal(planDigest);
    const archive = await dependencies.read_archive_inventory(planDigest);
    return { consistency, journal, archive };
};

const reconcileWithDependencies = async (
    input: D1ProbeCloudflareWorkerCanaryArchiveAheadReconciliationInputV1,
    dependencies: D1ProbeCloudflareWorkerCanaryArchiveAheadReconciliationTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryArchiveAheadReconciliationResultV1> => {
    let key: Uint8Array | null = null;
    try {
        if (typeof input !== "object" || input === null || Array.isArray(input)) return denied();
        const raw = input as unknown as Record<string, unknown>;
        if (!exactKeys(raw, ["operation", "driver_lease_owner", "archive_key"])) return denied();
        const operation = await validateD1ProbeCloudflareWorkerCanaryOperationV1(structuredClone(raw["operation"]));
        const owner = ownerFrom(raw["driver_lease_owner"]);
        if (!(raw["archive_key"] instanceof Uint8Array) || raw["archive_key"].byteLength !== 32) return denied();
        key = new Uint8Array(raw["archive_key"]);
        if (
            operation === null ||
            owner === null ||
            owner.plan_digest !== operation.plan.plan_digest ||
            owner.execution_nonce !== operation.execution_nonce
        ) {
            return denied();
        }
        const [operationDigest, nonceCommitment] = await Promise.all([
            digestD1ProbeCloudflareWorkerCanaryOperationRecordV1(operation),
            commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1(operation.execution_nonce),
        ]);
        if (operationDigest === null || nonceCommitment === null) return denied();
        const lease = await currentLeaseEpoch(dependencies, owner);
        if (lease === null) return denied();
        const first = await readLocalHeads(dependencies, operation.plan.plan_digest);
        if (!first.journal.success || !first.archive.success) return denied();
        const head = first.journal.claims.at(-1);
        let cleanupObligation: D1ProbeCloudflareWorkerCanaryCleanupObligationV1 | null = null;
        if (head?.cleanup_obligation_digest !== null && head?.cleanup_obligation_digest !== undefined) {
            const read = await dependencies.read_cleanup_obligation(operation.plan.plan_digest, nonceCommitment);
            if (
                !read.success ||
                read.obligation.obligation_digest !== head.cleanup_obligation_digest ||
                !matchesD1ProbeCloudflareWorkerCanaryCleanupObligationContextV1(
                    read.obligation,
                    operation,
                    nonceCommitment
                )
            ) {
                return denied();
            }
            cleanupObligation = read.obligation;
        }
        const cleanupObligationIsCurrent = async (): Promise<boolean> => {
            if (cleanupObligation === null) return true;
            const read = await dependencies.read_cleanup_obligation(operation.plan.plan_digest, nonceCommitment);
            return (
                read.success &&
                read.obligation.obligation_digest === cleanupObligation.obligation_digest &&
                matchesD1ProbeCloudflareWorkerCanaryCleanupObligationContextV1(
                    read.obligation,
                    operation,
                    nonceCommitment
                )
            );
        };
        if (
            head === undefined ||
            !exactStartedHead(
                first.consistency,
                operation,
                operationDigest,
                nonceCommitment,
                head,
                lease.generation,
                lease.record_digest,
                cleanupObligation
            )
        ) {
            return denied();
        }
        const matched = new Set<string>();
        for (const binding of first.consistency.response_claim_bindings) {
            const record = first.archive.inventory.records.find(
                candidate => candidate.claim_digest === binding.claim_digest
            );
            if (record === undefined || !exactRecordBinding(record, binding)) return denied();
            matched.add(record.claim_digest);
        }
        const ahead = first.archive.inventory.records.filter(record => !matched.has(record.claim_digest));
        const archiveRecord = ahead[0];
        if (
            ahead.length !== 1 ||
            archiveRecord === undefined ||
            archiveRecord.cleanup_obligation_digest !== head.cleanup_obligation_digest ||
            archiveRecord.journal_revision !== head.journal_revision + 1 ||
            archiveRecord.transcript_sequence !== head.transcript_sequence
        ) {
            return denied();
        }
        const resolved = await dependencies.resolve_archive_ahead(
            head,
            archiveRecord,
            cleanupObligation?.cleanup_grace.automatic_cleanup_expires_at_ms ?? operation.plan.expires_at_ms,
            key
        );
        if (
            !resolved.success ||
            resolved.claim.claim_digest !== archiveRecord.claim_digest ||
            resolved.claim.previous_claim_digest !== head.claim_digest ||
            resolved.claim.effect_phase !== "response_observed" ||
            resolved.receipt.cleanup_obligation_digest !== head.cleanup_obligation_digest ||
            resolved.receipt.archive_record_digest !== archiveRecord.archive_record_digest
        ) {
            return denied();
        }
        const reboundLease = await currentLeaseEpoch(dependencies, owner);
        if (
            reboundLease === null ||
            reboundLease.generation !== lease.generation ||
            reboundLease.record_digest !== lease.record_digest
        ) {
            return denied();
        }
        const second = await readLocalHeads(dependencies, operation.plan.plan_digest);
        if (
            stableSignature(first) === null ||
            stableSignature(first) !== stableSignature(second) ||
            !second.journal.success ||
            second.journal.claims.at(-1)?.claim_digest !== head.claim_digest
        ) {
            return denied();
        }
        const preAppendLease = await currentLeaseEpoch(dependencies, owner);
        if (
            preAppendLease === null ||
            preAppendLease.generation !== lease.generation ||
            preAppendLease.record_digest !== lease.record_digest ||
            !(await cleanupObligationIsCurrent())
        ) {
            return denied();
        }
        const appended = await dependencies.append_effect_claim(resolved.claim);
        if (!appended.success || appended.claim.claim_digest !== resolved.claim.claim_digest) return denied();
        const finalLease = await currentLeaseEpoch(dependencies, owner);
        if (
            finalLease === null ||
            finalLease.generation !== lease.generation ||
            finalLease.record_digest !== lease.record_digest
        ) {
            return denied();
        }
        const finalHeads = await readLocalHeads(dependencies, operation.plan.plan_digest);
        if (
            !finalHeads.journal.success ||
            !finalHeads.archive.success ||
            finalHeads.journal.claims.at(-1)?.claim_digest !== resolved.claim.claim_digest ||
            finalHeads.consistency.classification !== "exact_sync" ||
            finalHeads.consistency.claim_digest !== resolved.claim.claim_digest ||
            !finalHeads.consistency.response_claim_bindings.some(binding =>
                exactRecordBinding(archiveRecord, binding)
            ) ||
            stableSignature(first.archive) !== stableSignature(finalHeads.archive)
        ) {
            return denied();
        }
        return Object.freeze({
            success: true,
            plan_digest: operation.plan.plan_digest,
            cleanup_obligation_digest: resolved.claim.cleanup_obligation_digest,
            claim_digest: resolved.claim.claim_digest,
            journal_revision: resolved.claim.journal_revision,
            transcript_sequence: resolved.claim.transcript_sequence,
            archive_record_digest: archiveRecord.archive_record_digest,
            response_claim_appended: true,
            local_archive_key_matched: true,
            local_ciphertext_integrity_matched: true,
            local_plaintext_digest_matched: true,
            plaintext_exported: false,
            ...authority,
        });
    } catch {
        return denied();
    } finally {
        key?.fill(0);
    }
};

export const reconcileD1ProbeCloudflareWorkerCanaryArchiveAheadV1 = async (
    input: D1ProbeCloudflareWorkerCanaryArchiveAheadReconciliationInputV1
): Promise<D1ProbeCloudflareWorkerCanaryArchiveAheadReconciliationResultV1> =>
    await reconcileWithDependencies(input, fixedDependencies);

/** Test-only dependency seam. Production callers must use the fixed function above. */
export const reconcileD1ProbeCloudflareWorkerCanaryArchiveAheadWithDependenciesTestOnlyV1 = async (
    input: D1ProbeCloudflareWorkerCanaryArchiveAheadReconciliationInputV1,
    dependencies: D1ProbeCloudflareWorkerCanaryArchiveAheadReconciliationTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryArchiveAheadReconciliationResultV1> =>
    await reconcileWithDependencies(input, dependencies);
