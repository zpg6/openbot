import { describe, expect, it } from "vitest";

import {
    readD1ProbeCloudflareWorkerCanaryBaseRecoveryWithReadersTestOnlyV1,
    type D1ProbeCloudflareWorkerCanaryBaseRecoveryTestOnlyReadersV1,
} from "../src/cloudflare-worker-canary-base-recovery.js";
import type { D1ProbeCloudflareWorkerCanaryConsistencyV1 } from "../src/cloudflare-worker-canary-consistency.js";
import type {
    D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryRecordV1,
    D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryResultV1,
} from "../src/cloudflare-worker-canary-response-archive.js";

const digest = (character: string): string => character.repeat(64);
const planDigest = digest("a");

const consistency = (
    overrides: Partial<D1ProbeCloudflareWorkerCanaryConsistencyV1> = {}
): D1ProbeCloudflareWorkerCanaryConsistencyV1 => ({
    schema_version: 1,
    kind: "untrusted_d1_probe_cloudflare_worker_api_canary_consistency",
    plan_digest: planDigest,
    classification: "exact_sync",
    missing_component: null,
    corrupt_component: null,
    state_operation_revision: 0,
    state_operation_state: "prepared",
    state_operation_record_digest: digest("b"),
    state_execution_nonce_commitment: digest("c"),
    driver_lease_generation: 0,
    driver_lease_record_digest: digest("d"),
    driver_lease_state: "active",
    claim_journal_revision: 2,
    claim_digest: digest("e"),
    claim_operation_revision: 0,
    claim_operation_state: "prepared",
    claim_operation_record_digest: digest("b"),
    claim_execution_nonce_commitment: digest("c"),
    claim_lease_generation: 0,
    claim_lease_record_digest: digest("d"),
    claim_cleanup_obligation_digest: null,
    claim_workflow_step: "prepared_worker_list",
    claim_effect_phase: "response_observed",
    claim_ambiguity_classification: "none",
    response_claim_bindings: [
        {
            journal_revision: 2,
            claim_digest: digest("e"),
            transcript_sequence: 1,
            response_status: 200,
            response_digest: digest("f"),
            cleanup_obligation_digest: null,
        },
    ],
    effect_claims_authenticated: false,
    caller_mutation_authority: false,
    authoritative: false,
    eligible_for_upload: false,
    eligible_for_attestation: false,
    lifecycle_advance_allowed: false,
    gate_promotion_allowed: false,
    ...overrides,
});

const archiveRecord = (
    overrides: Partial<D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryRecordV1> = {}
): D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryRecordV1 => ({
    schema_version: 1,
    kind: "d1_probe_cloudflare_worker_api_canary_local_encrypted_envelope_shape_inventory_record",
    cleanup_obligation_digest: null,
    claim_digest: digest("e"),
    journal_revision: 2,
    transcript_sequence: 1,
    response_status: 200,
    response_digest: digest("f"),
    archive_key_identifier: digest("1"),
    plaintext_length: 12,
    archive_record_digest: digest("2"),
    caller_asserted_response_content_type_digest: digest("3"),
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
    ...overrides,
});

const archive = (
    records: readonly D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryRecordV1[] = [archiveRecord()]
): D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryResultV1 => ({
    success: true,
    inventory: {
        schema_version: 1,
        kind: "d1_probe_cloudflare_worker_api_canary_local_encrypted_envelope_shape_inventory",
        plan_digest: planDigest,
        record_count: records.length,
        records,
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
});

const readers = (
    consistencyResult: D1ProbeCloudflareWorkerCanaryConsistencyV1,
    archiveResult: D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryResultV1
): D1ProbeCloudflareWorkerCanaryBaseRecoveryTestOnlyReadersV1 => ({
    read_consistency: async () => consistencyResult,
    read_archive_inventory: async () => archiveResult,
});

describe("Cloudflare Worker canary base recovery classification", () => {
    it("classifies aligned response, lease, state, effect, and archive heads without granting authority", async () => {
        const result = await readD1ProbeCloudflareWorkerCanaryBaseRecoveryWithReadersTestOnlyV1(
            planDigest,
            readers(consistency({ classification: "state_ahead", state_operation_revision: 1 }), archive())
        );
        expect(result).toMatchObject({
            classification: "local_histories_aligned",
            recovery_requirement: "none",
            driver_lease_generation: 0,
            driver_lease_record_digest: digest("d"),
            archive_record_count: 1,
            archive_head_claim_digest: digest("e"),
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
        expect(JSON.stringify(result)).not.toMatch(
            /worker_id|version_id|deployment_id|attempt_tag|owner_nonce|api_token/iu
        );
    });

    it("keeps an observed response pending until its operation state advances", async () => {
        await expect(
            readD1ProbeCloudflareWorkerCanaryBaseRecoveryWithReadersTestOnlyV1(
                planDigest,
                readers(consistency(), archive())
            )
        ).resolves.toMatchObject({
            classification: "response_observed_state_transition_pending",
            recovery_requirement: "state_transition_revalidation",
            recovery_action_authorized: false,
        });
    });

    it("requires archive repair when a terminal response claim has no envelope", async () => {
        await expect(
            readD1ProbeCloudflareWorkerCanaryBaseRecoveryWithReadersTestOnlyV1(
                planDigest,
                readers(consistency(), { success: false, code: "archive_not_found" })
            )
        ).resolves.toMatchObject({
            classification: "terminal_claim_missing_archive",
            recovery_requirement: "archive_repair_or_manual_stop",
        });
    });

    it("detects one archive ahead of an exact dispatch-started head without allowing replay", async () => {
        const started = consistency({
            classification: "ambiguous_dispatch",
            claim_journal_revision: 1,
            claim_digest: digest("4"),
            claim_effect_phase: "dispatch_started",
            claim_ambiguity_classification: "may_have_dispatched",
            response_claim_bindings: [],
        });
        await expect(
            readD1ProbeCloudflareWorkerCanaryBaseRecoveryWithReadersTestOnlyV1(planDigest, readers(started, archive()))
        ).resolves.toMatchObject({
            classification: "archive_ahead_requires_keyed_reconciliation",
            recovery_requirement: "keyed_archive_reconciliation_without_mutation_replay",
            mutation_replay_allowed: false,
        });
    });

    it("never retries a started or ambiguous effect without a response archive", async () => {
        for (const phase of ["dispatch_started", "dispatch_ambiguous"] as const) {
            await expect(
                readD1ProbeCloudflareWorkerCanaryBaseRecoveryWithReadersTestOnlyV1(
                    planDigest,
                    readers(
                        consistency({
                            classification: "ambiguous_dispatch",
                            claim_journal_revision: 1,
                            claim_effect_phase: phase,
                            claim_ambiguity_classification:
                                phase === "dispatch_started" ? "may_have_dispatched" : "dispatch_outcome_unknown",
                            response_claim_bindings: [],
                        }),
                        { success: false, code: "archive_not_found" }
                    )
                )
            ).resolves.toMatchObject({
                classification: "mutation_outcome_unknown_no_retry",
                recovery_requirement: "read_only_remote_reconciliation_only",
                mutation_replay_allowed: false,
            });
        }
    });

    it("separates prepared, intent-only, missing, unstable, and corrupt local states", async () => {
        const cases = [
            {
                input: consistency({
                    classification: "missing",
                    missing_component: "effect_journal",
                    claim_journal_revision: null,
                    claim_digest: null,
                    claim_effect_phase: null,
                    response_claim_bindings: [],
                }),
                expected: "prepared_without_effect_claim",
            },
            {
                input: consistency({
                    classification: "claim_behind",
                    claim_journal_revision: 0,
                    claim_effect_phase: "dispatch_intent",
                    claim_ambiguity_classification: "not_dispatched",
                    response_claim_bindings: [],
                }),
                expected: "intent_only_requires_dead_owner_takeover",
            },
            {
                input: consistency({ classification: "missing", missing_component: "multiple" }),
                expected: "local_histories_missing",
            },
            { input: consistency({ classification: "unstable" }), expected: "local_histories_unstable" },
            {
                input: consistency({ classification: "corrupt", corrupt_component: "bindings" }),
                expected: "local_histories_corrupt",
            },
        ] as const;
        for (const testCase of cases) {
            await expect(
                readD1ProbeCloudflareWorkerCanaryBaseRecoveryWithReadersTestOnlyV1(
                    planDigest,
                    readers(testCase.input, { success: false, code: "archive_not_found" })
                )
            ).resolves.toMatchObject({ classification: testCase.expected, recovery_action_authorized: false });
        }
    });

    it("rejects substituted archive fields, extra archive records, and authority drift", async () => {
        const substitutions = [
            archive([archiveRecord({ response_status: 201 })]),
            archive([archiveRecord({ cleanup_obligation_digest: digest("8") })]),
            archive([
                archiveRecord(),
                archiveRecord({ claim_digest: digest("9"), journal_revision: 5, transcript_sequence: 2 }),
            ]),
            {
                ...archive(),
                inventory: {
                    ...(archive() as Extract<ReturnType<typeof archive>, { success: true }>).inventory,
                    authoritative: true,
                },
            } as unknown as D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryResultV1,
        ];
        for (const substituted of substitutions) {
            await expect(
                readD1ProbeCloudflareWorkerCanaryBaseRecoveryWithReadersTestOnlyV1(
                    planDigest,
                    readers(consistency(), substituted)
                )
            ).resolves.toMatchObject({
                classification: "local_histories_corrupt",
                recovery_requirement: "manual_stop",
            });
        }
    });

    it("returns unstable when either local snapshot changes between reads", async () => {
        let consistencyReads = 0;
        const changingReaders: D1ProbeCloudflareWorkerCanaryBaseRecoveryTestOnlyReadersV1 = {
            read_consistency: async () => {
                consistencyReads += 1;
                return consistency(
                    consistencyReads === 1 ? {} : { classification: "state_ahead", state_operation_revision: 1 }
                );
            },
            read_archive_inventory: async () => archive(),
        };
        await expect(
            readD1ProbeCloudflareWorkerCanaryBaseRecoveryWithReadersTestOnlyV1(planDigest, changingReaders)
        ).resolves.toMatchObject({ classification: "local_histories_unstable", recovery_requirement: "manual_stop" });
    });

    it("denies hostile input and reader failures with fixed redacted output", async () => {
        let traps = 0;
        const hostile = new Proxy(
            {},
            {
                get: () => {
                    traps += 1;
                    throw new Error("trap");
                },
            }
        );
        const throwingReaders: D1ProbeCloudflareWorkerCanaryBaseRecoveryTestOnlyReadersV1 = {
            read_consistency: async () => {
                throw new Error("sentinel secret");
            },
            read_archive_inventory: async () => {
                throw new Error("sentinel body");
            },
        };
        await expect(
            readD1ProbeCloudflareWorkerCanaryBaseRecoveryWithReadersTestOnlyV1(hostile, throwingReaders)
        ).resolves.toMatchObject({ plan_digest: null, classification: "local_histories_corrupt" });
        expect(traps).toBe(0);
        const failure = await readD1ProbeCloudflareWorkerCanaryBaseRecoveryWithReadersTestOnlyV1(
            planDigest,
            throwingReaders
        );
        expect(failure).toMatchObject({ classification: "local_histories_corrupt", recovery_action_authorized: false });
        expect(JSON.stringify(failure)).not.toMatch(/sentinel|secret|body/iu);
    });
});
