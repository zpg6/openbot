import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
    buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1,
    digestD1ProbeCloudflareWorkerCanaryOperationRecordV1,
    type D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
} from "./cloudflare-worker-canary-effect-journal.js";
import {
    digestD1ProbeCloudflareWorkerCanaryDriverLeaseRecordV1,
    type D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1,
    type D1ProbeCloudflareWorkerCanaryDriverLeaseV1,
} from "./cloudflare-worker-canary-driver-lease.js";
import type { D1ProbeCloudflareWorkerCanaryConsistencyV1 } from "./cloudflare-worker-canary-consistency.js";
import {
    prepareD1ProbeCloudflareWorkerCanaryOperationV1,
    type D1ProbeCloudflareWorkerCanaryOperationV1,
} from "./cloudflare-worker-canary-operation.js";
import { generateD1ProbeCloudflareWorkerApiCanaryCommandV1 } from "./cloudflare-worker-canary-plan.js";
import {
    reconcileD1ProbeCloudflareWorkerCanaryArchiveAheadWithDependenciesTestOnlyV1,
    type D1ProbeCloudflareWorkerCanaryArchiveAheadReconciliationTestOnlyDependenciesV1,
} from "./cloudflare-worker-canary-archive-reconciliation.js";
import type { D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryRecordV1 } from "./cloudflare-worker-canary-response-archive.js";

const digest = (character: string): string => character.repeat(64);
const responseBytes = new TextEncoder().encode('{"private":"worker-id"}');
const responseDigest = createHash("sha256").update(responseBytes).digest("hex");
const hmacKey = globalThis
    .btoa(String.fromCharCode(...new Uint8Array(32).fill(37)))
    .replace(/=/gu, "")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_");

const operation = async (): Promise<D1ProbeCloudflareWorkerCanaryOperationV1> => {
    let draw = 0;
    const generated = await generateD1ProbeCloudflareWorkerApiCanaryCommandV1(
        {
            schema_version: 1,
            kind: "d1_probe_cloudflare_worker_api_canary_plan_request",
            account_id: "a".repeat(32),
        },
        { hmac_key_base64url: hmacKey },
        { now: () => 10_000, randomBytes: length => new Uint8Array(length).fill(++draw) }
    );
    if (!generated.success) throw new Error(generated.code);
    const prepared = await prepareD1ProbeCloudflareWorkerCanaryOperationV1(
        generated.command.plan,
        `openbot-canary-attempt-${"ab".repeat(16)}`,
        10_001
    );
    if (!prepared.success) throw new Error(prepared.code);
    return prepared.operation;
};

interface HarnessV1 {
    readonly input: {
        readonly operation: D1ProbeCloudflareWorkerCanaryOperationV1;
        readonly driver_lease_owner: D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1;
        readonly archive_key: Uint8Array;
    };
    readonly dependencies: D1ProbeCloudflareWorkerCanaryArchiveAheadReconciliationTestOnlyDependenciesV1;
    readonly observed: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1;
    readonly events: string[];
    readonly failLeaseAt: (call: number) => void;
    readonly raceSecondRead: () => void;
    readonly failAppend: () => void;
    readonly failFinalConsistency: () => void;
}

const harness = async (takeover = false): Promise<HarnessV1> => {
    const currentOperation = await operation();
    const dispatchLease: D1ProbeCloudflareWorkerCanaryDriverLeaseV1 = {
        schema_version: 1,
        kind: "d1_probe_cloudflare_worker_api_canary_driver_lease",
        transition: "renewed",
        state: "active",
        plan_digest: currentOperation.plan.plan_digest,
        execution_nonce_commitment: digest("a"),
        generation: 2,
        previous_record_digest: digest("b"),
        owner_pid: takeover ? 41 : 42,
        owner_nonce_commitment: digest("c"),
        prior_owner_liveness: "not_checked",
        issued_at_ms: 10_000,
        heartbeat_at_ms: 10_005,
        expires_at_ms: 20_000,
        caller_mutation_authority: false,
        authoritative: false,
        eligible_for_upload: false,
        eligible_for_attestation: false,
        lifecycle_advance_allowed: false,
        gate_promotion_allowed: false,
        mutation_authority: false,
    };
    const dispatchLeaseDigest = await digestD1ProbeCloudflareWorkerCanaryDriverLeaseRecordV1(dispatchLease);
    if (dispatchLeaseDigest === null) throw new Error("dispatch lease digest unavailable");
    const owner: D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1 = {
        plan_digest: currentOperation.plan.plan_digest,
        execution_nonce: currentOperation.execution_nonce,
        generation: takeover ? 3 : 2,
        owner_pid: 42,
        owner_nonce: "A".repeat(43),
    };
    const lease: D1ProbeCloudflareWorkerCanaryDriverLeaseV1 = {
        schema_version: 1,
        kind: "d1_probe_cloudflare_worker_api_canary_driver_lease",
        transition: takeover ? "taken_over" : "renewed",
        state: "active",
        plan_digest: currentOperation.plan.plan_digest,
        execution_nonce_commitment: digest("a"),
        generation: owner.generation,
        previous_record_digest: takeover ? dispatchLeaseDigest : digest("b"),
        owner_pid: owner.owner_pid,
        owner_nonce_commitment: digest("c"),
        prior_owner_liveness: "not_checked",
        issued_at_ms: 10_000,
        heartbeat_at_ms: 10_005,
        expires_at_ms: 20_000,
        caller_mutation_authority: false,
        authoritative: false,
        eligible_for_upload: false,
        eligible_for_attestation: false,
        lifecycle_advance_allowed: false,
        gate_promotion_allowed: false,
        mutation_authority: false,
    };
    const [currentLeaseDigest, operationDigest, nonceCommitment] = await Promise.all([
        digestD1ProbeCloudflareWorkerCanaryDriverLeaseRecordV1(lease),
        digestD1ProbeCloudflareWorkerCanaryOperationRecordV1(currentOperation),
        commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1(currentOperation.execution_nonce),
    ]);
    if (currentLeaseDigest === null || operationDigest === null || nonceCommitment === null) {
        throw new Error("test digests unavailable");
    }
    const intent = await buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1({
        schema_version: 1,
        kind: "d1_probe_cloudflare_worker_api_canary_untrusted_effect_claim",
        journal_revision: 0,
        previous_claim_digest: null,
        plan_digest: currentOperation.plan.plan_digest,
        operation_revision: currentOperation.revision,
        operation_state: currentOperation.state,
        operation_record_digest: operationDigest,
        execution_nonce_commitment: nonceCommitment,
        lease_generation: dispatchLease.generation,
        lease_record_digest: dispatchLeaseDigest,
        workflow_step: "prepared_worker_list",
        request_kind: "inspect_worker",
        request_method: "GET",
        transcript_sequence: 1,
        effect_phase: "dispatch_intent",
        intent_observed_at_ms: 10_010,
        dispatch_started_at_ms: null,
        request_digest: digest("d"),
        request_path_digest: digest("e"),
        response_status: null,
        response_digest: null,
        ambiguity_classification: "not_dispatched",
        caller_mutation_authority: false,
        authoritative: false,
        eligible_for_upload: false,
        eligible_for_attestation: false,
        lifecycle_advance_allowed: false,
        gate_promotion_allowed: false,
    });
    if (intent === null) throw new Error("intent unavailable");
    const { claim_digest: _intentDigest, ...intentDraft } = intent;
    const started = await buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1({
        ...intentDraft,
        journal_revision: 1,
        previous_claim_digest: intent.claim_digest,
        effect_phase: "dispatch_started",
        dispatch_started_at_ms: 10_011,
        ambiguity_classification: "may_have_dispatched",
    });
    if (started === null) throw new Error("started unavailable");
    const { claim_digest: _startedDigest, ...startedDraft } = started;
    const observed = await buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1({
        ...startedDraft,
        journal_revision: 2,
        previous_claim_digest: started.claim_digest,
        effect_phase: "response_observed",
        response_status: 200,
        response_digest: responseDigest,
        ambiguity_classification: "none",
    });
    if (observed === null) throw new Error("observed unavailable");
    const archiveRecord: D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryRecordV1 = {
        schema_version: 1,
        kind: "d1_probe_cloudflare_worker_api_canary_local_encrypted_envelope_shape_inventory_record",
        claim_digest: observed.claim_digest,
        journal_revision: observed.journal_revision,
        transcript_sequence: observed.transcript_sequence,
        response_status: 200,
        response_digest: responseDigest,
        archive_key_identifier: digest("f"),
        plaintext_length: responseBytes.length,
        archive_record_digest: digest("1"),
        caller_asserted_response_content_type_digest: digest("2"),
        caller_asserted_response_content_encoding: "identity",
        caller_asserted_response_observed_at_ms: 10_012,
        caller_mutation_authority: false,
        cloudflare_origin_authenticated: false,
        archive_key_possession_proven: false,
        archive_decryptability_proven: false,
        effect_claim_persistence_proven: false,
        response_authenticated: false,
        authoritative: false,
        eligible_for_upload: false,
        eligible_for_attestation: false,
        lifecycle_advance_allowed: false,
        gate_promotion_allowed: false,
    };
    const consistency = (phase: "started" | "observed"): D1ProbeCloudflareWorkerCanaryConsistencyV1 => ({
        schema_version: 1,
        kind: "untrusted_d1_probe_cloudflare_worker_api_canary_consistency",
        plan_digest: currentOperation.plan.plan_digest,
        classification: phase === "started" ? "ambiguous_dispatch" : "exact_sync",
        missing_component: null,
        corrupt_component: null,
        state_operation_revision: currentOperation.revision,
        state_operation_state: currentOperation.state,
        state_operation_record_digest: operationDigest,
        state_execution_nonce_commitment: nonceCommitment,
        driver_lease_generation: lease.generation,
        driver_lease_record_digest: currentLeaseDigest,
        driver_lease_state: "active",
        claim_journal_revision: phase === "started" ? started.journal_revision : observed.journal_revision,
        claim_digest: phase === "started" ? started.claim_digest : observed.claim_digest,
        claim_operation_revision: currentOperation.revision,
        claim_operation_state: currentOperation.state,
        claim_operation_record_digest: operationDigest,
        claim_execution_nonce_commitment: nonceCommitment,
        claim_lease_generation: dispatchLease.generation,
        claim_lease_record_digest: dispatchLeaseDigest,
        claim_workflow_step: "prepared_worker_list",
        claim_effect_phase: phase === "started" ? "dispatch_started" : "response_observed",
        claim_ambiguity_classification: phase === "started" ? "may_have_dispatched" : "none",
        response_claim_bindings:
            phase === "started"
                ? []
                : [
                      {
                          journal_revision: observed.journal_revision,
                          claim_digest: observed.claim_digest,
                          transcript_sequence: observed.transcript_sequence,
                          response_status: 200,
                          response_digest: responseDigest,
                      },
                  ],
        effect_claims_authenticated: false,
        caller_mutation_authority: false,
        authoritative: false,
        eligible_for_upload: false,
        eligible_for_attestation: false,
        lifecycle_advance_allowed: false,
        gate_promotion_allowed: false,
    });
    const events: string[] = [];
    let leaseCalls = 0;
    let leaseFailure = -1;
    let localRead = 0;
    let raced = false;
    let appended = false;
    let appendFailure = false;
    let finalMismatch = false;
    const dependencies: D1ProbeCloudflareWorkerCanaryArchiveAheadReconciliationTestOnlyDependenciesV1 = {
        assert_current_driver_lease: async () => {
            events.push("lease");
            leaseCalls += 1;
            return leaseCalls === leaseFailure ? { success: false, code: "lease_expired" } : { success: true, lease };
        },
        read_consistency: async () => {
            events.push("consistency");
            localRead += 1;
            if (finalMismatch && appended) return { ...consistency("observed"), claim_digest: digest("9") };
            return appended ? consistency("observed") : consistency("started");
        },
        read_effect_journal: async () => {
            events.push("journal");
            if (raced && localRead >= 2 && !appended) return { success: true, claims: [intent] };
            return { success: true, claims: appended ? [intent, started, observed] : [intent, started] };
        },
        read_archive_inventory: async () => {
            events.push("archive");
            return {
                success: true,
                inventory: {
                    schema_version: 1,
                    kind: "d1_probe_cloudflare_worker_api_canary_local_encrypted_envelope_shape_inventory",
                    plan_digest: currentOperation.plan.plan_digest,
                    record_count: 1,
                    records: [archiveRecord],
                    cloudflare_origin_authenticated: false,
                    archive_key_possession_proven: false,
                    archive_decryptability_proven: false,
                    effect_claim_persistence_proven: false,
                    response_authenticated: false,
                    authoritative: false,
                    eligible_for_upload: false,
                    eligible_for_attestation: false,
                    lifecycle_advance_allowed: false,
                    gate_promotion_allowed: false,
                },
            };
        },
        resolve_archive_ahead: async () => {
            events.push("resolve");
            return {
                success: true,
                claim: observed,
                receipt: {
                    schema_version: 1,
                    kind: "untrusted_d1_probe_cloudflare_worker_api_canary_keyed_archive_resolution_receipt",
                    plan_digest: observed.plan_digest,
                    claim_digest: observed.claim_digest,
                    journal_revision: observed.journal_revision,
                    transcript_sequence: observed.transcript_sequence,
                    response_status: 200,
                    response_digest: responseDigest,
                    archive_key_identifier: archiveRecord.archive_key_identifier,
                    archive_record_digest: archiveRecord.archive_record_digest,
                    plaintext_length: responseBytes.length,
                    local_archive_key_matched: true,
                    local_ciphertext_integrity_matched: true,
                    local_plaintext_digest_matched: true,
                    plaintext_exported: false,
                    cloudflare_origin_authenticated: false,
                    effect_claim_authenticated: false,
                    caller_mutation_authority: false,
                    authoritative: false,
                    eligible_for_upload: false,
                    eligible_for_attestation: false,
                    lifecycle_advance_allowed: false,
                    gate_promotion_allowed: false,
                },
            };
        },
        append_effect_claim: async claim => {
            events.push("append");
            if (appendFailure) return { success: false, code: "journal_io_unavailable" };
            appended = true;
            return { success: true, claim };
        },
    };
    return {
        input: { operation: currentOperation, driver_lease_owner: owner, archive_key: new Uint8Array(32).fill(7) },
        dependencies,
        observed,
        events,
        failLeaseAt: call => {
            leaseFailure = call;
        },
        raceSecondRead: () => {
            raced = true;
        },
        failAppend: () => {
            appendFailure = true;
        },
        failFinalConsistency: () => {
            finalMismatch = true;
        },
    };
};

describe("Cloudflare Worker canary archive-ahead reconciliation", () => {
    it("appends the exact archived response claim without replaying a remote request", async () => {
        const test = await harness();
        const keyBefore = [...test.input.archive_key];
        const result = await reconcileD1ProbeCloudflareWorkerCanaryArchiveAheadWithDependenciesTestOnlyV1(
            test.input,
            test.dependencies
        );

        expect(result).toMatchObject({
            success: true,
            claim_digest: test.observed.claim_digest,
            response_claim_appended: true,
            local_archive_key_matched: true,
            local_ciphertext_integrity_matched: true,
            local_plaintext_digest_matched: true,
            plaintext_exported: false,
            mutation_replay_allowed: false,
            cleanup_authorized: false,
            remote_request_dispatched: false,
            cloudflare_origin_authenticated: false,
            authoritative: false,
        });
        expect(test.events).toEqual([
            "lease",
            "consistency",
            "journal",
            "archive",
            "resolve",
            "lease",
            "consistency",
            "journal",
            "archive",
            "lease",
            "append",
            "lease",
            "consistency",
            "journal",
            "archive",
        ]);
        expect([...test.input.archive_key]).toEqual(keyBefore);
        expect(JSON.stringify(result)).not.toContain("worker-id");
    });

    it("preserves the dispatch lease epoch while a later takeover lease authorizes repair", async () => {
        const test = await harness(true);

        const result = await reconcileD1ProbeCloudflareWorkerCanaryArchiveAheadWithDependenciesTestOnlyV1(
            test.input,
            test.dependencies
        );

        expect(result).toMatchObject({
            success: true,
            claim_digest: test.observed.claim_digest,
            remote_request_dispatched: false,
            mutation_replay_allowed: false,
        });
    });

    it("denies a lease loss or local-head race before append", async () => {
        const leaseLoss = await harness();
        leaseLoss.failLeaseAt(2);
        const leaseAppend = vi.spyOn(leaseLoss.dependencies, "append_effect_claim");
        await expect(
            reconcileD1ProbeCloudflareWorkerCanaryArchiveAheadWithDependenciesTestOnlyV1(
                leaseLoss.input,
                leaseLoss.dependencies
            )
        ).resolves.toMatchObject({ success: false, remote_request_dispatched: false });
        expect(leaseAppend).not.toHaveBeenCalled();

        const raced = await harness();
        raced.raceSecondRead();
        const raceAppend = vi.spyOn(raced.dependencies, "append_effect_claim");
        await expect(
            reconcileD1ProbeCloudflareWorkerCanaryArchiveAheadWithDependenciesTestOnlyV1(
                raced.input,
                raced.dependencies
            )
        ).resolves.toMatchObject({ success: false, mutation_replay_allowed: false });
        expect(raceAppend).not.toHaveBeenCalled();
    });

    it("returns a fixed denial when append or final verification fails", async () => {
        const appendFailure = await harness();
        appendFailure.failAppend();
        await expect(
            reconcileD1ProbeCloudflareWorkerCanaryArchiveAheadWithDependenciesTestOnlyV1(
                appendFailure.input,
                appendFailure.dependencies
            )
        ).resolves.toEqual({
            success: false,
            code: "archive_ahead_reconciliation_denied",
            ...{
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
            },
        });

        const finalMismatch = await harness();
        finalMismatch.failFinalConsistency();
        await expect(
            reconcileD1ProbeCloudflareWorkerCanaryArchiveAheadWithDependenciesTestOnlyV1(
                finalMismatch.input,
                finalMismatch.dependencies
            )
        ).resolves.toMatchObject({ success: false, code: "archive_ahead_reconciliation_denied" });
    });
});
