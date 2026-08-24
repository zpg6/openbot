// This schema exists only for disposable D1 concurrency probes. It is not a product migration.
export const D1_DISPOSABLE_PROBE_SCHEMA_SQL_V1 = `
CREATE TABLE IF NOT EXISTS _openbot_probe_authority (
    scenario TEXT PRIMARY KEY,
    state TEXT NOT NULL CHECK (state IN ('active', 'revoked')),
    version INTEGER NOT NULL CHECK (version >= 1)
);

CREATE TABLE IF NOT EXISTS _openbot_probe_slot (
    scenario TEXT PRIMARY KEY REFERENCES _openbot_probe_authority(scenario),
    live_confirmation_id TEXT,
    active_run_id TEXT,
    version INTEGER NOT NULL CHECK (version >= 1)
);

CREATE TABLE IF NOT EXISTS _openbot_probe_confirmation (
    scenario TEXT PRIMARY KEY REFERENCES _openbot_probe_authority(scenario),
    confirmation_id TEXT NOT NULL UNIQUE,
    candidate_run_id TEXT NOT NULL UNIQUE,
    state TEXT NOT NULL CHECK (state IN ('live', 'consumed', 'discarded')),
    authority_version INTEGER NOT NULL,
    session_digest TEXT NOT NULL,
    manifest_digest TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS _openbot_probe_run (
    run_id TEXT PRIMARY KEY,
    scenario TEXT NOT NULL UNIQUE REFERENCES _openbot_probe_authority(scenario),
    state TEXT NOT NULL CHECK (state IN ('active', 'cancellation_requested')),
    manifest_digest TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS _openbot_probe_run_guard (
    run_id TEXT PRIMARY KEY REFERENCES _openbot_probe_run(run_id)
);

CREATE TABLE IF NOT EXISTS _openbot_probe_outbox (
    event_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES _openbot_probe_run(run_id),
    kind TEXT NOT NULL CHECK (kind = 'cancel_run')
);

CREATE TABLE IF NOT EXISTS _openbot_probe_gateway_budget (
    scenario TEXT NOT NULL,
    call_kind TEXT NOT NULL CHECK (call_kind IN ('model', 'provider_tool', 'code')),
    remaining INTEGER NOT NULL CHECK (remaining >= 0),
    PRIMARY KEY (scenario, call_kind)
);

CREATE TABLE IF NOT EXISTS _openbot_probe_gateway_call (
    scenario TEXT NOT NULL,
    call_kind TEXT NOT NULL CHECK (call_kind IN ('model', 'provider_tool', 'code')),
    sequence INTEGER NOT NULL CHECK (sequence >= 1),
    claim_id TEXT NOT NULL UNIQUE,
    request_digest TEXT NOT NULL,
    PRIMARY KEY (scenario, call_kind, sequence),
    FOREIGN KEY (scenario, call_kind) REFERENCES _openbot_probe_gateway_budget(scenario, call_kind)
);

CREATE TABLE IF NOT EXISTS _openbot_probe_gateway_guard (
    claim_id TEXT PRIMARY KEY REFERENCES _openbot_probe_gateway_call(claim_id)
);

CREATE TABLE IF NOT EXISTS _openbot_probe_gateway_sink_receipt (
    scenario TEXT NOT NULL,
    call_kind TEXT NOT NULL CHECK (call_kind IN ('model', 'provider_tool', 'code')),
    sequence INTEGER NOT NULL,
    claim_id TEXT NOT NULL UNIQUE,
    PRIMARY KEY (scenario, call_kind, sequence),
    FOREIGN KEY (scenario, call_kind, sequence) REFERENCES _openbot_probe_gateway_call(scenario, call_kind, sequence),
    FOREIGN KEY (claim_id) REFERENCES _openbot_probe_gateway_call(claim_id)
);

CREATE TABLE IF NOT EXISTS _openbot_probe_external_sink_receipt (
    receipt_id TEXT PRIMARY KEY,
    probe_run_id TEXT NOT NULL,
    writer_role TEXT NOT NULL CHECK (writer_role IN ('writer_a', 'writer_b')),
    receipt_kind TEXT NOT NULL CHECK (receipt_kind IN ('private_rpc_probe', 'gateway_dispatch', 'destroy_observation')),
    source_request_digest TEXT NOT NULL,
    receipt_request_digest TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS _openbot_probe_external_trial (
    probe_run_id TEXT NOT NULL,
    trial_id TEXT NOT NULL,
    trial_kind TEXT NOT NULL CHECK (trial_kind = 'gateway_reservation'),
    state TEXT NOT NULL CHECK (state IN ('open', 'closed')),
    expected_contender_count INTEGER NOT NULL CHECK (expected_contender_count = 2),
    PRIMARY KEY (probe_run_id, trial_id)
);

CREATE TABLE IF NOT EXISTS _openbot_probe_external_trial_assignment (
    probe_run_id TEXT NOT NULL,
    trial_id TEXT NOT NULL,
    child_process_id TEXT NOT NULL,
    writer_role TEXT NOT NULL CHECK (writer_role IN ('writer_a', 'writer_b')),
    go_receipt_digest TEXT NOT NULL,
    operation_request_digest TEXT NOT NULL,
    PRIMARY KEY (probe_run_id, trial_id, child_process_id),
    UNIQUE (
        probe_run_id,
        trial_id,
        child_process_id,
        writer_role,
        go_receipt_digest,
        operation_request_digest
    ),
    UNIQUE (probe_run_id, trial_id, go_receipt_digest),
    UNIQUE (probe_run_id, trial_id, operation_request_digest),
    FOREIGN KEY (probe_run_id, trial_id) REFERENCES _openbot_probe_external_trial(probe_run_id, trial_id)
);

CREATE TABLE IF NOT EXISTS _openbot_probe_external_trial_readiness (
    probe_run_id TEXT NOT NULL,
    trial_id TEXT NOT NULL,
    child_process_id TEXT NOT NULL,
    writer_role TEXT NOT NULL CHECK (writer_role IN ('writer_a', 'writer_b')),
    go_receipt_digest TEXT NOT NULL,
    operation_request_digest TEXT NOT NULL,
    request_id TEXT NOT NULL UNIQUE,
    request_digest TEXT NOT NULL,
    PRIMARY KEY (probe_run_id, trial_id, child_process_id),
    FOREIGN KEY (
        probe_run_id,
        trial_id,
        child_process_id,
        writer_role,
        go_receipt_digest,
        operation_request_digest
    ) REFERENCES _openbot_probe_external_trial_assignment(
        probe_run_id,
        trial_id,
        child_process_id,
        writer_role,
        go_receipt_digest,
        operation_request_digest
    )
);

CREATE TABLE IF NOT EXISTS _openbot_probe_external_trial_readiness_guard (
    request_id TEXT PRIMARY KEY REFERENCES _openbot_probe_external_trial_readiness(request_id)
);

CREATE TABLE IF NOT EXISTS _openbot_probe_external_gateway_budget (
    probe_run_id TEXT NOT NULL,
    scenario TEXT NOT NULL,
    call_kind TEXT NOT NULL CHECK (call_kind IN ('model', 'provider_tool', 'code')),
    remaining INTEGER NOT NULL CHECK (remaining >= 0 AND remaining <= 1),
    PRIMARY KEY (probe_run_id, scenario, call_kind)
);

CREATE TABLE IF NOT EXISTS _openbot_probe_external_gateway_reservation (
    probe_run_id TEXT NOT NULL,
    scenario TEXT NOT NULL,
    call_kind TEXT NOT NULL CHECK (call_kind IN ('model', 'provider_tool', 'code')),
    call_sequence INTEGER NOT NULL CHECK (call_sequence >= 1),
    request_id TEXT NOT NULL UNIQUE,
    writer_role TEXT NOT NULL CHECK (writer_role IN ('writer_a', 'writer_b')),
    request_variant TEXT NOT NULL CHECK (request_variant IN ('exact', 'substituted')),
    fault_point TEXT NOT NULL CHECK (fault_point IN ('none', 'reserve_then_crash', 'dispatch_response_lost')),
    logical_call_id TEXT NOT NULL,
    attempt_id TEXT NOT NULL UNIQUE,
    reservation_id TEXT NOT NULL UNIQUE,
    dispatch_request_digest TEXT NOT NULL,
    request_digest TEXT NOT NULL,
    PRIMARY KEY (probe_run_id, scenario, call_kind, call_sequence),
    UNIQUE (probe_run_id, call_kind, logical_call_id),
    FOREIGN KEY (probe_run_id, scenario, call_kind)
        REFERENCES _openbot_probe_external_gateway_budget(probe_run_id, scenario, call_kind)
);

CREATE TABLE IF NOT EXISTS _openbot_probe_external_gateway_guard (
    reservation_id TEXT PRIMARY KEY REFERENCES _openbot_probe_external_gateway_reservation(reservation_id)
);

CREATE TABLE IF NOT EXISTS _openbot_probe_capacity (
    scenario TEXT PRIMARY KEY,
    maximum INTEGER NOT NULL CHECK (maximum = 4),
    reserved INTEGER NOT NULL CHECK (reserved >= 0 AND reserved <= maximum)
);

CREATE TABLE IF NOT EXISTS _openbot_probe_sandbox_lease (
    lease_id TEXT PRIMARY KEY,
    scenario TEXT NOT NULL REFERENCES _openbot_probe_capacity(scenario),
    run_id TEXT NOT NULL,
    run_attempt_fence INTEGER NOT NULL CHECK (run_attempt_fence >= 1),
    sandbox_id TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('active', 'released')),
    UNIQUE (scenario, sandbox_id)
);

CREATE TABLE IF NOT EXISTS _openbot_probe_capacity_guard (
    lease_id TEXT PRIMARY KEY REFERENCES _openbot_probe_sandbox_lease(lease_id)
);

CREATE TABLE IF NOT EXISTS _openbot_probe_capacity_release (
    lease_id TEXT PRIMARY KEY REFERENCES _openbot_probe_sandbox_lease(lease_id),
    release_claim_id TEXT NOT NULL UNIQUE,
    destroy_observation_id TEXT NOT NULL UNIQUE REFERENCES _openbot_probe_destroy_observation(observation_id)
);

CREATE TABLE IF NOT EXISTS _openbot_probe_destroy_observation (
    observation_id TEXT PRIMARY KEY,
    lease_id TEXT NOT NULL REFERENCES _openbot_probe_sandbox_lease(lease_id),
    scenario TEXT NOT NULL,
    run_id TEXT NOT NULL,
    run_attempt_fence INTEGER NOT NULL CHECK (run_attempt_fence >= 1),
    sandbox_id TEXT NOT NULL,
    platform_state TEXT NOT NULL CHECK (platform_state IN ('destroy_requested', 'destroyed')),
    receipt_digest TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS _openbot_probe_destroy_observation_guard (
    observation_id TEXT PRIMARY KEY REFERENCES _openbot_probe_destroy_observation(observation_id)
);

CREATE TABLE IF NOT EXISTS _openbot_probe_capacity_release_guard (
    release_claim_id TEXT PRIMARY KEY REFERENCES _openbot_probe_capacity_release(release_claim_id)
);

CREATE TABLE IF NOT EXISTS _openbot_probe_audit_head (
    scenario TEXT PRIMARY KEY,
    sequence INTEGER NOT NULL CHECK (sequence >= 0),
    head_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS _openbot_probe_audit_event (
    scenario TEXT NOT NULL,
    sequence INTEGER NOT NULL CHECK (sequence >= 1),
    append_claim_id TEXT NOT NULL UNIQUE,
    previous_hash TEXT NOT NULL,
    event_hash TEXT NOT NULL,
    PRIMARY KEY (scenario, sequence),
    FOREIGN KEY (scenario) REFERENCES _openbot_probe_audit_head(scenario)
);

CREATE TABLE IF NOT EXISTS _openbot_probe_audit_guard (
    append_claim_id TEXT PRIMARY KEY REFERENCES _openbot_probe_audit_event(append_claim_id)
);

CREATE TRIGGER IF NOT EXISTS _openbot_probe_audit_append_guard
BEFORE INSERT ON _openbot_probe_audit_event
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1
        FROM _openbot_probe_audit_head AS head
        WHERE head.scenario = NEW.scenario
          AND NEW.sequence = head.sequence + 1
          AND NEW.previous_hash = head.head_hash
    ) THEN RAISE(ABORT, 'openbot_probe_audit_head_mismatch') END;
END;

CREATE TRIGGER IF NOT EXISTS _openbot_probe_audit_advance_head
AFTER INSERT ON _openbot_probe_audit_event
BEGIN
    UPDATE _openbot_probe_audit_head
    SET sequence = NEW.sequence, head_hash = NEW.event_hash
    WHERE scenario = NEW.scenario;
END;
` as const;

export const D1_DISPOSABLE_PROBE_SCHEMA_STATEMENTS_V1 = Object.freeze(
    D1_DISPOSABLE_PROBE_SCHEMA_SQL_V1.trim()
        .split(/\n\s*\n/u)
        .map(statement => statement.replace(/\s+/gu, " ").trim())
);

export interface DisposableD1ProbeSchemaEntryV1 {
    readonly type: "table" | "trigger";
    readonly name: string;
    readonly tbl_name: string;
    readonly sql: string;
}

function schemaEntry(statement: string): DisposableD1ProbeSchemaEntryV1 {
    const table = /^CREATE TABLE IF NOT EXISTS ([a-z0-9_]+)/u.exec(statement);
    if (table?.[1] !== undefined) {
        return Object.freeze({
            type: "table",
            name: table[1],
            tbl_name: table[1],
            sql: statement.replace(/^CREATE TABLE IF NOT EXISTS/u, "CREATE TABLE").replace(/;$/u, ""),
        });
    }

    const trigger = /^CREATE TRIGGER IF NOT EXISTS ([a-z0-9_]+) .* ON ([a-z0-9_]+) BEGIN /u.exec(statement);
    if (trigger?.[1] !== undefined && trigger[2] !== undefined) {
        return Object.freeze({
            type: "trigger",
            name: trigger[1],
            tbl_name: trigger[2],
            sql: statement.replace(/^CREATE TRIGGER IF NOT EXISTS/u, "CREATE TRIGGER").replace(/;$/u, ""),
        });
    }

    throw new Error("invalid disposable D1 probe schema statement");
}

export const D1_DISPOSABLE_PROBE_SCHEMA_MANIFEST_V1 = Object.freeze(
    D1_DISPOSABLE_PROBE_SCHEMA_STATEMENTS_V1.map(schemaEntry)
);

export const D1_DISPOSABLE_PROBE_SCHEMA_TABLE_NAMES_V1 = Object.freeze(
    D1_DISPOSABLE_PROBE_SCHEMA_MANIFEST_V1.filter(entry => entry.type === "table").map(entry => entry.name)
);

export const D1_DISPOSABLE_PROBE_SCHEMA_TRIGGERS_V1 = Object.freeze(
    D1_DISPOSABLE_PROBE_SCHEMA_MANIFEST_V1.filter(entry => entry.type === "trigger").map(entry =>
        Object.freeze({ name: entry.name, tbl_name: entry.tbl_name })
    )
);

export const D1_DISPOSABLE_PROBE_SCHEMA_SHA256_V1 =
    "sha256:af03a7328447a2a254ce93ea6d66f912399645e610efe1422380c2f55e1aadad" as const;
