import type {
    AccountStateV1,
    BotStateV1,
    CleanupStateV1,
    PresentationStateV1,
    PresentationStatusV1,
    ProviderEvidenceStateV1,
    RunExecutionStateV1,
} from "@openbot/contracts/internal";

const unreachable = (value: never): never => {
    throw new Error(`Unmapped presentation state: ${String(value)}`);
};

const isConfigurationUsable = (account: AccountStateV1, bot: BotStateV1): boolean => {
    switch (account) {
        case "active":
            break;
        case "disabled":
            return false;
        default:
            return unreachable(account);
    }
    switch (bot) {
        case "active":
            return true;
        case "disabled":
            return false;
        default:
            return unreachable(bot);
    }
};

const executionClass = (
    execution: RunExecutionStateV1 | null
): "none" | "unknown" | "cancelling" | "active" | "cancelled" | "failed" | "completed" => {
    if (execution === null) return "none";
    switch (execution) {
        case "cancelled_with_effect_unknown":
        case "outcome_unknown":
        case "result_lost_after_execution":
            return "unknown";
        case "cancellation_requested":
            return "cancelling";
        case "requested":
        case "queued":
        case "provisioning":
        case "running":
        case "result_pending_import":
        case "result_imported":
            return "active";
        case "cancelled":
            return "cancelled";
        case "failed":
            return "failed";
        case "succeeded":
            return "completed";
        default:
            return unreachable(execution);
    }
};

const cleanupNeedsAttention = (cleanup: CleanupStateV1, runIsActive: boolean): "none" | "required" | "cleaning" => {
    switch (cleanup) {
        case "manual_required":
            return "required";
        case "pending":
            return runIsActive ? "none" : "required";
        case "running":
            return runIsActive ? "none" : "cleaning";
        case "not_required":
        case "complete":
            return "none";
        default:
            return unreachable(cleanup);
    }
};

const acknowledgeEvidenceState = (evidence: ProviderEvidenceStateV1): void => {
    switch (evidence) {
        case "complete":
        case "partial":
        case "unavailable":
            return;
        default:
            return unreachable(evidence);
    }
};

export const derivePresentationStatusV1 = (state: PresentationStateV1): PresentationStatusV1 => {
    acknowledgeEvidenceState(state.evidence);
    const execution = executionClass(state.execution);
    if (execution === "unknown") return "outcome_unknown";

    const cleanup = cleanupNeedsAttention(state.cleanup, execution === "active" || execution === "cancelling");
    if (cleanup === "required") return "cleanup_required";
    if (cleanup === "cleaning") return "cleaning_up";
    if (execution === "cancelling") return "cancelling";
    if (execution === "active") return "running";
    if (state.confirmation === "live") return "needs_confirmation";
    if (!isConfigurationUsable(state.account, state.bot) || state.catalog === "unusable") {
        return "needs_configuration";
    }
    if (state.compute === "configuration_missing") return "needs_configuration";
    if (state.grant === "missing" || state.compute === "grant_missing") return "needs_access";

    switch (execution) {
        case "cancelled":
            return "cancelled";
        case "failed":
            return "failed";
        case "completed":
            return "completed";
        case "none":
            return "ready";
        default:
            return unreachable(execution);
    }
};

export const PRESENTATION_STATUS_LABELS_V1 = {
    outcome_unknown: "Outcome unknown",
    cleanup_required: "Cleanup required",
    cleaning_up: "Cleaning up",
    cancelling: "Cancelling",
    running: "Running",
    needs_confirmation: "Needs confirmation",
    needs_configuration: "Needs configuration",
    needs_access: "Needs access",
    cancelled: "Cancelled",
    failed: "Failed",
    completed: "Completed",
    ready: "Ready",
} as const satisfies Record<PresentationStatusV1, string>;

export const PRESENTATION_STATUS_RANK_V1 = {
    outcome_unknown: 0,
    cleanup_required: 1,
    cleaning_up: 2,
    cancelling: 3,
    running: 4,
    needs_confirmation: 5,
    needs_configuration: 6,
    needs_access: 7,
    cancelled: 8,
    failed: 9,
    completed: 10,
    ready: 11,
} as const satisfies Record<PresentationStatusV1, number>;
