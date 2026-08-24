import { z } from "zod";

import {
    canonicalizeJsonV1,
    digestCanonicalJsonV1,
    type CanonicalJsonValueV1,
} from "@openbot/gate-attestation/internal";

import {
    D1ProbeCloudflareWorkerApiCanaryPlanV1Schema,
    type D1ProbeCloudflareWorkerApiCanaryPlanV1,
} from "./cloudflare-worker-interoperability-canary.js";

const PLAN_DIGEST_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-api-canary-plan.v1";
const IdentifierV1Schema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const AttemptTagV1Schema = z.string().regex(/^openbot-canary-attempt-[0-9a-f]{32}$/u);
const ExecutionNonceV1Schema = z.string().regex(/^[0-9a-f]{32}$/u);
const SafeTimeV1Schema = z.number().int().safe().nonnegative();

export const D1ProbeCloudflareWorkerCanaryOperationStateV1Schema = z.enum([
    "prepared",
    "shell_dispatching",
    "shell_identified",
    "version_dispatching",
    "version_identified",
    "deployment_dispatching",
    "deployment_identified",
    "cleanup_reconciling",
    "delete_dispatching",
    "absence_observed",
    "manual_required",
]);

export type D1ProbeCloudflareWorkerCanaryOperationStateV1 = z.infer<
    typeof D1ProbeCloudflareWorkerCanaryOperationStateV1Schema
>;

const OperationV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("d1_probe_cloudflare_worker_api_canary_operation"),
        revision: z.number().int().safe().nonnegative(),
        state: D1ProbeCloudflareWorkerCanaryOperationStateV1Schema,
        plan: D1ProbeCloudflareWorkerApiCanaryPlanV1Schema,
        script_name: z.string().regex(/^openbot-d1-probe-canary-[a-z0-9]{16}$/u),
        ownership_tag: z.string().regex(/^openbot-canary-owner-[0-9a-f]{32}$/u),
        attempt_tag: AttemptTagV1Schema,
        execution_nonce: ExecutionNonceV1Schema,
        worker_id: IdentifierV1Schema.nullable(),
        version_id: IdentifierV1Schema.nullable(),
        deployment_id: IdentifierV1Schema.nullable(),
        updated_at_ms: SafeTimeV1Schema,
        authoritative: z.literal(false),
        eligible_for_attestation: z.literal(false),
        lifecycle_advance_allowed: z.literal(false),
        gate_promotion_allowed: z.literal(false),
    })
    .strict()
    .superRefine((operation, context) => {
        if (operation.script_name !== operation.plan.script_name) {
            context.addIssue({ code: "custom", message: "script name must match plan" });
        }
        if (operation.ownership_tag !== operation.plan.markers.ownership_tag) {
            context.addIssue({ code: "custom", message: "ownership tag must match plan" });
        }
        if (operation.attempt_tag !== `openbot-canary-attempt-${operation.execution_nonce}`) {
            context.addIssue({ code: "custom", message: "attempt tag must match execution nonce" });
        }
        if (operation.execution_nonce === operation.plan.operation_id) {
            context.addIssue({ code: "custom", message: "execution nonce must be independent from plan operation ID" });
        }
        if (operation.revision === 0 && operation.state !== "prepared") {
            context.addIssue({ code: "custom", message: "revision zero must be prepared" });
        }
        if (operation.state === "prepared" && operation.revision !== 0) {
            context.addIssue({ code: "custom", message: "prepared state must have revision zero" });
        }

        const noWorker = operation.worker_id === null;
        const noVersion = operation.version_id === null;
        const noDeployment = operation.deployment_id === null;
        if (!noVersion && noWorker) {
            context.addIssue({ code: "custom", message: "version ID requires worker ID" });
        }
        if (!noDeployment && noVersion) {
            context.addIssue({ code: "custom", message: "deployment ID requires version ID" });
        }

        if (["prepared", "shell_dispatching"].includes(operation.state) && (!noWorker || !noVersion || !noDeployment)) {
            context.addIssue({ code: "custom", message: "state must not retain resource IDs" });
        }
        if (
            ["shell_identified", "version_dispatching"].includes(operation.state) &&
            (noWorker || !noVersion || !noDeployment)
        ) {
            context.addIssue({ code: "custom", message: "state must retain only worker ID" });
        }
        if (
            ["version_identified", "deployment_dispatching"].includes(operation.state) &&
            (noWorker || noVersion || !noDeployment)
        ) {
            context.addIssue({ code: "custom", message: "state must retain worker and version IDs" });
        }
        if (operation.state === "deployment_identified" && (noWorker || noVersion || noDeployment)) {
            context.addIssue({ code: "custom", message: "deployment identity is incomplete" });
        }
        if (["delete_dispatching", "absence_observed"].includes(operation.state) && noWorker) {
            context.addIssue({ code: "custom", message: "state requires worker ID" });
        }
    });

export const D1ProbeCloudflareWorkerCanaryOperationV1Schema = OperationV1Schema;
export type D1ProbeCloudflareWorkerCanaryOperationV1 = z.infer<typeof OperationV1Schema>;

const allowedTransitions: Readonly<Record<D1ProbeCloudflareWorkerCanaryOperationStateV1, readonly string[]>> = {
    prepared: ["shell_dispatching", "cleanup_reconciling", "manual_required"],
    shell_dispatching: ["shell_identified", "cleanup_reconciling", "manual_required"],
    shell_identified: ["version_dispatching", "cleanup_reconciling", "manual_required"],
    version_dispatching: ["version_identified", "cleanup_reconciling", "manual_required"],
    version_identified: ["deployment_dispatching", "cleanup_reconciling", "manual_required"],
    deployment_dispatching: ["deployment_identified", "cleanup_reconciling", "manual_required"],
    deployment_identified: ["cleanup_reconciling", "manual_required"],
    cleanup_reconciling: ["delete_dispatching", "absence_observed", "manual_required"],
    delete_dispatching: ["absence_observed", "manual_required"],
    absence_observed: [],
    manual_required: [],
};

export type TransitionD1ProbeCloudflareWorkerCanaryOperationDenialV1 =
    | "invalid_current_operation"
    | "invalid_next_operation"
    | "operation_transition_not_allowed"
    | "operation_revision_mismatch"
    | "operation_identity_changed"
    | "operation_clock_moved_backwards";

const sameCanonicalValue = (left: CanonicalJsonValueV1, right: CanonicalJsonValueV1): boolean =>
    canonicalizeJsonV1(left) === canonicalizeJsonV1(right);

export const validateD1ProbeCloudflareWorkerCanaryOperationV1 = async (
    input: unknown
): Promise<D1ProbeCloudflareWorkerCanaryOperationV1 | null> => {
    let parsed: ReturnType<typeof OperationV1Schema.safeParse>;
    try {
        parsed = OperationV1Schema.safeParse(input);
    } catch {
        return null;
    }
    if (!parsed.success) return null;
    try {
        const { plan_digest: _claimedPlanDigest, ...unsignedPlan } = parsed.data.plan;
        const planDigest = await digestCanonicalJsonV1(PLAN_DIGEST_DOMAIN_V1, unsignedPlan as CanonicalJsonValueV1);
        return planDigest === parsed.data.plan.plan_digest ? parsed.data : null;
    } catch {
        return null;
    }
};

export const prepareD1ProbeCloudflareWorkerCanaryOperationV1 = async (
    planInput: unknown,
    attemptTagInput: unknown,
    updatedAtMsInput: unknown
): Promise<
    | {
          readonly success: false;
          readonly code: "invalid_canary_plan" | "invalid_attempt_tag" | "invalid_operation_time";
      }
    | { readonly success: true; readonly operation: D1ProbeCloudflareWorkerCanaryOperationV1 }
> => {
    let plan: ReturnType<typeof D1ProbeCloudflareWorkerApiCanaryPlanV1Schema.safeParse>;
    let attemptTag: ReturnType<typeof AttemptTagV1Schema.safeParse>;
    let updatedAtMs: ReturnType<typeof SafeTimeV1Schema.safeParse>;
    try {
        plan = D1ProbeCloudflareWorkerApiCanaryPlanV1Schema.safeParse(planInput);
        attemptTag = AttemptTagV1Schema.safeParse(attemptTagInput);
        updatedAtMs = SafeTimeV1Schema.safeParse(updatedAtMsInput);
    } catch {
        return { success: false, code: "invalid_canary_plan" };
    }
    if (!plan.success) return { success: false, code: "invalid_canary_plan" };
    if (!attemptTag.success) return { success: false, code: "invalid_attempt_tag" };
    if (!updatedAtMs.success) return { success: false, code: "invalid_operation_time" };
    if (attemptTag.data === `openbot-canary-attempt-${plan.data.operation_id}`) {
        return { success: false, code: "invalid_attempt_tag" };
    }
    const operation = await validateD1ProbeCloudflareWorkerCanaryOperationV1({
        schema_version: 1,
        kind: "d1_probe_cloudflare_worker_api_canary_operation",
        revision: 0,
        state: "prepared",
        plan: plan.data,
        script_name: plan.data.script_name,
        ownership_tag: plan.data.markers.ownership_tag,
        attempt_tag: attemptTag.data,
        execution_nonce: attemptTag.data.slice("openbot-canary-attempt-".length),
        worker_id: null,
        version_id: null,
        deployment_id: null,
        updated_at_ms: updatedAtMs.data,
        authoritative: false,
        eligible_for_attestation: false,
        lifecycle_advance_allowed: false,
        gate_promotion_allowed: false,
    });
    return operation === null ? { success: false, code: "invalid_canary_plan" } : { success: true, operation };
};

export const transitionD1ProbeCloudflareWorkerCanaryOperationV1 = async (
    currentInput: unknown,
    nextInput: unknown
): Promise<
    | { readonly success: false; readonly code: TransitionD1ProbeCloudflareWorkerCanaryOperationDenialV1 }
    | { readonly success: true; readonly operation: D1ProbeCloudflareWorkerCanaryOperationV1 }
> => {
    const current = await validateD1ProbeCloudflareWorkerCanaryOperationV1(currentInput);
    if (current === null) return { success: false, code: "invalid_current_operation" };
    const next = await validateD1ProbeCloudflareWorkerCanaryOperationV1(nextInput);
    if (next === null) return { success: false, code: "invalid_next_operation" };
    if (!allowedTransitions[current.state].includes(next.state)) {
        return { success: false, code: "operation_transition_not_allowed" };
    }
    if (next.revision !== current.revision + 1) {
        return { success: false, code: "operation_revision_mismatch" };
    }
    if (next.updated_at_ms < current.updated_at_ms) {
        return { success: false, code: "operation_clock_moved_backwards" };
    }
    if (
        !sameCanonicalValue(current.plan as CanonicalJsonValueV1, next.plan as CanonicalJsonValueV1) ||
        current.script_name !== next.script_name ||
        current.ownership_tag !== next.ownership_tag ||
        current.attempt_tag !== next.attempt_tag ||
        current.execution_nonce !== next.execution_nonce ||
        (current.worker_id !== null && current.worker_id !== next.worker_id) ||
        (current.version_id !== null && current.version_id !== next.version_id) ||
        (current.deployment_id !== null && current.deployment_id !== next.deployment_id)
    ) {
        return { success: false, code: "operation_identity_changed" };
    }
    return { success: true, operation: next };
};

export const buildNextD1ProbeCloudflareWorkerCanaryOperationV1 = (
    current: D1ProbeCloudflareWorkerCanaryOperationV1,
    state: D1ProbeCloudflareWorkerCanaryOperationStateV1,
    updatedAtMs: number,
    identities: {
        readonly worker_id?: string | null;
        readonly version_id?: string | null;
        readonly deployment_id?: string | null;
    } = {}
): D1ProbeCloudflareWorkerCanaryOperationV1 => ({
    ...current,
    ...identities,
    revision: current.revision + 1,
    state,
    updated_at_ms: updatedAtMs,
});

export type { D1ProbeCloudflareWorkerApiCanaryPlanV1 };
