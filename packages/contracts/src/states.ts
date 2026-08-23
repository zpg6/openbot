import { z } from "zod";

export const AccountStateV1Schema = z.enum(["active", "disabled"]);
export type AccountStateV1 = z.infer<typeof AccountStateV1Schema>;

export const BotStateV1Schema = z.enum(["active", "disabled"]);
export type BotStateV1 = z.infer<typeof BotStateV1Schema>;

export const CapabilityGrantStateV1Schema = z.enum(["active", "revoked", "expired"]);
export type CapabilityGrantStateV1 = z.infer<typeof CapabilityGrantStateV1Schema>;

export const CatalogDependencyStateV1Schema = z.enum(["usable", "unusable"]);
export type CatalogDependencyStateV1 = z.infer<typeof CatalogDependencyStateV1Schema>;

export const ConfirmationStateV1Schema = z.enum(["none", "live"]);
export type ConfirmationStateV1 = z.infer<typeof ConfirmationStateV1Schema>;

export const RunExecutionStateV1Schema = z.enum([
    "requested",
    "queued",
    "provisioning",
    "running",
    "result_pending_import",
    "result_imported",
    "succeeded",
    "failed",
    "cancellation_requested",
    "cancelled",
    "cancelled_with_effect_unknown",
    "outcome_unknown",
    "result_lost_after_execution",
]);
export type RunExecutionStateV1 = z.infer<typeof RunExecutionStateV1Schema>;

export const CleanupStateV1Schema = z.enum(["not_required", "pending", "running", "complete", "manual_required"]);
export type CleanupStateV1 = z.infer<typeof CleanupStateV1Schema>;

export const ProviderEvidenceStateV1Schema = z.enum(["complete", "partial", "unavailable"]);
export type ProviderEvidenceStateV1 = z.infer<typeof ProviderEvidenceStateV1Schema>;

export const SandboxExecutionStateV1Schema = z.enum([
    "requested",
    "provisioning",
    "ready",
    "executing",
    "destroy_requested",
    "destroyed",
    "destroy_unverified",
    "manual_required",
]);
export type SandboxExecutionStateV1 = z.infer<typeof SandboxExecutionStateV1Schema>;

export const SandboxCommandStateV1Schema = z.enum([
    "reserved",
    "dispatched",
    "completed",
    "failed",
    "timed_out",
    "cancelled",
    "outcome_unknown",
]);
export type SandboxCommandStateV1 = z.infer<typeof SandboxCommandStateV1Schema>;

export const PresentationStatusV1Schema = z.enum([
    "outcome_unknown",
    "cleanup_required",
    "cleaning_up",
    "cancelling",
    "running",
    "needs_confirmation",
    "needs_configuration",
    "needs_access",
    "cancelled",
    "failed",
    "completed",
    "ready",
]);
export type PresentationStatusV1 = z.infer<typeof PresentationStatusV1Schema>;

export const PresentationStateV1Schema = z
    .object({
        account: AccountStateV1Schema,
        bot: BotStateV1Schema,
        catalog: CatalogDependencyStateV1Schema,
        grant: z.enum(["usable", "missing"]),
        compute: z.enum(["not_selected", "usable", "configuration_missing", "grant_missing"]),
        confirmation: ConfirmationStateV1Schema,
        execution: RunExecutionStateV1Schema.nullable(),
        cleanup: CleanupStateV1Schema,
        evidence: ProviderEvidenceStateV1Schema,
    })
    .strict();
export type PresentationStateV1 = z.infer<typeof PresentationStateV1Schema>;
