import { z } from "zod";

import {
    D1_DISPOSABLE_PROBE_SCHEMA_MANIFEST_V1,
    D1_DISPOSABLE_PROBE_SCHEMA_SHA256_V1,
    D1_DISPOSABLE_PROBE_SCHEMA_SQL_V1,
    D1_DISPOSABLE_PROBE_SCHEMA_STATEMENTS_V1,
    D1_DISPOSABLE_PROBE_SCHEMA_TABLE_NAMES_V1,
    D1_DISPOSABLE_PROBE_SCHEMA_TRIGGERS_V1,
} from "@openbot/d1-probe-rpc/schema";
import {
    canonicalizeJsonV1,
    digestCanonicalJsonV1,
    type CanonicalJsonValueV1,
} from "@openbot/gate-attestation/internal";

import {
    D1ProbeCommitmentKeyV1Schema,
    D1ProbeLifecycleJournalV1Schema,
    type D1ProbeLifecycleJournalV1,
} from "./contracts.js";
import { resolveCreatedD1ProbeDatabaseV1, type CreatedD1ProbeDatabaseV1 } from "./cloudflare-database.js";
import {
    isD1ProbeLifecycleJournalBoundV1,
    isD1ProbeLifecycleJournalReadyForStepV1,
    markD1ProbeLifecycleAmbiguousV1,
} from "./lifecycle.js";
import { resolveVerifiedD1ProbePreflightV1, verifyD1ProbePreflightV1 } from "./verified-preflight.js";

const CLOUDFLARE_API_ORIGIN_V1 = "https://api.cloudflare.com";
const CLOUDFLARE_API_PREFIX_V1 = "/client/v4";
const CLOUDFLARE_RESPONSE_LIMIT_BYTES_V1 = 262_144;
const CLOUDFLARE_TOTAL_TIMEOUT_MS_V1 = 20_000;

const CloudflareApiTokenV1Schema = z.string().regex(/^[A-Za-z0-9_-]{20,256}$/u);
const QueryMetaV1Schema = z
    .object({
        changed_db: z.boolean(),
        changes: z.number().int().min(0),
        duration: z.number().finite().min(0),
        last_row_id: z.number().int(),
        rows_read: z.number().int().min(0),
        rows_written: z.number().int().min(0),
        served_by_primary: z.literal(true),
        size_after: z.number().int().min(0),
    })
    .passthrough();
const QueryResultV1Schema = z
    .object({
        meta: QueryMetaV1Schema,
        results: z.array(z.unknown()),
        success: z.literal(true),
    })
    .strict();
const QuerySuccessEnvelopeV1Schema = z
    .object({
        errors: z.array(z.unknown()).length(0),
        messages: z.array(z.unknown()).length(0),
        result: z.array(QueryResultV1Schema),
        success: z.literal(true),
    })
    .strict();
const ConstraintFailureEnvelopeV1Schema = z
    .object({
        errors: z
            .array(
                z
                    .object({
                        code: z.number().int().min(1_000),
                        message: z.string().regex(/(?:^|:)\s*FOREIGN KEY constraint failed(?:\s|$)/u),
                    })
                    .passthrough()
            )
            .length(1),
        messages: z.array(z.unknown()).length(0),
        result: z.null(),
        success: z.literal(false),
    })
    .strict();

const schemaStatements = D1_DISPOSABLE_PROBE_SCHEMA_STATEMENTS_V1;
const schemaObjects = Object.freeze(
    [...D1_DISPOSABLE_PROBE_SCHEMA_MANIFEST_V1].sort(
        (left, right) => left.type.localeCompare(right.type) || left.name.localeCompare(right.name)
    )
);

const SchemaRowV1Schema = z
    .object({
        type: z.enum(["table", "trigger"]),
        name: z.string().regex(/^_openbot_probe_[a-z0-9_]+$/u),
        tbl_name: z.string().regex(/^_openbot_probe_[a-z0-9_]+$/u),
        sql: z.string().min(1).max(16_384),
    })
    .strict();
const ForeignKeysRowV1Schema = z.object({ foreign_keys: z.literal(1) }).strict();
const CanaryRowV1Schema = z.object({ row_count: z.literal(0) }).strict();

const FOREIGN_KEYS_SQL_V1 = "PRAGMA foreign_keys";
const SCHEMA_READBACK_SQL_V1 =
    "SELECT type, name, tbl_name, sql FROM main.sqlite_schema WHERE (name GLOB '_openbot_probe_*' OR tbl_name GLOB '_openbot_probe_*') AND name NOT LIKE 'sqlite_%' AND type IN ('table', 'trigger', 'index', 'view') ORDER BY type ASC, name ASC";
const CANARY_INSERT_SQL_V1 = "INSERT INTO _openbot_probe_authority (scenario, state, version) VALUES (?, 'active', 1)";
const CANARY_REJECT_SQL_V1 =
    "INSERT INTO _openbot_probe_slot (scenario, live_confirmation_id, active_run_id, version) VALUES (?, NULL, NULL, 1)";
const CANARY_READBACK_SQL_V1 = "SELECT COUNT(*) AS row_count FROM _openbot_probe_authority WHERE scenario = ?";

export interface D1ProbeCloudflareDatabaseBootstrapDependenciesV1 {
    readonly fetch: typeof globalThis.fetch;
}

export interface InitializedD1ProbeDatabaseV1 {
    readonly schema_version: 1;
    readonly kind: "initialized_d1_probe_database";
}

export interface InitializedD1ProbeDatabaseContextV1 {
    readonly created_database: CreatedD1ProbeDatabaseV1;
    readonly plan_digest: string;
    readonly journal_digest: string;
    readonly schema_digest: typeof D1_DISPOSABLE_PROBE_SCHEMA_SHA256_V1;
    readonly database_id_commitment: string;
    readonly database_name_commitment: string;
    readonly observation_digest: string;
}

export interface UntrustedD1ProbeDatabaseBootstrapObservationV1 {
    readonly schema_version: 1;
    readonly kind: "untrusted_d1_probe_database_bootstrap_observation";
    readonly authoritative: false;
    readonly deploy_performed: true;
    readonly eligible_for_attestation: false;
    readonly gate_promotion_allowed: false;
    readonly plan_digest: string;
    readonly journal_digest: string;
    readonly schema_digest: typeof D1_DISPOSABLE_PROBE_SCHEMA_SHA256_V1;
    readonly database_id_commitment: string;
    readonly database_name_commitment: string;
    readonly table_count: number;
    readonly trigger_count: number;
    readonly foreign_keys: 1;
    readonly rollback_canary: "constraint_rejected_and_rolled_back";
    readonly observation_digest: string;
}

export type BootstrapD1ProbeDatabaseDenialV1 =
    | "invalid_created_database"
    | "invalid_lifecycle_journal"
    | "invalid_commitment_key"
    | "invalid_api_token"
    | "preflight_reverification_failed"
    | "resource_binding_mismatch"
    | "schema_digest_mismatch"
    | "commitment_unavailable"
    | "database_bootstrap_already_requested"
    | "database_bootstrap_outcome_unknown"
    | "database_schema_mismatch"
    | "database_foreign_keys_disabled"
    | "database_rollback_canary_failed"
    | "observation_digest_unavailable";

type PostDispatchFailureV1 = Readonly<{
    success: false;
    code:
        | "database_bootstrap_outcome_unknown"
        | "database_schema_mismatch"
        | "database_foreign_keys_disabled"
        | "database_rollback_canary_failed"
        | "observation_digest_unavailable";
    journal: D1ProbeLifecycleJournalV1;
    cleanup_target: CreatedD1ProbeDatabaseV1;
}>;

const initializedDatabases = new WeakMap<InitializedD1ProbeDatabaseV1, InitializedD1ProbeDatabaseContextV1>();
const bootstrapRequestedDatabases = new WeakSet<CreatedD1ProbeDatabaseV1>();
const bootstrapCleanupBindings = new WeakMap<CreatedD1ProbeDatabaseV1, string>();
const encoder = new TextEncoder();

export const resolveInitializedD1ProbeDatabaseV1 = (
    initialized: InitializedD1ProbeDatabaseV1
): InitializedD1ProbeDatabaseContextV1 | null => initializedDatabases.get(initialized) ?? null;

const safeParse = <T>(
    schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } },
    input: unknown
) => {
    try {
        return schema.safeParse(input);
    } catch {
        return { success: false } as const;
    }
};

const arrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const encodeBase64Url = (bytes: Uint8Array): string =>
    globalThis
        .btoa(String.fromCharCode(...bytes))
        .replace(/=/gu, "")
        .replace(/\+/gu, "-")
        .replace(/\//gu, "_");

const decodeBase64Url = (value: string): Uint8Array | null => {
    try {
        const padding = "=".repeat((4 - (value.length % 4)) % 4);
        const binary = globalThis.atob(value.replace(/-/gu, "+").replace(/_/gu, "/") + padding);
        const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
        return encodeBase64Url(bytes) === value ? bytes : null;
    } catch {
        return null;
    }
};

const toHex = (bytes: ArrayBuffer): string =>
    [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");

const importCommitmentKey = async (input: unknown): Promise<CryptoKey | null> => {
    const parsed = safeParse(D1ProbeCommitmentKeyV1Schema, input);
    if (!parsed.success) return null;
    const raw = decodeBase64Url(parsed.data.hmac_key_base64url);
    if (raw === null || raw.byteLength < 32 || raw.byteLength > 64) return null;
    try {
        return await globalThis.crypto.subtle.importKey(
            "raw",
            arrayBuffer(raw),
            { name: "HMAC", hash: "SHA-256" },
            false,
            ["sign"]
        );
    } catch {
        return null;
    } finally {
        raw.fill(0);
    }
};

const hmacValue = async (key: CryptoKey, domain: string, value: CanonicalJsonValueV1): Promise<string | null> => {
    try {
        const bytes = encoder.encode(`${domain}\u0000${canonicalizeJsonV1(value)}`);
        return toHex(await globalThis.crypto.subtle.sign("HMAC", key, arrayBuffer(bytes)));
    } catch {
        return null;
    }
};

const rawSha256 = async (value: string): Promise<string | null> => {
    try {
        return `sha256:${toHex(await globalThis.crypto.subtle.digest("SHA-256", arrayBuffer(encoder.encode(value))))}`;
    } catch {
        return null;
    }
};

const readBoundedJson = async (response: Response, expectedStatus: number): Promise<unknown | null> => {
    if (response.status !== expectedStatus || response.redirected || response.body === null) {
        await response.body?.cancel("Cloudflare API response was invalid").catch(() => undefined);
        return null;
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/u.test(contentType)) {
        await response.body.cancel("Cloudflare API content type was invalid").catch(() => undefined);
        return null;
    }
    const contentEncoding = response.headers.get("content-encoding")?.toLowerCase();
    if (contentEncoding !== undefined && contentEncoding !== "identity") {
        await response.body.cancel("Cloudflare API encoding was invalid").catch(() => undefined);
        return null;
    }
    const declared = response.headers.get("content-length");
    if (
        declared !== null &&
        (!/^(?:0|[1-9][0-9]{0,6})$/u.test(declared) || Number(declared) > CLOUDFLARE_RESPONSE_LIMIT_BYTES_V1)
    ) {
        await response.body.cancel("Cloudflare API response was too large").catch(() => undefined);
        return null;
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
        while (true) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > CLOUDFLARE_RESPONSE_LIMIT_BYTES_V1) {
                await reader.cancel("Cloudflare API response was too large");
                return null;
            }
            chunks.push(part.value);
        }
    } catch {
        return null;
    } finally {
        reader.releaseLock();
    }
    if (declared !== null && Number(declared) !== size) return null;
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try {
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
    } catch {
        return null;
    }
};

const query = async (
    fetchImplementation: typeof globalThis.fetch,
    endpoint: string,
    token: string,
    body: CanonicalJsonValueV1,
    signal: AbortSignal,
    expectedStatus = 200
): Promise<unknown | null> => {
    try {
        const response = await fetchImplementation(endpoint, {
            method: "POST",
            headers: {
                accept: "application/json",
                "accept-encoding": "identity",
                authorization: `Bearer ${token}`,
                "content-type": "application/json",
            },
            body: canonicalizeJsonV1(body),
            cache: "no-store",
            credentials: "omit",
            redirect: "manual",
            signal,
        });
        return await readBoundedJson(response, expectedStatus);
    } catch {
        return null;
    }
};

const parseJournal = (input: unknown): D1ProbeLifecycleJournalV1 | null => {
    const parsed = safeParse(D1ProbeLifecycleJournalV1Schema, input);
    if (!parsed.success) return null;
    const journal = parsed.data;
    return journal.state === "provisioning" &&
        journal.completed_steps.length === 1 &&
        journal.completed_steps[0] === "database_created" &&
        journal.observations.length === 1 &&
        journal.observations[0]?.step === "database_created" &&
        journal.manual_required === null
        ? journal
        : null;
};

const queryEnvelope = (input: unknown) => safeParse(QuerySuccessEnvelopeV1Schema, input);

const hasExactDdlAndSchemaResults = (input: unknown): boolean => {
    const parsed = queryEnvelope(input);
    if (!parsed.success || parsed.data.result.length !== schemaStatements.length + 2) return false;
    const initialReadback = parsed.data.result[0];
    if (
        initialReadback === undefined ||
        initialReadback.meta.changed_db ||
        initialReadback.meta.changes !== 0 ||
        initialReadback.results.length !== 0
    ) {
        return false;
    }
    const ddlResults = parsed.data.result.slice(1, schemaStatements.length + 1);
    if (
        !ddlResults.every(
            result =>
                result.results.length === 0 &&
                result.meta.changed_db &&
                result.meta.changes === 0 &&
                result.meta.rows_read === 0
        )
    ) {
        return false;
    }
    const readback = parsed.data.result.at(-1);
    if (readback === undefined || readback.meta.changed_db || readback.meta.changes !== 0) return false;
    const rows = readback.results.map(row => safeParse(SchemaRowV1Schema, row));
    return (
        rows.every(row => row.success) &&
        canonicalizeJsonV1(rows.map(row => (row.success ? row.data : null)) as CanonicalJsonValueV1) ===
            canonicalizeJsonV1(schemaObjects as unknown as CanonicalJsonValueV1)
    );
};

const hasForeignKeysEnabled = (input: unknown): boolean => {
    const parsed = queryEnvelope(input);
    if (!parsed.success || parsed.data.result.length !== 1) return false;
    const result = parsed.data.result[0];
    return (
        result !== undefined &&
        result.meta.changed_db === false &&
        result.meta.changes === 0 &&
        result.results.length === 1 &&
        safeParse(ForeignKeysRowV1Schema, result.results[0]).success
    );
};

const hasExpectedConstraintFailure = (input: unknown): boolean =>
    safeParse(ConstraintFailureEnvelopeV1Schema, input).success;

const hasEmptyCanaryReadback = (input: unknown): boolean => {
    const parsed = queryEnvelope(input);
    if (!parsed.success || parsed.data.result.length !== 1) return false;
    const result = parsed.data.result[0];
    return (
        result !== undefined &&
        result.meta.changed_db === false &&
        result.meta.changes === 0 &&
        result.results.length === 1 &&
        safeParse(CanaryRowV1Schema, result.results[0]).success
    );
};

const mintInitializedDatabase = (context: InitializedD1ProbeDatabaseContextV1): InitializedD1ProbeDatabaseV1 => {
    const initialized = Object.freeze({
        schema_version: 1 as const,
        kind: "initialized_d1_probe_database" as const,
    });
    initializedDatabases.set(initialized, Object.freeze({ ...context }));
    return initialized;
};

const markManual = async (
    plan: unknown,
    journal: D1ProbeLifecycleJournalV1,
    created: CreatedD1ProbeDatabaseV1,
    fallbackObservationDigest: string,
    code: PostDispatchFailureV1["code"],
    phase: string
): Promise<PostDispatchFailureV1> => {
    const observationDigest =
        (await digestCanonicalJsonV1("openbot.d1-probe.database-bootstrap-failure.v1", {
            fallback_observation_digest: fallbackObservationDigest,
            phase,
        })) ?? fallbackObservationDigest;
    const marked = markD1ProbeLifecycleAmbiguousV1(plan, journal, {
        failed_step: "sink_private_shell_created",
        reason: "unexpected_platform_result",
        observation_digest: observationDigest,
        worker_dispatch_phase: "pre_dispatch",
        retry_allowed: false,
        manual_cleanup_required: true,
    });
    const nextJournal = marked.success ? marked.journal : journal;
    if (marked.success) {
        try {
            bootstrapCleanupBindings.set(
                created,
                canonicalizeJsonV1(marked.journal as unknown as CanonicalJsonValueV1)
            );
        } catch {
            // The validated journal is canonical JSON. A failure keeps cleanup unavailable and visible as manual work.
        }
    }
    return { success: false, code, journal: nextJournal, cleanup_target: created };
};

export const isD1ProbeDatabaseBootstrapCleanupAuthorizedV1 = (
    created: CreatedD1ProbeDatabaseV1,
    journal: D1ProbeLifecycleJournalV1
): boolean => {
    if (
        journal.state !== "manual_required" ||
        journal.completed_steps.length !== 1 ||
        journal.completed_steps[0] !== "database_created" ||
        journal.manual_required?.failed_step !== "sink_private_shell_created" ||
        journal.manual_required.reason !== "unexpected_platform_result"
    ) {
        return false;
    }
    try {
        return bootstrapCleanupBindings.get(created) === canonicalizeJsonV1(journal as unknown as CanonicalJsonValueV1);
    } catch {
        return false;
    }
};

export const initializeD1ProbeDatabaseV1 = async (
    createdDatabase: CreatedD1ProbeDatabaseV1,
    journalInput: unknown,
    commitmentKeyInput: unknown,
    apiTokenInput: unknown,
    dependencies: D1ProbeCloudflareDatabaseBootstrapDependenciesV1 = { fetch: globalThis.fetch }
): Promise<
    | Readonly<{
          success: true;
          initialized: InitializedD1ProbeDatabaseV1;
          journal: D1ProbeLifecycleJournalV1;
          observation: UntrustedD1ProbeDatabaseBootstrapObservationV1;
      }>
    | Readonly<{ success: false; code: BootstrapD1ProbeDatabaseDenialV1 }>
    | PostDispatchFailureV1
> => {
    const createdContext = resolveCreatedD1ProbeDatabaseV1(createdDatabase);
    if (createdContext === null) return { success: false, code: "invalid_created_database" };
    const preflightContext = resolveVerifiedD1ProbePreflightV1(createdContext.verified_preflight);
    if (preflightContext === null || preflightContext.plan.plan_digest !== createdContext.plan_digest) {
        return { success: false, code: "invalid_created_database" };
    }
    const journal = parseJournal(journalInput);
    if (
        journal === null ||
        journal.plan_digest !== preflightContext.plan.plan_digest ||
        !isD1ProbeLifecycleJournalBoundV1(preflightContext.plan, journal) ||
        !isD1ProbeLifecycleJournalReadyForStepV1(preflightContext.plan, journal, "sink_private_shell_created")
    ) {
        return { success: false, code: "invalid_lifecycle_journal" };
    }
    const reverified = await verifyD1ProbePreflightV1(
        preflightContext.request,
        preflightContext.plan,
        commitmentKeyInput
    );
    if (!reverified.success) {
        return {
            success: false,
            code:
                reverified.code === "invalid_commitment_key"
                    ? "invalid_commitment_key"
                    : "preflight_reverification_failed",
        };
    }
    const key = await importCommitmentKey(commitmentKeyInput);
    if (key === null) return { success: false, code: "invalid_commitment_key" };
    const token = safeParse(CloudflareApiTokenV1Schema, apiTokenInput);
    if (!token.success) return { success: false, code: "invalid_api_token" };
    if ((await rawSha256(D1_DISPOSABLE_PROBE_SCHEMA_SQL_V1)) !== D1_DISPOSABLE_PROBE_SCHEMA_SHA256_V1) {
        return { success: false, code: "schema_digest_mismatch" };
    }

    const databaseIdCommitment = await hmacValue(
        key,
        "openbot.identity.cloudflare_d1_database_id.v1",
        createdContext.database_id
    );
    const databaseNameCommitment = await hmacValue(
        key,
        "openbot.d1-probe.generated-resource-name.database.v1",
        createdContext.database_name
    );
    if (databaseIdCommitment === null || databaseNameCommitment === null) {
        return { success: false, code: "commitment_unavailable" };
    }
    const plannedDatabase = preflightContext.plan.resources.find(resource => resource.resource_kind === "database");
    const createdObservation = journal.observations[0];
    if (
        plannedDatabase === undefined ||
        createdContext.database_name !== plannedDatabase.generated_name ||
        databaseNameCommitment !== plannedDatabase.generated_name_commitment ||
        createdObservation?.resource_id_commitment !== databaseIdCommitment ||
        createdObservation.resource_name_commitment !== databaseNameCommitment
    ) {
        return { success: false, code: "resource_binding_mismatch" };
    }
    const journalDigest = await digestCanonicalJsonV1(
        "openbot.d1-probe.database-bootstrap-journal.v1",
        journal as unknown as CanonicalJsonValueV1
    );
    const fallbackObservationDigest = await digestCanonicalJsonV1("openbot.d1-probe.database-bootstrap-attempt.v1", {
        plan_digest: preflightContext.plan.plan_digest,
        journal_digest: journalDigest,
        schema_digest: D1_DISPOSABLE_PROBE_SCHEMA_SHA256_V1,
        database_id_commitment: databaseIdCommitment,
        database_name_commitment: databaseNameCommitment,
    });
    if (journalDigest === null || fallbackObservationDigest === null) {
        return { success: false, code: "observation_digest_unavailable" };
    }
    if (bootstrapRequestedDatabases.has(createdDatabase)) {
        return { success: false, code: "database_bootstrap_already_requested" };
    }
    bootstrapRequestedDatabases.add(createdDatabase);

    const endpoint = `${CLOUDFLARE_API_ORIGIN_V1}${CLOUDFLARE_API_PREFIX_V1}/accounts/${preflightContext.request.account_id}/d1/database/${createdContext.database_id}/query`;
    const canaryScenario = `bootstrap-${preflightContext.plan.plan_digest}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLOUDFLARE_TOTAL_TIMEOUT_MS_V1);
    try {
        const ddl = await query(
            dependencies.fetch,
            endpoint,
            token.data,
            {
                batch: [
                    { sql: SCHEMA_READBACK_SQL_V1 },
                    ...schemaStatements.map(sql => ({ sql })),
                    { sql: SCHEMA_READBACK_SQL_V1 },
                ],
            },
            controller.signal
        );
        if (!hasExactDdlAndSchemaResults(ddl)) {
            return await markManual(
                preflightContext.plan,
                journal,
                createdDatabase,
                fallbackObservationDigest,
                ddl === null ? "database_bootstrap_outcome_unknown" : "database_schema_mismatch",
                "schema_create_and_readback"
            );
        }
        const foreignKeys = await query(
            dependencies.fetch,
            endpoint,
            token.data,
            { params: [], sql: FOREIGN_KEYS_SQL_V1 },
            controller.signal
        );
        if (!hasForeignKeysEnabled(foreignKeys)) {
            return await markManual(
                preflightContext.plan,
                journal,
                createdDatabase,
                fallbackObservationDigest,
                "database_foreign_keys_disabled",
                "foreign_keys"
            );
        }
        const canaryFailure = await query(
            dependencies.fetch,
            endpoint,
            token.data,
            {
                batch: [
                    { params: [canaryScenario], sql: CANARY_INSERT_SQL_V1 },
                    { params: [`${canaryScenario}-missing`], sql: CANARY_REJECT_SQL_V1 },
                ],
            },
            controller.signal,
            400
        );
        if (!hasExpectedConstraintFailure(canaryFailure)) {
            return await markManual(
                preflightContext.plan,
                journal,
                createdDatabase,
                fallbackObservationDigest,
                "database_rollback_canary_failed",
                "rollback_canary_rejection"
            );
        }
        const canaryReadback = await query(
            dependencies.fetch,
            endpoint,
            token.data,
            { params: [canaryScenario], sql: CANARY_READBACK_SQL_V1 },
            controller.signal
        );
        if (!hasEmptyCanaryReadback(canaryReadback)) {
            return await markManual(
                preflightContext.plan,
                journal,
                createdDatabase,
                fallbackObservationDigest,
                "database_rollback_canary_failed",
                "rollback_canary_readback"
            );
        }
    } finally {
        clearTimeout(timer);
    }

    const observationDigest = await digestCanonicalJsonV1("openbot.d1-probe.database-bootstrap-result.v1", {
        plan_digest: preflightContext.plan.plan_digest,
        journal_digest: journalDigest,
        schema_digest: D1_DISPOSABLE_PROBE_SCHEMA_SHA256_V1,
        database_id_commitment: databaseIdCommitment,
        database_name_commitment: databaseNameCommitment,
        table_count: D1_DISPOSABLE_PROBE_SCHEMA_TABLE_NAMES_V1.length,
        trigger_count: D1_DISPOSABLE_PROBE_SCHEMA_TRIGGERS_V1.length,
        foreign_keys: 1,
        rollback_canary: "constraint_rejected_and_rolled_back",
    });
    if (observationDigest === null) {
        return await markManual(
            preflightContext.plan,
            journal,
            createdDatabase,
            fallbackObservationDigest,
            "observation_digest_unavailable",
            "result_digest"
        );
    }
    const context = Object.freeze({
        created_database: createdDatabase,
        plan_digest: preflightContext.plan.plan_digest,
        journal_digest: journalDigest,
        schema_digest: D1_DISPOSABLE_PROBE_SCHEMA_SHA256_V1,
        database_id_commitment: databaseIdCommitment,
        database_name_commitment: databaseNameCommitment,
        observation_digest: observationDigest,
    });
    return {
        success: true,
        initialized: mintInitializedDatabase(context),
        journal,
        observation: Object.freeze({
            schema_version: 1,
            kind: "untrusted_d1_probe_database_bootstrap_observation",
            authoritative: false,
            deploy_performed: true,
            eligible_for_attestation: false,
            gate_promotion_allowed: false,
            plan_digest: preflightContext.plan.plan_digest,
            journal_digest: journalDigest,
            schema_digest: D1_DISPOSABLE_PROBE_SCHEMA_SHA256_V1,
            database_id_commitment: databaseIdCommitment,
            database_name_commitment: databaseNameCommitment,
            table_count: D1_DISPOSABLE_PROBE_SCHEMA_TABLE_NAMES_V1.length,
            trigger_count: D1_DISPOSABLE_PROBE_SCHEMA_TRIGGERS_V1.length,
            foreign_keys: 1,
            rollback_canary: "constraint_rejected_and_rolled_back",
            observation_digest: observationDigest,
        }),
    };
};

export const initializedD1ProbeDatabaseMatchesV1 = async (
    initialized: InitializedD1ProbeDatabaseV1,
    createdDatabase: CreatedD1ProbeDatabaseV1,
    journalInput: unknown
): Promise<boolean> => {
    const context = resolveInitializedD1ProbeDatabaseV1(initialized);
    if (context === null || context.created_database !== createdDatabase) return false;
    const journal = parseJournal(journalInput);
    if (journal === null || journal.plan_digest !== context.plan_digest) return false;
    const journalDigest = await digestCanonicalJsonV1(
        "openbot.d1-probe.database-bootstrap-journal.v1",
        journal as unknown as CanonicalJsonValueV1
    );
    return journalDigest !== null && journalDigest === context.journal_digest;
};
