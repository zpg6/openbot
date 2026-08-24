import { afterEach, describe, expect, it, vi } from "vitest";

import {
    buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1,
    digestD1ProbeCloudflareWorkerCanaryOperationRecordV1,
    type D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
} from "./cloudflare-worker-canary-effect-journal.js";
import {
    createD1ProbeCloudflareWorkerCanaryDispatchClaimsWithDependenciesTestOnlyV1,
    type D1ProbeCloudflareWorkerCanaryDispatchClaimsTestOnlyDependenciesV1,
} from "./cloudflare-worker-canary-dispatch-claims.js";
import type { D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1 } from "./cloudflare-worker-canary-driver-lease.js";
import type { D1ProbeCloudflareWorkerCanaryConsistencyV1 } from "./cloudflare-worker-canary-consistency.js";
import {
    prepareD1ProbeCloudflareWorkerCanaryOperationV1,
    type D1ProbeCloudflareWorkerCanaryOperationV1,
} from "./cloudflare-worker-canary-operation.js";
import { generateD1ProbeCloudflareWorkerApiCanaryCommandV1 } from "./cloudflare-worker-canary-plan.js";
import {
    createD1ProbeCloudflareWorkerCanaryTransportV1,
    type D1ProbeCloudflareWorkerCanaryDispatchIntentV1,
} from "./cloudflare-worker-canary-transport.js";

const hmacKey = globalThis
    .btoa(String.fromCharCode(...new Uint8Array(32).fill(37)))
    .replace(/=/gu, "")
    .replace(/\+/gu, "-")
    .replace(/\//gu, "_");
const digest = (character: string): string => character.repeat(64);

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

const canaryIntent = (overrides: Partial<D1ProbeCloudflareWorkerCanaryDispatchIntentV1> = {}) => ({
    sequence: 1,
    method: "GET" as const,
    path_digest: digest("b"),
    request_digest: digest("c"),
    window_class: "forward" as const,
    intent_observed_at_ms: 10_010,
    dispatch_started_at_ms: 10_011,
    ...overrides,
});

interface HarnessV1 {
    readonly dependencies: D1ProbeCloudflareWorkerCanaryDispatchClaimsTestOnlyDependenciesV1;
    readonly events: string[];
    readonly claims: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1[];
    readonly setLeaseFailureAt: (call: number) => void;
    readonly setAppendFailureAt: (call: number) => void;
    readonly setAfterIntent: (snapshot: D1ProbeCloudflareWorkerCanaryConsistencyV1) => void;
    readonly missing: D1ProbeCloudflareWorkerCanaryConsistencyV1;
    readonly intentSnapshot: (
        claim: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1
    ) => D1ProbeCloudflareWorkerCanaryConsistencyV1;
}

const authority = {
    effect_claims_authenticated: false as const,
    caller_mutation_authority: false as const,
    authoritative: false as const,
    eligible_for_upload: false as const,
    eligible_for_attestation: false as const,
    lifecycle_advance_allowed: false as const,
    gate_promotion_allowed: false as const,
};

const harnessFor = async (operation: D1ProbeCloudflareWorkerCanaryOperationV1): Promise<HarnessV1> => {
    const owner = ownerFor(operation);
    const [operationDigest, nonceCommitment] = await Promise.all([
        digestD1ProbeCloudflareWorkerCanaryOperationRecordV1(operation),
        commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1(operation.execution_nonce),
    ]);
    if (operationDigest === null || nonceCommitment === null) throw new Error("test commitment unavailable");
    const events: string[] = [];
    const claims: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1[] = [];
    let leaseCalls = 0;
    let appendCalls = 0;
    let leaseFailureAt = 0;
    let appendFailureAt = 0;
    const missing: D1ProbeCloudflareWorkerCanaryConsistencyV1 = {
        schema_version: 1,
        kind: "untrusted_d1_probe_cloudflare_worker_api_canary_consistency",
        plan_digest: operation.plan.plan_digest,
        classification: "missing",
        missing_component: "effect_journal",
        corrupt_component: null,
        state_operation_revision: operation.revision,
        state_operation_state: operation.state,
        state_operation_record_digest: operationDigest,
        state_execution_nonce_commitment: nonceCommitment,
        claim_journal_revision: null,
        claim_digest: null,
        claim_operation_revision: null,
        claim_operation_state: null,
        claim_operation_record_digest: null,
        claim_execution_nonce_commitment: null,
        claim_workflow_step: null,
        claim_effect_phase: null,
        claim_ambiguity_classification: null,
        ...authority,
    };
    const intentSnapshot = (
        claim: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1
    ): D1ProbeCloudflareWorkerCanaryConsistencyV1 => ({
        ...missing,
        classification: "claim_behind",
        missing_component: null,
        claim_journal_revision: claim.journal_revision,
        claim_digest: claim.claim_digest,
        claim_operation_revision: claim.operation_revision,
        claim_operation_state: claim.operation_state,
        claim_operation_record_digest: claim.operation_record_digest,
        claim_execution_nonce_commitment: claim.execution_nonce_commitment,
        claim_workflow_step: claim.workflow_step,
        claim_effect_phase: claim.effect_phase,
        claim_ambiguity_classification: claim.ambiguity_classification,
    });
    let current = missing;
    const dependencies: D1ProbeCloudflareWorkerCanaryDispatchClaimsTestOnlyDependenciesV1 = {
        assert_current_driver_lease: async () => {
            events.push("lease");
            leaseCalls += 1;
            if (leaseCalls === leaseFailureAt) return { success: false, code: "lease_expired" };
            return {
                success: true,
                lease: {
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
                },
            };
        },
        read_consistency: async () => {
            events.push("heads");
            return current;
        },
        build_effect_claim: async draft => {
            events.push(`build:${draft.effect_phase}`);
            return await buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1(draft);
        },
        append_effect_claim: async claim => {
            events.push(`append:${claim.effect_phase}`);
            appendCalls += 1;
            if (appendCalls === appendFailureAt) return { success: false, code: "journal_io_unavailable" };
            claims.push(claim);
            if (claim.effect_phase === "dispatch_intent") current = intentSnapshot(claim);
            if (claim.effect_phase === "dispatch_started") {
                current = { ...intentSnapshot(claim), classification: "ambiguous_dispatch" };
            }
            return { success: true, claim };
        },
    };
    return {
        dependencies,
        events,
        claims,
        setLeaseFailureAt: call => {
            leaseFailureAt = call;
        },
        setAppendFailureAt: call => {
            appendFailureAt = call;
        },
        setAfterIntent: snapshot => {
            current = snapshot;
        },
        missing,
        intentSnapshot,
    };
};

const makeAdapter = async (
    operation: D1ProbeCloudflareWorkerCanaryOperationV1,
    dependencies: D1ProbeCloudflareWorkerCanaryDispatchClaimsTestOnlyDependenciesV1,
    workflowStep = "prepared_worker_list"
) => {
    const result = await createD1ProbeCloudflareWorkerCanaryDispatchClaimsWithDependenciesTestOnlyV1(
        { operation, driver_lease_owner: ownerFor(operation), workflow_step: workflowStep },
        dependencies
    );
    if (!result.success) throw new Error(result.code);
    return result;
};

afterEach(() => vi.restoreAllMocks());

describe("Cloudflare Worker canary dispatch claims", () => {
    it("records the exact intent and start in the fenced order", async () => {
        const operation = await prepared();
        const harness = await harnessFor(operation);
        const adapter = await makeAdapter(operation, harness.dependencies);
        await expect(adapter.record_dispatch(canaryIntent())).resolves.toBeUndefined();
        expect(harness.events).toEqual([
            "lease",
            "heads",
            "build:dispatch_intent",
            "append:dispatch_intent",
            "lease",
            "heads",
            "build:dispatch_started",
            "append:dispatch_started",
            "lease",
            "heads",
            "lease",
        ]);
        expect(harness.claims).toHaveLength(2);
        expect(harness.claims[0]).toMatchObject({
            journal_revision: 0,
            previous_claim_digest: null,
            transcript_sequence: 1,
            effect_phase: "dispatch_intent",
            intent_observed_at_ms: 10_010,
            dispatch_started_at_ms: null,
            workflow_step: "prepared_worker_list",
            request_method: "GET",
            request_digest: digest("c"),
            request_path_digest: digest("b"),
        });
        expect(harness.claims[1]).toMatchObject({
            journal_revision: 1,
            previous_claim_digest: harness.claims[0]?.claim_digest,
            effect_phase: "dispatch_started",
            intent_observed_at_ms: 10_010,
            dispatch_started_at_ms: 10_011,
        });
        expect(adapter).toMatchObject({
            success: true,
            caller_mutation_authority: false,
            authoritative: false,
            lifecycle_advance_allowed: false,
            gate_promotion_allowed: false,
        });
        expect(JSON.stringify(adapter)).not.toMatch(/owner|nonce|operation|path|token/iu);
    });

    it.each([1, 2, 3, 4])("rejects lease expiry or takeover at assertion %i", async failureAt => {
        const operation = await prepared();
        const harness = await harnessFor(operation);
        harness.setLeaseFailureAt(failureAt);
        const adapter = await makeAdapter(operation, harness.dependencies);
        await expect(adapter.record_dispatch(canaryIntent())).rejects.toThrow("dispatch claim recording denied");
        expect(harness.events.filter(event => event.startsWith("append:"))).toHaveLength(
            failureAt === 1 ? 0 : failureAt === 2 ? 1 : 2
        );
    });

    it("rejects state or journal head drift after intent", async () => {
        const operation = await prepared();
        const harness = await harnessFor(operation);
        const originalAppend = harness.dependencies.append_effect_claim;
        const dependencies = {
            ...harness.dependencies,
            append_effect_claim: async (claim: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1) => {
                const result = await originalAppend(claim);
                if (claim.effect_phase === "dispatch_intent") {
                    harness.setAfterIntent({
                        ...harness.intentSnapshot(claim),
                        state_operation_record_digest: digest("9"),
                    });
                }
                return result;
            },
        };
        const adapter = await makeAdapter(operation, dependencies);
        await expect(adapter.record_dispatch(canaryIntent())).rejects.toThrow("dispatch claim recording denied");
        expect(harness.claims.map(claim => claim.effect_phase)).toEqual(["dispatch_intent"]);
    });

    it.each([1, 2])("rejects append failure %i", async failureAt => {
        const operation = await prepared();
        const harness = await harnessFor(operation);
        harness.setAppendFailureAt(failureAt);
        const adapter = await makeAdapter(operation, harness.dependencies);
        await expect(adapter.record_dispatch(canaryIntent())).rejects.toThrow("dispatch claim recording denied");
    });

    it("rejects operation revision substitution in the post-intent head", async () => {
        const operation = await prepared();
        const harness = await harnessFor(operation);
        const originalAppend = harness.dependencies.append_effect_claim;
        const dependencies = {
            ...harness.dependencies,
            append_effect_claim: async (claim: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1) => {
                const result = await originalAppend(claim);
                if (claim.effect_phase === "dispatch_intent") {
                    harness.setAfterIntent({ ...harness.intentSnapshot(claim), claim_operation_revision: 1 });
                }
                return result;
            },
        };
        const adapter = await makeAdapter(operation, dependencies);
        await expect(adapter.record_dispatch(canaryIntent())).rejects.toThrow("dispatch claim recording denied");
        expect(harness.claims).toHaveLength(1);
    });

    it.each(["state_drift", "journal_substitution", "unstable", "corrupt"] as const)(
        "rejects %s after dispatch_started before fetch",
        async fault => {
            const operation = await prepared();
            const harness = await harnessFor(operation);
            const originalAppend = harness.dependencies.append_effect_claim;
            const dependencies = {
                ...harness.dependencies,
                append_effect_claim: async (claim: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1) => {
                    const result = await originalAppend(claim);
                    if (claim.effect_phase === "dispatch_started") {
                        const exact = {
                            ...harness.intentSnapshot(claim),
                            classification: "ambiguous_dispatch" as const,
                        };
                        harness.setAfterIntent(
                            fault === "state_drift"
                                ? { ...exact, state_operation_record_digest: digest("8") }
                                : fault === "journal_substitution"
                                  ? { ...exact, claim_digest: digest("7"), claim_effect_phase: "response_observed" }
                                  : fault === "unstable"
                                    ? { ...exact, classification: "unstable" }
                                    : { ...exact, classification: "corrupt", corrupt_component: "bindings" }
                        );
                    }
                    return result;
                },
            };
            const fetchSpy = vi.spyOn(globalThis, "fetch");
            const adapter = await makeAdapter(operation, dependencies);
            await expect(adapter.record_dispatch(canaryIntent())).rejects.toThrow("dispatch claim recording denied");
            expect(fetchSpy).not.toHaveBeenCalled();
            expect(harness.claims.map(claim => claim.effect_phase)).toEqual(["dispatch_intent", "dispatch_started"]);
        }
    );

    it("rejects workflow, method, and window mismatches", async () => {
        const operation = await prepared();
        const harness = await harnessFor(operation);
        await expect(
            createD1ProbeCloudflareWorkerCanaryDispatchClaimsWithDependenciesTestOnlyV1(
                { operation, driver_lease_owner: ownerFor(operation), workflow_step: "shell_create" },
                harness.dependencies
            )
        ).resolves.toMatchObject({ success: false, authoritative: false });
        const adapter = await makeAdapter(operation, harness.dependencies);
        await expect(adapter.record_dispatch(canaryIntent({ method: "POST" }))).rejects.toThrow(
            "dispatch claim recording denied"
        );
        const second = await makeAdapter(operation, harness.dependencies);
        await expect(second.record_dispatch(canaryIntent({ window_class: "cleanup" }))).rejects.toThrow(
            "dispatch claim recording denied"
        );
        expect(harness.claims).toHaveLength(0);
    });

    it("consumes before hostile input inspection and rejects reuse", async () => {
        const operation = await prepared();
        const harness = await harnessFor(operation);
        const adapter = await makeAdapter(operation, harness.dependencies);
        const hostile = new Proxy(canaryIntent(), {
            ownKeys: () => {
                throw new Error("trap");
            },
        });
        await expect(adapter.record_dispatch(hostile)).rejects.toThrow("dispatch claim recording denied");
        await expect(adapter.record_dispatch(canaryIntent())).rejects.toThrow("dispatch claim recording denied");
        expect(harness.events).toEqual([]);
    });

    it("shares one-use state across copied callback references", async () => {
        const operation = await prepared();
        const harness = await harnessFor(operation);
        const adapter = await makeAdapter(operation, harness.dependencies);
        const copied = adapter.record_dispatch;
        await expect(copied(canaryIntent())).resolves.toBeUndefined();
        await expect(adapter.record_dispatch(canaryIntent())).rejects.toThrow("dispatch claim recording denied");
        expect(harness.claims).toHaveLength(2);
    });

    it("rejects forged owner context and backward hook timing", async () => {
        const operation = await prepared();
        const harness = await harnessFor(operation);
        await expect(
            createD1ProbeCloudflareWorkerCanaryDispatchClaimsWithDependenciesTestOnlyV1(
                {
                    operation,
                    driver_lease_owner: { ...ownerFor(operation), execution_nonce: "00".repeat(16) },
                    workflow_step: "prepared_worker_list",
                },
                harness.dependencies
            )
        ).resolves.toMatchObject({ success: false, authoritative: false });
        const adapter = await makeAdapter(operation, harness.dependencies);
        await expect(adapter.record_dispatch(canaryIntent({ dispatch_started_at_ms: 10_009 }))).rejects.toThrow(
            "dispatch claim recording denied"
        );
        expect(harness.events).toEqual([]);
    });

    it.each([
        { label: "intent before plan", intent: 9_999, started: 10_001 },
        { label: "intent before persisted operation", intent: 10_000, started: 10_001 },
        { label: "start at plan expiry", intent: 10_010, started: 310_000 },
    ])("rejects $label before lease or journal access", async ({ intent, started }) => {
        const operation = await prepared();
        const harness = await harnessFor(operation);
        const adapter = await makeAdapter(operation, harness.dependencies);
        await expect(
            adapter.record_dispatch(canaryIntent({ intent_observed_at_ms: intent, dispatch_started_at_ms: started }))
        ).rejects.toThrow("dispatch claim recording denied");
        expect(harness.events).toEqual([]);
    });

    it.each([
        { label: "exact lower bound", time: 10_001 },
        { label: "last millisecond", time: 309_999 },
    ])("accepts $label timing", async ({ time }) => {
        const operation = await prepared();
        const harness = await harnessFor(operation);
        const adapter = await makeAdapter(operation, harness.dependencies);
        await expect(
            adapter.record_dispatch(canaryIntent({ intent_observed_at_ms: time, dispatch_started_at_ms: time }))
        ).resolves.toBeUndefined();
    });

    it("rejects cleanup workflows until a persisted grace window is bound", async () => {
        const preparedOperation = await prepared();
        const cleanupOperation = {
            ...preparedOperation,
            revision: 1,
            state: "cleanup_reconciling" as const,
            updated_at_ms: 10_002,
        };
        const harness = await harnessFor(cleanupOperation);
        await expect(
            createD1ProbeCloudflareWorkerCanaryDispatchClaimsWithDependenciesTestOnlyV1(
                {
                    operation: cleanupOperation,
                    driver_lease_owner: ownerFor(cleanupOperation),
                    workflow_step: "cleanup_worker_readback",
                },
                harness.dependencies
            )
        ).resolves.toMatchObject({ success: false, authoritative: false });
        expect(harness.events).toEqual([]);
    });

    it("prevents fetch when durable recording rejects", async () => {
        const operation = await prepared();
        const harness = await harnessFor(operation);
        harness.setLeaseFailureAt(1);
        const adapter = await makeAdapter(operation, harness.dependencies);
        const fetch = vi.fn<typeof globalThis.fetch>();
        const transport = createD1ProbeCloudflareWorkerCanaryTransportV1({
            api_token: "test-only-token",
            fetch,
            now: () => 10_010,
            forward_window: { not_before_ms: 10_000, expires_at_ms: 20_000 },
            cleanup_window: { not_before_ms: 10_000, expires_at_ms: 20_000 },
        });
        const request = await transport.prepare.forward.get("/accounts/redacted/workers/scripts");
        if (request === null) throw new Error("test request was not prepared");
        await expect(transport.dispatch(request, adapter.record_dispatch)).resolves.toEqual({
            ok: false,
            status: null,
        });
        expect(fetch).not.toHaveBeenCalled();
    });
});
