import type {
    CleanupStateV1,
    ProviderEvidenceStateV1,
    RunExecutionStateV1,
    SandboxCommandStateV1,
    SandboxExecutionStateV1,
} from "@openbot/contracts/internal";

type TransitionTable<State extends string> = Readonly<Record<State, ReadonlySet<State>>>;

const executionTransitions = {
    requested: new Set(["queued", "cancellation_requested", "failed"]),
    queued: new Set(["provisioning", "cancellation_requested", "failed"]),
    provisioning: new Set([
        "running",
        "cancellation_requested",
        "cancelled_with_effect_unknown",
        "outcome_unknown",
        "failed",
    ]),
    running: new Set([
        "result_pending_import",
        "cancellation_requested",
        "cancelled_with_effect_unknown",
        "outcome_unknown",
        "failed",
    ]),
    result_pending_import: new Set(["result_imported", "result_lost_after_execution"]),
    result_imported: new Set(["succeeded"]),
    cancellation_requested: new Set(["cancelled", "cancelled_with_effect_unknown", "outcome_unknown"]),
    succeeded: new Set(),
    failed: new Set(),
    cancelled: new Set(),
    cancelled_with_effect_unknown: new Set(),
    outcome_unknown: new Set(),
    result_lost_after_execution: new Set(),
} as const satisfies TransitionTable<RunExecutionStateV1>;

const cleanupTransitions = {
    not_required: new Set(["pending"]),
    pending: new Set(["running", "complete", "manual_required"]),
    running: new Set(["pending", "complete", "manual_required"]),
    manual_required: new Set(),
    complete: new Set(),
} as const satisfies TransitionTable<CleanupStateV1>;

const evidenceTransitions = {
    unavailable: new Set(["partial", "complete"]),
    partial: new Set(["complete"]),
    complete: new Set(),
} as const satisfies TransitionTable<ProviderEvidenceStateV1>;

const sandboxExecutionTransitions = {
    requested: new Set(["provisioning", "destroy_requested", "destroy_unverified"]),
    provisioning: new Set(["ready", "destroy_requested", "destroy_unverified"]),
    ready: new Set(["executing", "destroy_requested", "destroy_unverified"]),
    executing: new Set(["destroy_requested", "destroy_unverified"]),
    destroy_requested: new Set(["destroyed", "destroy_unverified", "manual_required"]),
    destroy_unverified: new Set(["manual_required"]),
    manual_required: new Set(),
    destroyed: new Set(),
} as const satisfies TransitionTable<SandboxExecutionStateV1>;

const sandboxCommandTransitions = {
    reserved: new Set(["dispatched", "cancelled"]),
    dispatched: new Set(["completed", "failed", "timed_out", "cancelled", "outcome_unknown"]),
    completed: new Set(),
    failed: new Set(),
    timed_out: new Set(),
    cancelled: new Set(),
    outcome_unknown: new Set(),
} as const satisfies TransitionTable<SandboxCommandStateV1>;

const permits = <State extends string>(table: TransitionTable<State>, from: State, to: State): boolean =>
    from === to || table[from].has(to);

export const canTransitionRunExecutionV1 = (from: RunExecutionStateV1, to: RunExecutionStateV1): boolean =>
    permits(executionTransitions, from, to);

export const canTransitionCleanupV1 = (from: CleanupStateV1, to: CleanupStateV1): boolean =>
    permits(cleanupTransitions, from, to);

export const canTransitionProviderEvidenceV1 = (from: ProviderEvidenceStateV1, to: ProviderEvidenceStateV1): boolean =>
    permits(evidenceTransitions, from, to);

export const isTerminalRunExecutionV1 = (state: RunExecutionStateV1): boolean => executionTransitions[state].size === 0;

export const canTransitionSandboxExecutionV1 = (from: SandboxExecutionStateV1, to: SandboxExecutionStateV1): boolean =>
    permits(sandboxExecutionTransitions, from, to);

export const canTransitionSandboxCommandV1 = (from: SandboxCommandStateV1, to: SandboxCommandStateV1): boolean =>
    permits(sandboxCommandTransitions, from, to);

export interface SandboxCleanupRetryContextV1 {
    profile_enabled: boolean;
    profile_active: boolean;
    repeat_destroy_safe_evidence: boolean;
    evidence_valid_until: number;
    now: number;
    cleanup_obligation_id: string;
    expected_cleanup_obligation_id: string;
    cleanup_fence: number;
    expected_cleanup_fence: number;
    retry_window_ends_at: number;
}

export const canRetrySandboxCleanupV1 = (context: SandboxCleanupRetryContextV1): boolean =>
    context.profile_enabled &&
    context.profile_active &&
    context.repeat_destroy_safe_evidence &&
    context.now <= context.evidence_valid_until &&
    context.now <= context.retry_window_ends_at &&
    context.cleanup_obligation_id === context.expected_cleanup_obligation_id &&
    context.cleanup_fence === context.expected_cleanup_fence;
