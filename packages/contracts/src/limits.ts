import { z } from "zod";

const boundedInteger = (maximum: number) => z.number().int().positive().max(maximum);

export const ArtifactRuntimeLimitsV1Schema = z
    .object({
        max_snapshot_mounts: boundedInteger(8),
        max_operations: boundedInteger(32),
        max_listed_entries: boundedInteger(500),
        max_text_read_bytes: boundedInteger(128 * 1024),
        max_total_read_bytes: boundedInteger(512 * 1024),
        max_model_visible_text_bytes: boundedInteger(128 * 1024),
        max_draft_objects: boundedInteger(8),
        max_draft_bytes: boundedInteger(1024 * 1024),
        max_bytes_per_draft: boundedInteger(128 * 1024),
    })
    .strict();
export type ArtifactRuntimeLimitsV1 = z.infer<typeof ArtifactRuntimeLimitsV1Schema>;

export const RuntimeLimitsV1Schema = z
    .object({
        schema_version: z.literal(1),
        max_prompt_bytes: boundedInteger(16 * 1024),
        max_model_request_bytes: boundedInteger(256 * 1024),
        max_exposed_tools: boundedInteger(4),
        max_selected_skills: boundedInteger(4),
        max_skill_instruction_bytes: boundedInteger(32 * 1024),
        max_tool_schema_bytes: boundedInteger(128 * 1024),
        max_tool_argument_bytes_per_call: boundedInteger(16 * 1024),
        max_tool_result_bytes_per_call: boundedInteger(128 * 1024),
        max_safe_summary_bytes_per_call: boundedInteger(4 * 1024),
        max_model_turns: boundedInteger(3),
        max_tool_calls: boundedInteger(2),
        max_estimated_model_input_tokens_per_request: boundedInteger(32_000),
        max_model_output_tokens_per_request: boundedInteger(2_048),
        max_model_stream_bytes_per_request: boundedInteger(128 * 1024),
        max_runtime_wall_time_ms: boundedInteger(120_000),
        max_durable_metadata_events: boundedInteger(64),
        max_ndjson_frame_bytes: boundedInteger(16 * 1024),
        max_durable_event_bytes_per_run: boundedInteger(256 * 1024),
        max_final_answer_bytes: boundedInteger(64 * 1024),
        max_estimated_run_cost_usd_micros: boundedInteger(250_000),
        max_queue_delivery_attempts: boundedInteger(3),
        queue_message_retention_ms: boundedInteger(24 * 60 * 60 * 1000),
        outbox_dispatch_lease_ms: boundedInteger(30_000),
        run_attempt_lease_ms: boundedInteger(180_000),
        run_attempt_heartbeat_ms: boundedInteger(30_000),
        max_automatic_cleanup_attempts: boundedInteger(10),
        automatic_cleanup_window_ms: boundedInteger(24 * 60 * 60 * 1000),
        raw_content_retention_ms: boundedInteger(7 * 24 * 60 * 60 * 1000),
        max_openrouter_price_snapshot_age_ms: boundedInteger(24 * 60 * 60 * 1000),
        redacted_audit_retention: z.literal("indefinite"),
        artifact_workspace: ArtifactRuntimeLimitsV1Schema.optional(),
    })
    .strict()
    .superRefine((limits, context) => {
        if (limits.run_attempt_heartbeat_ms >= limits.run_attempt_lease_ms) {
            context.addIssue({
                code: "custom",
                path: ["run_attempt_heartbeat_ms"],
                message: "Heartbeat must be shorter than the run-attempt lease",
            });
        }
        if (
            limits.artifact_workspace &&
            limits.artifact_workspace.max_bytes_per_draft > limits.artifact_workspace.max_draft_bytes
        ) {
            context.addIssue({
                code: "custom",
                path: ["artifact_workspace", "max_bytes_per_draft"],
                message: "Per-draft bytes cannot exceed total draft bytes",
            });
        }
        if (
            limits.artifact_workspace &&
            limits.artifact_workspace.max_text_read_bytes > limits.artifact_workspace.max_total_read_bytes
        ) {
            context.addIssue({
                code: "custom",
                path: ["artifact_workspace", "max_text_read_bytes"],
                message: "Per-read bytes cannot exceed total read bytes",
            });
        }
        if (
            limits.artifact_workspace &&
            limits.artifact_workspace.max_model_visible_text_bytes > limits.artifact_workspace.max_total_read_bytes
        ) {
            context.addIssue({
                code: "custom",
                path: ["artifact_workspace", "max_model_visible_text_bytes"],
                message: "Model-visible bytes cannot exceed total read bytes",
            });
        }
        if (
            limits.artifact_workspace &&
            limits.artifact_workspace.max_snapshot_mounts > limits.artifact_workspace.max_operations
        ) {
            context.addIssue({
                code: "custom",
                path: ["artifact_workspace", "max_snapshot_mounts"],
                message: "Snapshot mounts cannot exceed artifact operations",
            });
        }
        if (
            limits.artifact_workspace &&
            limits.artifact_workspace.max_draft_objects > limits.artifact_workspace.max_operations
        ) {
            context.addIssue({
                code: "custom",
                path: ["artifact_workspace", "max_draft_objects"],
                message: "Draft objects cannot exceed artifact operations",
            });
        }
    });
export type RuntimeLimitsV1 = z.infer<typeof RuntimeLimitsV1Schema>;

export const DEFAULT_RUNTIME_LIMITS_V1 = Object.freeze({
    schema_version: 1,
    max_prompt_bytes: 16 * 1024,
    max_model_request_bytes: 256 * 1024,
    max_exposed_tools: 4,
    max_selected_skills: 4,
    max_skill_instruction_bytes: 32 * 1024,
    max_tool_schema_bytes: 128 * 1024,
    max_tool_argument_bytes_per_call: 16 * 1024,
    max_tool_result_bytes_per_call: 128 * 1024,
    max_safe_summary_bytes_per_call: 4 * 1024,
    max_model_turns: 3,
    max_tool_calls: 2,
    max_estimated_model_input_tokens_per_request: 32_000,
    max_model_output_tokens_per_request: 2_048,
    max_model_stream_bytes_per_request: 128 * 1024,
    max_runtime_wall_time_ms: 120_000,
    max_durable_metadata_events: 64,
    max_ndjson_frame_bytes: 16 * 1024,
    max_durable_event_bytes_per_run: 256 * 1024,
    max_final_answer_bytes: 64 * 1024,
    max_estimated_run_cost_usd_micros: 250_000,
    max_queue_delivery_attempts: 3,
    queue_message_retention_ms: 24 * 60 * 60 * 1000,
    outbox_dispatch_lease_ms: 30_000,
    run_attempt_lease_ms: 180_000,
    run_attempt_heartbeat_ms: 30_000,
    max_automatic_cleanup_attempts: 10,
    automatic_cleanup_window_ms: 24 * 60 * 60 * 1000,
    raw_content_retention_ms: 7 * 24 * 60 * 60 * 1000,
    max_openrouter_price_snapshot_age_ms: 24 * 60 * 60 * 1000,
    redacted_audit_retention: "indefinite",
} as const satisfies RuntimeLimitsV1);

export const DEFAULT_ARTIFACT_RUNTIME_LIMITS_V1 = Object.freeze({
    max_snapshot_mounts: 8,
    max_operations: 32,
    max_listed_entries: 500,
    max_text_read_bytes: 128 * 1024,
    max_total_read_bytes: 512 * 1024,
    max_model_visible_text_bytes: 128 * 1024,
    max_draft_objects: 8,
    max_draft_bytes: 1024 * 1024,
    max_bytes_per_draft: 128 * 1024,
} as const satisfies ArtifactRuntimeLimitsV1);
