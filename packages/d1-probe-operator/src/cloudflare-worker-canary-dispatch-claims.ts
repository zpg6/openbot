import {
    appendD1ProbeCloudflareWorkerCanaryEffectJournalV1,
    buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1,
    digestD1ProbeCloudflareWorkerCanaryOperationRecordV1,
    type D1ProbeCloudflareWorkerCanaryEffectJournalAppendResultV1,
    type D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1,
    type D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
} from "./cloudflare-worker-canary-effect-journal.js";
import {
    assertCurrentD1ProbeCloudflareWorkerCanaryDriverLeaseV1,
    type D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1,
    type D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1,
} from "./cloudflare-worker-canary-driver-lease.js";
import {
    readD1ProbeCloudflareWorkerCanaryConsistencyV1,
    type D1ProbeCloudflareWorkerCanaryConsistencyV1,
} from "./cloudflare-worker-canary-consistency.js";
import {
    validateD1ProbeCloudflareWorkerCanaryOperationV1,
    type D1ProbeCloudflareWorkerCanaryOperationV1,
} from "./cloudflare-worker-canary-operation.js";
import type {
    D1ProbeCloudflareWorkerCanaryDispatchIntentV1,
    D1ProbeCloudflareWorkerCanaryRecordDispatchV1,
} from "./cloudflare-worker-canary-transport.js";

const DigestV1 = /^[0-9a-f]{64}$/u;
const ExecutionNonceV1 = /^[0-9a-f]{32}$/u;
const OwnerNonceV1 = /^[A-Za-z0-9_-]{43}$/u;

const workflowBindings = {
    prepared_worker_list: {
        request_kind: "inspect_worker",
        request_method: "GET",
        operation_state: "prepared",
        window_class: "forward",
    },
    shell_create: {
        request_kind: "create_worker",
        request_method: "POST",
        operation_state: "shell_dispatching",
        window_class: "forward",
    },
    shell_dispatch_reconciliation: {
        request_kind: "inspect_worker",
        request_method: "GET",
        operation_state: "shell_dispatching",
        window_class: "forward",
    },
    shell_readback: {
        request_kind: "inspect_worker",
        request_method: "GET",
        operation_state: "shell_identified",
        window_class: "forward",
    },
    version_create: {
        request_kind: "create_version",
        request_method: "POST",
        operation_state: "version_dispatching",
        window_class: "forward",
    },
    version_dispatch_reconciliation: {
        request_kind: "inspect_worker",
        request_method: "GET",
        operation_state: "version_dispatching",
        window_class: "forward",
    },
    version_readback: {
        request_kind: "inspect_worker",
        request_method: "GET",
        operation_state: "version_identified",
        window_class: "forward",
    },
    deployment_create: {
        request_kind: "create_deployment",
        request_method: "POST",
        operation_state: "deployment_dispatching",
        window_class: "forward",
    },
    deployment_dispatch_reconciliation: {
        request_kind: "inspect_worker",
        request_method: "GET",
        operation_state: "deployment_dispatching",
        window_class: "forward",
    },
    deployment_readback: {
        request_kind: "inspect_worker",
        request_method: "GET",
        operation_state: "deployment_identified",
        window_class: "forward",
    },
} as const;

type WorkflowStepV1 = keyof typeof workflowBindings;

export interface D1ProbeCloudflareWorkerCanaryDispatchClaimsInputV1 {
    readonly operation: unknown;
    readonly driver_lease_owner: unknown;
    readonly workflow_step: unknown;
}

interface DispatchClaimsAuthorityV1 {
    readonly caller_mutation_authority: false;
    readonly authoritative: false;
    readonly eligible_for_upload: false;
    readonly eligible_for_attestation: false;
    readonly lifecycle_advance_allowed: false;
    readonly gate_promotion_allowed: false;
}

export type D1ProbeCloudflareWorkerCanaryDispatchClaimsResultV1 =
    | ({ readonly success: false; readonly code: "invalid_dispatch_claim_context" } & DispatchClaimsAuthorityV1)
    | ({
          readonly success: true;
          readonly record_dispatch: D1ProbeCloudflareWorkerCanaryRecordDispatchV1;
      } & DispatchClaimsAuthorityV1);

export interface D1ProbeCloudflareWorkerCanaryDispatchClaimsTestOnlyDependenciesV1 {
    readonly assert_current_driver_lease: (
        owner: D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1
    ) => Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1>;
    readonly read_consistency: (planDigest: string) => Promise<D1ProbeCloudflareWorkerCanaryConsistencyV1>;
    readonly build_effect_claim: (
        draft: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1
    ) => Promise<D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1 | null>;
    readonly append_effect_claim: (
        claim: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1
    ) => Promise<D1ProbeCloudflareWorkerCanaryEffectJournalAppendResultV1>;
}

const authority = Object.freeze({
    caller_mutation_authority: false,
    authoritative: false,
    eligible_for_upload: false,
    eligible_for_attestation: false,
    lifecycle_advance_allowed: false,
    gate_promotion_allowed: false,
} as const);

const fixedDependencies: D1ProbeCloudflareWorkerCanaryDispatchClaimsTestOnlyDependenciesV1 = {
    assert_current_driver_lease: assertCurrentD1ProbeCloudflareWorkerCanaryDriverLeaseV1,
    read_consistency: readD1ProbeCloudflareWorkerCanaryConsistencyV1,
    build_effect_claim: buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    append_effect_claim: appendD1ProbeCloudflareWorkerCanaryEffectJournalV1,
};

const exactKeys = (input: Record<string, unknown>, keys: readonly string[]): boolean => {
    const actual = Object.keys(input).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const safeClone = (input: unknown): unknown | null => {
    try {
        return structuredClone(input);
    } catch {
        return null;
    }
};

const ownerFrom = (input: unknown): D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1 | null => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
    const owner = input as Record<string, unknown>;
    if (!exactKeys(owner, ["plan_digest", "execution_nonce", "generation", "owner_pid", "owner_nonce"])) {
        return null;
    }
    if (
        typeof owner["plan_digest"] !== "string" ||
        !DigestV1.test(owner["plan_digest"]) ||
        typeof owner["execution_nonce"] !== "string" ||
        !ExecutionNonceV1.test(owner["execution_nonce"]) ||
        !Number.isSafeInteger(owner["generation"]) ||
        (owner["generation"] as number) < 0 ||
        !Number.isSafeInteger(owner["owner_pid"]) ||
        (owner["owner_pid"] as number) <= 0 ||
        (owner["owner_pid"] as number) > 2_147_483_647 ||
        typeof owner["owner_nonce"] !== "string" ||
        !OwnerNonceV1.test(owner["owner_nonce"])
    ) {
        return null;
    }
    return Object.freeze(owner) as unknown as D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1;
};

const intentFrom = (input: unknown): D1ProbeCloudflareWorkerCanaryDispatchIntentV1 | null => {
    const cloned = safeClone(input);
    if (typeof cloned !== "object" || cloned === null || Array.isArray(cloned)) return null;
    const intent = cloned as Record<string, unknown>;
    if (
        !exactKeys(intent, [
            "sequence",
            "method",
            "path_digest",
            "request_digest",
            "window_class",
            "intent_observed_at_ms",
            "dispatch_started_at_ms",
        ]) ||
        !Number.isSafeInteger(intent["sequence"]) ||
        (intent["sequence"] as number) <= 0 ||
        !["GET", "POST", "DELETE"].includes(intent["method"] as string) ||
        typeof intent["path_digest"] !== "string" ||
        !DigestV1.test(intent["path_digest"]) ||
        typeof intent["request_digest"] !== "string" ||
        !DigestV1.test(intent["request_digest"]) ||
        !["forward", "cleanup"].includes(intent["window_class"] as string) ||
        !Number.isSafeInteger(intent["intent_observed_at_ms"]) ||
        (intent["intent_observed_at_ms"] as number) < 0 ||
        !Number.isSafeInteger(intent["dispatch_started_at_ms"]) ||
        (intent["dispatch_started_at_ms"] as number) < (intent["intent_observed_at_ms"] as number)
    ) {
        return null;
    }
    return Object.freeze(intent) as unknown as D1ProbeCloudflareWorkerCanaryDispatchIntentV1;
};

const exactAuthority = (snapshot: D1ProbeCloudflareWorkerCanaryConsistencyV1): boolean =>
    snapshot.effect_claims_authenticated === false &&
    snapshot.caller_mutation_authority === false &&
    snapshot.authoritative === false &&
    snapshot.eligible_for_upload === false &&
    snapshot.eligible_for_attestation === false &&
    snapshot.lifecycle_advance_allowed === false &&
    snapshot.gate_promotion_allowed === false;

const exactOperationHead = (
    snapshot: D1ProbeCloudflareWorkerCanaryConsistencyV1,
    operation: D1ProbeCloudflareWorkerCanaryOperationV1,
    operationDigest: string,
    nonceCommitment: string
): boolean =>
    snapshot.plan_digest === operation.plan.plan_digest &&
    snapshot.state_operation_revision === operation.revision &&
    snapshot.state_operation_state === operation.state &&
    snapshot.state_operation_record_digest === operationDigest &&
    snapshot.state_execution_nonce_commitment === nonceCommitment &&
    exactAuthority(snapshot);

const exactClaimHead = (
    snapshot: D1ProbeCloudflareWorkerCanaryConsistencyV1,
    claim: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1
): boolean =>
    snapshot.claim_journal_revision === claim.journal_revision &&
    snapshot.claim_digest === claim.claim_digest &&
    snapshot.claim_operation_revision === claim.operation_revision &&
    snapshot.claim_operation_state === claim.operation_state &&
    snapshot.claim_operation_record_digest === claim.operation_record_digest &&
    snapshot.claim_execution_nonce_commitment === claim.execution_nonce_commitment &&
    snapshot.claim_workflow_step === claim.workflow_step &&
    snapshot.claim_effect_phase === claim.effect_phase &&
    snapshot.claim_ambiguity_classification === claim.ambiguity_classification;

const assertLease = async (
    dependencies: D1ProbeCloudflareWorkerCanaryDispatchClaimsTestOnlyDependenciesV1,
    owner: D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1
): Promise<boolean> => {
    const result = await dependencies.assert_current_driver_lease(owner);
    return (
        result.success &&
        result.lease.state === "active" &&
        result.lease.plan_digest === owner.plan_digest &&
        result.lease.generation === owner.generation &&
        result.lease.owner_pid === owner.owner_pid
    );
};

const makeDraft = (
    operation: D1ProbeCloudflareWorkerCanaryOperationV1,
    operationDigest: string,
    nonceCommitment: string,
    workflowStep: WorkflowStepV1,
    intent: D1ProbeCloudflareWorkerCanaryDispatchIntentV1,
    journalRevision: number,
    previousClaimDigest: string | null,
    phase: "dispatch_intent" | "dispatch_started"
): D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1 => ({
    schema_version: 1,
    kind: "d1_probe_cloudflare_worker_api_canary_untrusted_effect_claim",
    journal_revision: journalRevision,
    previous_claim_digest: previousClaimDigest,
    plan_digest: operation.plan.plan_digest,
    operation_revision: operation.revision,
    operation_state: operation.state,
    operation_record_digest: operationDigest,
    execution_nonce_commitment: nonceCommitment,
    workflow_step: workflowStep,
    request_kind: workflowBindings[workflowStep].request_kind,
    request_method: workflowBindings[workflowStep].request_method,
    transcript_sequence: intent.sequence,
    effect_phase: phase,
    intent_observed_at_ms: intent.intent_observed_at_ms,
    dispatch_started_at_ms: phase === "dispatch_intent" ? null : intent.dispatch_started_at_ms,
    request_digest: intent.request_digest,
    request_path_digest: intent.path_digest,
    response_status: null,
    response_digest: null,
    ambiguity_classification: phase === "dispatch_intent" ? "not_dispatched" : "may_have_dispatched",
    ...authority,
});

const denied = (): D1ProbeCloudflareWorkerCanaryDispatchClaimsResultV1 => ({
    success: false,
    code: "invalid_dispatch_claim_context",
    ...authority,
});

const failDispatch = (): never => {
    throw new Error("Cloudflare Worker canary dispatch claim recording denied");
};

const createWithDependencies = async (
    input: D1ProbeCloudflareWorkerCanaryDispatchClaimsInputV1,
    dependencies: D1ProbeCloudflareWorkerCanaryDispatchClaimsTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryDispatchClaimsResultV1> => {
    const cloned = safeClone(input);
    if (typeof cloned !== "object" || cloned === null || Array.isArray(cloned)) return denied();
    const context = cloned as Record<string, unknown>;
    if (!exactKeys(context, ["operation", "driver_lease_owner", "workflow_step"])) return denied();
    const operation = await validateD1ProbeCloudflareWorkerCanaryOperationV1(context["operation"]);
    const owner = ownerFrom(context["driver_lease_owner"]);
    const workflowStep =
        typeof context["workflow_step"] === "string" && context["workflow_step"] in workflowBindings
            ? (context["workflow_step"] as WorkflowStepV1)
            : null;
    if (
        operation === null ||
        owner === null ||
        workflowStep === null ||
        owner.plan_digest !== operation.plan.plan_digest ||
        owner.execution_nonce !== operation.execution_nonce ||
        workflowBindings[workflowStep].operation_state !== operation.state
    ) {
        return denied();
    }
    const [operationDigest, nonceCommitment] = await Promise.all([
        digestD1ProbeCloudflareWorkerCanaryOperationRecordV1(operation),
        commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1(operation.execution_nonce),
    ]);
    if (operationDigest === null || nonceCommitment === null) return denied();

    let consumed = false;
    const recordDispatch: D1ProbeCloudflareWorkerCanaryRecordDispatchV1 = async intentInput => {
        if (consumed) failDispatch();
        consumed = true;
        try {
            const intent = intentFrom(intentInput);
            const binding = workflowBindings[workflowStep];
            if (intent === null) throw new Error("invalid dispatch intent");
            if (
                intent.method !== binding.request_method ||
                intent.window_class !== binding.window_class ||
                intent.intent_observed_at_ms < Math.max(operation.plan.not_before_ms, operation.updated_at_ms) ||
                intent.dispatch_started_at_ms >= operation.plan.expires_at_ms ||
                !(await assertLease(dependencies, owner))
            ) {
                failDispatch();
            }
            const before = await dependencies.read_consistency(operation.plan.plan_digest);
            if (!exactOperationHead(before, operation, operationDigest, nonceCommitment)) failDispatch();
            const journalMissing =
                before.classification === "missing" &&
                before.missing_component === "effect_journal" &&
                before.claim_journal_revision === null &&
                before.claim_digest === null &&
                operation.revision === 0 &&
                operation.state === "prepared";
            const terminalHead =
                (before.classification === "exact_sync" || before.classification === "state_ahead") &&
                before.missing_component === null &&
                before.corrupt_component === null &&
                before.claim_journal_revision !== null &&
                before.claim_digest !== null &&
                (before.claim_effect_phase === "response_observed" ||
                    before.claim_effect_phase === "dispatch_ambiguous");
            const terminalHeadHasCapacity =
                terminalHead && before.claim_journal_revision !== null && before.claim_journal_revision <= 252;
            if (!journalMissing && !terminalHeadHasCapacity) failDispatch();
            const intentRevision = journalMissing ? 0 : (before.claim_journal_revision as number) + 1;
            if (!Number.isSafeInteger(intentRevision) || intentRevision < 0) failDispatch();
            const intentClaim = await dependencies.build_effect_claim(
                makeDraft(
                    operation,
                    operationDigest,
                    nonceCommitment,
                    workflowStep,
                    intent,
                    intentRevision,
                    journalMissing ? null : before.claim_digest,
                    "dispatch_intent"
                )
            );
            if (intentClaim === null) throw new Error("invalid intent claim");
            const intentAppend = await dependencies.append_effect_claim(intentClaim);
            if (!intentAppend.success || intentAppend.claim.claim_digest !== intentClaim.claim_digest) failDispatch();
            if (!(await assertLease(dependencies, owner))) failDispatch();
            const afterIntent = await dependencies.read_consistency(operation.plan.plan_digest);
            if (
                afterIntent.classification !== "claim_behind" ||
                afterIntent.missing_component !== null ||
                afterIntent.corrupt_component !== null ||
                !exactOperationHead(afterIntent, operation, operationDigest, nonceCommitment) ||
                !exactClaimHead(afterIntent, intentClaim)
            ) {
                failDispatch();
            }
            const startedClaim = await dependencies.build_effect_claim(
                makeDraft(
                    operation,
                    operationDigest,
                    nonceCommitment,
                    workflowStep,
                    intent,
                    intentClaim.journal_revision + 1,
                    intentClaim.claim_digest,
                    "dispatch_started"
                )
            );
            if (startedClaim === null) throw new Error("invalid started claim");
            const startedAppend = await dependencies.append_effect_claim(startedClaim);
            if (!startedAppend.success || startedAppend.claim.claim_digest !== startedClaim.claim_digest) {
                failDispatch();
            }
            if (!(await assertLease(dependencies, owner))) failDispatch();
            const afterStarted = await dependencies.read_consistency(operation.plan.plan_digest);
            if (
                afterStarted.classification !== "ambiguous_dispatch" ||
                afterStarted.missing_component !== null ||
                afterStarted.corrupt_component !== null ||
                !exactOperationHead(afterStarted, operation, operationDigest, nonceCommitment) ||
                !exactClaimHead(afterStarted, startedClaim)
            ) {
                failDispatch();
            }
            if (!(await assertLease(dependencies, owner))) failDispatch();
        } catch {
            failDispatch();
        }
    };
    return Object.freeze({ success: true, record_dispatch: recordDispatch, ...authority });
};

export const createD1ProbeCloudflareWorkerCanaryDispatchClaimsV1 = async (
    input: D1ProbeCloudflareWorkerCanaryDispatchClaimsInputV1
): Promise<D1ProbeCloudflareWorkerCanaryDispatchClaimsResultV1> =>
    await createWithDependencies(input, fixedDependencies);

/** Test-only dependency seam. Production callers must use the fixed public factory. */
export const createD1ProbeCloudflareWorkerCanaryDispatchClaimsWithDependenciesTestOnlyV1 = async (
    input: D1ProbeCloudflareWorkerCanaryDispatchClaimsInputV1,
    dependencies: D1ProbeCloudflareWorkerCanaryDispatchClaimsTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryDispatchClaimsResultV1> =>
    await createWithDependencies(input, Object.freeze({ ...dependencies }));
