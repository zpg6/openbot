const identifierPattern = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

export const D1_HERMETIC_PROBE_SCOPE_V1 = {
    schema_version: 1,
    evidence_scope: "hermetic_test_only",
    authoritative: false,
    eligible_for_attestation: false,
    eligible_for_gate_attestation: false,
    gate_promotion_allowed: false,
    proves_outbound_delivery: false,
    storage: "disposable_non_migration_d1_sql",
} as const;

type ProbeNameV1 = "audit_head" | "gateway_reservation" | "guarded_create" | "sandbox_capacity";

type ProbeOutcomeV1 =
    | "append_replay"
    | "appended"
    | "capacity_denied"
    | "created"
    | "create_replay"
    | "destroy_observation_conflict"
    | "destroy_observation_recorded"
    | "destroy_observation_replay"
    | "different_digest_conflict"
    | "gate_denied"
    | "head_contention_lost"
    | "head_precondition_denied"
    | "inconclusive"
    | "release_replay"
    | "release_denied"
    | "released"
    | "reservation_conflict"
    | "reservation_replay"
    | "reserved"
    | "revoked_after_create"
    | "revoked_before_create"
    | "same_digest_replay"
    | "stale_or_duplicate_release";

export interface HermeticD1ProbeObservationV1 {
    readonly schema_version: 1;
    readonly evidence_scope: "hermetic_test_only";
    readonly authoritative: false;
    readonly eligible_for_attestation: false;
    readonly eligible_for_gate_attestation: false;
    readonly gate_promotion_allowed: false;
    readonly proves_outbound_delivery: false;
    readonly probe: ProbeNameV1;
    readonly scenario: string;
    readonly writer: string;
    readonly operation_id: string;
    readonly outcome: ProbeOutcomeV1;
}

export interface GuardedCreateInputV1 {
    readonly scenario: string;
    readonly writer: string;
    readonly run_id: string;
    readonly session_digest: string;
    readonly manifest_digest: string;
}

export interface GatewayReservationInputV1 {
    readonly scenario: string;
    readonly writer: string;
    readonly claim_id: string;
    readonly call_kind: "code" | "model" | "provider_tool";
    readonly sequence: number;
    readonly request_digest: string;
}

export interface CapacityReservationInputV1 {
    readonly scenario: string;
    readonly writer: string;
    readonly lease_id: string;
    readonly run_id: string;
    readonly run_attempt_fence: number;
    readonly sandbox_id: string;
}

export interface CapacityDestroyObservationInputV1 {
    readonly scenario: string;
    readonly writer: string;
    readonly observation_id: string;
    readonly lease_id: string;
    readonly run_id: string;
    readonly run_attempt_fence: number;
    readonly sandbox_id: string;
    readonly platform_state: "destroy_requested" | "destroyed";
    readonly receipt_digest: string;
}

export interface CapacityReleaseInputV1 {
    readonly scenario: string;
    readonly writer: string;
    readonly lease_id: string;
    readonly run_id: string;
    readonly run_attempt_fence: number;
    readonly sandbox_id: string;
    readonly destroy_observation_id: string;
    readonly release_claim_id: string;
}

export interface AuditAppendInputV1 {
    readonly scenario: string;
    readonly writer: string;
    readonly append_claim_id: string;
    readonly expected_sequence: number;
    readonly previous_hash: string;
    readonly event_hash: string;
}

export interface GuardedCreateStateV1 {
    readonly authority_state: "active" | "revoked";
    readonly confirmation_state: "consumed" | "discarded" | "live";
    readonly live_confirmation_id: string | null;
    readonly active_run_id: string | null;
    readonly run_state: "active" | "cancellation_requested" | null;
    readonly run_guard_count: number;
    readonly outbox_count: number;
}

export interface GatewayStateV1 {
    readonly remaining: number;
    readonly call_count: number;
    readonly sink_receipt_count: number;
    readonly guard_count: number;
    readonly request_digest: string | null;
    readonly call_kind: "code" | "model" | "provider_tool";
}

export interface CapacityStateV1 {
    readonly maximum: 4;
    readonly reserved: number;
    readonly active_lease_count: number;
    readonly released_lease_count: number;
    readonly destroy_observation_count: number;
}

export interface AuditStateV1 {
    readonly sequence: number;
    readonly head_hash: string;
    readonly event_count: number;
    readonly guard_count: number;
}

const disposableSchema = `
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
`;

const resetSql = `
DELETE FROM _openbot_probe_audit_guard;
DELETE FROM _openbot_probe_audit_event;
DELETE FROM _openbot_probe_audit_head;
DELETE FROM _openbot_probe_capacity_release_guard;
DELETE FROM _openbot_probe_capacity_release;
DELETE FROM _openbot_probe_destroy_observation_guard;
DELETE FROM _openbot_probe_destroy_observation;
DELETE FROM _openbot_probe_capacity_guard;
DELETE FROM _openbot_probe_sandbox_lease;
DELETE FROM _openbot_probe_capacity;
DELETE FROM _openbot_probe_gateway_sink_receipt;
DELETE FROM _openbot_probe_gateway_guard;
DELETE FROM _openbot_probe_gateway_call;
DELETE FROM _openbot_probe_gateway_budget;
DELETE FROM _openbot_probe_outbox;
DELETE FROM _openbot_probe_run_guard;
DELETE FROM _openbot_probe_run;
DELETE FROM _openbot_probe_confirmation;
DELETE FROM _openbot_probe_slot;
DELETE FROM _openbot_probe_authority;
`;

function observe(
    probe: ProbeNameV1,
    scenario: string,
    writer: string,
    operationId: string,
    outcome: ProbeOutcomeV1
): HermeticD1ProbeObservationV1 {
    return {
        schema_version: 1,
        evidence_scope: "hermetic_test_only",
        authoritative: false,
        eligible_for_attestation: false,
        eligible_for_gate_attestation: false,
        gate_promotion_allowed: false,
        proves_outbound_delivery: false,
        probe,
        scenario,
        writer,
        operation_id: operationId,
        outcome,
    };
}

class ProbeBatchValidationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ProbeBatchValidationError";
    }
}

function ownRecord(value: unknown, name: string, expectedKeys: readonly string[]): Readonly<Record<string, unknown>> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new TypeError(`${name} must be an object`);
    }
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Object.keys(descriptors).sort();
    const expected = [...expectedKeys].sort();
    if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
        throw new TypeError(`${name} has unexpected keys`);
    }
    for (const key of keys) {
        const descriptor = descriptors[key];
        if (descriptor === undefined || !("value" in descriptor)) {
            throw new TypeError(`${name}.${key} must be a data property`);
        }
    }
    return Object.fromEntries(keys.map(key => [key, descriptors[key]?.value]));
}

type ReturningValue = boolean | number | string | null;
type ExpectedReturningRow = Readonly<Record<string, ReturningValue>>;

async function exactBatch(
    database: D1Database,
    statements: D1PreparedStatement[],
    expectedRows: ReadonlyArray<readonly ExpectedReturningRow[]>
): Promise<void> {
    const results = await database.batch<Record<string, ReturningValue>>(statements);
    if (results.length !== statements.length || results.length !== expectedRows.length) {
        throw new ProbeBatchValidationError("D1 batch returned an unexpected result count");
    }
    for (const [index, result] of results.entries()) {
        if (result.success !== true) {
            throw new ProbeBatchValidationError(`D1 batch result ${index} was not successful`);
        }
        const actualRows = result.results;
        const wantedRows = expectedRows[index];
        if (wantedRows === undefined || actualRows.length !== wantedRows.length) {
            throw new ProbeBatchValidationError(`D1 batch result ${index} had unexpected cardinality`);
        }
        for (const [rowIndex, actual] of actualRows.entries()) {
            const wanted = wantedRows[rowIndex];
            if (wanted === undefined) {
                throw new ProbeBatchValidationError(`D1 batch result ${index} had an unexpected row`);
            }
            const actualKeys = Object.keys(actual).sort();
            const wantedKeys = Object.keys(wanted).sort();
            if (
                actualKeys.length !== wantedKeys.length ||
                actualKeys.some((key, keyIndex) => key !== wantedKeys[keyIndex]) ||
                wantedKeys.some(key => actual[key] !== wanted[key])
            ) {
                throw new ProbeBatchValidationError(`D1 batch result ${index} had unexpected RETURNING data`);
            }
        }
    }
}

async function reconcileOrInconclusive(reconcile: () => Promise<ProbeOutcomeV1>): Promise<ProbeOutcomeV1> {
    try {
        return await reconcile();
    } catch {
        return "inconclusive";
    }
}

function primary(database: D1Database): D1DatabaseSession {
    return database.withSession("first-primary");
}

function errorMessage(error: unknown): string {
    try {
        return error instanceof Error ? error.message : String(error);
    } catch {
        return "";
    }
}

function expectedGuardConstraint(error: unknown, guardTable: string, guardColumn: string): boolean {
    const message = errorMessage(error);
    const d1Constraint = /D1_(?:EXEC_)?ERROR|SQLITE_CONSTRAINT/iu.test(message);
    const foreignKeyGuard = /FOREIGN KEY constraint failed/iu.test(message);
    const exactUniqueGuard =
        /UNIQUE constraint failed/iu.test(message) && message.includes(`${guardTable}.${guardColumn}`);
    return d1Constraint && (foreignKeyGuard || exactUniqueGuard);
}

function expectedAuditTriggerConstraint(error: unknown): boolean {
    const message = errorMessage(error);
    return (
        /D1_(?:EXEC_)?ERROR|SQLITE_CONSTRAINT/iu.test(message) && message.includes("openbot_probe_audit_head_mismatch")
    );
}

function identifier(value: unknown, name: string): string {
    if (typeof value !== "string" || !identifierPattern.test(value)) {
        throw new TypeError(`${name} must match ${identifierPattern.source}`);
    }
    return value;
}

function digest(value: unknown, name: string): string {
    if (typeof value !== "string" || !digestPattern.test(value)) {
        throw new TypeError(`${name} must be a lowercase sha256 digest`);
    }
    return value;
}

function sequence(value: unknown, name: string, minimum: number): number {
    if (!Number.isSafeInteger(value) || (value as number) < minimum) {
        throw new TypeError(`${name} must be a safe integer greater than or equal to ${minimum}`);
    }
    return value as number;
}

function guardedCreateInput(value: unknown): GuardedCreateInputV1 {
    const input = ownRecord(value, "guarded create input", [
        "scenario",
        "writer",
        "run_id",
        "session_digest",
        "manifest_digest",
    ]);
    return {
        scenario: identifier(input["scenario"], "scenario"),
        writer: identifier(input["writer"], "writer"),
        run_id: identifier(input["run_id"], "run_id"),
        session_digest: digest(input["session_digest"], "session_digest"),
        manifest_digest: digest(input["manifest_digest"], "manifest_digest"),
    };
}

function gatewayInput(value: unknown): GatewayReservationInputV1 {
    const input = ownRecord(value, "gateway reservation input", [
        "scenario",
        "writer",
        "claim_id",
        "call_kind",
        "sequence",
        "request_digest",
    ]);
    const callKind = input["call_kind"];
    if (callKind !== "model" && callKind !== "provider_tool" && callKind !== "code") {
        throw new TypeError("call_kind is invalid");
    }
    return {
        scenario: identifier(input["scenario"], "scenario"),
        writer: identifier(input["writer"], "writer"),
        claim_id: identifier(input["claim_id"], "claim_id"),
        call_kind: callKind,
        sequence: sequence(input["sequence"], "sequence", 1),
        request_digest: digest(input["request_digest"], "request_digest"),
    };
}

function capacityReservationInput(value: unknown): CapacityReservationInputV1 {
    const input = ownRecord(value, "capacity reservation input", [
        "scenario",
        "writer",
        "lease_id",
        "run_id",
        "run_attempt_fence",
        "sandbox_id",
    ]);
    return {
        scenario: identifier(input["scenario"], "scenario"),
        writer: identifier(input["writer"], "writer"),
        lease_id: identifier(input["lease_id"], "lease_id"),
        run_id: identifier(input["run_id"], "run_id"),
        run_attempt_fence: sequence(input["run_attempt_fence"], "run_attempt_fence", 1),
        sandbox_id: identifier(input["sandbox_id"], "sandbox_id"),
    };
}

function capacityDestroyObservationInput(value: unknown): CapacityDestroyObservationInputV1 {
    const input = ownRecord(value, "capacity destroy observation input", [
        "scenario",
        "writer",
        "observation_id",
        "lease_id",
        "run_id",
        "run_attempt_fence",
        "sandbox_id",
        "platform_state",
        "receipt_digest",
    ]);
    const platformState = input["platform_state"];
    if (platformState !== "destroy_requested" && platformState !== "destroyed") {
        throw new TypeError("platform_state is invalid");
    }
    return {
        scenario: identifier(input["scenario"], "scenario"),
        writer: identifier(input["writer"], "writer"),
        observation_id: identifier(input["observation_id"], "observation_id"),
        lease_id: identifier(input["lease_id"], "lease_id"),
        run_id: identifier(input["run_id"], "run_id"),
        run_attempt_fence: sequence(input["run_attempt_fence"], "run_attempt_fence", 1),
        sandbox_id: identifier(input["sandbox_id"], "sandbox_id"),
        platform_state: platformState,
        receipt_digest: digest(input["receipt_digest"], "receipt_digest"),
    };
}

function capacityReleaseInput(value: unknown): CapacityReleaseInputV1 {
    const input = ownRecord(value, "capacity release input", [
        "scenario",
        "writer",
        "lease_id",
        "run_id",
        "run_attempt_fence",
        "sandbox_id",
        "destroy_observation_id",
        "release_claim_id",
    ]);
    return {
        scenario: identifier(input["scenario"], "scenario"),
        writer: identifier(input["writer"], "writer"),
        lease_id: identifier(input["lease_id"], "lease_id"),
        run_id: identifier(input["run_id"], "run_id"),
        run_attempt_fence: sequence(input["run_attempt_fence"], "run_attempt_fence", 1),
        sandbox_id: identifier(input["sandbox_id"], "sandbox_id"),
        destroy_observation_id: identifier(input["destroy_observation_id"], "destroy_observation_id"),
        release_claim_id: identifier(input["release_claim_id"], "release_claim_id"),
    };
}

function auditInput(value: unknown): AuditAppendInputV1 {
    const input = ownRecord(value, "audit append input", [
        "scenario",
        "writer",
        "append_claim_id",
        "expected_sequence",
        "previous_hash",
        "event_hash",
    ]);
    return {
        scenario: identifier(input["scenario"], "scenario"),
        writer: identifier(input["writer"], "writer"),
        append_claim_id: identifier(input["append_claim_id"], "append_claim_id"),
        expected_sequence: sequence(input["expected_sequence"], "expected_sequence", 0),
        previous_hash: digest(input["previous_hash"], "previous_hash"),
        event_hash: digest(input["event_hash"], "event_hash"),
    };
}

export async function initializeDisposableD1ProbeTablesV1(database: D1Database): Promise<void> {
    const oneStatementPerLine = disposableSchema
        .trim()
        .split(/\n\s*\n/u)
        .map(statement => statement.replace(/\s+/gu, " ").trim())
        .join("\n");
    await database.exec(oneStatementPerLine);
}

export async function resetDisposableD1ProbeTablesV1(database: D1Database): Promise<void> {
    await database.exec(resetSql);
}

export async function seedGuardedCreateScenarioV1(database: D1Database, rawInput: unknown): Promise<void> {
    const input = guardedCreateInput(rawInput);
    const confirmationId = `confirmation_${input.scenario}`;
    await exactBatch(
        database,
        [
            database
                .prepare(
                    "INSERT INTO _openbot_probe_authority (scenario, state, version) VALUES (?, 'active', 1) RETURNING scenario"
                )
                .bind(input.scenario),
            database
                .prepare(
                    "INSERT INTO _openbot_probe_slot (scenario, live_confirmation_id, active_run_id, version) VALUES (?, ?, NULL, 1) RETURNING scenario, live_confirmation_id"
                )
                .bind(input.scenario, confirmationId),
            database
                .prepare(
                    `INSERT INTO _openbot_probe_confirmation
                (scenario, confirmation_id, candidate_run_id, state, authority_version, session_digest, manifest_digest)
             VALUES (?, ?, ?, 'live', 1, ?, ?)
             RETURNING scenario, confirmation_id, candidate_run_id`
                )
                .bind(input.scenario, confirmationId, input.run_id, input.session_digest, input.manifest_digest),
        ],
        [
            [{ scenario: input.scenario }],
            [{ scenario: input.scenario, live_confirmation_id: confirmationId }],
            [{ scenario: input.scenario, confirmation_id: confirmationId, candidate_run_id: input.run_id }],
        ]
    );
}

export async function runGuardedCreateV1(
    database: D1Database,
    rawInput: unknown
): Promise<HermeticD1ProbeObservationV1> {
    const input = guardedCreateInput(rawInput);
    const confirmationId = `confirmation_${input.scenario}`;
    try {
        await exactBatch(
            database,
            [
                database
                    .prepare(
                        `INSERT INTO _openbot_probe_run (run_id, scenario, state, manifest_digest)
                 SELECT ?, authority.scenario, 'active', confirmation.manifest_digest
                 FROM _openbot_probe_authority AS authority
                 JOIN _openbot_probe_slot AS slot ON slot.scenario = authority.scenario
                 JOIN _openbot_probe_confirmation AS confirmation ON confirmation.scenario = authority.scenario
                 WHERE authority.scenario = ?
                   AND authority.state = 'active'
                   AND authority.version = confirmation.authority_version
                   AND slot.active_run_id IS NULL
                   AND slot.live_confirmation_id = confirmation.confirmation_id
                   AND confirmation.confirmation_id = ?
                   AND confirmation.candidate_run_id = ?
                   AND confirmation.state = 'live'
                   AND confirmation.session_digest = ?
                   AND confirmation.manifest_digest = ?
                 RETURNING run_id, scenario`
                    )
                    .bind(
                        input.run_id,
                        input.scenario,
                        confirmationId,
                        input.run_id,
                        input.session_digest,
                        input.manifest_digest
                    ),
                database
                    .prepare("INSERT INTO _openbot_probe_run_guard (run_id) VALUES (?) RETURNING run_id")
                    .bind(input.run_id),
                database
                    .prepare(
                        `UPDATE _openbot_probe_slot
                 SET active_run_id = ?, version = version + 1
                     ,live_confirmation_id = NULL
                 WHERE scenario = ? AND active_run_id IS NULL AND live_confirmation_id = ?
                 RETURNING scenario, live_confirmation_id, active_run_id`
                    )
                    .bind(input.run_id, input.scenario, confirmationId),
                database
                    .prepare(
                        `UPDATE _openbot_probe_confirmation
                 SET state = 'consumed'
                 WHERE scenario = ? AND candidate_run_id = ? AND state = 'live'
                 RETURNING scenario, state`
                    )
                    .bind(input.scenario, input.run_id),
            ],
            [
                [{ run_id: input.run_id, scenario: input.scenario }],
                [{ run_id: input.run_id }],
                [{ scenario: input.scenario, live_confirmation_id: null, active_run_id: input.run_id }],
                [{ scenario: input.scenario, state: "consumed" }],
            ]
        );
        const state = await readGuardedCreateStateV1(database, input.scenario);
        if (
            state.confirmation_state !== "consumed" ||
            state.live_confirmation_id !== null ||
            state.active_run_id !== input.run_id ||
            state.run_guard_count !== 1 ||
            !(
                (state.authority_state === "active" && state.run_state === "active" && state.outbox_count === 0) ||
                (state.authority_state === "revoked" &&
                    state.run_state === "cancellation_requested" &&
                    state.outbox_count === 1)
            )
        ) {
            return observe("guarded_create", input.scenario, input.writer, input.run_id, "inconclusive");
        }
        return observe("guarded_create", input.scenario, input.writer, input.run_id, "created");
    } catch (error) {
        if (error instanceof ProbeBatchValidationError) {
            return observe("guarded_create", input.scenario, input.writer, input.run_id, "inconclusive");
        }
        if (!expectedGuardConstraint(error, "_openbot_probe_run_guard", "run_id")) {
            return observe("guarded_create", input.scenario, input.writer, input.run_id, "inconclusive");
        }
        const outcome = await reconcileOrInconclusive(async () => {
            const state = await readGuardedCreateStateV1(database, input.scenario);
            return state.authority_state === "revoked" &&
                state.confirmation_state === "discarded" &&
                state.live_confirmation_id === null &&
                state.active_run_id === null &&
                state.run_state === null &&
                state.run_guard_count === 0 &&
                state.outbox_count === 0
                ? "gate_denied"
                : ((state.authority_state === "active" && state.run_state === "active" && state.outbox_count === 0) ||
                        (state.authority_state === "revoked" &&
                            state.run_state === "cancellation_requested" &&
                            state.outbox_count === 1)) &&
                    state.confirmation_state === "consumed" &&
                    state.live_confirmation_id === null &&
                    state.active_run_id === input.run_id &&
                    state.run_guard_count === 1
                  ? "create_replay"
                  : "inconclusive";
        });
        return observe("guarded_create", input.scenario, input.writer, input.run_id, outcome);
    }
}

export async function runGrantRevocationV1(
    database: D1Database,
    rawScenario: unknown,
    rawWriter: unknown
): Promise<HermeticD1ProbeObservationV1> {
    const scenarioValue = identifier(rawScenario, "scenario");
    const writerValue = identifier(rawWriter, "writer");
    const confirmationId = `confirmation_${scenarioValue}`;
    const results = await database.batch<Record<string, ReturningValue>>([
        database
            .prepare(
                `UPDATE _openbot_probe_authority
             SET state = 'revoked', version = version + 1
             WHERE scenario = ? AND state = 'active'
             RETURNING scenario`
            )
            .bind(scenarioValue),
        database
            .prepare(
                `UPDATE _openbot_probe_confirmation
             SET state = 'discarded'
             WHERE scenario = ? AND confirmation_id = ? AND state = 'live'
             RETURNING confirmation_id`
            )
            .bind(scenarioValue, confirmationId),
        database
            .prepare(
                `UPDATE _openbot_probe_slot
             SET live_confirmation_id = NULL, version = version + 1
             WHERE scenario = ? AND live_confirmation_id = ?
             RETURNING scenario`
            )
            .bind(scenarioValue, confirmationId),
        database
            .prepare(
                `UPDATE _openbot_probe_run
             SET state = 'cancellation_requested'
             WHERE scenario = ? AND state = 'active'
             RETURNING run_id`
            )
            .bind(scenarioValue),
        database
            .prepare(
                `INSERT OR IGNORE INTO _openbot_probe_outbox (event_id, run_id, kind)
             SELECT 'revoke_' || scenario, run_id, 'cancel_run'
             FROM _openbot_probe_run
             WHERE scenario = ? AND state = 'cancellation_requested'
             RETURNING event_id, run_id`
            )
            .bind(scenarioValue),
    ]);
    if (results.length !== 5 || results.some(result => result.success !== true)) {
        return observe("guarded_create", scenarioValue, writerValue, `revoke_${scenarioValue}`, "inconclusive");
    }
    const authorityRows = results[0]?.results ?? [];
    const confirmationRows = results[1]?.results ?? [];
    const slotRows = results[2]?.results ?? [];
    const runRows = results[3]?.results ?? [];
    const outboxRows = results[4]?.results ?? [];
    if (
        authorityRows.length !== 1 ||
        authorityRows[0]?.["scenario"] !== scenarioValue ||
        !(
            (confirmationRows.length === 1 &&
                confirmationRows[0]?.["confirmation_id"] === confirmationId &&
                slotRows.length === 1 &&
                slotRows[0]?.["scenario"] === scenarioValue &&
                runRows.length === 0 &&
                outboxRows.length === 0) ||
            (confirmationRows.length === 0 &&
                slotRows.length === 0 &&
                runRows.length === 1 &&
                outboxRows.length === 1 &&
                runRows[0]?.["run_id"] === outboxRows[0]?.["run_id"])
        )
    ) {
        return observe("guarded_create", scenarioValue, writerValue, `revoke_${scenarioValue}`, "inconclusive");
    }
    const state = await readGuardedCreateStateV1(database, scenarioValue);
    const revokedBefore =
        state.authority_state === "revoked" &&
        state.confirmation_state === "discarded" &&
        state.live_confirmation_id === null &&
        state.active_run_id === null &&
        state.run_state === null &&
        state.run_guard_count === 0 &&
        state.outbox_count === 0;
    const revokedAfter =
        state.authority_state === "revoked" &&
        state.confirmation_state === "consumed" &&
        state.live_confirmation_id === null &&
        state.active_run_id !== null &&
        state.run_state === "cancellation_requested" &&
        state.run_guard_count === 1 &&
        state.outbox_count === 1;
    return observe(
        "guarded_create",
        scenarioValue,
        writerValue,
        `revoke_${scenarioValue}`,
        revokedBefore ? "revoked_before_create" : revokedAfter ? "revoked_after_create" : "inconclusive"
    );
}

export async function readGuardedCreateStateV1(
    database: D1Database,
    rawScenario: unknown
): Promise<GuardedCreateStateV1> {
    const scenarioValue = identifier(rawScenario, "scenario");
    const row = await primary(database)
        .prepare(
            `SELECT authority.state AS authority_state,
                    confirmation.state AS confirmation_state,
                    slot.live_confirmation_id AS live_confirmation_id,
                    slot.active_run_id AS active_run_id,
                    run.state AS run_state,
                    (SELECT COUNT(*) FROM _openbot_probe_run_guard AS guard WHERE guard.run_id = run.run_id) AS run_guard_count,
                    (SELECT COUNT(*) FROM _openbot_probe_outbox AS outbox WHERE outbox.run_id = run.run_id) AS outbox_count
             FROM _openbot_probe_authority AS authority
             JOIN _openbot_probe_confirmation AS confirmation ON confirmation.scenario = authority.scenario
             JOIN _openbot_probe_slot AS slot ON slot.scenario = authority.scenario
             LEFT JOIN _openbot_probe_run AS run ON run.scenario = authority.scenario
             WHERE authority.scenario = ?`
        )
        .bind(scenarioValue)
        .first<GuardedCreateStateV1>();
    if (row === null) throw new Error("guarded create scenario not found");
    return row;
}

export async function seedGatewayScenarioV1(database: D1Database, rawScenario: unknown): Promise<void> {
    const scenarioValue = identifier(rawScenario, "scenario");
    await exactBatch(
        database,
        ["model", "provider_tool", "code"].map(callKind =>
            database
                .prepare(
                    "INSERT INTO _openbot_probe_gateway_budget (scenario, call_kind, remaining) VALUES (?, ?, 1) RETURNING scenario, call_kind"
                )
                .bind(scenarioValue, callKind)
        ),
        ["model", "provider_tool", "code"].map(callKind => [{ scenario: scenarioValue, call_kind: callKind }])
    );
}

export async function runGatewayReservationV1(
    database: D1Database,
    rawInput: unknown
): Promise<HermeticD1ProbeObservationV1> {
    const input = gatewayInput(rawInput);
    try {
        await exactBatch(
            database,
            [
                database
                    .prepare(
                        `INSERT INTO _openbot_probe_gateway_call
                    (scenario, call_kind, sequence, claim_id, request_digest)
                 SELECT budget.scenario, budget.call_kind, ?, ?, ?
                 FROM _openbot_probe_gateway_budget AS budget
                 WHERE budget.scenario = ?
                   AND budget.call_kind = ?
                   AND budget.remaining > 0
                   AND NOT EXISTS (
                       SELECT 1 FROM _openbot_probe_gateway_call AS call
                       WHERE call.scenario = budget.scenario
                         AND call.call_kind = budget.call_kind
                         AND call.sequence = ?
                   )
                 RETURNING scenario, call_kind, sequence, claim_id`
                    )
                    .bind(
                        input.sequence,
                        input.claim_id,
                        input.request_digest,
                        input.scenario,
                        input.call_kind,
                        input.sequence
                    ),
                database
                    .prepare("INSERT INTO _openbot_probe_gateway_guard (claim_id) VALUES (?) RETURNING claim_id")
                    .bind(input.claim_id),
                database
                    .prepare(
                        `UPDATE _openbot_probe_gateway_budget
                 SET remaining = remaining - 1
                 WHERE scenario = ?
                   AND call_kind = ?
                   AND remaining > 0
                   AND EXISTS (
                       SELECT 1 FROM _openbot_probe_gateway_call AS call
                       WHERE call.claim_id = ?
                         AND call.scenario = _openbot_probe_gateway_budget.scenario
                         AND call.call_kind = _openbot_probe_gateway_budget.call_kind
                   )
                 RETURNING scenario, call_kind, remaining`
                    )
                    .bind(input.scenario, input.call_kind, input.claim_id),
                database
                    .prepare(
                        `INSERT INTO _openbot_probe_gateway_sink_receipt (scenario, call_kind, sequence, claim_id)
                 VALUES (?, ?, ?, ?)
                 RETURNING scenario, call_kind, sequence, claim_id`
                    )
                    .bind(input.scenario, input.call_kind, input.sequence, input.claim_id),
            ],
            [
                [
                    {
                        scenario: input.scenario,
                        call_kind: input.call_kind,
                        sequence: input.sequence,
                        claim_id: input.claim_id,
                    },
                ],
                [{ claim_id: input.claim_id }],
                [{ scenario: input.scenario, call_kind: input.call_kind, remaining: 0 }],
                [
                    {
                        scenario: input.scenario,
                        call_kind: input.call_kind,
                        sequence: input.sequence,
                        claim_id: input.claim_id,
                    },
                ],
            ]
        );
        const state = await readGatewayStateV1(database, input.scenario, input.call_kind);
        if (
            state.remaining !== 0 ||
            state.call_count !== 1 ||
            state.sink_receipt_count !== 1 ||
            state.guard_count !== 1 ||
            state.request_digest !== input.request_digest
        ) {
            return observe("gateway_reservation", input.scenario, input.writer, input.claim_id, "inconclusive");
        }
        return observe("gateway_reservation", input.scenario, input.writer, input.claim_id, "reserved");
    } catch (error) {
        if (error instanceof ProbeBatchValidationError) {
            return observe("gateway_reservation", input.scenario, input.writer, input.claim_id, "inconclusive");
        }
        if (!expectedGuardConstraint(error, "_openbot_probe_gateway_guard", "claim_id")) {
            return observe("gateway_reservation", input.scenario, input.writer, input.claim_id, "inconclusive");
        }
        const outcome = await reconcileOrInconclusive(async () => {
            const existing = await primary(database)
                .prepare(
                    `SELECT request_digest FROM _openbot_probe_gateway_call
                 WHERE scenario = ? AND call_kind = ? AND sequence = ?`
                )
                .bind(input.scenario, input.call_kind, input.sequence)
                .first<{ request_digest: string }>();
            const state = await readGatewayStateV1(database, input.scenario, input.call_kind);
            const coherentWinner =
                state.remaining === 0 &&
                state.call_count === 1 &&
                state.sink_receipt_count === 1 &&
                state.guard_count === 1;
            return !coherentWinner
                ? "inconclusive"
                : existing?.request_digest === input.request_digest
                  ? "same_digest_replay"
                  : existing === null
                    ? "gate_denied"
                    : "different_digest_conflict";
        });
        return observe("gateway_reservation", input.scenario, input.writer, input.claim_id, outcome);
    }
}

export async function readGatewayStateV1(
    database: D1Database,
    rawScenario: unknown,
    rawCallKind: unknown
): Promise<GatewayStateV1> {
    const scenarioValue = identifier(rawScenario, "scenario");
    if (rawCallKind !== "model" && rawCallKind !== "provider_tool" && rawCallKind !== "code") {
        throw new TypeError("call_kind is invalid");
    }
    const row = await primary(database)
        .prepare(
            `SELECT budget.remaining AS remaining,
                    budget.call_kind AS call_kind,
                    (SELECT COUNT(*) FROM _openbot_probe_gateway_call AS call WHERE call.scenario = budget.scenario AND call.call_kind = budget.call_kind) AS call_count,
                    (SELECT COUNT(*) FROM _openbot_probe_gateway_sink_receipt AS receipt WHERE receipt.scenario = budget.scenario AND receipt.call_kind = budget.call_kind) AS sink_receipt_count,
                    (SELECT COUNT(*) FROM _openbot_probe_gateway_guard AS guard JOIN _openbot_probe_gateway_call AS call ON call.claim_id = guard.claim_id WHERE call.scenario = budget.scenario AND call.call_kind = budget.call_kind) AS guard_count,
                    (SELECT request_digest FROM _openbot_probe_gateway_call AS call WHERE call.scenario = budget.scenario AND call.call_kind = budget.call_kind LIMIT 1) AS request_digest
             FROM _openbot_probe_gateway_budget AS budget
             WHERE budget.scenario = ? AND budget.call_kind = ?`
        )
        .bind(scenarioValue, rawCallKind)
        .first<GatewayStateV1>();
    if (row === null) throw new Error("gateway scenario not found");
    return row;
}

export async function seedCapacityScenarioV1(database: D1Database, rawScenario: unknown): Promise<void> {
    const scenarioValue = identifier(rawScenario, "scenario");
    await exactBatch(
        database,
        [
            database
                .prepare(
                    "INSERT INTO _openbot_probe_capacity (scenario, maximum, reserved) VALUES (?, 4, 0) RETURNING scenario, maximum, reserved"
                )
                .bind(scenarioValue),
        ],
        [[{ scenario: scenarioValue, maximum: 4, reserved: 0 }]]
    );
}

export async function runSandboxCapacityReservationV1(
    database: D1Database,
    rawInput: unknown
): Promise<HermeticD1ProbeObservationV1> {
    const input = capacityReservationInput(rawInput);
    try {
        await exactBatch(
            database,
            [
                database
                    .prepare(
                        `INSERT INTO _openbot_probe_sandbox_lease
                    (lease_id, scenario, run_id, run_attempt_fence, sandbox_id, state)
                 SELECT ?, capacity.scenario, ?, ?, ?, 'active'
                 FROM _openbot_probe_capacity AS capacity
                 WHERE capacity.scenario = ?
                   AND capacity.reserved < capacity.maximum
                   AND NOT EXISTS (
                       SELECT 1 FROM _openbot_probe_sandbox_lease AS lease
                       WHERE lease.scenario = capacity.scenario AND lease.sandbox_id = ?
                   )
                 RETURNING lease_id, scenario, run_id, run_attempt_fence, sandbox_id`
                    )
                    .bind(
                        input.lease_id,
                        input.run_id,
                        input.run_attempt_fence,
                        input.sandbox_id,
                        input.scenario,
                        input.sandbox_id
                    ),
                database
                    .prepare("INSERT INTO _openbot_probe_capacity_guard (lease_id) VALUES (?) RETURNING lease_id")
                    .bind(input.lease_id),
                database
                    .prepare(
                        `UPDATE _openbot_probe_capacity
                 SET reserved = reserved + 1
                 WHERE scenario = ?
                   AND reserved < maximum
                   AND EXISTS (
                       SELECT 1 FROM _openbot_probe_sandbox_lease AS lease
                       WHERE lease.lease_id = ? AND lease.scenario = _openbot_probe_capacity.scenario
                   )
                 RETURNING scenario`
                    )
                    .bind(input.scenario, input.lease_id),
            ],
            [
                [
                    {
                        lease_id: input.lease_id,
                        scenario: input.scenario,
                        run_id: input.run_id,
                        run_attempt_fence: input.run_attempt_fence,
                        sandbox_id: input.sandbox_id,
                    },
                ],
                [{ lease_id: input.lease_id }],
                [{ scenario: input.scenario }],
            ]
        );
        const lease = await primary(database)
            .prepare(
                `SELECT run_id, run_attempt_fence, sandbox_id, state
                 FROM _openbot_probe_sandbox_lease WHERE lease_id = ? AND scenario = ?`
            )
            .bind(input.lease_id, input.scenario)
            .first<{ run_id: string; run_attempt_fence: number; sandbox_id: string; state: string }>();
        const state = await readCapacityStateV1(database, input.scenario);
        if (
            lease?.run_id !== input.run_id ||
            lease.run_attempt_fence !== input.run_attempt_fence ||
            lease.sandbox_id !== input.sandbox_id ||
            lease.state !== "active" ||
            state.reserved !== state.active_lease_count ||
            state.reserved < 1 ||
            state.reserved > 4
        ) {
            return observe("sandbox_capacity", input.scenario, input.writer, input.lease_id, "inconclusive");
        }
        return observe("sandbox_capacity", input.scenario, input.writer, input.lease_id, "reserved");
    } catch (error) {
        if (error instanceof ProbeBatchValidationError) {
            return observe("sandbox_capacity", input.scenario, input.writer, input.lease_id, "inconclusive");
        }
        if (!expectedGuardConstraint(error, "_openbot_probe_capacity_guard", "lease_id")) {
            return observe("sandbox_capacity", input.scenario, input.writer, input.lease_id, "inconclusive");
        }
        const outcome = await reconcileOrInconclusive(async () => {
            const existing = await primary(database)
                .prepare(
                    `SELECT lease.lease_id, lease.run_id, lease.run_attempt_fence,
                        guard.lease_id AS guarded_lease_id
                 FROM _openbot_probe_sandbox_lease AS lease
                 LEFT JOIN _openbot_probe_capacity_guard AS guard ON guard.lease_id = lease.lease_id
                 WHERE lease.scenario = ? AND lease.sandbox_id = ?`
                )
                .bind(input.scenario, input.sandbox_id)
                .first<{
                    lease_id: string;
                    run_id: string;
                    run_attempt_fence: number;
                    guarded_lease_id: string | null;
                }>();
            const state = await readCapacityStateV1(database, input.scenario);
            const exactReplay =
                existing?.lease_id === input.lease_id &&
                existing.run_id === input.run_id &&
                existing.run_attempt_fence === input.run_attempt_fence &&
                existing.guarded_lease_id === input.lease_id &&
                state.reserved === state.active_lease_count;
            return exactReplay
                ? "reservation_replay"
                : existing === null && state.reserved === 4 && state.active_lease_count === 4
                  ? "capacity_denied"
                  : existing === null
                    ? "inconclusive"
                    : "reservation_conflict";
        });
        return observe("sandbox_capacity", input.scenario, input.writer, input.lease_id, outcome);
    }
}

export async function runSandboxDestroyObservationV1(
    database: D1Database,
    rawInput: unknown
): Promise<HermeticD1ProbeObservationV1> {
    const input = capacityDestroyObservationInput(rawInput);
    try {
        await exactBatch(
            database,
            [
                database
                    .prepare(
                        `INSERT INTO _openbot_probe_destroy_observation
                    (observation_id, lease_id, scenario, run_id, run_attempt_fence, sandbox_id, platform_state, receipt_digest)
                 SELECT ?, lease_id, scenario, run_id, run_attempt_fence, sandbox_id, ?, ?
                 FROM _openbot_probe_sandbox_lease
                 WHERE lease_id = ? AND scenario = ? AND run_id = ? AND run_attempt_fence = ? AND sandbox_id = ?
                 RETURNING observation_id, lease_id, platform_state`
                    )
                    .bind(
                        input.observation_id,
                        input.platform_state,
                        input.receipt_digest,
                        input.lease_id,
                        input.scenario,
                        input.run_id,
                        input.run_attempt_fence,
                        input.sandbox_id
                    ),
                database
                    .prepare(
                        "INSERT INTO _openbot_probe_destroy_observation_guard (observation_id) VALUES (?) RETURNING observation_id"
                    )
                    .bind(input.observation_id),
            ],
            [
                [
                    {
                        observation_id: input.observation_id,
                        lease_id: input.lease_id,
                        platform_state: input.platform_state,
                    },
                ],
                [{ observation_id: input.observation_id }],
            ]
        );
        const recorded = await primary(database)
            .prepare(
                `SELECT observation.observation_id, observation.lease_id, observation.scenario,
                        observation.run_id, observation.run_attempt_fence, observation.sandbox_id,
                        observation.platform_state, observation.receipt_digest,
                        guard.observation_id AS guarded_observation_id
                 FROM _openbot_probe_destroy_observation AS observation
                 JOIN _openbot_probe_destroy_observation_guard AS guard
                   ON guard.observation_id = observation.observation_id
                 WHERE observation.observation_id = ?`
            )
            .bind(input.observation_id)
            .first<Record<string, unknown>>();
        if (
            recorded?.["lease_id"] !== input.lease_id ||
            recorded["scenario"] !== input.scenario ||
            recorded["run_id"] !== input.run_id ||
            recorded["run_attempt_fence"] !== input.run_attempt_fence ||
            recorded["sandbox_id"] !== input.sandbox_id ||
            recorded["platform_state"] !== input.platform_state ||
            recorded["receipt_digest"] !== input.receipt_digest ||
            recorded["guarded_observation_id"] !== input.observation_id
        ) {
            return observe("sandbox_capacity", input.scenario, input.writer, input.observation_id, "inconclusive");
        }
        return observe(
            "sandbox_capacity",
            input.scenario,
            input.writer,
            input.observation_id,
            "destroy_observation_recorded"
        );
    } catch (error) {
        if (error instanceof ProbeBatchValidationError) {
            return observe("sandbox_capacity", input.scenario, input.writer, input.observation_id, "inconclusive");
        }
        if (!expectedGuardConstraint(error, "_openbot_probe_destroy_observation_guard", "observation_id")) {
            return observe("sandbox_capacity", input.scenario, input.writer, input.observation_id, "inconclusive");
        }
        const outcome = await reconcileOrInconclusive(async () => {
            const existing = await primary(database)
                .prepare(
                    `SELECT observation.lease_id, observation.scenario, observation.run_id,
                        observation.run_attempt_fence, observation.sandbox_id, observation.platform_state,
                        observation.receipt_digest, guard.observation_id AS guarded_observation_id
                 FROM _openbot_probe_destroy_observation AS observation
                 LEFT JOIN _openbot_probe_destroy_observation_guard AS guard
                   ON guard.observation_id = observation.observation_id
                 WHERE observation.observation_id = ?`
                )
                .bind(input.observation_id)
                .first<Record<string, unknown>>();
            const exactReplay =
                existing?.["lease_id"] === input.lease_id &&
                existing["scenario"] === input.scenario &&
                existing["run_id"] === input.run_id &&
                existing["run_attempt_fence"] === input.run_attempt_fence &&
                existing["sandbox_id"] === input.sandbox_id &&
                existing["platform_state"] === input.platform_state &&
                existing["receipt_digest"] === input.receipt_digest &&
                existing["guarded_observation_id"] === input.observation_id;
            return exactReplay
                ? "destroy_observation_replay"
                : existing === null
                  ? "inconclusive"
                  : "destroy_observation_conflict";
        });
        return observe("sandbox_capacity", input.scenario, input.writer, input.observation_id, outcome);
    }
}

export async function runSandboxCapacityReleaseV1(
    database: D1Database,
    rawInput: unknown
): Promise<HermeticD1ProbeObservationV1> {
    const input = capacityReleaseInput(rawInput);
    try {
        await exactBatch(
            database,
            [
                database
                    .prepare(
                        `INSERT INTO _openbot_probe_capacity_release (lease_id, release_claim_id, destroy_observation_id)
                 SELECT lease.lease_id, ?, observation.observation_id
                 FROM _openbot_probe_sandbox_lease AS lease
                 JOIN _openbot_probe_destroy_observation AS observation ON observation.lease_id = lease.lease_id
                 WHERE lease.lease_id = ? AND lease.scenario = ? AND lease.run_id = ?
                   AND lease.run_attempt_fence = ? AND lease.sandbox_id = ? AND lease.state = 'active'
                   AND observation.observation_id = ? AND observation.platform_state = 'destroyed'
                 RETURNING lease_id, release_claim_id, destroy_observation_id`
                    )
                    .bind(
                        input.release_claim_id,
                        input.lease_id,
                        input.scenario,
                        input.run_id,
                        input.run_attempt_fence,
                        input.sandbox_id,
                        input.destroy_observation_id
                    ),
                database
                    .prepare(
                        "INSERT INTO _openbot_probe_capacity_release_guard (release_claim_id) VALUES (?) RETURNING release_claim_id"
                    )
                    .bind(input.release_claim_id),
                database
                    .prepare(
                        `UPDATE _openbot_probe_sandbox_lease
                 SET state = 'released'
                 WHERE lease_id = ? AND scenario = ? AND state = 'active'
                 RETURNING lease_id, state`
                    )
                    .bind(input.lease_id, input.scenario),
                database
                    .prepare(
                        `UPDATE _openbot_probe_capacity
                 SET reserved = reserved - 1
                 WHERE scenario = ?
                   AND reserved > 0
                   AND EXISTS (
                       SELECT 1 FROM _openbot_probe_capacity_release AS release
                       WHERE release.lease_id = ? AND release.release_claim_id = ?
                   )
                 RETURNING scenario`
                    )
                    .bind(input.scenario, input.lease_id, input.release_claim_id),
            ],
            [
                [
                    {
                        lease_id: input.lease_id,
                        release_claim_id: input.release_claim_id,
                        destroy_observation_id: input.destroy_observation_id,
                    },
                ],
                [{ release_claim_id: input.release_claim_id }],
                [{ lease_id: input.lease_id, state: "released" }],
                [{ scenario: input.scenario }],
            ]
        );
        const released = await primary(database)
            .prepare(
                `SELECT lease.state, release.release_claim_id, release.destroy_observation_id,
                        guard.release_claim_id AS guarded_release_claim_id
                 FROM _openbot_probe_sandbox_lease AS lease
                 JOIN _openbot_probe_capacity_release AS release ON release.lease_id = lease.lease_id
                 JOIN _openbot_probe_capacity_release_guard AS guard
                   ON guard.release_claim_id = release.release_claim_id
                 WHERE lease.lease_id = ? AND lease.scenario = ?`
            )
            .bind(input.lease_id, input.scenario)
            .first<Record<string, unknown>>();
        const state = await readCapacityStateV1(database, input.scenario);
        if (
            released?.["state"] !== "released" ||
            released["release_claim_id"] !== input.release_claim_id ||
            released["destroy_observation_id"] !== input.destroy_observation_id ||
            released["guarded_release_claim_id"] !== input.release_claim_id ||
            state.reserved !== state.active_lease_count
        ) {
            return observe("sandbox_capacity", input.scenario, input.writer, input.release_claim_id, "inconclusive");
        }
        return observe("sandbox_capacity", input.scenario, input.writer, input.release_claim_id, "released");
    } catch (error) {
        if (error instanceof ProbeBatchValidationError) {
            return observe("sandbox_capacity", input.scenario, input.writer, input.release_claim_id, "inconclusive");
        }
        if (!expectedGuardConstraint(error, "_openbot_probe_capacity_release_guard", "release_claim_id")) {
            return observe("sandbox_capacity", input.scenario, input.writer, input.release_claim_id, "inconclusive");
        }
        const outcome = await reconcileOrInconclusive(async () => {
            const existing = await primary(database)
                .prepare(
                    `SELECT release.release_claim_id, release.destroy_observation_id,
                        guard.release_claim_id AS guarded_release_claim_id
                 FROM _openbot_probe_capacity_release AS release
                 LEFT JOIN _openbot_probe_capacity_release_guard AS guard
                   ON guard.release_claim_id = release.release_claim_id
                 WHERE release.lease_id = ?`
                )
                .bind(input.lease_id)
                .first<{
                    release_claim_id: string;
                    destroy_observation_id: string;
                    guarded_release_claim_id: string | null;
                }>();
            const lease = await primary(database)
                .prepare(
                    `SELECT state, run_id, run_attempt_fence, sandbox_id
                     FROM _openbot_probe_sandbox_lease WHERE lease_id = ? AND scenario = ?`
                )
                .bind(input.lease_id, input.scenario)
                .first<{
                    state: string;
                    run_id: string;
                    run_attempt_fence: number;
                    sandbox_id: string;
                }>();
            const state = await readCapacityStateV1(database, input.scenario);
            const coherentCapacity = state.reserved === state.active_lease_count;
            const exactLease =
                lease?.run_id === input.run_id &&
                lease.run_attempt_fence === input.run_attempt_fence &&
                lease.sandbox_id === input.sandbox_id;
            return existing?.release_claim_id === input.release_claim_id &&
                existing.destroy_observation_id === input.destroy_observation_id &&
                existing.guarded_release_claim_id === input.release_claim_id &&
                exactLease &&
                lease.state === "released" &&
                coherentCapacity
                ? "release_replay"
                : (existing !== null || lease?.state === "released") && coherentCapacity
                  ? "stale_or_duplicate_release"
                  : lease?.state === "active" && exactLease && coherentCapacity
                    ? "release_denied"
                    : "inconclusive";
        });
        return observe("sandbox_capacity", input.scenario, input.writer, input.release_claim_id, outcome);
    }
}

export async function readCapacityStateV1(database: D1Database, rawScenario: unknown): Promise<CapacityStateV1> {
    const scenarioValue = identifier(rawScenario, "scenario");
    const row = await primary(database)
        .prepare(
            `SELECT capacity.maximum AS maximum,
                    capacity.reserved AS reserved,
                    (SELECT COUNT(*) FROM _openbot_probe_sandbox_lease AS lease WHERE lease.scenario = capacity.scenario AND lease.state = 'active') AS active_lease_count,
                    (SELECT COUNT(*) FROM _openbot_probe_sandbox_lease AS lease WHERE lease.scenario = capacity.scenario AND lease.state = 'released') AS released_lease_count
                    ,(SELECT COUNT(*) FROM _openbot_probe_destroy_observation AS observation WHERE observation.scenario = capacity.scenario) AS destroy_observation_count
             FROM _openbot_probe_capacity AS capacity
             WHERE capacity.scenario = ?`
        )
        .bind(scenarioValue)
        .first<CapacityStateV1>();
    if (row === null) throw new Error("capacity scenario not found");
    return row;
}

export async function seedAuditScenarioV1(
    database: D1Database,
    rawScenario: unknown,
    rawGenesisHash: unknown
): Promise<void> {
    const scenarioValue = identifier(rawScenario, "scenario");
    const genesisHash = digest(rawGenesisHash, "genesis_hash");
    await exactBatch(
        database,
        [
            database
                .prepare(
                    "INSERT INTO _openbot_probe_audit_head (scenario, sequence, head_hash) VALUES (?, 0, ?) RETURNING scenario, sequence, head_hash"
                )
                .bind(scenarioValue, genesisHash),
        ],
        [[{ scenario: scenarioValue, sequence: 0, head_hash: genesisHash }]]
    );
}

export async function runAuditAppendV1(database: D1Database, rawInput: unknown): Promise<HermeticD1ProbeObservationV1> {
    const input = auditInput(rawInput);
    const nextSequence = input.expected_sequence + 1;
    try {
        await exactBatch(
            database,
            [
                database
                    .prepare(
                        `INSERT INTO _openbot_probe_audit_event
                    (scenario, sequence, append_claim_id, previous_hash, event_hash)
                 VALUES (?, ?, ?, ?, ?)
                 RETURNING scenario, sequence, append_claim_id, previous_hash, event_hash`
                    )
                    .bind(input.scenario, nextSequence, input.append_claim_id, input.previous_hash, input.event_hash),
                database
                    .prepare(
                        "INSERT INTO _openbot_probe_audit_guard (append_claim_id) VALUES (?) RETURNING append_claim_id"
                    )
                    .bind(input.append_claim_id),
            ],
            [
                [
                    {
                        scenario: input.scenario,
                        sequence: nextSequence,
                        append_claim_id: input.append_claim_id,
                        previous_hash: input.previous_hash,
                        event_hash: input.event_hash,
                    },
                ],
                [{ append_claim_id: input.append_claim_id }],
            ]
        );
        const state = await readAuditStateV1(database, input.scenario);
        if (
            state.sequence !== nextSequence ||
            state.head_hash !== input.event_hash ||
            state.event_count !== nextSequence ||
            state.guard_count !== nextSequence
        ) {
            return observe("audit_head", input.scenario, input.writer, input.append_claim_id, "inconclusive");
        }
        return observe("audit_head", input.scenario, input.writer, input.append_claim_id, "appended");
    } catch (error) {
        if (error instanceof ProbeBatchValidationError) {
            return observe("audit_head", input.scenario, input.writer, input.append_claim_id, "inconclusive");
        }
        if (!expectedAuditTriggerConstraint(error)) {
            return observe("audit_head", input.scenario, input.writer, input.append_claim_id, "inconclusive");
        }
        const outcome = await reconcileOrInconclusive(async () => {
            const existing = await primary(database)
                .prepare(
                    `SELECT append_claim_id, previous_hash, event_hash FROM _openbot_probe_audit_event
                 WHERE scenario = ? AND sequence = ?`
                )
                .bind(input.scenario, nextSequence)
                .first<{ append_claim_id: string; previous_hash: string; event_hash: string }>();
            const state = await readAuditStateV1(database, input.scenario);
            const exactWinnerState =
                existing !== null &&
                state.sequence === nextSequence &&
                state.head_hash === existing.event_hash &&
                state.event_count === nextSequence &&
                state.guard_count === nextSequence;
            const exactReplay =
                exactWinnerState &&
                existing.append_claim_id === input.append_claim_id &&
                existing.previous_hash === input.previous_hash &&
                existing.event_hash === input.event_hash;
            const exactPreconditionDenial =
                existing === null &&
                state.sequence === state.event_count &&
                state.event_count === state.guard_count &&
                (state.sequence !== input.expected_sequence || state.head_hash !== input.previous_hash);
            return exactReplay
                ? "append_replay"
                : exactWinnerState
                  ? "head_contention_lost"
                  : exactPreconditionDenial
                    ? "head_precondition_denied"
                    : "inconclusive";
        });
        return observe("audit_head", input.scenario, input.writer, input.append_claim_id, outcome);
    }
}

export async function readAuditStateV1(database: D1Database, rawScenario: unknown): Promise<AuditStateV1> {
    const scenarioValue = identifier(rawScenario, "scenario");
    const row = await primary(database)
        .prepare(
            `SELECT head.sequence AS sequence,
                    head.head_hash AS head_hash,
                    (SELECT COUNT(*) FROM _openbot_probe_audit_event AS event WHERE event.scenario = head.scenario) AS event_count,
                    (SELECT COUNT(*)
                     FROM _openbot_probe_audit_guard AS guard
                     JOIN _openbot_probe_audit_event AS event ON event.append_claim_id = guard.append_claim_id
                     WHERE event.scenario = head.scenario) AS guard_count
             FROM _openbot_probe_audit_head AS head
             WHERE head.scenario = ?`
        )
        .bind(scenarioValue)
        .first<AuditStateV1>();
    if (row === null) throw new Error("audit scenario not found");
    return row;
}
