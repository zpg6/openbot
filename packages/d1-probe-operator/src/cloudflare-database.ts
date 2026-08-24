import { z } from "zod";

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
import {
    advanceD1ProbeLifecycleJournalV1,
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

const CLOUDFLARE_API_ORIGIN_V1 = "https://api.cloudflare.com";
const CLOUDFLARE_API_PREFIX_V1 = "/client/v4";
const CLOUDFLARE_RESPONSE_LIMIT_BYTES_V1 = 262_144;
const CLOUDFLARE_TOTAL_TIMEOUT_MS_V1 = 20_000;

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

export interface D1ProbeCloudflareDatabaseDependenciesV1 {
    readonly fetch: typeof globalThis.fetch;
}

export interface CreatedD1ProbeDatabaseV1 {
    readonly schema_version: 1;
    readonly kind: "created_d1_probe_database";
}

interface CreatedDatabaseContextV1 {
    readonly database_id: string;
    readonly database_name: string;
    readonly plan_digest: string;
}

const createdDatabases = new WeakMap<CreatedD1ProbeDatabaseV1, CreatedDatabaseContextV1>();

export const resolveCreatedD1ProbeDatabaseV1 = (created: CreatedD1ProbeDatabaseV1): CreatedDatabaseContextV1 | null =>
    createdDatabases.get(created) ?? null;

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
        await response.body?.cancel("Cloudflare D1 create response was invalid").catch(() => undefined);
        return null;
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/u.test(contentType)) {
        await response.body.cancel("Cloudflare D1 create content type was invalid").catch(() => undefined);
        return null;
    }
    const contentEncoding = response.headers.get("content-encoding")?.toLowerCase();
    if (contentEncoding !== undefined && contentEncoding !== "identity") {
        await response.body.cancel("Cloudflare D1 create encoding was invalid").catch(() => undefined);
        return null;
    }
    const declared = response.headers.get("content-length");
    if (
        declared !== null &&
        (!/^(?:0|[1-9][0-9]{0,6})$/u.test(declared) || Number(declared) > CLOUDFLARE_RESPONSE_LIMIT_BYTES_V1)
    ) {
        await response.body.cancel("Cloudflare D1 create response was too large").catch(() => undefined);
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
                await reader.cancel("Cloudflare D1 create response was too large");
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

const mintCreatedDatabase = (databaseId: string, databaseName: string, planDigest: string) => {
    const created = Object.freeze({
        schema_version: 1 as const,
        kind: "created_d1_probe_database" as const,
    });
    createdDatabases.set(
        created,
        Object.freeze({ database_id: databaseId, database_name: databaseName, plan_digest: planDigest })
    );
    return created;
};

const markManual = (
    plan: unknown,
    journal: D1ProbeLifecycleJournalV1,
    reason: "ambiguous_create" | "id_mismatch" | "name_mismatch" | "unexpected_platform_result",
    observationDigest: string,
    code: CreateD1ProbeDatabaseDenialV1,
    cleanupTarget: CreatedD1ProbeDatabaseV1 | null
): PostDispatchFailureV1 => {
    const marked = markD1ProbeLifecycleAmbiguousV1(plan, journal, {
        failed_step: "database_created",
        reason,
        observation_digest: observationDigest,
    });
    if (!marked.success) {
        return { success: false, code: "invalid_lifecycle_journal", journal, cleanup_target: cleanupTarget };
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
    const created = mintCreatedDatabase(result.uuid, result.name, context.plan.plan_digest);
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
        return markManual(context.plan, journal, "name_mismatch", observationDigest, "database_name_mismatch", created);
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
            created
        );
    }
    if (context.plan.operator_database_deny_id_commitments.includes(databaseIdCommitment)) {
        return markManual(
            context.plan,
            journal,
            "id_mismatch",
            observationDigest,
            "production_database_denied",
            created
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
            created
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
