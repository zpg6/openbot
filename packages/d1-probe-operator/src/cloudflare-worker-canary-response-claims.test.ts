import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { compileD1ProbeCloudflareWorkerCanaryCleanupCommandV1 } from "./cloudflare-worker-canary-cleanup-grace.js";
import { compileD1ProbeCloudflareWorkerCanaryCleanupObligationV1 } from "./cloudflare-worker-canary-cleanup-obligation.js";
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
    buildNextD1ProbeCloudflareWorkerCanaryOperationV1,
    prepareD1ProbeCloudflareWorkerCanaryOperationV1,
    transitionD1ProbeCloudflareWorkerCanaryOperationV1,
    type D1ProbeCloudflareWorkerCanaryOperationV1,
} from "./cloudflare-worker-canary-operation.js";
import { generateD1ProbeCloudflareWorkerApiCanaryCommandV1 } from "./cloudflare-worker-canary-plan.js";
import {
    createD1ProbeCloudflareWorkerCanaryResponseClaimsWithDependenciesTestOnlyV1,
    type D1ProbeCloudflareWorkerCanaryResponseClaimsTestOnlyDependenciesV1,
} from "./cloudflare-worker-canary-response-claims.js";
import type { D1ProbeCloudflareWorkerCanaryResponseCaptureContextV1 } from "./cloudflare-worker-canary-transport.js";

const hmacKey = globalThis
    .btoa(String.fromCharCode(...new Uint8Array(32).fill(37)))
    .replace(/=/gu, "")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_");
const digest = (character: string): string => character.repeat(64);
const bytes = new TextEncoder().encode('{"ok":true}');
const responseDigest = createHash("sha256").update(bytes).digest("hex");

const prepared = async (): Promise<D1ProbeCloudflareWorkerCanaryOperationV1> => {
    let batch = 0;
    const generated = await generateD1ProbeCloudflareWorkerApiCanaryCommandV1(
        {
            schema_version: 1,
            kind: "d1_probe_cloudflare_worker_api_canary_plan_request",
            account_id: "a".repeat(32),
        },
        { hmac_key_base64url: hmacKey },
        {
            now: () => 10_000,
            randomBytes: byteLength => new Uint8Array(byteLength).fill(++batch),
        }
    );
    if (!generated.success) throw new Error(generated.code);
    const operation = await prepareD1ProbeCloudflareWorkerCanaryOperationV1(
        generated.command.plan,
        `openbot-canary-attempt-${"ab".repeat(16)}`,
        10_001
    );
    if (!operation.success) throw new Error(operation.code);
    return operation.operation;
};

const ownerFor = (
    operation: D1ProbeCloudflareWorkerCanaryOperationV1
): D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1 => ({
    plan_digest: operation.plan.plan_digest,
    execution_nonce: operation.execution_nonce,
    generation: 3,
    owner_pid: 42,
    owner_nonce: "A".repeat(43),
});

const context = (
    overrides: Partial<D1ProbeCloudflareWorkerCanaryResponseCaptureContextV1> = {}
): D1ProbeCloudflareWorkerCanaryResponseCaptureContextV1 =>
    Object.freeze({
        transcript_sequence: 1,
        request_method: "GET" as const,
        request_path_digest: digest("b"),
        request_digest: digest("c"),
        response_status: 200,
        response_digest: responseDigest,
        caller_asserted_response_content_type: "application/json",
        caller_asserted_response_content_encoding: "identity" as const,
        caller_asserted_response_observed_at_ms: 10_012,
        ...overrides,
    });

const dispatchIntent = (
    overrides: Partial<{
        readonly sequence: number;
        readonly method: "GET" | "POST" | "DELETE";
        readonly path_digest: string;
        readonly request_digest: string;
        readonly window_class: "forward" | "cleanup";
        readonly intent_observed_at_ms: number;
        readonly dispatch_started_at_ms: number;
    }> = {}
) =>
    Object.freeze({
        sequence: 1,
        method: "GET" as const,
        path_digest: digest("b"),
        request_digest: digest("c"),
        window_class: "forward" as const,
        intent_observed_at_ms: 10_010,
        dispatch_started_at_ms: 10_011,
        ...overrides,
    });

const authority = {
    effect_claims_authenticated: false as const,
    caller_mutation_authority: false as const,
    authoritative: false as const,
    eligible_for_upload: false as const,
    eligible_for_attestation: false as const,
    lifecycle_advance_allowed: false as const,
    gate_promotion_allowed: false as const,
};

interface HarnessV1 {
    readonly dependencies: D1ProbeCloudflareWorkerCanaryResponseClaimsTestOnlyDependenciesV1;
    readonly events: string[];
    readonly started: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1;
    readonly setLeaseFailureAt: (call: number) => void;
    readonly setArchiveFailure: (value: boolean) => void;
    readonly setAppendFailure: (value: boolean) => void;
    readonly setAppendSubstitution: (value: boolean) => void;
    readonly setHeadRaceAfterArchive: (value: boolean) => void;
    readonly setFinalMismatch: (value: boolean) => void;
    readonly capturedArrays: () => { readonly key: Uint8Array | null; readonly response: Uint8Array | null };
}

interface HarnessOptionsV1 {
    readonly workflow_step?: "prepared_worker_list" | "cleanup_worker_readback";
    readonly request_kind?: "inspect_worker" | "inspect_cleanup";
    readonly window_class?: "forward" | "cleanup";
    readonly cleanup_obligation_digest?: string | null;
    readonly intent_observed_at_ms?: number;
    readonly dispatch_started_at_ms?: number;
}

const harnessFor = async (
    operation: D1ProbeCloudflareWorkerCanaryOperationV1,
    options: HarnessOptionsV1 = {}
): Promise<HarnessV1> => {
    const workflowStep = options.workflow_step ?? "prepared_worker_list";
    const requestKind = options.request_kind ?? "inspect_worker";
    const windowClass = options.window_class ?? "forward";
    const cleanupObligationDigest = options.cleanup_obligation_digest ?? null;
    const intentObservedAtMs = options.intent_observed_at_ms ?? 10_010;
    const dispatchStartedAtMs = options.dispatch_started_at_ms ?? 10_011;
    const owner = ownerFor(operation);
    const lease: D1ProbeCloudflareWorkerCanaryDriverLeaseV1 = {
        schema_version: 1,
        kind: "d1_probe_cloudflare_worker_api_canary_driver_lease",
        transition: "renewed",
        state: "active",
        plan_digest: operation.plan.plan_digest,
        execution_nonce_commitment: digest("d"),
        generation: owner.generation,
        previous_record_digest: digest("e"),
        owner_pid: owner.owner_pid,
        owner_nonce_commitment: digest("f"),
        prior_owner_liveness: "not_checked",
        issued_at_ms: 10_000,
        heartbeat_at_ms: 10_009,
        expires_at_ms: 20_000,
        caller_mutation_authority: false,
        authoritative: false,
        eligible_for_upload: false,
        eligible_for_attestation: false,
        lifecycle_advance_allowed: false,
        gate_promotion_allowed: false,
        mutation_authority: false,
    };
    const leaseRecordDigest = await digestD1ProbeCloudflareWorkerCanaryDriverLeaseRecordV1(lease);
    if (leaseRecordDigest === null) throw new Error("lease digest unavailable");
    const [operationDigest, nonceCommitment] = await Promise.all([
        digestD1ProbeCloudflareWorkerCanaryOperationRecordV1(operation),
        commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1(operation.execution_nonce),
    ]);
    if (operationDigest === null || nonceCommitment === null) throw new Error("test commitment unavailable");
    const intent = await buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1({
        schema_version: 1,
        kind: "d1_probe_cloudflare_worker_api_canary_untrusted_effect_claim",
        journal_revision: 0,
        previous_claim_digest: null,
        plan_digest: operation.plan.plan_digest,
        operation_revision: operation.revision,
        operation_state: operation.state,
        operation_record_digest: operationDigest,
        execution_nonce_commitment: nonceCommitment,
        lease_generation: owner.generation,
        lease_record_digest: leaseRecordDigest,
        cleanup_obligation_digest: cleanupObligationDigest,
        workflow_step: workflowStep,
        request_kind: requestKind,
        request_method: "GET",
        transcript_sequence: 1,
        effect_phase: "dispatch_intent",
        intent_observed_at_ms: intentObservedAtMs,
        dispatch_started_at_ms: null,
        request_digest: digest("c"),
        request_path_digest: digest("b"),
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
    if (intent === null) throw new Error("intent fixture unavailable");
    const { claim_digest: _intentDigest, ...intentDraft } = intent;
    const started = await buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1({
        ...intentDraft,
        journal_revision: 1,
        previous_claim_digest: intent.claim_digest,
        effect_phase: "dispatch_started",
        dispatch_started_at_ms: dispatchStartedAtMs,
        ambiguity_classification: "may_have_dispatched",
    });
    if (started === null) throw new Error("started fixture unavailable");
    const events: string[] = [];
    let currentClaims: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1[] = [intent, started];
    let leaseCalls = 0;
    let leaseFailureAt = 0;
    let archiveFailure = false;
    let appendFailure = false;
    let appendSubstitution = false;
    let headRaceAfterArchive = false;
    let finalMismatch = false;
    let archived = false;
    let capturedKey: Uint8Array | null = null;
    let capturedResponse: Uint8Array | null = null;

    const snapshotFor = (
        claim: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1
    ): D1ProbeCloudflareWorkerCanaryConsistencyV1 => ({
        schema_version: 1,
        kind: "untrusted_d1_probe_cloudflare_worker_api_canary_consistency",
        plan_digest: operation.plan.plan_digest,
        classification:
            claim.effect_phase === "dispatch_started"
                ? "ambiguous_dispatch"
                : finalMismatch
                  ? "state_ahead"
                  : "exact_sync",
        missing_component: null,
        corrupt_component: null,
        state_operation_revision: operation.revision,
        state_operation_state: operation.state,
        state_operation_record_digest: operationDigest,
        state_execution_nonce_commitment: nonceCommitment,
        driver_lease_generation: lease.generation,
        driver_lease_record_digest: leaseRecordDigest,
        driver_lease_state: lease.state,
        claim_journal_revision: claim.journal_revision,
        claim_digest: claim.claim_digest,
        claim_operation_revision: claim.operation_revision,
        claim_operation_state: claim.operation_state,
        claim_operation_record_digest: claim.operation_record_digest,
        claim_execution_nonce_commitment: claim.execution_nonce_commitment,
        claim_lease_generation: claim.lease_generation,
        claim_lease_record_digest: claim.lease_record_digest,
        claim_cleanup_obligation_digest: claim.cleanup_obligation_digest,
        claim_workflow_step: claim.workflow_step,
        claim_effect_phase: claim.effect_phase,
        claim_ambiguity_classification: claim.ambiguity_classification,
        response_claim_bindings:
            claim.effect_phase === "response_observed" &&
            claim.response_status !== null &&
            claim.response_digest !== null
                ? [
                      {
                          journal_revision: claim.journal_revision,
                          claim_digest: claim.claim_digest,
                          transcript_sequence: claim.transcript_sequence,
                          response_status: claim.response_status,
                          response_digest: claim.response_digest,
                          cleanup_obligation_digest: claim.cleanup_obligation_digest,
                      },
                  ]
                : [],
        ...authority,
    });
    const dependencies: D1ProbeCloudflareWorkerCanaryResponseClaimsTestOnlyDependenciesV1 = {
        create_dispatch_claims: async () => ({
            success: true,
            record_dispatch: async dispatchIntent => {
                events.push("record");
                expect(dispatchIntent).toEqual(
                    Object.freeze({
                        sequence: 1,
                        method: "GET",
                        path_digest: digest("b"),
                        request_digest: digest("c"),
                        window_class: windowClass,
                        intent_observed_at_ms: intentObservedAtMs,
                        dispatch_started_at_ms: dispatchStartedAtMs,
                    })
                );
            },
            caller_mutation_authority: false,
            authoritative: false,
            eligible_for_upload: false,
            eligible_for_attestation: false,
            lifecycle_advance_allowed: false,
            gate_promotion_allowed: false,
        }),
        assert_current_driver_lease: async () => {
            events.push("lease");
            leaseCalls += 1;
            if (leaseCalls === leaseFailureAt) return { success: false, code: "lease_expired" };
            return {
                success: true,
                lease,
            };
        },
        read_effect_journal: async () => {
            events.push("journal");
            if (headRaceAfterArchive && archived) {
                return { success: true, claims: currentClaims.slice(0, -1) };
            }
            return { success: true, claims: currentClaims };
        },
        read_consistency: async () => {
            events.push("heads");
            const head = currentClaims.at(-1);
            if (head === undefined) throw new Error("missing test head");
            return snapshotFor(head);
        },
        build_effect_claim: async draft => {
            events.push("build");
            return await buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1(draft);
        },
        archive_response_preimage: async (claimInput, _archiveContext, responseInput, keyInput) => {
            events.push("archive");
            archived = true;
            capturedResponse = responseInput as Uint8Array;
            capturedKey = keyInput as Uint8Array;
            if (archiveFailure) return { success: false, code: "archive_already_exists" };
            const claim = claimInput as D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1;
            return {
                success: true,
                receipt: {
                    schema_version: 1,
                    kind: "untrusted_d1_probe_cloudflare_worker_api_canary_response_archive_receipt",
                    plan_digest: claim.plan_digest,
                    cleanup_obligation_digest: claim.cleanup_obligation_digest,
                    claim_digest: claim.claim_digest,
                    journal_revision: claim.journal_revision,
                    transcript_sequence: claim.transcript_sequence,
                    response_digest: claim.response_digest as string,
                    archive_key_identifier: digest("8"),
                    plaintext_length: (responseInput as Uint8Array).byteLength,
                    archive_record_digest: digest("9"),
                    caller_mutation_authority: false,
                    cloudflare_origin_authenticated: false,
                    effect_claim_authenticated: false,
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
            currentClaims = [...currentClaims, claim];
            return appendSubstitution
                ? { success: true, claim: { ...claim, claim_digest: digest("7") } }
                : { success: true, claim };
        },
        read_cleanup_obligation: async () => ({ success: false, code: "obligation_not_found" }),
    };
    return {
        dependencies,
        events,
        started,
        setLeaseFailureAt: value => {
            leaseFailureAt = value;
        },
        setArchiveFailure: value => {
            archiveFailure = value;
        },
        setAppendFailure: value => {
            appendFailure = value;
        },
        setAppendSubstitution: value => {
            appendSubstitution = value;
        },
        setHeadRaceAfterArchive: value => {
            headRaceAfterArchive = value;
        },
        setFinalMismatch: value => {
            finalMismatch = value;
        },
        capturedArrays: () => ({ key: capturedKey, response: capturedResponse }),
    };
};

const adapterFor = async (
    operation: D1ProbeCloudflareWorkerCanaryOperationV1,
    dependencies: D1ProbeCloudflareWorkerCanaryResponseClaimsTestOnlyDependenciesV1,
    workflowStep: "prepared_worker_list" | "cleanup_worker_readback" = "prepared_worker_list"
) => {
    const result = await createD1ProbeCloudflareWorkerCanaryResponseClaimsWithDependenciesTestOnlyV1(
        {
            operation,
            driver_lease_owner: ownerFor(operation),
            workflow_step: workflowStep,
            archive_key: new Uint8Array(32).fill(41),
        },
        dependencies
    );
    if (!result.success) throw new Error(result.code);
    return result;
};

const bind = async (adapter: Awaited<ReturnType<typeof adapterFor>>): Promise<void> => {
    await adapter.record_dispatch_and_bind(dispatchIntent());
};

afterEach(() => vi.restoreAllMocks());

describe("Cloudflare Worker canary response claims", () => {
    it("carries the immutable cleanup obligation through dispatch, archive, and response claim", async () => {
        const preparedOperation = await prepared();
        const cleanupCommand = await compileD1ProbeCloudflareWorkerCanaryCleanupCommandV1(preparedOperation.plan, {
            worker_id: null,
            worker_id_commitment: null,
            attempt_tag_commitment: digest("a"),
        });
        if (!cleanupCommand.success) throw new Error(cleanupCommand.code);
        const compiledObligation = await compileD1ProbeCloudflareWorkerCanaryCleanupObligationV1(
            preparedOperation,
            cleanupCommand.command.cleanup_grace
        );
        if (!compiledObligation.success) throw new Error(compiledObligation.code);
        const shell = await transitionD1ProbeCloudflareWorkerCanaryOperationV1(
            preparedOperation,
            buildNextD1ProbeCloudflareWorkerCanaryOperationV1(
                preparedOperation,
                "shell_dispatching",
                preparedOperation.updated_at_ms + 1
            )
        );
        if (!shell.success) throw new Error(shell.code);
        const cleanup = await transitionD1ProbeCloudflareWorkerCanaryOperationV1(
            shell.operation,
            buildNextD1ProbeCloudflareWorkerCanaryOperationV1(
                shell.operation,
                "cleanup_reconciling",
                shell.operation.updated_at_ms + 1
            )
        );
        if (!cleanup.success) throw new Error(cleanup.code);
        const intentObservedAtMs = cleanup.operation.plan.expires_at_ms;
        const dispatchStartedAtMs = intentObservedAtMs + 1;
        const harness = await harnessFor(cleanup.operation, {
            workflow_step: "cleanup_worker_readback",
            request_kind: "inspect_cleanup",
            window_class: "cleanup",
            cleanup_obligation_digest: compiledObligation.obligation.obligation_digest,
            intent_observed_at_ms: intentObservedAtMs,
            dispatch_started_at_ms: dispatchStartedAtMs,
        });
        let obligationReads = 0;
        const dependencies: D1ProbeCloudflareWorkerCanaryResponseClaimsTestOnlyDependenciesV1 = {
            ...harness.dependencies,
            read_cleanup_obligation: async () => {
                obligationReads += 1;
                return { success: true, obligation: compiledObligation.obligation };
            },
        };
        const adapter = await adapterFor(cleanup.operation, dependencies, "cleanup_worker_readback");
        await adapter.record_dispatch_and_bind(
            dispatchIntent({
                window_class: "cleanup",
                intent_observed_at_ms: intentObservedAtMs,
                dispatch_started_at_ms: dispatchStartedAtMs,
            })
        );
        await expect(
            adapter.capture_response_preimage(
                context({ caller_asserted_response_observed_at_ms: dispatchStartedAtMs + 1 }),
                bytes
            )
        ).resolves.toBeUndefined();
        expect(obligationReads).toBeGreaterThanOrEqual(6);
        expect(harness.events).toContain("archive");
        expect(harness.events).toContain("append");
    });

    it("archives before append and ends on the exact response head", async () => {
        const operation = await prepared();
        const harness = await harnessFor(operation);
        const adapter = await adapterFor(operation, harness.dependencies);
        await bind(adapter);
        await expect(adapter.capture_response_preimage(context(), bytes)).resolves.toBeUndefined();
        expect(harness.events).toEqual([
            "record",
            "lease",
            "journal",
            "heads",
            "lease",
            "lease",
            "journal",
            "heads",
            "build",
            "lease",
            "archive",
            "lease",
            "journal",
            "heads",
            "lease",
            "append",
            "lease",
            "journal",
            "heads",
            "lease",
        ]);
        expect(harness.events.indexOf("archive")).toBeLessThan(harness.events.indexOf("append"));
        expect(harness.capturedArrays().key).not.toBeNull();
        expect([...harness.capturedArrays().key!]).toEqual(new Array(32).fill(0));
        expect([...harness.capturedArrays().response!]).toEqual(new Array(bytes.byteLength).fill(0));
        expect(adapter).toMatchObject({ success: true, authoritative: false, lifecycle_advance_allowed: false });
        expect(JSON.stringify(adapter)).not.toMatch(/owner|nonce|operation|archive_key|path|token/iu);
        expect(() => adapter.discard()).not.toThrow();
        expect(() => adapter.discard()).not.toThrow();
    });

    it.each([1, 2, 3, 4, 5, 6, 7, 8])("rejects lease loss at assertion %i", async failureAt => {
        const operation = await prepared();
        const harness = await harnessFor(operation);
        harness.setLeaseFailureAt(failureAt);
        const adapter = await adapterFor(operation, harness.dependencies);
        if (failureAt <= 2) {
            await expect(bind(adapter)).rejects.toThrow("response claim recording denied");
        } else {
            await bind(adapter);
            await expect(adapter.capture_response_preimage(context(), bytes)).rejects.toThrow(
                "response claim recording denied"
            );
        }
        expect(() => adapter.discard()).not.toThrow();
    });

    it.each([
        ["sequence", { transcript_sequence: 2 }],
        ["method", { request_method: "POST" as const }],
        ["request digest", { request_digest: digest("4") }],
        ["path digest", { request_path_digest: digest("5") }],
        ["backward response time", { caller_asserted_response_observed_at_ms: 10_010 }],
        ["expiry response time", { caller_asserted_response_observed_at_ms: 310_000 }],
        ["invalid status", { response_status: 99 }],
    ])("rejects %s substitution", async (_label, overrides) => {
        const operation = await prepared();
        const harness = await harnessFor(operation);
        const adapter = await adapterFor(operation, harness.dependencies);
        await bind(adapter);
        await expect(
            adapter.capture_response_preimage(
                context(overrides as Partial<D1ProbeCloudflareWorkerCanaryResponseCaptureContextV1>),
                bytes
            )
        ).rejects.toThrow("response claim recording denied");
        expect(harness.events).not.toContain("archive");
    });

    it("consumes before hostile context inspection and shares state across copied callbacks", async () => {
        const operation = await prepared();
        const harness = await harnessFor(operation);
        const adapter = await adapterFor(operation, harness.dependencies);
        await bind(adapter);
        const copied = adapter.capture_response_preimage;
        const hostile = new Proxy(context(), {
            ownKeys: () => {
                throw new Error("trap");
            },
        });
        await expect(copied(hostile, bytes)).rejects.toThrow("response claim recording denied");
        await expect(adapter.capture_response_preimage(context(), bytes)).rejects.toThrow(
            "response claim recording denied"
        );
        expect(harness.events).toEqual(["record", "lease", "journal", "heads", "lease"]);
        expect(() => adapter.discard()).not.toThrow();
    });

    it("supports unconditional idempotent discard before capture", async () => {
        const operation = await prepared();
        const harness = await harnessFor(operation);
        const adapter = await adapterFor(operation, harness.dependencies);
        adapter.discard();
        adapter.discard();
        await expect(adapter.record_dispatch_and_bind(dispatchIntent())).rejects.toThrow(
            "response claim recording denied"
        );
        await expect(adapter.capture_response_preimage(context(), bytes)).rejects.toThrow(
            "response claim recording denied"
        );
        expect(harness.events).toEqual([]);
    });

    it("burns the session when copied capture runs before record", async () => {
        const operation = await prepared();
        const harness = await harnessFor(operation);
        const adapter = await adapterFor(operation, harness.dependencies);
        const copied = adapter.capture_response_preimage;
        await expect(copied(context(), bytes)).rejects.toThrow("response claim recording denied");
        await expect(adapter.record_dispatch_and_bind(dispatchIntent())).rejects.toThrow(
            "response claim recording denied"
        );
        expect(harness.events).toEqual([]);
        expect(() => adapter.discard()).not.toThrow();
    });

    it("consumes a forged recorder call before inspecting its intent", async () => {
        const operation = await prepared();
        const harness = await harnessFor(operation);
        const adapter = await adapterFor(operation, harness.dependencies);
        await expect(adapter.record_dispatch_and_bind({ ...dispatchIntent() })).rejects.toThrow(
            "response claim recording denied"
        );
        await expect(adapter.record_dispatch_and_bind(dispatchIntent())).rejects.toThrow(
            "response claim recording denied"
        );
        expect(harness.events).toEqual([]);
        expect(() => adapter.discard()).not.toThrow();
    });

    it("shares one-use recorder state across copied callback references", async () => {
        const operation = await prepared();
        const harness = await harnessFor(operation);
        const adapter = await adapterFor(operation, harness.dependencies);
        const copied = adapter.record_dispatch_and_bind;
        await expect(copied(dispatchIntent())).resolves.toBeUndefined();
        await expect(adapter.record_dispatch_and_bind(dispatchIntent())).rejects.toThrow(
            "response claim recording denied"
        );
        expect(harness.events.filter(event => event === "record")).toHaveLength(1);
        await expect(adapter.capture_response_preimage(context(), bytes)).resolves.toBeUndefined();
    });

    it("honors discard requested while durable recording is in flight", async () => {
        const operation = await prepared();
        const harness = await harnessFor(operation);
        let releaseRecorder: () => void = () => undefined;
        const recorderGate = new Promise<void>(resolve => {
            releaseRecorder = resolve;
        });
        const dependencies: D1ProbeCloudflareWorkerCanaryResponseClaimsTestOnlyDependenciesV1 = {
            ...harness.dependencies,
            create_dispatch_claims: async () => ({
                success: true,
                record_dispatch: async () => {
                    harness.events.push("record:waiting");
                    await recorderGate;
                    harness.events.push("record:done");
                },
                caller_mutation_authority: false,
                authoritative: false,
                eligible_for_upload: false,
                eligible_for_attestation: false,
                lifecycle_advance_allowed: false,
                gate_promotion_allowed: false,
            }),
        };
        const adapter = await adapterFor(operation, dependencies);
        const recording = adapter.record_dispatch_and_bind(dispatchIntent());
        await vi.waitFor(() => expect(harness.events).toContain("record:waiting"));
        adapter.discard();
        releaseRecorder();
        await expect(recording).rejects.toThrow("response claim recording denied");
        expect(harness.events).toEqual(["record:waiting", "record:done"]);
        await expect(adapter.capture_response_preimage(context(), bytes)).rejects.toThrow(
            "response claim recording denied"
        );
        expect(() => adapter.discard()).not.toThrow();
    });

    it("stops before terminal append when discard is requested during archive publication", async () => {
        const operation = await prepared();
        const harness = await harnessFor(operation);
        let announceArchive: () => void = () => undefined;
        let releaseArchive: () => void = () => undefined;
        const archiveStarted = new Promise<void>(resolve => {
            announceArchive = resolve;
        });
        const archiveGate = new Promise<void>(resolve => {
            releaseArchive = resolve;
        });
        const archiveResponse = harness.dependencies.archive_response_preimage;
        const dependencies: D1ProbeCloudflareWorkerCanaryResponseClaimsTestOnlyDependenciesV1 = {
            ...harness.dependencies,
            archive_response_preimage: async (...args) => {
                announceArchive();
                await archiveGate;
                return await archiveResponse(...args);
            },
        };
        const adapter = await adapterFor(operation, dependencies);
        await bind(adapter);
        const capturing = adapter.capture_response_preimage(context(), bytes);
        await archiveStarted;
        adapter.discard();
        releaseArchive();
        await expect(capturing).rejects.toThrow("response claim recording denied");
        expect(harness.events).toContain("archive");
        expect(harness.events).not.toContain("append");
        expect([...harness.capturedArrays().key!]).toEqual(new Array(32).fill(0));
        expect([...harness.capturedArrays().response!]).toEqual(new Array(bytes.byteLength).fill(0));
        expect(() => adapter.discard()).not.toThrow();
    });

    it.each(["archive_denial", "append_failure", "append_substitution"] as const)(
        "keeps %s as a conservative denial",
        async fault => {
            const operation = await prepared();
            const harness = await harnessFor(operation);
            harness.setArchiveFailure(fault === "archive_denial");
            harness.setAppendFailure(fault === "append_failure");
            harness.setAppendSubstitution(fault === "append_substitution");
            const adapter = await adapterFor(operation, harness.dependencies);
            await bind(adapter);
            await expect(adapter.capture_response_preimage(context(), bytes)).rejects.toThrow(
                "response claim recording denied"
            );
            expect(() => adapter.discard()).not.toThrow();
            expect(harness.events).toContain("archive");
            expect([...harness.capturedArrays().key!]).toEqual(new Array(32).fill(0));
            expect([...harness.capturedArrays().response!]).toEqual(new Array(bytes.byteLength).fill(0));
        }
    );

    it("rejects a journal race after archive before append", async () => {
        const operation = await prepared();
        const harness = await harnessFor(operation);
        harness.setHeadRaceAfterArchive(true);
        const adapter = await adapterFor(operation, harness.dependencies);
        await bind(adapter);
        await expect(adapter.capture_response_preimage(context(), bytes)).rejects.toThrow(
            "response claim recording denied"
        );
        expect(harness.events).toContain("archive");
        expect(harness.events).not.toContain("append");
    });

    it("rejects a final consistency mismatch after append", async () => {
        const operation = await prepared();
        const harness = await harnessFor(operation);
        harness.setFinalMismatch(true);
        const adapter = await adapterFor(operation, harness.dependencies);
        await bind(adapter);
        await expect(adapter.capture_response_preimage(context(), bytes)).rejects.toThrow(
            "response claim recording denied"
        );
        expect(harness.events).toContain("append");
    });

    it("rejects unfrozen context, oversized bytes, and response digest substitution without I/O", async () => {
        const operation = await prepared();
        const cases: readonly [unknown, Uint8Array][] = [
            [{ ...context() }, bytes],
            [context(), new Uint8Array(256 * 1024 + 1)],
            [context({ response_digest: digest("6") }), bytes],
        ];
        for (const [captureContext, responseBytes] of cases) {
            const harness = await harnessFor(operation);
            const adapter = await adapterFor(operation, harness.dependencies);
            await bind(adapter);
            await expect(adapter.capture_response_preimage(captureContext as never, responseBytes)).rejects.toThrow(
                "response claim recording denied"
            );
            expect(harness.events).toEqual(["record", "lease", "journal", "heads", "lease"]);
        }
    });

    it("never calls fetch and denies forged owner or workflow input", async () => {
        const operation = await prepared();
        const harness = await harnessFor(operation);
        const fetchSpy = vi.spyOn(globalThis, "fetch");
        await expect(
            createD1ProbeCloudflareWorkerCanaryResponseClaimsWithDependenciesTestOnlyV1(
                {
                    operation,
                    driver_lease_owner: { ...ownerFor(operation), execution_nonce: "00".repeat(16) },
                    workflow_step: "prepared_worker_list",
                    archive_key: new Uint8Array(32),
                },
                harness.dependencies
            )
        ).resolves.toMatchObject({ success: false, authoritative: false });
        await expect(
            createD1ProbeCloudflareWorkerCanaryResponseClaimsWithDependenciesTestOnlyV1(
                {
                    operation,
                    driver_lease_owner: ownerFor(operation),
                    workflow_step: "shell_create",
                    archive_key: new Uint8Array(32),
                },
                harness.dependencies
            )
        ).resolves.toMatchObject({ success: false, authoritative: false });
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("rejects a started head at the journal capacity boundary before archive", async () => {
        const operation = await prepared();
        const harness = await harnessFor(operation);
        const { claim_digest: _startedDigest, ...startedDraft } = harness.started;
        const fullStarted = await buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1({
            ...startedDraft,
            journal_revision: 255,
            previous_claim_digest: digest("1"),
        });
        if (fullStarted === null) throw new Error("capacity fixture unavailable");
        const dependencies = {
            ...harness.dependencies,
            read_effect_journal: async () => ({ success: true as const, claims: [fullStarted] }),
        };
        const adapter = await adapterFor(operation, dependencies);
        await expect(bind(adapter)).rejects.toThrow("response claim recording denied");
        expect(harness.events).not.toContain("archive");
    });
});
