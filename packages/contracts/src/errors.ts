import { z } from "zod";

export const DENY_CODES_V1 = [
    "account_not_active",
    "artifact_snapshot_pending",
    "bot_busy",
    "bot_not_active",
    "catalog_dependency_disabled",
    "cleanup_blocked",
    "confirmation_consumed",
    "confirmation_exists",
    "confirmation_session_mismatch",
    "confirmation_stale",
    "connector_schema_changed",
    "cross_authorization_policy",
    "cross_deployment_policy",
    "data_class_unknown",
    "destination_not_allowed",
    "grant_not_active",
    "idempotency_mismatch",
    "impact_changed",
    "limit_exceeded",
    "model_route_unavailable",
    "outbound_field_not_allowed",
    "resource_scope_unsupported",
    "skill_disabled",
    "tool_not_selected",
    "write_tool_denied",
    "zdr_unavailable",
] as const;

export const DenyCodeV1Schema = z.enum(DENY_CODES_V1);
export type DenyCodeV1 = z.infer<typeof DenyCodeV1Schema>;

export const ERROR_CODES_V1 = [
    ...DENY_CODES_V1,
    "content_deleted",
    "external_outcome_unknown",
    "internal_error",
    "invalid_command",
    "invalid_cursor",
    "not_found",
    "rate_limited",
    "vendor_protocol_error",
] as const;

export const ErrorCodeV1Schema = z.enum(ERROR_CODES_V1);
export type ErrorCodeV1 = z.infer<typeof ErrorCodeV1Schema>;
