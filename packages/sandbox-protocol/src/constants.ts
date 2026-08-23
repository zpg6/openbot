export const SANDBOX_PROTOCOL_VERSION_V1 = 1 as const;
export const SANDBOX_FRAME_MAX_BYTES_V1 = 16 * 1024;
export const SANDBOX_FRAME_MAX_COUNT_V1 = 64;
export const SANDBOX_STREAM_MAX_BYTES_V1 = 256 * 1024;
export const SANDBOX_TEXT_CHUNK_MAX_BYTES_V1 = 12 * 1024;

export const SANDBOX_LIFECYCLE_HARD_LIMITS_V1 = Object.freeze({
    startup_timeout_ms: 60_000,
    process_timeout_ms: 15_000,
    teardown_timeout_ms: 30_000,
    total_sandbox_age_ms: 120_000,
} as const);

export const SANDBOX_EXECUTION_HARD_LIMITS_V1 = Object.freeze({
    max_source_bytes: 32 * 1024,
    max_input_bytes: 128 * 1024,
    max_stdout_bytes: 48 * 1024,
    max_stderr_bytes: 16 * 1024,
    max_result_bytes: 64 * 1024,
    max_output_bytes: 128 * 1024,
    filesystem_bytes_unverified_target: 256 * 1024 * 1024,
    processes_unverified_target: 8,
    max_outbound_requests: 0,
    max_output_frames: SANDBOX_FRAME_MAX_COUNT_V1,
    execution_timeout_ms: SANDBOX_LIFECYCLE_HARD_LIMITS_V1.process_timeout_ms,
} as const);
