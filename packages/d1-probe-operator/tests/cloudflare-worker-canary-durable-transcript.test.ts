import { describe, expect, it } from "vitest";

import type { D1ProbeCloudflareWorkerCanaryConsistencyV1 } from "../src/cloudflare-worker-canary-consistency.js";
import {
    readD1ProbeCloudflareWorkerCanaryDurableTranscriptWithReadersTestOnlyV1,
    type D1ProbeCloudflareWorkerCanaryDurableTranscriptTestOnlyReadersV1,
} from "../src/cloudflare-worker-canary-durable-transcript.js";
import {
    buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    type D1ProbeCloudflareWorkerCanaryEffectJournalReadResultV1,
    type D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1,
    type D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
} from "../src/cloudflare-worker-canary-effect-journal.js";
import type {
    D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryRecordV1,
    D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryResultV1,
} from "../src/cloudflare-worker-canary-response-archive.js";

const digest = (character: string): string => character.repeat(64);
const planDigest = digest("a");

const buildClaim = async (
    overrides: Partial<D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1> = {}
): Promise<D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1> => {
    const claim = await buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1({
        schema_version: 1,
        kind: "d1_probe_cloudflare_worker_api_canary_untrusted_effect_claim",
        journal_revision: 0,
        previous_claim_digest: null,
        plan_digest: planDigest,
        operation_revision: 0,
        operation_state: "prepared",
        operation_record_digest: digest("b"),
        execution_nonce_commitment: digest("c"),
        lease_generation: 0,
        lease_record_digest: digest("d"),
        cleanup_obligation_digest: null,
        workflow_step: "prepared_worker_list",
        request_kind: "inspect_worker",
        request_method: "GET",
        transcript_sequence: 1,
        effect_phase: "dispatch_intent",
        intent_observed_at_ms: 10_000,
        dispatch_started_at_ms: null,
        request_digest: digest("e"),
        request_path_digest: digest("f"),
        response_status: null,
        response_digest: null,
        ambiguity_classification: "not_dispatched",
        caller_mutation_authority: false,
        authoritative: false,
        eligible_for_upload: false,
        eligible_for_attestation: false,
        lifecycle_advance_allowed: false,
        gate_promotion_allowed: false,
        ...overrides,
    });
    if (claim === null) throw new Error("claim fixture did not validate");
    return claim;
};

const nextClaim = async (
    current: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    overrides: Partial<D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1>
): Promise<D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1> => {
    const { claim_digest: _claimDigest, ...draft } = current;
    return await buildClaim({
        ...draft,
        journal_revision: current.journal_revision + 1,
        previous_claim_digest: current.claim_digest,
        ...overrides,
    });
};

const claims = async (
    terminal: "intent" | "started" | "observed" | "ambiguous" = "observed"
): Promise<readonly D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1[]> => {
    const intent = await buildClaim();
    if (terminal === "intent") return [intent];
    const started = await nextClaim(intent, {
        effect_phase: "dispatch_started",
        dispatch_started_at_ms: 10_001,
        ambiguity_classification: "may_have_dispatched",
    });
    if (terminal === "started") return [intent, started];
    const final = await nextClaim(started, {
        effect_phase: terminal === "observed" ? "response_observed" : "dispatch_ambiguous",
        response_status: terminal === "observed" ? 200 : null,
        response_digest: terminal === "observed" ? digest("1") : null,
        ambiguity_classification: terminal === "observed" ? "none" : "dispatch_outcome_unknown",
    });
    return [intent, started, final];
};

const consistency = (
    history: readonly D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1[],
    overrides: Partial<D1ProbeCloudflareWorkerCanaryConsistencyV1> = {}
): D1ProbeCloudflareWorkerCanaryConsistencyV1 => {
    const head = history.at(-1);
    if (head === undefined) throw new Error("empty history fixture");
    return {
        schema_version: 1,
        kind: "untrusted_d1_probe_cloudflare_worker_api_canary_consistency",
        plan_digest: planDigest,
        classification:
            head.effect_phase === "dispatch_intent"
                ? "claim_behind"
                : head.effect_phase === "dispatch_started" || head.effect_phase === "dispatch_ambiguous"
                  ? "ambiguous_dispatch"
                  : "exact_sync",
        missing_component: null,
        corrupt_component: null,
        state_operation_revision: 0,
        state_operation_state: "prepared",
        state_operation_record_digest: digest("b"),
        state_execution_nonce_commitment: digest("c"),
        driver_lease_generation: 0,
        driver_lease_record_digest: digest("d"),
        driver_lease_state: "active",
        claim_journal_revision: head.journal_revision,
        claim_digest: head.claim_digest,
        claim_operation_revision: head.operation_revision,
        claim_operation_state: head.operation_state,
        claim_operation_record_digest: head.operation_record_digest,
        claim_execution_nonce_commitment: head.execution_nonce_commitment,
        claim_lease_generation: head.lease_generation,
        claim_lease_record_digest: head.lease_record_digest,
        claim_cleanup_obligation_digest: head.cleanup_obligation_digest,
        claim_workflow_step: head.workflow_step,
        claim_effect_phase: head.effect_phase,
        claim_ambiguity_classification: head.ambiguity_classification,
        response_claim_bindings: history
            .filter(claim => claim.effect_phase === "response_observed")
            .map(claim => ({
                journal_revision: claim.journal_revision,
                claim_digest: claim.claim_digest,
                transcript_sequence: claim.transcript_sequence,
                response_status: claim.response_status ?? 0,
                response_digest: claim.response_digest ?? digest("0"),
                cleanup_obligation_digest: claim.cleanup_obligation_digest,
            })),
        effect_claims_authenticated: false,
        caller_mutation_authority: false,
        authoritative: false,
        eligible_for_upload: false,
        eligible_for_attestation: false,
        lifecycle_advance_allowed: false,
        gate_promotion_allowed: false,
        ...overrides,
    };
};

const archiveRecord = (
    terminal: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    overrides: Partial<D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryRecordV1> = {}
): D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryRecordV1 => ({
    schema_version: 1,
    kind: "d1_probe_cloudflare_worker_api_canary_local_encrypted_envelope_shape_inventory_record",
    cleanup_obligation_digest: terminal.cleanup_obligation_digest,
    claim_digest: terminal.claim_digest,
    journal_revision: terminal.journal_revision,
    transcript_sequence: terminal.transcript_sequence,
    response_status: terminal.response_status ?? 200,
    response_digest: terminal.response_digest ?? digest("1"),
    archive_key_identifier: digest("2"),
    plaintext_length: 64,
    archive_record_digest: digest("3"),
    caller_asserted_response_content_type_digest: digest("4"),
    caller_asserted_response_content_encoding: "identity",
    caller_asserted_response_observed_at_ms: 10_002,
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
    records: readonly D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryRecordV1[]
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
    history: readonly D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1[],
    archiveResult: D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryResultV1,
    consistencyResult = consistency(history)
): D1ProbeCloudflareWorkerCanaryDurableTranscriptTestOnlyReadersV1 => ({
    read_consistency: async () => consistencyResult,
    read_effect_journal: async () => ({ success: true, claims: history }),
    read_archive_inventory: async () => archiveResult,
});

describe("Cloudflare Worker canary durable transcript", () => {
    it("reconstructs one archived response without raw paths or authority", async () => {
        const history = await claims();
        const terminal = history.at(-1);
        if (terminal === undefined) throw new Error("missing terminal fixture");
        const result = await readD1ProbeCloudflareWorkerCanaryDurableTranscriptWithReadersTestOnlyV1(
            planDigest,
            readers(history, archive([archiveRecord(terminal)]))
        );
        expect(result).toMatchObject({
            classification: "durable_prefix_complete",
            entry_count: 1,
            archive_record_count: 1,
            complete_response_archive_count: 1,
            mutation_replay_allowed: false,
            cleanup_authorized: false,
            transcript_authenticated: false,
            cloudflare_origin_authenticated: false,
            authoritative: false,
        });
        expect(result.entries[0]).toMatchObject({
            sequence: 1,
            method: "GET",
            latest_effect_phase: "response_observed",
            response_status: 200,
            response_digest: digest("1"),
            caller_asserted_response_observed_at_ms: 10_002,
            response_archive_record_digest: digest("3"),
        });
        expect(result.transcript_digest).toMatch(/^[0-9a-f]{64}$/u);
        expect(JSON.stringify(result)).not.toMatch(
            /raw-path|worker_id|version_id|deployment_id|attempt_tag|api_token/iu
        );
    });

    it("classifies durable intent, started, and ambiguous tails without allowing replay", async () => {
        for (const [terminal, expected] of [
            ["intent", "dispatch_intent_tail"],
            ["started", "dispatch_started_tail"],
            ["ambiguous", "durable_prefix_complete"],
        ] as const) {
            const history = await claims(terminal);
            const result = await readD1ProbeCloudflareWorkerCanaryDurableTranscriptWithReadersTestOnlyV1(
                planDigest,
                readers(history, { success: false, code: "archive_not_found" })
            );
            expect(result).toMatchObject({ classification: expected, entry_count: 1, mutation_replay_allowed: false });
        }
    });

    it("separates a terminal claim with no archive from an archive ahead of a started claim", async () => {
        const observedHistory = await claims("observed");
        await expect(
            readD1ProbeCloudflareWorkerCanaryDurableTranscriptWithReadersTestOnlyV1(
                planDigest,
                readers(observedHistory, { success: false, code: "archive_not_found" })
            )
        ).resolves.toMatchObject({ classification: "terminal_archive_missing", complete_response_archive_count: 0 });

        const startedHistory = await claims("started");
        const hypotheticalTerminal = await nextClaim(startedHistory[1]!, {
            effect_phase: "response_observed",
            response_status: 200,
            response_digest: digest("1"),
            ambiguity_classification: "none",
        });
        await expect(
            readD1ProbeCloudflareWorkerCanaryDurableTranscriptWithReadersTestOnlyV1(
                planDigest,
                readers(startedHistory, archive([archiveRecord(hypotheticalTerminal)]))
            )
        ).resolves.toMatchObject({ classification: "archive_ahead", mutation_replay_allowed: false });
    });

    it("fails closed on archive, consistency, and authority substitutions", async () => {
        const history = await claims();
        const terminal = history.at(-1)!;
        const cases = [
            readers(history, archive([archiveRecord(terminal, { response_digest: digest("5") })])),
            readers(history, archive([archiveRecord(terminal)]), consistency(history, { claim_digest: digest("6") })),
            readers(history, archive([archiveRecord(terminal, { authoritative: true as false })])),
        ];
        for (const input of cases) {
            await expect(
                readD1ProbeCloudflareWorkerCanaryDurableTranscriptWithReadersTestOnlyV1(planDigest, input)
            ).resolves.toMatchObject({ classification: "local_history_corrupt", authoritative: false });
        }
    });

    it("rechecks the complete claim chain and phase classification", async () => {
        const history = await claims();
        const intent = history[0]!;
        const wrongStarted = await nextClaim(intent, {
            previous_claim_digest: digest("8"),
            effect_phase: "dispatch_started",
            dispatch_started_at_ms: 10_001,
            ambiguity_classification: "may_have_dispatched",
        });
        const wrongTerminal = await nextClaim(wrongStarted, {
            effect_phase: "response_observed",
            response_status: 200,
            response_digest: digest("1"),
            ambiguity_classification: "none",
        });
        const wrongChain = [intent, wrongStarted, wrongTerminal] as const;
        await expect(
            readD1ProbeCloudflareWorkerCanaryDurableTranscriptWithReadersTestOnlyV1(
                planDigest,
                readers(wrongChain, archive([archiveRecord(wrongTerminal)]))
            )
        ).resolves.toMatchObject({ classification: "local_history_corrupt" });

        const terminal = history.at(-1)!;
        await expect(
            readD1ProbeCloudflareWorkerCanaryDurableTranscriptWithReadersTestOnlyV1(
                planDigest,
                readers(
                    history,
                    archive([archiveRecord(terminal)]),
                    consistency(history, { classification: "claim_behind" })
                )
            )
        ).resolves.toMatchObject({ classification: "local_history_corrupt" });
    });

    it("detects a mixed snapshot across its two reads", async () => {
        const history = await claims();
        const terminal = history.at(-1)!;
        let journalReads = 0;
        const input = readers(history, archive([archiveRecord(terminal)]));
        const unstable: D1ProbeCloudflareWorkerCanaryDurableTranscriptTestOnlyReadersV1 = {
            ...input,
            read_effect_journal: async (): Promise<D1ProbeCloudflareWorkerCanaryEffectJournalReadResultV1> => {
                journalReads += 1;
                return journalReads === 1
                    ? { success: true, claims: history }
                    : { success: true, claims: history.slice(0, 2) };
            },
        };
        await expect(
            readD1ProbeCloudflareWorkerCanaryDurableTranscriptWithReadersTestOnlyV1(planDigest, unstable)
        ).resolves.toMatchObject({ classification: "local_history_unstable" });
    });

    it("handles missing history, invalid input, thrown readers, and hostile proxies with fixed denials", async () => {
        const missingConsistency = consistency(await claims("intent"), {
            classification: "missing",
            missing_component: "effect_journal",
            claim_journal_revision: null,
            claim_digest: null,
            claim_operation_revision: null,
            claim_operation_state: null,
            claim_operation_record_digest: null,
            claim_execution_nonce_commitment: null,
            claim_lease_generation: null,
            claim_lease_record_digest: null,
            claim_workflow_step: null,
            claim_effect_phase: null,
            claim_ambiguity_classification: null,
            response_claim_bindings: [],
        });
        const missingReaders: D1ProbeCloudflareWorkerCanaryDurableTranscriptTestOnlyReadersV1 = {
            read_consistency: async () => missingConsistency,
            read_effect_journal: async () => ({ success: false, code: "journal_not_found" }),
            read_archive_inventory: async () => ({ success: false, code: "archive_not_found" }),
        };
        await expect(
            readD1ProbeCloudflareWorkerCanaryDurableTranscriptWithReadersTestOnlyV1(planDigest, missingReaders)
        ).resolves.toMatchObject({ classification: "local_history_missing" });
        const orphanTerminal = (await claims()).at(-1)!;
        await expect(
            readD1ProbeCloudflareWorkerCanaryDurableTranscriptWithReadersTestOnlyV1(planDigest, {
                ...missingReaders,
                read_archive_inventory: async () => archive([archiveRecord(orphanTerminal)]),
            })
        ).resolves.toMatchObject({ classification: "local_history_corrupt" });
        await expect(
            readD1ProbeCloudflareWorkerCanaryDurableTranscriptWithReadersTestOnlyV1("bad", missingReaders)
        ).resolves.toMatchObject({ plan_digest: null, classification: "local_history_corrupt" });
        await expect(
            readD1ProbeCloudflareWorkerCanaryDurableTranscriptWithReadersTestOnlyV1(planDigest, {
                ...missingReaders,
                read_consistency: async () => {
                    throw new Error("sentinel");
                },
            })
        ).resolves.toMatchObject({ classification: "local_history_corrupt" });
        const hostile = new Proxy(
            {},
            {
                get() {
                    throw new Error("hostile");
                },
            }
        );
        await expect(
            readD1ProbeCloudflareWorkerCanaryDurableTranscriptWithReadersTestOnlyV1(hostile, missingReaders)
        ).resolves.toMatchObject({ classification: "local_history_corrupt" });
    });

    it("binds the transcript digest to the request projection", async () => {
        const firstHistory = await claims();
        const firstTerminal = firstHistory.at(-1)!;
        const first = await readD1ProbeCloudflareWorkerCanaryDurableTranscriptWithReadersTestOnlyV1(
            planDigest,
            readers(firstHistory, archive([archiveRecord(firstTerminal)]))
        );
        const changedIntent = await buildClaim({ request_digest: digest("7") });
        const changedStarted = await nextClaim(changedIntent, {
            effect_phase: "dispatch_started",
            dispatch_started_at_ms: 10_001,
            ambiguity_classification: "may_have_dispatched",
        });
        const changedTerminal = await nextClaim(changedStarted, {
            effect_phase: "response_observed",
            response_status: 200,
            response_digest: digest("1"),
            ambiguity_classification: "none",
        });
        const changedHistory = [changedIntent, changedStarted, changedTerminal] as const;
        const changed = await readD1ProbeCloudflareWorkerCanaryDurableTranscriptWithReadersTestOnlyV1(
            planDigest,
            readers(changedHistory, archive([archiveRecord(changedTerminal)]))
        );
        expect(first.transcript_digest).not.toBe(changed.transcript_digest);
    });
});
