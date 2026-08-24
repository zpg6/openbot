import { z } from "zod";

import {
    canonicalizeJsonV1,
    digestCanonicalJsonV1,
    type CanonicalJsonValueV1,
} from "@openbot/gate-attestation/internal";

import {
    D1ProbeCommitmentKeyV1Schema,
    D1ProbeLifecycleJournalV1Schema,
    D1ProbePreflightPlanV1Schema,
    type D1ProbeLifecycleJournalV1,
} from "./contracts.js";
import {
    advanceD1ProbeLifecycleJournalV1,
    isD1ProbeLifecycleJournalBoundV1,
    isD1ProbeLifecycleJournalReadyForStepV1,
    markD1ProbeLifecycleAmbiguousV1,
} from "./lifecycle.js";
import {
    D1_PROBE_ROUTE_OBSERVATION_MAX_AGE_MS_V1,
    resolveObservedD1ProbeCloudflareRouteV1,
    type ObservedD1ProbeCloudflareRouteV1,
} from "./cloudflare-route-reader.js";
import { resolveVerifiedD1ProbePreflightV1 } from "./verified-preflight.js";
import { verifyD1ProbePreflightV1 } from "./verified-preflight.js";
import type { VerifiedD1ProbePreflightV1 } from "./verified-preflight.js";

const CLOUDFLARE_API_ORIGIN_V1 = "https://api.cloudflare.com";
const CLOUDFLARE_API_PREFIX_V1 = "/client/v4";
const CLOUDFLARE_RESPONSE_LIMIT_BYTES_V1 = 262_144;
const CLOUDFLARE_TOTAL_TIMEOUT_MS_V1 = 20_000;
const CLOUDFLARE_DATABASE_LIST_PER_PAGE_V1 = 100;
const CLOUDFLARE_DATABASE_LIST_MAX_PAGES_V1 = 4;

const DatabaseIdV1Schema = z
    .string()
    .regex(/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u);
const CloudflareApiTokenV1Schema = z.string().regex(/^[A-Za-z0-9_-]{20,256}$/u);
const CloudflareDatabaseCreateResponseV1Schema = z
    .object({
        success: z.literal(true),
        errors: z.array(z.unknown()).length(0),
        result: z
            .object({
                uuid: DatabaseIdV1Schema,
                name: z.string().min(1).max(64),
                jurisdiction: z.enum(["eu", "us", "fedramp"]).optional(),
                read_replication: z.object({ mode: z.enum(["auto", "disabled"]) }).passthrough(),
            })
            .passthrough(),
    })
    .passthrough();
const CloudflareDatabaseDeleteResponseV1Schema = z
    .object({
        success: z.literal(true),
        errors: z.array(z.unknown()).length(0),
        result: z.unknown(),
    })
    .passthrough();
const CloudflareDatabaseListResponseV1Schema = z
    .object({
        success: z.literal(true),
        errors: z.array(z.unknown()).length(0),
        result: z.array(
            z
                .object({
                    uuid: DatabaseIdV1Schema,
                    name: z.string().min(1).max(64),
                })
                .passthrough()
        ),
        result_info: z
            .object({
                count: z.number().int().min(0).max(CLOUDFLARE_DATABASE_LIST_PER_PAGE_V1),
                page: z.number().int().min(1).max(CLOUDFLARE_DATABASE_LIST_MAX_PAGES_V1),
                per_page: z.literal(CLOUDFLARE_DATABASE_LIST_PER_PAGE_V1),
                total_count: z.number().int().min(0),
            })
            .strict(),
    })
    .passthrough();

export interface D1ProbeCloudflareDatabaseDependenciesV1 {
    readonly fetch: typeof globalThis.fetch;
}

export interface CreatedD1ProbeDatabaseV1 {
    readonly schema_version: 1;
    readonly kind: "created_d1_probe_database";
}

export interface ObservedD1ProbeDatabaseAbsenceV1 {
    readonly schema_version: 1;
    readonly kind: "observed_d1_probe_database_absence";
}

export interface CreatedDatabaseContextV1 {
    readonly database_id: string;
    readonly database_name: string;
    readonly plan_digest: string;
    readonly verified_preflight: VerifiedD1ProbePreflightV1;
}

export interface ObservedDatabaseAbsenceContextV1 {
    readonly created_database: CreatedD1ProbeDatabaseV1;
    readonly plan_digest: string;
    readonly journal_digest: string;
    readonly database_id_commitment: string;
    readonly database_name_commitment: string;
    readonly deletion_outcome: "sdk_acknowledged" | "outcome_unknown";
    readonly observation_digest: string;
}

const createdDatabases = new WeakMap<CreatedD1ProbeDatabaseV1, CreatedDatabaseContextV1>();
const deleteRequestedDatabases = new WeakSet<CreatedD1ProbeDatabaseV1>();
const emergencyCleanupBindings = new WeakMap<CreatedD1ProbeDatabaseV1, string>();
const databaseDeleteOutcomes = new WeakMap<CreatedD1ProbeDatabaseV1, "sdk_acknowledged" | "outcome_unknown">();
const observedDatabaseAbsences = new WeakMap<ObservedD1ProbeDatabaseAbsenceV1, ObservedDatabaseAbsenceContextV1>();

export const resolveCreatedD1ProbeDatabaseV1 = (created: CreatedD1ProbeDatabaseV1): CreatedDatabaseContextV1 | null =>
    createdDatabases.get(created) ?? null;

export const resolveObservedD1ProbeDatabaseAbsenceV1 = (
    observed: ObservedD1ProbeDatabaseAbsenceV1
): ObservedDatabaseAbsenceContextV1 | null => observedDatabaseAbsences.get(observed) ?? null;

export interface UntrustedD1ProbeDatabaseCreateObservationV1 {
    readonly schema_version: 1;
    readonly kind: "untrusted_d1_probe_database_create_observation";
    readonly authoritative: false;
    readonly deploy_performed: true;
    readonly eligible_for_attestation: false;
    readonly gate_promotion_allowed: false;
    readonly plan_digest: string;
    readonly database_id_commitment: string;
    readonly database_name_commitment: string;
    readonly database_jurisdiction: "automatic" | "eu" | "us" | "fedramp";
    readonly read_replication: "auto";
    readonly observation_digest: string;
}

export interface UntrustedD1ProbeDatabaseDeleteObservationV1 {
    readonly schema_version: 1;
    readonly kind: "untrusted_d1_probe_database_delete_observation";
    readonly status: "sdk_acknowledged";
    readonly authoritative: false;
    readonly absence_verified: false;
    readonly eligible_for_attestation: false;
    readonly gate_promotion_allowed: false;
    readonly plan_digest: string;
    readonly database_id_commitment: string;
    readonly database_name_commitment: string;
    readonly observation_digest: string;
}

export interface UntrustedD1ProbeDatabaseAbsenceObservationV1 {
    readonly schema_version: 1;
    readonly kind: "untrusted_d1_probe_database_absence_observation";
    readonly status: "control_plane_absence_observed";
    readonly deletion_outcome: "sdk_acknowledged" | "outcome_unknown";
    readonly authoritative: false;
    readonly absence_observed: true;
    readonly independent_proof: false;
    readonly cleanup_confirmed: false;
    readonly eligible_for_attestation: false;
    readonly gate_promotion_allowed: false;
    readonly plan_digest: string;
    readonly journal_digest: string;
    readonly database_id_commitment: string;
    readonly database_name_commitment: string;
    readonly page_count: number;
    readonly candidate_count: number;
    readonly observation_digest: string;
}

export type CreateD1ProbeDatabaseDenialV1 =
    | "invalid_observed_route"
    | "stale_observed_route"
    | "invalid_lifecycle_journal"
    | "invalid_commitment_key"
    | "invalid_api_token"
    | "preflight_reverification_failed"
    | "commitment_unavailable"
    | "observation_digest_unavailable"
    | "database_create_outcome_unknown"
    | "database_name_mismatch"
    | "database_configuration_mismatch"
    | "production_database_denied";

export type DeleteD1ProbeDatabaseDenialV1 =
    | "invalid_created_database"
    | "invalid_lifecycle_journal"
    | "invalid_commitment_key"
    | "invalid_api_token"
    | "preflight_reverification_failed"
    | "resource_binding_mismatch"
    | "commitment_unavailable"
    | "observation_digest_unavailable"
    | "database_delete_already_requested"
    | "database_delete_outcome_unknown";

export type ObserveD1ProbeDatabaseAbsenceDenialV1 =
    | "invalid_created_database"
    | "invalid_lifecycle_journal"
    | "invalid_commitment_key"
    | "invalid_api_token"
    | "preflight_reverification_failed"
    | "resource_binding_mismatch"
    | "commitment_unavailable"
    | "database_delete_not_requested"
    | "database_list_request_failed"
    | "database_list_response_invalid"
    | "database_list_pagination_inconsistent"
    | "database_list_duplicate_id"
    | "database_list_too_many_pages"
    | "database_still_present"
    | "observation_digest_unavailable";

type PostDispatchFailureV1 = Readonly<{
    success: false;
    code: CreateD1ProbeDatabaseDenialV1;
    journal: D1ProbeLifecycleJournalV1;
    cleanup_target: CreatedD1ProbeDatabaseV1 | null;
}>;

const encoder = new TextEncoder();

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
    let parsed: ReturnType<typeof D1ProbeCommitmentKeyV1Schema.safeParse>;
    try {
        parsed = D1ProbeCommitmentKeyV1Schema.safeParse(input);
    } catch {
        return null;
    }
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

const readBoundedJson = async (response: Response): Promise<unknown | null> => {
    if (response.status !== 200 || response.redirected || response.body === null) {
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

const parseJournal = (input: unknown): D1ProbeLifecycleJournalV1 | null => {
    try {
        const parsed = D1ProbeLifecycleJournalV1Schema.safeParse(input);
        return parsed.success && parsed.data.state === "planned" ? parsed.data : null;
    } catch {
        return null;
    }
};

const mintCreatedDatabase = (
    databaseId: string,
    databaseName: string,
    planDigest: string,
    verifiedPreflight: VerifiedD1ProbePreflightV1
) => {
    const created = Object.freeze({
        schema_version: 1 as const,
        kind: "created_d1_probe_database" as const,
    });
    createdDatabases.set(
        created,
        Object.freeze({
            database_id: databaseId,
            database_name: databaseName,
            plan_digest: planDigest,
            verified_preflight: verifiedPreflight,
        })
    );
    return created;
};

const mintObservedDatabaseAbsence = (context: ObservedDatabaseAbsenceContextV1) => {
    const observed = Object.freeze({
        schema_version: 1 as const,
        kind: "observed_d1_probe_database_absence" as const,
    });
    observedDatabaseAbsences.set(observed, Object.freeze({ ...context }));
    return observed;
};

const markManual = (
    plan: unknown,
    journal: D1ProbeLifecycleJournalV1,
    reason: "ambiguous_create" | "id_mismatch" | "name_mismatch" | "unexpected_platform_result",
    observationDigest: string,
    code: CreateD1ProbeDatabaseDenialV1,
    cleanupTarget: CreatedD1ProbeDatabaseV1 | null,
    emergencyCleanupAllowed = false
): PostDispatchFailureV1 => {
    const marked = markD1ProbeLifecycleAmbiguousV1(plan, journal, {
        failed_step: "database_created",
        reason,
        observation_digest: observationDigest,
    });
    if (!marked.success) {
        return { success: false, code: "invalid_lifecycle_journal", journal, cleanup_target: cleanupTarget };
    }
    if (cleanupTarget !== null && emergencyCleanupAllowed) {
        emergencyCleanupBindings.set(cleanupTarget, observationDigest);
    }
    return { success: false, code, journal: marked.journal, cleanup_target: cleanupTarget };
};

export const createD1ProbeDatabaseV1 = async (
    observedRoute: ObservedD1ProbeCloudflareRouteV1,
    journalInput: unknown,
    commitmentKeyInput: unknown,
    apiTokenInput: unknown,
    dependencies: D1ProbeCloudflareDatabaseDependenciesV1 = { fetch: globalThis.fetch }
): Promise<
    | Readonly<{
          success: true;
          created: CreatedD1ProbeDatabaseV1;
          journal: D1ProbeLifecycleJournalV1;
          observation: UntrustedD1ProbeDatabaseCreateObservationV1;
      }>
    | Readonly<{ success: false; code: CreateD1ProbeDatabaseDenialV1 }>
    | PostDispatchFailureV1
> => {
    const observedContext = resolveObservedD1ProbeCloudflareRouteV1(observedRoute);
    if (observedContext === null) return { success: false, code: "invalid_observed_route" };
    const observationAge = Date.now() - observedContext.observed_at_ms;
    if (
        !Number.isSafeInteger(observationAge) ||
        observationAge < 0 ||
        observationAge > D1_PROBE_ROUTE_OBSERVATION_MAX_AGE_MS_V1
    ) {
        return { success: false, code: "stale_observed_route" };
    }
    const context = resolveVerifiedD1ProbePreflightV1(observedContext.verified_preflight);
    if (context === null) return { success: false, code: "invalid_observed_route" };
    const journal = parseJournal(journalInput);
    if (
        journal === null ||
        journal.plan_digest !== context.plan.plan_digest ||
        !isD1ProbeLifecycleJournalReadyForStepV1(context.plan, journal, "database_created")
    ) {
        return { success: false, code: "invalid_lifecycle_journal" };
    }
    const reverified = await verifyD1ProbePreflightV1(context.request, context.plan, commitmentKeyInput);
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
    let token: ReturnType<typeof CloudflareApiTokenV1Schema.safeParse>;
    try {
        token = CloudflareApiTokenV1Schema.safeParse(apiTokenInput);
    } catch {
        return { success: false, code: "invalid_api_token" };
    }
    if (!token.success) return { success: false, code: "invalid_api_token" };

    const databaseResource = context.plan.resources.find(resource => resource.resource_kind === "database");
    if (databaseResource === undefined) return { success: false, code: "invalid_observed_route" };
    const body = {
        name: databaseResource.generated_name,
        read_replication: { mode: "auto" as const },
        ...(context.request.database_jurisdiction === "automatic"
            ? {}
            : { jurisdiction: context.request.database_jurisdiction }),
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLOUDFLARE_TOTAL_TIMEOUT_MS_V1);
    let responseValue: unknown | null = null;
    try {
        const response = await dependencies.fetch(
            `${CLOUDFLARE_API_ORIGIN_V1}${CLOUDFLARE_API_PREFIX_V1}/accounts/${context.request.account_id}/d1/database`,
            {
                method: "POST",
                headers: {
                    accept: "application/json",
                    "accept-encoding": "identity",
                    authorization: `Bearer ${token.data}`,
                    "content-type": "application/json",
                },
                body: canonicalizeJsonV1(body as CanonicalJsonValueV1),
                cache: "no-store",
                credentials: "omit",
                redirect: "manual",
                signal: controller.signal,
            }
        );
        responseValue = await readBoundedJson(response);
    } catch {
        responseValue = null;
    } finally {
        clearTimeout(timer);
    }

    const failureObservationDigest = await digestCanonicalJsonV1("openbot.d1-probe.database-create-response.v1", {
        response_received_and_valid: responseValue !== null,
        plan_digest: context.plan.plan_digest,
    });
    if (failureObservationDigest === null) return { success: false, code: "observation_digest_unavailable" };
    let parsed: ReturnType<typeof CloudflareDatabaseCreateResponseV1Schema.safeParse>;
    try {
        parsed = CloudflareDatabaseCreateResponseV1Schema.safeParse(responseValue);
    } catch {
        parsed = { success: false } as ReturnType<typeof CloudflareDatabaseCreateResponseV1Schema.safeParse>;
    }
    if (!parsed.success) {
        return markManual(
            context.plan,
            journal,
            "ambiguous_create",
            failureObservationDigest,
            "database_create_outcome_unknown",
            null
        );
    }

    const result = parsed.data.result;
    const created = mintCreatedDatabase(
        result.uuid,
        result.name,
        context.plan.plan_digest,
        observedContext.verified_preflight
    );
    const databaseIdCommitment = await hmacValue(key, "openbot.identity.cloudflare_d1_database_id.v1", result.uuid);
    const databaseNameCommitment = await hmacValue(
        key,
        "openbot.d1-probe.generated-resource-name.database.v1",
        result.name
    );
    if (databaseIdCommitment === null || databaseNameCommitment === null) {
        return markManual(
            context.plan,
            journal,
            "unexpected_platform_result",
            failureObservationDigest,
            "commitment_unavailable",
            created
        );
    }
    const observationDigest = await digestCanonicalJsonV1("openbot.d1-probe.database-create-response.v1", {
        plan_digest: context.plan.plan_digest,
        database_id_commitment: databaseIdCommitment,
        database_name_commitment: databaseNameCommitment,
        jurisdiction: result.jurisdiction ?? null,
        read_replication: result.read_replication.mode,
    });
    if (observationDigest === null) {
        return markManual(
            context.plan,
            journal,
            "unexpected_platform_result",
            failureObservationDigest,
            "observation_digest_unavailable",
            created
        );
    }
    if (result.name !== databaseResource.generated_name) {
        return markManual(
            context.plan,
            journal,
            "name_mismatch",
            observationDigest,
            "database_name_mismatch",
            created,
            true
        );
    }
    const jurisdictionMatches =
        context.request.database_jurisdiction === "automatic"
            ? result.jurisdiction === undefined
            : result.jurisdiction === context.request.database_jurisdiction;
    if (!jurisdictionMatches || result.read_replication.mode !== "auto") {
        return markManual(
            context.plan,
            journal,
            "unexpected_platform_result",
            observationDigest,
            "database_configuration_mismatch",
            created,
            true
        );
    }
    if (context.plan.operator_database_deny_id_commitments.includes(databaseIdCommitment)) {
        return markManual(
            context.plan,
            journal,
            "id_mismatch",
            observationDigest,
            "production_database_denied",
            created,
            true
        );
    }

    const advanced = advanceD1ProbeLifecycleJournalV1(context.plan, journal, {
        step: "database_created",
        observation_digest: observationDigest,
        resource_kind: "database",
        resource_name_commitment: databaseResource.generated_name_commitment,
        resource_id_commitment: databaseIdCommitment,
    });
    if (!advanced.success) {
        return markManual(
            context.plan,
            journal,
            "unexpected_platform_result",
            observationDigest,
            "invalid_lifecycle_journal",
            created,
            true
        );
    }
    return {
        success: true,
        created,
        journal: advanced.journal,
        observation: Object.freeze({
            schema_version: 1,
            kind: "untrusted_d1_probe_database_create_observation",
            authoritative: false,
            deploy_performed: true,
            eligible_for_attestation: false,
            gate_promotion_allowed: false,
            plan_digest: context.plan.plan_digest,
            database_id_commitment: databaseIdCommitment,
            database_name_commitment: databaseResource.generated_name_commitment,
            database_jurisdiction: context.request.database_jurisdiction,
            read_replication: "auto",
            observation_digest: observationDigest,
        }),
    };
};

const isEmergencyCreateCleanup = (journal: D1ProbeLifecycleJournalV1): boolean =>
    journal.state === "manual_required" &&
    journal.completed_steps.length === 0 &&
    journal.manual_required?.failed_step === "database_created";

const isEmergencyBootstrapCleanup = (journal: D1ProbeLifecycleJournalV1): boolean =>
    journal.state === "manual_required" &&
    journal.completed_steps.length === 1 &&
    journal.completed_steps[0] === "database_created" &&
    journal.manual_required?.failed_step === "sink_deployed" &&
    journal.manual_required.reason === "unexpected_platform_result";

export const deleteD1ProbeDatabaseV1 = async (
    createdDatabase: CreatedD1ProbeDatabaseV1,
    journalInput: unknown,
    commitmentKeyInput: unknown,
    apiTokenInput: unknown,
    dependencies: D1ProbeCloudflareDatabaseDependenciesV1 = { fetch: globalThis.fetch }
): Promise<
    | Readonly<{
          success: true;
          journal: D1ProbeLifecycleJournalV1;
          observation: UntrustedD1ProbeDatabaseDeleteObservationV1;
      }>
    | Readonly<{ success: false; code: DeleteD1ProbeDatabaseDenialV1 }>
    | Readonly<{
          success: false;
          code: "database_delete_outcome_unknown" | "observation_digest_unavailable";
          journal: D1ProbeLifecycleJournalV1;
      }>
> => {
    const createdContext = resolveCreatedD1ProbeDatabaseV1(createdDatabase);
    if (createdContext === null) return { success: false, code: "invalid_created_database" };
    const preflightContext = resolveVerifiedD1ProbePreflightV1(createdContext.verified_preflight);
    if (preflightContext === null || preflightContext.plan.plan_digest !== createdContext.plan_digest) {
        return { success: false, code: "invalid_created_database" };
    }
    let journal: D1ProbeLifecycleJournalV1 | null = null;
    try {
        const parsed = D1ProbeLifecycleJournalV1Schema.safeParse(journalInput);
        journal = parsed.success ? parsed.data : null;
    } catch {
        journal = null;
    }
    if (
        journal === null ||
        journal.plan_digest !== preflightContext.plan.plan_digest ||
        !isD1ProbeLifecycleJournalBoundV1(preflightContext.plan, journal)
    ) {
        return { success: false, code: "invalid_lifecycle_journal" };
    }
    const normalCleanup = isD1ProbeLifecycleJournalReadyForStepV1(preflightContext.plan, journal, "database_deleted");
    const emergencyCleanup = isEmergencyCreateCleanup(journal);
    const bootstrapCleanup = isEmergencyBootstrapCleanup(journal);
    if (!normalCleanup && !emergencyCleanup && !bootstrapCleanup) {
        return { success: false, code: "invalid_lifecycle_journal" };
    }
    const bootstrapCleanupAuthorized = bootstrapCleanup
        ? await import("./cloudflare-database-bootstrap.js").then(module =>
              module.isD1ProbeDatabaseBootstrapCleanupAuthorizedV1(createdDatabase, journal)
          )
        : false;
    if (
        (emergencyCleanup &&
            emergencyCleanupBindings.get(createdDatabase) !== journal.manual_required?.observation_digest) ||
        (bootstrapCleanup && !bootstrapCleanupAuthorized)
    ) {
        return { success: false, code: "resource_binding_mismatch" };
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
    const createdObservation = journal.observations.find(observation => observation.step === "database_created");
    if (
        plannedDatabase === undefined ||
        ((normalCleanup || bootstrapCleanup) &&
            (createdContext.database_name !== plannedDatabase.generated_name ||
                databaseNameCommitment !== plannedDatabase.generated_name_commitment ||
                createdObservation?.resource_id_commitment !== databaseIdCommitment ||
                createdObservation.resource_name_commitment !== databaseNameCommitment))
    ) {
        return { success: false, code: "resource_binding_mismatch" };
    }
    const fallbackObservationDigest = await digestCanonicalJsonV1("openbot.d1-probe.database-delete-attempt.v1", {
        plan_digest: preflightContext.plan.plan_digest,
        database_id_commitment: databaseIdCommitment,
        database_name_commitment: databaseNameCommitment,
    });
    if (fallbackObservationDigest === null) {
        return { success: false, code: "observation_digest_unavailable" };
    }

    let token: ReturnType<typeof CloudflareApiTokenV1Schema.safeParse>;
    try {
        token = CloudflareApiTokenV1Schema.safeParse(apiTokenInput);
    } catch {
        return { success: false, code: "invalid_api_token" };
    }
    if (!token.success) return { success: false, code: "invalid_api_token" };
    if (deleteRequestedDatabases.has(createdDatabase)) {
        return { success: false, code: "database_delete_already_requested" };
    }
    deleteRequestedDatabases.add(createdDatabase);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLOUDFLARE_TOTAL_TIMEOUT_MS_V1);
    let responseValue: unknown | null = null;
    try {
        const response = await dependencies.fetch(
            `${CLOUDFLARE_API_ORIGIN_V1}${CLOUDFLARE_API_PREFIX_V1}/accounts/${preflightContext.request.account_id}/d1/database/${createdContext.database_id}`,
            {
                method: "DELETE",
                headers: {
                    accept: "application/json",
                    "accept-encoding": "identity",
                    authorization: `Bearer ${token.data}`,
                },
                cache: "no-store",
                credentials: "omit",
                redirect: "manual",
                signal: controller.signal,
            }
        );
        responseValue = await readBoundedJson(response);
    } catch {
        responseValue = null;
    } finally {
        clearTimeout(timer);
    }

    const response = CloudflareDatabaseDeleteResponseV1Schema.safeParse(responseValue);
    databaseDeleteOutcomes.set(createdDatabase, response.success ? "sdk_acknowledged" : "outcome_unknown");
    const observationDigest = await digestCanonicalJsonV1("openbot.d1-probe.database-delete-response.v1", {
        plan_digest: preflightContext.plan.plan_digest,
        database_id_commitment: databaseIdCommitment,
        database_name_commitment: databaseNameCommitment,
        sdk_acknowledged: response.success,
    });
    if (observationDigest === null) {
        if (normalCleanup) {
            const marked = markD1ProbeLifecycleAmbiguousV1(preflightContext.plan, journal, {
                failed_step: "database_deleted",
                reason: "ambiguous_delete",
                observation_digest: fallbackObservationDigest,
            });
            return {
                success: false,
                code: "observation_digest_unavailable",
                journal: marked.success ? marked.journal : journal,
            };
        }
        return { success: false, code: "observation_digest_unavailable", journal };
    }
    if (!response.success) {
        if (normalCleanup) {
            const marked = markD1ProbeLifecycleAmbiguousV1(preflightContext.plan, journal, {
                failed_step: "database_deleted",
                reason: "ambiguous_delete",
                observation_digest: observationDigest,
            });
            return {
                success: false,
                code: "database_delete_outcome_unknown",
                journal: marked.success ? marked.journal : journal,
            };
        }
        return { success: false, code: "database_delete_outcome_unknown", journal };
    }

    let nextJournal = journal;
    if (normalCleanup) {
        const advanced = advanceD1ProbeLifecycleJournalV1(preflightContext.plan, journal, {
            step: "database_deleted",
            observation_digest: observationDigest,
            resource_kind: "database",
            resource_name_commitment: databaseNameCommitment,
            resource_id_commitment: databaseIdCommitment,
        });
        if (!advanced.success) return { success: false, code: "invalid_lifecycle_journal" };
        nextJournal = advanced.journal;
    }
    return {
        success: true,
        journal: nextJournal,
        observation: Object.freeze({
            schema_version: 1,
            kind: "untrusted_d1_probe_database_delete_observation",
            status: "sdk_acknowledged",
            authoritative: false,
            absence_verified: false,
            eligible_for_attestation: false,
            gate_promotion_allowed: false,
            plan_digest: preflightContext.plan.plan_digest,
            database_id_commitment: databaseIdCommitment,
            database_name_commitment: databaseNameCommitment,
            observation_digest: observationDigest,
        }),
    };
};

export const observeD1ProbeDatabaseAbsenceV1 = async (
    createdDatabase: CreatedD1ProbeDatabaseV1,
    journalInput: unknown,
    commitmentKeyInput: unknown,
    apiTokenInput: unknown,
    dependencies: D1ProbeCloudflareDatabaseDependenciesV1 = { fetch: globalThis.fetch }
): Promise<
    | Readonly<{
          success: true;
          observed: ObservedD1ProbeDatabaseAbsenceV1;
          journal: D1ProbeLifecycleJournalV1;
          observation: UntrustedD1ProbeDatabaseAbsenceObservationV1;
      }>
    | Readonly<{ success: false; code: ObserveD1ProbeDatabaseAbsenceDenialV1 }>
> => {
    const createdContext = resolveCreatedD1ProbeDatabaseV1(createdDatabase);
    if (createdContext === null) return { success: false, code: "invalid_created_database" };
    const preflightContext = resolveVerifiedD1ProbePreflightV1(createdContext.verified_preflight);
    if (preflightContext === null || preflightContext.plan.plan_digest !== createdContext.plan_digest) {
        return { success: false, code: "invalid_created_database" };
    }
    let journal: D1ProbeLifecycleJournalV1 | null = null;
    try {
        const parsed = D1ProbeLifecycleJournalV1Schema.safeParse(journalInput);
        journal = parsed.success ? parsed.data : null;
    } catch {
        journal = null;
    }
    if (
        journal === null ||
        journal.plan_digest !== preflightContext.plan.plan_digest ||
        !isD1ProbeLifecycleJournalBoundV1(preflightContext.plan, journal)
    ) {
        return { success: false, code: "invalid_lifecycle_journal" };
    }
    const readyForFinalAbsence = isD1ProbeLifecycleJournalReadyForStepV1(
        preflightContext.plan,
        journal,
        "all_resource_absence_confirmed"
    );
    const reconcilingDelete =
        journal.state === "manual_required" && journal.manual_required?.failed_step === "database_deleted";
    const reconcilingCreate = isEmergencyCreateCleanup(journal);
    const reconcilingBootstrap = isEmergencyBootstrapCleanup(journal);
    if (!readyForFinalAbsence && !reconcilingDelete && !reconcilingCreate && !reconcilingBootstrap) {
        return { success: false, code: "invalid_lifecycle_journal" };
    }
    if (
        reconcilingCreate &&
        emergencyCleanupBindings.get(createdDatabase) !== journal.manual_required?.observation_digest
    ) {
        return { success: false, code: "resource_binding_mismatch" };
    }
    if (reconcilingBootstrap) {
        const authorized = await import("./cloudflare-database-bootstrap.js").then(module =>
            module.isD1ProbeDatabaseBootstrapCleanupAuthorizedV1(createdDatabase, journal)
        );
        if (!authorized) return { success: false, code: "resource_binding_mismatch" };
    }
    const deletionOutcome = databaseDeleteOutcomes.get(createdDatabase);
    if (deletionOutcome === undefined) return { success: false, code: "database_delete_not_requested" };

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
    const createdObservation = journal.observations.find(observation => observation.step === "database_created");
    if (
        plannedDatabase === undefined ||
        (!reconcilingCreate &&
            (createdContext.database_name !== plannedDatabase.generated_name ||
                databaseNameCommitment !== plannedDatabase.generated_name_commitment ||
                createdObservation?.resource_id_commitment !== databaseIdCommitment ||
                createdObservation.resource_name_commitment !== databaseNameCommitment))
    ) {
        return { success: false, code: "resource_binding_mismatch" };
    }
    let token: ReturnType<typeof CloudflareApiTokenV1Schema.safeParse>;
    try {
        token = CloudflareApiTokenV1Schema.safeParse(apiTokenInput);
    } catch {
        return { success: false, code: "invalid_api_token" };
    }
    if (!token.success) return { success: false, code: "invalid_api_token" };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLOUDFLARE_TOTAL_TIMEOUT_MS_V1);
    const observedDatabaseIds = new Set<string>();
    let pageCount = 0;
    let candidateCount = 0;
    let expectedTotalCount: number | null = null;
    try {
        for (let page = 1; page <= CLOUDFLARE_DATABASE_LIST_MAX_PAGES_V1; page += 1) {
            const query = new URLSearchParams({
                name: createdContext.database_name,
                page: String(page),
                per_page: String(CLOUDFLARE_DATABASE_LIST_PER_PAGE_V1),
            });
            let responseValue: unknown | null = null;
            try {
                const response = await dependencies.fetch(
                    `${CLOUDFLARE_API_ORIGIN_V1}${CLOUDFLARE_API_PREFIX_V1}/accounts/${preflightContext.request.account_id}/d1/database?${query.toString()}`,
                    {
                        method: "GET",
                        headers: {
                            accept: "application/json",
                            "accept-encoding": "identity",
                            authorization: `Bearer ${token.data}`,
                        },
                        cache: "no-store",
                        credentials: "omit",
                        redirect: "manual",
                        signal: controller.signal,
                    }
                );
                responseValue = await readBoundedJson(response);
            } catch {
                return { success: false, code: "database_list_request_failed" };
            }
            if (responseValue === null) return { success: false, code: "database_list_response_invalid" };
            let parsed: ReturnType<typeof CloudflareDatabaseListResponseV1Schema.safeParse>;
            try {
                parsed = CloudflareDatabaseListResponseV1Schema.safeParse(responseValue);
            } catch {
                return { success: false, code: "database_list_response_invalid" };
            }
            if (!parsed.success) return { success: false, code: "database_list_response_invalid" };
            const result = parsed.data.result;
            const resultInfo = parsed.data.result_info;
            if (
                resultInfo.page !== page ||
                resultInfo.count !== result.length ||
                (expectedTotalCount !== null && resultInfo.total_count !== expectedTotalCount)
            ) {
                return { success: false, code: "database_list_pagination_inconsistent" };
            }
            expectedTotalCount ??= resultInfo.total_count;
            pageCount += 1;
            candidateCount += result.length;
            for (const candidate of result) {
                if (observedDatabaseIds.has(candidate.uuid)) {
                    return { success: false, code: "database_list_duplicate_id" };
                }
                observedDatabaseIds.add(candidate.uuid);
                if (candidate.uuid === createdContext.database_id || candidate.name === createdContext.database_name) {
                    return { success: false, code: "database_still_present" };
                }
            }
            if (result.length < CLOUDFLARE_DATABASE_LIST_PER_PAGE_V1) break;
            if (page === CLOUDFLARE_DATABASE_LIST_MAX_PAGES_V1) {
                return { success: false, code: "database_list_too_many_pages" };
            }
        }
    } finally {
        clearTimeout(timer);
    }
    const journalDigest = await digestCanonicalJsonV1(
        "openbot.d1-probe.database-absence-journal.v1",
        journal as CanonicalJsonValueV1
    );
    if (journalDigest === null) return { success: false, code: "observation_digest_unavailable" };
    const observationDigest = await digestCanonicalJsonV1("openbot.d1-probe.database-absence-observation.v1", {
        plan_digest: preflightContext.plan.plan_digest,
        journal_digest: journalDigest,
        database_id_commitment: databaseIdCommitment,
        database_name_commitment: databaseNameCommitment,
        deletion_outcome: deletionOutcome,
        page_count: pageCount,
        candidate_count: candidateCount,
    });
    if (observationDigest === null) return { success: false, code: "observation_digest_unavailable" };
    const observed = mintObservedDatabaseAbsence({
        created_database: createdDatabase,
        plan_digest: preflightContext.plan.plan_digest,
        journal_digest: journalDigest,
        database_id_commitment: databaseIdCommitment,
        database_name_commitment: databaseNameCommitment,
        deletion_outcome: deletionOutcome,
        observation_digest: observationDigest,
    });
    return {
        success: true,
        observed,
        journal,
        observation: Object.freeze({
            schema_version: 1,
            kind: "untrusted_d1_probe_database_absence_observation",
            status: "control_plane_absence_observed",
            deletion_outcome: deletionOutcome,
            authoritative: false,
            absence_observed: true,
            independent_proof: false,
            cleanup_confirmed: false,
            eligible_for_attestation: false,
            gate_promotion_allowed: false,
            plan_digest: preflightContext.plan.plan_digest,
            journal_digest: journalDigest,
            database_id_commitment: databaseIdCommitment,
            database_name_commitment: databaseNameCommitment,
            page_count: pageCount,
            candidate_count: candidateCount,
            observation_digest: observationDigest,
        }),
    };
};

export const observedD1ProbeDatabaseAbsenceMatchesV1 = async (
    observed: ObservedD1ProbeDatabaseAbsenceV1,
    createdDatabase: CreatedD1ProbeDatabaseV1,
    planInput: unknown,
    journalInput: unknown
): Promise<boolean> => {
    const context = resolveObservedD1ProbeDatabaseAbsenceV1(observed);
    if (context === null || context.created_database !== createdDatabase) return false;
    const createdContext = resolveCreatedD1ProbeDatabaseV1(createdDatabase);
    const preflightContext =
        createdContext === null ? null : resolveVerifiedD1ProbePreflightV1(createdContext.verified_preflight);
    if (
        createdContext === null ||
        preflightContext === null ||
        createdContext.plan_digest !== context.plan_digest ||
        preflightContext.plan.plan_digest !== context.plan_digest
    ) {
        return false;
    }
    let plan: ReturnType<typeof D1ProbePreflightPlanV1Schema.safeParse>;
    let journal: ReturnType<typeof D1ProbeLifecycleJournalV1Schema.safeParse>;
    let suppliedPlanBytes: string;
    let verifiedPlanBytes: string;
    try {
        plan = D1ProbePreflightPlanV1Schema.safeParse(planInput);
        journal = D1ProbeLifecycleJournalV1Schema.safeParse(journalInput);
        if (!plan.success || !journal.success) return false;
        suppliedPlanBytes = canonicalizeJsonV1(plan.data as CanonicalJsonValueV1);
        verifiedPlanBytes = canonicalizeJsonV1(preflightContext.plan as unknown as CanonicalJsonValueV1);
    } catch {
        return false;
    }
    if (
        suppliedPlanBytes !== verifiedPlanBytes ||
        plan.data.plan_digest !== context.plan_digest ||
        !isD1ProbeLifecycleJournalBoundV1(plan.data, journal.data)
    ) {
        return false;
    }
    const journalDigest = await digestCanonicalJsonV1(
        "openbot.d1-probe.database-absence-journal.v1",
        journal.data as CanonicalJsonValueV1
    );
    return journalDigest !== null && journalDigest === context.journal_digest;
};
