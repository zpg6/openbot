import { createHash } from "node:crypto";

import {
    appendD1ProbeCloudflareWorkerCanaryEffectJournalV1,
    buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1,
    digestD1ProbeCloudflareWorkerCanaryOperationRecordV1,
    readD1ProbeCloudflareWorkerCanaryEffectJournalReadOnlyV1,
    validateD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    type D1ProbeCloudflareWorkerCanaryEffectJournalAppendResultV1,
    type D1ProbeCloudflareWorkerCanaryEffectJournalReadResultV1,
    type D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1,
    type D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
} from "./cloudflare-worker-canary-effect-journal.js";
import {
    assertCurrentD1ProbeCloudflareWorkerCanaryDriverLeaseV1,
    digestD1ProbeCloudflareWorkerCanaryDriverLeaseRecordV1,
    type D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1,
    type D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1,
} from "./cloudflare-worker-canary-driver-lease.js";
import {
    readD1ProbeCloudflareWorkerCanaryConsistencyV1,
    type D1ProbeCloudflareWorkerCanaryConsistencyV1,
} from "./cloudflare-worker-canary-consistency.js";
import {
    createD1ProbeCloudflareWorkerCanaryDispatchClaimsV1,
    type D1ProbeCloudflareWorkerCanaryDispatchClaimsInputV1,
    type D1ProbeCloudflareWorkerCanaryDispatchClaimsResultV1,
} from "./cloudflare-worker-canary-dispatch-claims.js";
import {
    validateD1ProbeCloudflareWorkerCanaryOperationV1,
    type D1ProbeCloudflareWorkerCanaryOperationV1,
} from "./cloudflare-worker-canary-operation.js";
import {
    archiveD1ProbeCloudflareWorkerCanaryResponsePreimageV1,
    D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_MAX_PLAINTEXT_BYTES_V1,
    type D1ProbeCloudflareWorkerCanaryResponseArchiveExpectedContextV1,
    type D1ProbeCloudflareWorkerCanaryResponseArchiveResultV1,
} from "./cloudflare-worker-canary-response-archive.js";
import type {
    D1ProbeCloudflareWorkerCanaryCaptureResponsePreimageCallerControlledV1,
    D1ProbeCloudflareWorkerCanaryDispatchIntentV1,
    D1ProbeCloudflareWorkerCanaryRecordDispatchV1,
    D1ProbeCloudflareWorkerCanaryResponseCaptureContextV1,
} from "./cloudflare-worker-canary-transport.js";

const DigestV1 = /^[0-9a-f]{64}$/u;
const ExecutionNonceV1 = /^[0-9a-f]{32}$/u;
const OwnerNonceV1 = /^[A-Za-z0-9_-]{43}$/u;

const workflowBindings = {
    prepared_worker_list: { request_kind: "inspect_worker", request_method: "GET", operation_state: "prepared" },
    shell_create: { request_kind: "create_worker", request_method: "POST", operation_state: "shell_dispatching" },
    shell_dispatch_reconciliation: {
        request_kind: "inspect_worker",
        request_method: "GET",
        operation_state: "shell_dispatching",
    },
    shell_readback: { request_kind: "inspect_worker", request_method: "GET", operation_state: "shell_identified" },
    version_create: {
        request_kind: "create_version",
        request_method: "POST",
        operation_state: "version_dispatching",
    },
    version_dispatch_reconciliation: {
        request_kind: "inspect_worker",
        request_method: "GET",
        operation_state: "version_dispatching",
    },
    version_readback: {
        request_kind: "inspect_worker",
        request_method: "GET",
        operation_state: "version_identified",
    },
    deployment_create: {
        request_kind: "create_deployment",
        request_method: "POST",
        operation_state: "deployment_dispatching",
    },
    deployment_dispatch_reconciliation: {
        request_kind: "inspect_worker",
        request_method: "GET",
        operation_state: "deployment_dispatching",
    },
    deployment_readback: {
        request_kind: "inspect_worker",
        request_method: "GET",
        operation_state: "deployment_identified",
    },
} as const;

type WorkflowStepV1 = keyof typeof workflowBindings;

export interface D1ProbeCloudflareWorkerCanaryResponseClaimsInputV1 {
    readonly operation: unknown;
    readonly driver_lease_owner: unknown;
    readonly workflow_step: unknown;
    readonly archive_key: unknown;
}

interface ResponseClaimsAuthorityV1 {
    readonly caller_mutation_authority: false;
    readonly authoritative: false;
    readonly eligible_for_upload: false;
    readonly eligible_for_attestation: false;
    readonly lifecycle_advance_allowed: false;
    readonly gate_promotion_allowed: false;
}

export type D1ProbeCloudflareWorkerCanaryResponseClaimsResultV1 =
    | ({ readonly success: false; readonly code: "invalid_response_claim_context" } & ResponseClaimsAuthorityV1)
    | ({
          readonly success: true;
          readonly record_dispatch_and_bind: D1ProbeCloudflareWorkerCanaryRecordDispatchV1;
          readonly capture_response_preimage: D1ProbeCloudflareWorkerCanaryCaptureResponsePreimageCallerControlledV1;
          readonly discard: () => void;
      } & ResponseClaimsAuthorityV1);

export interface D1ProbeCloudflareWorkerCanaryResponseClaimsTestOnlyDependenciesV1 {
    readonly create_dispatch_claims: (
        input: D1ProbeCloudflareWorkerCanaryDispatchClaimsInputV1
    ) => Promise<D1ProbeCloudflareWorkerCanaryDispatchClaimsResultV1>;
    readonly assert_current_driver_lease: (
        owner: D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1
    ) => Promise<D1ProbeCloudflareWorkerCanaryDriverLeaseReadResultV1>;
    readonly read_consistency: (planDigest: string) => Promise<D1ProbeCloudflareWorkerCanaryConsistencyV1>;
    readonly read_effect_journal: (
        planDigest: string
    ) => Promise<D1ProbeCloudflareWorkerCanaryEffectJournalReadResultV1>;
    readonly build_effect_claim: (
        draft: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1
    ) => Promise<D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1 | null>;
    readonly archive_response_preimage: (
        claim: unknown,
        context: unknown,
        responseBytes: unknown,
        archiveKey: unknown
    ) => Promise<D1ProbeCloudflareWorkerCanaryResponseArchiveResultV1>;
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

const fixedDependencies: D1ProbeCloudflareWorkerCanaryResponseClaimsTestOnlyDependenciesV1 = {
    create_dispatch_claims: createD1ProbeCloudflareWorkerCanaryDispatchClaimsV1,
    assert_current_driver_lease: assertCurrentD1ProbeCloudflareWorkerCanaryDriverLeaseV1,
    read_consistency: readD1ProbeCloudflareWorkerCanaryConsistencyV1,
    read_effect_journal: readD1ProbeCloudflareWorkerCanaryEffectJournalReadOnlyV1,
    build_effect_claim: buildD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    archive_response_preimage: archiveD1ProbeCloudflareWorkerCanaryResponsePreimageV1,
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

const clearBytes = (bytes: Uint8Array | null): void => {
    try {
        bytes?.fill(0);
    } catch {
        // A hostile test dependency can detach a copy. Production dependencies do not transfer these buffers.
    }
};

const ownerFrom = (input: unknown): D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1 | null => {
    const cloned = safeClone(input);
    if (typeof cloned !== "object" || cloned === null || Array.isArray(cloned)) return null;
    const owner = cloned as Record<string, unknown>;
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

const contextFrom = (input: unknown): D1ProbeCloudflareWorkerCanaryResponseCaptureContextV1 | null => {
    if (typeof input !== "object" || input === null || Array.isArray(input) || !Object.isFrozen(input)) return null;
    const cloned = safeClone(input);
    if (typeof cloned !== "object" || cloned === null || Array.isArray(cloned)) return null;
    const context = cloned as Record<string, unknown>;
    if (
        !exactKeys(context, [
            "transcript_sequence",
            "request_method",
            "request_path_digest",
            "request_digest",
            "response_status",
            "response_digest",
            "caller_asserted_response_content_type",
            "caller_asserted_response_content_encoding",
            "caller_asserted_response_observed_at_ms",
        ]) ||
        !Number.isSafeInteger(context["transcript_sequence"]) ||
        (context["transcript_sequence"] as number) <= 0 ||
        !["GET", "POST", "DELETE"].includes(context["request_method"] as string) ||
        typeof context["request_path_digest"] !== "string" ||
        !DigestV1.test(context["request_path_digest"]) ||
        typeof context["request_digest"] !== "string" ||
        !DigestV1.test(context["request_digest"]) ||
        !Number.isInteger(context["response_status"]) ||
        (context["response_status"] as number) < 100 ||
        (context["response_status"] as number) > 599 ||
        typeof context["response_digest"] !== "string" ||
        !DigestV1.test(context["response_digest"]) ||
        (context["caller_asserted_response_content_type"] !== null &&
            (typeof context["caller_asserted_response_content_type"] !== "string" ||
                (context["caller_asserted_response_content_type"] as string).length < 1 ||
                (context["caller_asserted_response_content_type"] as string).length > 512 ||
                !/^[\x20-\x7e]+$/u.test(context["caller_asserted_response_content_type"] as string))) ||
        ![null, "identity"].includes(context["caller_asserted_response_content_encoding"] as string | null) ||
        !Number.isSafeInteger(context["caller_asserted_response_observed_at_ms"]) ||
        (context["caller_asserted_response_observed_at_ms"] as number) < 0
    ) {
        return null;
    }
    return Object.freeze(context) as unknown as D1ProbeCloudflareWorkerCanaryResponseCaptureContextV1;
};

const intentFrom = (input: unknown): D1ProbeCloudflareWorkerCanaryDispatchIntentV1 | null => {
    if (typeof input !== "object" || input === null || Array.isArray(input) || !Object.isFrozen(input)) return null;
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
    snapshot.claim_lease_generation === claim.lease_generation &&
    snapshot.claim_lease_record_digest === claim.lease_record_digest &&
    snapshot.claim_workflow_step === claim.workflow_step &&
    snapshot.claim_effect_phase === claim.effect_phase &&
    snapshot.claim_ambiguity_classification === claim.ambiguity_classification;

const exactStartedForIntent = (
    claim: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    operation: D1ProbeCloudflareWorkerCanaryOperationV1,
    operationDigest: string,
    nonceCommitment: string,
    workflowStep: WorkflowStepV1,
    intent: D1ProbeCloudflareWorkerCanaryDispatchIntentV1
): boolean => {
    const binding = workflowBindings[workflowStep];
    return (
        claim.effect_phase === "dispatch_started" &&
        claim.ambiguity_classification === "may_have_dispatched" &&
        claim.plan_digest === operation.plan.plan_digest &&
        claim.operation_revision === operation.revision &&
        claim.operation_state === operation.state &&
        claim.operation_record_digest === operationDigest &&
        claim.execution_nonce_commitment === nonceCommitment &&
        claim.workflow_step === workflowStep &&
        claim.request_kind === binding.request_kind &&
        claim.request_method === binding.request_method &&
        claim.request_method === intent.method &&
        claim.transcript_sequence === intent.sequence &&
        claim.request_digest === intent.request_digest &&
        claim.request_path_digest === intent.path_digest &&
        claim.intent_observed_at_ms === intent.intent_observed_at_ms &&
        claim.dispatch_started_at_ms === intent.dispatch_started_at_ms &&
        claim.response_status === null &&
        claim.response_digest === null &&
        claim.dispatch_started_at_ms !== null &&
        claim.journal_revision < 255 &&
        claim.intent_observed_at_ms >= Math.max(operation.plan.not_before_ms, operation.updated_at_ms) &&
        claim.dispatch_started_at_ms >= claim.intent_observed_at_ms &&
        claim.dispatch_started_at_ms < operation.plan.expires_at_ms
    );
};

const contextMatchesBinding = (
    context: D1ProbeCloudflareWorkerCanaryResponseCaptureContextV1,
    intent: D1ProbeCloudflareWorkerCanaryDispatchIntentV1,
    operation: D1ProbeCloudflareWorkerCanaryOperationV1
): boolean =>
    context.transcript_sequence === intent.sequence &&
    context.request_method === intent.method &&
    context.request_path_digest === intent.path_digest &&
    context.request_digest === intent.request_digest &&
    context.caller_asserted_response_observed_at_ms >= intent.dispatch_started_at_ms &&
    context.caller_asserted_response_observed_at_ms < operation.plan.expires_at_ms;

const assertLease = async (
    dependencies: D1ProbeCloudflareWorkerCanaryResponseClaimsTestOnlyDependenciesV1,
    owner: D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1
): Promise<{ readonly generation: number; readonly record_digest: string } | null> => {
    const result = await dependencies.assert_current_driver_lease(owner);
    if (
        !result.success ||
        !(
            result.lease.state === "active" &&
            result.lease.plan_digest === owner.plan_digest &&
            result.lease.generation === owner.generation &&
            result.lease.owner_pid === owner.owner_pid
        )
    ) {
        return null;
    }
    const recordDigest = await digestD1ProbeCloudflareWorkerCanaryDriverLeaseRecordV1(result.lease);
    return recordDigest === null
        ? null
        : Object.freeze({ generation: result.lease.generation, record_digest: recordDigest });
};

const readValidatedHead = async (
    dependencies: D1ProbeCloudflareWorkerCanaryResponseClaimsTestOnlyDependenciesV1,
    planDigest: string
): Promise<D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1 | null> => {
    const journal = await dependencies.read_effect_journal(planDigest);
    if (!journal.success) return null;
    const rawHead = journal.claims.at(-1);
    if (rawHead === undefined) return null;
    const head = await validateD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1(rawHead);
    return head !== null && head.claim_digest === rawHead.claim_digest ? head : null;
};

const readExactStartedHead = async (
    dependencies: D1ProbeCloudflareWorkerCanaryResponseClaimsTestOnlyDependenciesV1,
    operation: D1ProbeCloudflareWorkerCanaryOperationV1,
    operationDigest: string,
    nonceCommitment: string,
    workflowStep: WorkflowStepV1,
    intent: D1ProbeCloudflareWorkerCanaryDispatchIntentV1,
    expectedClaimDigest?: string,
    expectedLeaseEpoch?: { readonly generation: number; readonly record_digest: string }
): Promise<D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1 | null> => {
    const head = await readValidatedHead(dependencies, operation.plan.plan_digest);
    if (
        head === null ||
        (expectedClaimDigest !== undefined && head.claim_digest !== expectedClaimDigest) ||
        (expectedLeaseEpoch !== undefined &&
            (head.lease_generation !== expectedLeaseEpoch.generation ||
                head.lease_record_digest !== expectedLeaseEpoch.record_digest)) ||
        !exactStartedForIntent(head, operation, operationDigest, nonceCommitment, workflowStep, intent)
    ) {
        return null;
    }
    const consistency = await dependencies.read_consistency(operation.plan.plan_digest);
    return consistency.classification === "ambiguous_dispatch" &&
        consistency.missing_component === null &&
        consistency.corrupt_component === null &&
        exactOperationHead(consistency, operation, operationDigest, nonceCommitment) &&
        exactClaimHead(consistency, head)
        ? head
        : null;
};

const makeResponseDraft = (
    started: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    context: D1ProbeCloudflareWorkerCanaryResponseCaptureContextV1
): D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimDraftV1 => ({
    schema_version: 1,
    kind: "d1_probe_cloudflare_worker_api_canary_untrusted_effect_claim",
    journal_revision: started.journal_revision + 1,
    previous_claim_digest: started.claim_digest,
    plan_digest: started.plan_digest,
    operation_revision: started.operation_revision,
    operation_state: started.operation_state,
    operation_record_digest: started.operation_record_digest,
    execution_nonce_commitment: started.execution_nonce_commitment,
    lease_generation: started.lease_generation,
    lease_record_digest: started.lease_record_digest,
    workflow_step: started.workflow_step,
    request_kind: started.request_kind,
    request_method: started.request_method,
    transcript_sequence: started.transcript_sequence,
    effect_phase: "response_observed",
    intent_observed_at_ms: started.intent_observed_at_ms,
    dispatch_started_at_ms: started.dispatch_started_at_ms,
    request_digest: started.request_digest,
    request_path_digest: started.request_path_digest,
    response_status: context.response_status,
    response_digest: context.response_digest,
    ambiguity_classification: "none",
    ...authority,
});

const archiveContext = (
    claim: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    context: D1ProbeCloudflareWorkerCanaryResponseCaptureContextV1
): D1ProbeCloudflareWorkerCanaryResponseArchiveExpectedContextV1 => ({
    schema_version: 1,
    kind: "d1_probe_cloudflare_worker_api_canary_response_archive_expected_context",
    plan_digest: claim.plan_digest,
    execution_nonce_commitment: claim.execution_nonce_commitment,
    operation_revision: claim.operation_revision,
    operation_state: claim.operation_state,
    operation_record_digest: claim.operation_record_digest,
    claim_digest: claim.claim_digest,
    journal_revision: claim.journal_revision,
    transcript_sequence: claim.transcript_sequence,
    effect_phase: "response_observed",
    workflow_step: claim.workflow_step,
    request_kind: claim.request_kind,
    request_method: claim.request_method,
    request_digest: claim.request_digest,
    request_path_digest: claim.request_path_digest,
    response_status: context.response_status,
    response_digest: context.response_digest,
    caller_asserted_response_content_type: context.caller_asserted_response_content_type,
    caller_asserted_response_content_encoding: context.caller_asserted_response_content_encoding,
    caller_asserted_response_observed_at_ms: context.caller_asserted_response_observed_at_ms,
});

const exactArchiveReceipt = (
    result: D1ProbeCloudflareWorkerCanaryResponseArchiveResultV1,
    claim: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1,
    byteLength: number
): boolean =>
    result.success &&
    result.receipt.schema_version === 1 &&
    result.receipt.kind === "untrusted_d1_probe_cloudflare_worker_api_canary_response_archive_receipt" &&
    result.receipt.plan_digest === claim.plan_digest &&
    result.receipt.claim_digest === claim.claim_digest &&
    result.receipt.journal_revision === claim.journal_revision &&
    result.receipt.transcript_sequence === claim.transcript_sequence &&
    result.receipt.response_digest === claim.response_digest &&
    result.receipt.plaintext_length === byteLength &&
    DigestV1.test(result.receipt.archive_key_identifier) &&
    DigestV1.test(result.receipt.archive_record_digest) &&
    result.receipt.caller_mutation_authority === false &&
    result.receipt.cloudflare_origin_authenticated === false &&
    result.receipt.effect_claim_authenticated === false &&
    result.receipt.authoritative === false &&
    result.receipt.eligible_for_upload === false &&
    result.receipt.eligible_for_attestation === false &&
    result.receipt.lifecycle_advance_allowed === false &&
    result.receipt.gate_promotion_allowed === false;

const exactFinalHead = async (
    dependencies: D1ProbeCloudflareWorkerCanaryResponseClaimsTestOnlyDependenciesV1,
    operation: D1ProbeCloudflareWorkerCanaryOperationV1,
    operationDigest: string,
    nonceCommitment: string,
    claim: D1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1
): Promise<boolean> => {
    const head = await readValidatedHead(dependencies, operation.plan.plan_digest);
    if (head === null || head.claim_digest !== claim.claim_digest) return false;
    const consistency = await dependencies.read_consistency(operation.plan.plan_digest);
    return (
        consistency.classification === "exact_sync" &&
        consistency.missing_component === null &&
        consistency.corrupt_component === null &&
        exactOperationHead(consistency, operation, operationDigest, nonceCommitment) &&
        exactClaimHead(consistency, claim)
    );
};

const denied = (): D1ProbeCloudflareWorkerCanaryResponseClaimsResultV1 => ({
    success: false,
    code: "invalid_response_claim_context",
    ...authority,
});

const failCapture = (): never => {
    throw new Error("Cloudflare Worker canary response claim recording denied");
};

const createWithDependencies = async (
    input: D1ProbeCloudflareWorkerCanaryResponseClaimsInputV1,
    dependencies: D1ProbeCloudflareWorkerCanaryResponseClaimsTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryResponseClaimsResultV1> => {
    if (typeof input !== "object" || input === null || Array.isArray(input)) return denied();
    const raw = input as unknown as Record<string, unknown>;
    let key: Uint8Array | null = null;
    try {
        if (!exactKeys(raw, ["operation", "driver_lease_owner", "workflow_step", "archive_key"])) return denied();
        if (!(raw["archive_key"] instanceof Uint8Array) || raw["archive_key"].byteLength !== 32) return denied();
        key = new Uint8Array(raw["archive_key"]);
        const operation = await validateD1ProbeCloudflareWorkerCanaryOperationV1(safeClone(raw["operation"]));
        const owner = ownerFrom(raw["driver_lease_owner"]);
        const workflowStep =
            typeof raw["workflow_step"] === "string" && raw["workflow_step"] in workflowBindings
                ? (raw["workflow_step"] as WorkflowStepV1)
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
        const dispatchClaims = await dependencies.create_dispatch_claims({
            operation,
            driver_lease_owner: owner,
            workflow_step: workflowStep,
        });
        if (
            !dispatchClaims.success ||
            typeof dispatchClaims.record_dispatch !== "function" ||
            dispatchClaims.caller_mutation_authority !== false ||
            dispatchClaims.authoritative !== false ||
            dispatchClaims.eligible_for_upload !== false ||
            dispatchClaims.eligible_for_attestation !== false ||
            dispatchClaims.lifecycle_advance_allowed !== false ||
            dispatchClaims.gate_promotion_allowed !== false
        ) {
            return denied();
        }

        let state: "ready" | "recording" | "bound" | "capturing" | "finished" | "discarded" = "ready";
        let privateKey: Uint8Array | null = key;
        let boundIntent: D1ProbeCloudflareWorkerCanaryDispatchIntentV1 | null = null;
        let boundStartedDigest: string | null = null;
        let boundLeaseEpoch: { readonly generation: number; readonly record_digest: string } | null = null;
        let discardRequested = false;
        const requireCaptureActive = (): void => {
            if (discardRequested) failCapture();
        };
        key = null;
        const discard = (): void => {
            if (state === "finished" || state === "discarded") return;
            discardRequested = true;
            clearBytes(privateKey);
            privateKey = null;
            boundIntent = null;
            boundStartedDigest = null;
            boundLeaseEpoch = null;
            if (state !== "recording" && state !== "capturing") state = "discarded";
        };
        const recordDispatchAndBind: D1ProbeCloudflareWorkerCanaryRecordDispatchV1 = async intentInput => {
            if (state !== "ready") failCapture();
            state = "recording";
            try {
                const intent = intentFrom(intentInput);
                if (intent === null) return failCapture();
                await dispatchClaims.record_dispatch(intent);
                if (discardRequested || privateKey === null) return failCapture();
                const leaseEpoch = await assertLease(dependencies, owner);
                if (leaseEpoch === null) return failCapture();
                const started = await readExactStartedHead(
                    dependencies,
                    operation,
                    operationDigest,
                    nonceCommitment,
                    workflowStep,
                    intent,
                    undefined,
                    leaseEpoch
                );
                if (started === null) return failCapture();
                const reboundLeaseEpoch = await assertLease(dependencies, owner);
                if (
                    reboundLeaseEpoch === null ||
                    reboundLeaseEpoch.generation !== leaseEpoch.generation ||
                    reboundLeaseEpoch.record_digest !== leaseEpoch.record_digest
                ) {
                    failCapture();
                }
                boundIntent = intent;
                boundStartedDigest = started.claim_digest;
                boundLeaseEpoch = leaseEpoch;
                state = "bound";
            } catch {
                clearBytes(privateKey);
                privateKey = null;
                boundIntent = null;
                boundStartedDigest = null;
                boundLeaseEpoch = null;
                state = "discarded";
                failCapture();
            }
        };
        const capture: D1ProbeCloudflareWorkerCanaryCaptureResponsePreimageCallerControlledV1 = async (
            contextInput,
            responseBytesInput
        ) => {
            if (state !== "bound" || boundIntent === null || boundStartedDigest === null || boundLeaseEpoch === null) {
                discardRequested = true;
                clearBytes(privateKey);
                privateKey = null;
                boundIntent = null;
                boundStartedDigest = null;
                boundLeaseEpoch = null;
                if (state !== "recording" && state !== "capturing") state = "discarded";
                return failCapture();
            }
            const intent: D1ProbeCloudflareWorkerCanaryDispatchIntentV1 = boundIntent;
            const startedDigest: string = boundStartedDigest;
            const leaseEpoch = boundLeaseEpoch;
            boundIntent = null;
            boundStartedDigest = null;
            boundLeaseEpoch = null;
            state = "capturing";
            const localKey = privateKey;
            privateKey = null;
            let responseBytes: Uint8Array | null = null;
            try {
                if (localKey === null) failCapture();
                const context = contextFrom(contextInput);
                if (context === null) return failCapture();
                if (!contextMatchesBinding(context, intent, operation)) return failCapture();
                if (!(responseBytesInput instanceof Uint8Array)) return failCapture();
                if (
                    responseBytesInput.byteLength >
                    D1_PROBE_CLOUDFLARE_WORKER_CANARY_RESPONSE_ARCHIVE_MAX_PLAINTEXT_BYTES_V1
                ) {
                    return failCapture();
                }
                responseBytes = new Uint8Array(responseBytesInput);
                if (createHash("sha256").update(responseBytes).digest("hex") !== context.response_digest) {
                    failCapture();
                }
                if (!(await assertLease(dependencies, owner))) failCapture();
                requireCaptureActive();
                const started = await readExactStartedHead(
                    dependencies,
                    operation,
                    operationDigest,
                    nonceCommitment,
                    workflowStep,
                    intent,
                    startedDigest,
                    leaseEpoch
                );
                if (started === null) return failCapture();
                requireCaptureActive();
                const builtResponseClaim = await dependencies.build_effect_claim(makeResponseDraft(started, context));
                if (builtResponseClaim === null) return failCapture();
                requireCaptureActive();
                const responseClaim =
                    await validateD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1(builtResponseClaim);
                if (responseClaim === null || responseClaim.claim_digest !== builtResponseClaim.claim_digest) {
                    return failCapture();
                }
                requireCaptureActive();
                if (!(await assertLease(dependencies, owner))) failCapture();
                requireCaptureActive();
                const archived = await dependencies.archive_response_preimage(
                    responseClaim,
                    archiveContext(responseClaim, context),
                    responseBytes,
                    localKey
                );
                requireCaptureActive();
                if (!exactArchiveReceipt(archived, responseClaim, responseBytes.byteLength)) failCapture();
                if (!(await assertLease(dependencies, owner))) failCapture();
                requireCaptureActive();
                const unchangedStarted = await readExactStartedHead(
                    dependencies,
                    operation,
                    operationDigest,
                    nonceCommitment,
                    workflowStep,
                    intent,
                    started.claim_digest,
                    leaseEpoch
                );
                if (unchangedStarted === null) return failCapture();
                requireCaptureActive();
                if (!(await assertLease(dependencies, owner))) failCapture();
                requireCaptureActive();
                const appended = await dependencies.append_effect_claim(responseClaim);
                requireCaptureActive();
                if (!appended.success) return failCapture();
                if (appended.claim.claim_digest !== responseClaim.claim_digest) return failCapture();
                const validatedAppend = await validateD1ProbeCloudflareWorkerCanaryUntrustedEffectClaimV1(
                    appended.claim
                );
                if (validatedAppend === null || validatedAppend.claim_digest !== responseClaim.claim_digest) {
                    failCapture();
                }
                if (!(await assertLease(dependencies, owner))) failCapture();
                requireCaptureActive();
                if (!(await exactFinalHead(dependencies, operation, operationDigest, nonceCommitment, responseClaim))) {
                    failCapture();
                }
                requireCaptureActive();
                if (!(await assertLease(dependencies, owner))) failCapture();
                requireCaptureActive();
                state = "finished";
            } catch {
                failCapture();
            } finally {
                state = state === "finished" ? "finished" : "discarded";
                clearBytes(localKey);
                clearBytes(responseBytes);
            }
        };
        return Object.freeze({
            success: true,
            record_dispatch_and_bind: recordDispatchAndBind,
            capture_response_preimage: capture,
            discard,
            ...authority,
        });
    } catch {
        return denied();
    } finally {
        clearBytes(key);
    }
};

// Both callbacks share one private started-claim binding. Capture cannot use a legacy recorder or an older head.
export const createD1ProbeCloudflareWorkerCanaryResponseClaimsV1 = async (
    input: D1ProbeCloudflareWorkerCanaryResponseClaimsInputV1
): Promise<D1ProbeCloudflareWorkerCanaryResponseClaimsResultV1> =>
    await createWithDependencies(input, fixedDependencies);

/** Test-only dependency seam. Production callers must use the fixed public factory. */
export const createD1ProbeCloudflareWorkerCanaryResponseClaimsWithDependenciesTestOnlyV1 = async (
    input: D1ProbeCloudflareWorkerCanaryResponseClaimsInputV1,
    dependencies: D1ProbeCloudflareWorkerCanaryResponseClaimsTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryResponseClaimsResultV1> =>
    await createWithDependencies(input, Object.freeze({ ...dependencies }));
