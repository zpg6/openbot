import { z } from "zod";

const IdentifierV1Schema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/u);
const UuidV1Schema = z.string().uuid();
const SafeTimeV1Schema = z.number().int().safe().nonnegative();
const HttpDateV1Schema = z.string().datetime({ offset: true });

const FIXED_MODULE_NAME_V1 = "entry.js";
const FIXED_MODULE_CONTENT_TYPE_V1 = "application/javascript+module";
const FIXED_COMPATIBILITY_DATE_V1 = "2026-08-22";

type SafeParseV1<T> = { readonly success: true; readonly data: T } | { readonly success: false };

const safeParseV1 = <T>(schema: z.ZodType<T>, input: unknown): SafeParseV1<T> => {
    try {
        const parsed = schema.safeParse(input);
        return parsed.success ? { success: true, data: parsed.data } : { success: false };
    } catch {
        return { success: false };
    }
};

export const D1ProbeCloudflareWorkerCleanupExpectationV1Schema = z
    .object({
        worker_id: IdentifierV1Schema,
        script_name: z.string().min(1).max(255),
        exact_tags: z.array(z.string().min(1).max(100)).min(1).max(100),
    })
    .strict()
    .superRefine((value, context) => {
        if (new Set(value.exact_tags).size !== value.exact_tags.length) {
            context.addIssue({ code: "custom", message: "exact_tags must not contain duplicates" });
        }
    });

export type D1ProbeCloudflareWorkerCleanupExpectationV1 = z.infer<
    typeof D1ProbeCloudflareWorkerCleanupExpectationV1Schema
>;

export const D1ProbeCloudflareWorkerCleanupCandidateV1Schema = z
    .object({
        id: IdentifierV1Schema.optional(),
        name: z.string().optional(),
        tags: z.array(z.string()).optional(),
    })
    .passthrough();

export const D1ProbeCloudflareWorkerCleanupIdentityV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("d1_probe_cloudflare_worker_cleanup_identity"),
        worker_id: IdentifierV1Schema,
        script_name: z.string().min(1).max(255),
        exact_tags: z.array(z.string().min(1).max(100)).min(1).max(100),
        observed_fields: z.object({ id: z.boolean(), name: z.boolean(), tags: z.boolean() }).strict(),
        status: z.enum(["partial_identity_compatible", "exact_identity_observed"]),
    })
    .strict()
    .superRefine((value, context) => {
        if (new Set(value.exact_tags).size !== value.exact_tags.length) {
            context.addIssue({ code: "custom", message: "exact_tags must not contain duplicates" });
        }
        const allObserved = value.observed_fields.id && value.observed_fields.name && value.observed_fields.tags;
        if (
            (value.status === "exact_identity_observed" && !allObserved) ||
            (value.status === "partial_identity_compatible" && allObserved)
        ) {
            context.addIssue({ code: "custom", message: "cleanup identity status contradicts observed fields" });
        }
    });

export type D1ProbeCloudflareWorkerCleanupIdentityV1 = z.infer<typeof D1ProbeCloudflareWorkerCleanupIdentityV1Schema>;

export type D1ProbeCloudflareWorkerCleanupProjectionV1 =
    | { readonly success: false; readonly code: "invalid_expectation" | "invalid_candidate" | "identity_mismatch" }
    | { readonly success: true; readonly identity: D1ProbeCloudflareWorkerCleanupIdentityV1 };

const exactSetMatches = (actual: readonly string[], expected: readonly string[]): boolean =>
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    actual.every(value => expected.includes(value));

export const projectD1ProbeCloudflareWorkerCleanupIdentityV1 = (
    input: unknown,
    expectationInput: unknown
): D1ProbeCloudflareWorkerCleanupProjectionV1 => {
    const expectation = safeParseV1(D1ProbeCloudflareWorkerCleanupExpectationV1Schema, expectationInput);
    if (!expectation.success) return { success: false, code: "invalid_expectation" };

    const candidate = safeParseV1(D1ProbeCloudflareWorkerCleanupCandidateV1Schema, input);
    if (!candidate.success) return { success: false, code: "invalid_candidate" };

    if (
        (candidate.data.id !== undefined && candidate.data.id !== expectation.data.worker_id) ||
        (candidate.data.name !== undefined && candidate.data.name !== expectation.data.script_name) ||
        (candidate.data.tags !== undefined && !exactSetMatches(candidate.data.tags, expectation.data.exact_tags))
    ) {
        return { success: false, code: "identity_mismatch" };
    }

    const observedFields = {
        id: candidate.data.id !== undefined,
        name: candidate.data.name !== undefined,
        tags: candidate.data.tags !== undefined,
    };
    return {
        success: true,
        identity: {
            schema_version: 1,
            kind: "d1_probe_cloudflare_worker_cleanup_identity",
            worker_id: expectation.data.worker_id,
            script_name: expectation.data.script_name,
            exact_tags: expectation.data.exact_tags,
            observed_fields: observedFields,
            status:
                observedFields.id && observedFields.name && observedFields.tags
                    ? "exact_identity_observed"
                    : "partial_identity_compatible",
        },
    };
};

const ResultInfoV1Schema = z
    .object({
        page: z.number().int().positive().optional(),
        per_page: z.number().int().positive().max(100).optional(),
        count: z.number().int().nonnegative().optional(),
        total_count: z.number().int().nonnegative().optional(),
        total_pages: z.number().int().nonnegative().optional(),
    })
    .passthrough();

export const D1ProbeCloudflareWorkerListPageInputV1Schema = z
    .object({
        page: z.number().int().positive(),
        per_page: z.number().int().positive().max(100),
        max_pages: z.number().int().positive().max(10),
        prior_item_count: z.number().int().nonnegative(),
        prior_worker_ids: z.array(IdentifierV1Schema),
        prior_correlated_candidate_observed: z.boolean(),
        expected_total_count: z.number().int().nonnegative().max(1_000).nullable(),
        expected_total_pages: z.number().int().nonnegative().max(10).nullable(),
        envelope: z
            .object({
                success: z.literal(true),
                errors: z.array(z.unknown()).length(0),
                messages: z.array(z.unknown()).length(0),
                result: z.array(z.unknown()),
                result_info: z.unknown().optional(),
            })
            .passthrough(),
    })
    .strict()
    .superRefine((value, context) => {
        if (value.page > value.max_pages) {
            context.addIssue({ code: "custom", message: "page exceeds max_pages" });
        }
        if (new Set(value.prior_worker_ids).size !== value.prior_worker_ids.length) {
            context.addIssue({ code: "custom", message: "prior_worker_ids must be unique" });
        }
        if (value.prior_worker_ids.length > value.prior_item_count) {
            context.addIssue({ code: "custom", message: "prior_worker_ids exceed prior_item_count" });
        }
        if (
            (value.expected_total_count === null) !== (value.expected_total_pages === null) ||
            (value.page === 1 && value.expected_total_count !== null) ||
            (value.page > 1 && value.expected_total_count === null)
        ) {
            context.addIssue({ code: "custom", message: "expected pagination totals do not match page" });
        }
    });

export type D1ProbeCloudflareWorkerListPageProjectionV1 =
    | { readonly success: false; readonly code: "invalid_page" | "invalid_result_info" | "pagination_mismatch" }
    | {
          readonly success: true;
          readonly page: number;
          readonly item_count: number;
          readonly exact_matches: readonly D1ProbeCloudflareWorkerCleanupIdentityV1[];
          readonly compatible_partial_matches: readonly D1ProbeCloudflareWorkerCleanupIdentityV1[];
          readonly pagination_status: "next_page_required" | "terminal_page_observed" | "page_bound_exhausted";
          readonly next_page: number | null;
          readonly result_info_observed: boolean;
          readonly pagination_metadata_complete: boolean;
          readonly declared_total_count: number | null;
          readonly declared_total_pages: number | null;
          readonly correlated_candidate_observed: boolean;
          readonly absence_metadata_complete: boolean;
      };

export const projectD1ProbeCloudflareWorkerListPageV1 = (
    input: unknown,
    expectationInput: unknown
): D1ProbeCloudflareWorkerListPageProjectionV1 => {
    const expectation = safeParseV1(D1ProbeCloudflareWorkerCleanupExpectationV1Schema, expectationInput);
    const parsed = safeParseV1(D1ProbeCloudflareWorkerListPageInputV1Schema, input);
    if (!expectation.success || !parsed.success) return { success: false, code: "invalid_page" };

    const { page, per_page: perPage, max_pages: maxPages, envelope, prior_item_count: priorCount } = parsed.data;
    const exactMatches: D1ProbeCloudflareWorkerCleanupIdentityV1[] = [];
    const compatiblePartialMatches: D1ProbeCloudflareWorkerCleanupIdentityV1[] = [];
    const currentIds: string[] = [];
    let currentCorrelatedCandidateObserved = false;
    for (const item of envelope.result) {
        const cleanup = projectD1ProbeCloudflareWorkerCleanupIdentityV1(item, expectation.data);
        if (cleanup.success) {
            if (cleanup.identity.status === "exact_identity_observed") exactMatches.push(cleanup.identity);
            else compatiblePartialMatches.push(cleanup.identity);
        }
        const candidate = safeParseV1(D1ProbeCloudflareWorkerCleanupCandidateV1Schema, item);
        if (candidate.success) {
            if (candidate.data.id !== undefined) currentIds.push(candidate.data.id);
            if (
                candidate.data.id === expectation.data.worker_id ||
                candidate.data.name === expectation.data.script_name ||
                candidate.data.tags?.some(tag => expectation.data.exact_tags.includes(tag)) === true
            ) {
                currentCorrelatedCandidateObserved = true;
            }
        }
    }
    const correlatedCandidateObserved =
        parsed.data.prior_correlated_candidate_observed || currentCorrelatedCandidateObserved;
    const allKnownIds = [...parsed.data.prior_worker_ids, ...currentIds];
    if (new Set(allKnownIds).size !== allKnownIds.length) {
        return { success: false, code: "pagination_mismatch" };
    }

    const resultInfoPresent = envelope.result_info !== undefined;
    if (!resultInfoPresent) {
        const terminal = envelope.result.length < perPage;
        const exhausted = !terminal && page === maxPages;
        return {
            success: true,
            page,
            item_count: envelope.result.length,
            exact_matches: exactMatches,
            compatible_partial_matches: compatiblePartialMatches,
            pagination_status: terminal
                ? "terminal_page_observed"
                : exhausted
                  ? "page_bound_exhausted"
                  : "next_page_required",
            next_page: terminal || exhausted ? null : page + 1,
            result_info_observed: false,
            pagination_metadata_complete: false,
            declared_total_count: null,
            declared_total_pages: null,
            correlated_candidate_observed: correlatedCandidateObserved,
            absence_metadata_complete: false,
        };
    }

    const info = safeParseV1(ResultInfoV1Schema, envelope.result_info);
    if (!info.success) return { success: false, code: "invalid_result_info" };
    if (
        (info.data.page !== undefined && info.data.page !== page) ||
        (info.data.per_page !== undefined && info.data.per_page !== perPage) ||
        (info.data.count !== undefined && info.data.count !== envelope.result.length) ||
        (info.data.total_count !== undefined && info.data.total_count < priorCount + envelope.result.length) ||
        (info.data.total_pages !== undefined && info.data.total_pages !== 0 && info.data.total_pages < page)
    ) {
        return { success: false, code: "pagination_mismatch" };
    }
    const completeInfo = z
        .object({
            page: z.number(),
            per_page: z.number(),
            count: z.number(),
            total_count: z.number(),
            total_pages: z.number(),
        })
        .safeParse(info.data);
    if (!completeInfo.success) {
        const terminal = envelope.result.length < perPage;
        const exhausted = !terminal && page === maxPages;
        return {
            success: true,
            page,
            item_count: envelope.result.length,
            exact_matches: exactMatches,
            compatible_partial_matches: compatiblePartialMatches,
            pagination_status: terminal
                ? "terminal_page_observed"
                : exhausted
                  ? "page_bound_exhausted"
                  : "next_page_required",
            next_page: terminal || exhausted ? null : page + 1,
            result_info_observed: true,
            pagination_metadata_complete: false,
            declared_total_count: null,
            declared_total_pages: null,
            correlated_candidate_observed: correlatedCandidateObserved,
            absence_metadata_complete: false,
        };
    }
    const effectivePages =
        completeInfo.data.total_pages === 0 && completeInfo.data.total_count === 0 ? 1 : completeInfo.data.total_pages;
    const calculatedPages = Math.max(1, Math.ceil(completeInfo.data.total_count / perPage));
    if (
        effectivePages !== calculatedPages ||
        effectivePages < page ||
        (parsed.data.expected_total_count !== null &&
            parsed.data.expected_total_count !== completeInfo.data.total_count) ||
        (parsed.data.expected_total_pages !== null && parsed.data.expected_total_pages !== effectivePages) ||
        (effectivePages === page && completeInfo.data.total_count !== priorCount + envelope.result.length)
    ) {
        return { success: false, code: "pagination_mismatch" };
    }
    const terminal = effectivePages === page;
    const exhausted = !terminal && page === maxPages;
    const allItemsIdentified =
        parsed.data.prior_worker_ids.length === priorCount && currentIds.length === envelope.result.length;
    const expectedIdObserved = allKnownIds.includes(expectation.data.worker_id);
    return {
        success: true,
        page,
        item_count: envelope.result.length,
        exact_matches: exactMatches,
        compatible_partial_matches: compatiblePartialMatches,
        pagination_status: terminal
            ? "terminal_page_observed"
            : exhausted
              ? "page_bound_exhausted"
              : "next_page_required",
        next_page: terminal || exhausted ? null : page + 1,
        result_info_observed: true,
        pagination_metadata_complete: true,
        declared_total_count: completeInfo.data.total_count,
        declared_total_pages: effectivePages,
        correlated_candidate_observed: correlatedCandidateObserved,
        absence_metadata_complete:
            page === 1 &&
            terminal &&
            !correlatedCandidateObserved &&
            allItemsIdentified &&
            !expectedIdObserved &&
            compatiblePartialMatches.length === 0 &&
            exactMatches.length === 0 &&
            completeInfo.data.total_count === priorCount + envelope.result.length,
    };
};

export const D1ProbeCloudflareWorkerVersionSemanticExpectationV1Schema = z
    .object({
        version_id: UuidV1Schema,
        version_tag: z.string().min(1).max(100),
        version_message: z.string().min(1).max(1_000),
        not_before_ms: SafeTimeV1Schema,
        expires_at_ms: SafeTimeV1Schema,
        module_content_base64: z.string().min(1),
    })
    .strict()
    .refine(value => value.expires_at_ms >= value.not_before_ms, "invalid observation window");

export const D1ProbeCloudflareWorkerVersionObservationV1Schema = z
    .object({
        id: UuidV1Schema,
        created_on: HttpDateV1Schema,
        annotations: z
            .object({
                "workers/tag": z.string(),
                "workers/message": z.string(),
            })
            .passthrough(),
        main_module: z.literal(FIXED_MODULE_NAME_V1),
        compatibility_date: z.literal(FIXED_COMPATIBILITY_DATE_V1),
        compatibility_flags: z.array(z.string()).length(0),
        bindings: z.array(z.unknown()).length(0),
        modules: z
            .array(
                z
                    .object({
                        name: z.literal(FIXED_MODULE_NAME_V1),
                        content_type: z.literal(FIXED_MODULE_CONTENT_TYPE_V1),
                        content_base64: z.string().min(1),
                    })
                    .passthrough()
            )
            .length(1),
    })
    .passthrough();

export const D1ProbeCloudflareWorkerDeploymentSemanticExpectationV1Schema = z
    .object({
        deployment_id: UuidV1Schema,
        version_id: UuidV1Schema,
        deployment_message: z.string().min(1).max(1_000),
        not_before_ms: SafeTimeV1Schema,
        expires_at_ms: SafeTimeV1Schema,
    })
    .strict()
    .refine(value => value.expires_at_ms >= value.not_before_ms, "invalid observation window");

export const D1ProbeCloudflareWorkerDeploymentObservationV1Schema = z
    .object({
        id: UuidV1Schema,
        created_on: HttpDateV1Schema,
        strategy: z.literal("percentage"),
        annotations: z.object({ "workers/message": z.string() }).passthrough(),
        versions: z
            .array(
                z
                    .object({
                        version_id: UuidV1Schema,
                        percentage: z.literal(100),
                    })
                    .passthrough()
            )
            .length(1),
    })
    .passthrough();

type SemanticObservationV1<T> =
    | { readonly accepted: false; readonly code: "missing_or_invalid_semantic_fields" | "semantic_mismatch" }
    | { readonly accepted: true; readonly value: T };

export interface D1ProbeCloudflareWorkerVersionProjectionV1 {
    readonly cleanup_identity: D1ProbeCloudflareWorkerCleanupIdentityV1;
    readonly version_identity: string | null;
    readonly semantic_observation: SemanticObservationV1<
        z.infer<typeof D1ProbeCloudflareWorkerVersionObservationV1Schema>
    >;
}

export interface D1ProbeCloudflareWorkerDeploymentProjectionV1 {
    readonly cleanup_identity: D1ProbeCloudflareWorkerCleanupIdentityV1;
    readonly deployment_identity: string | null;
    readonly semantic_observation: SemanticObservationV1<
        z.infer<typeof D1ProbeCloudflareWorkerDeploymentObservationV1Schema>
    >;
}

const IdentityCarrierV1Schema = z.object({ id: UuidV1Schema }).passthrough();

const identityFromUnknown = (input: unknown): string | null => {
    const parsed = safeParseV1(IdentityCarrierV1Schema, input);
    return parsed.success ? parsed.data.id : null;
};

const timestampInside = (timestamp: string, notBeforeMs: number, expiresAtMs: number): boolean => {
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) && parsed >= notBeforeMs && parsed <= expiresAtMs;
};

export const projectD1ProbeCloudflareWorkerVersionObservationV1 = (
    input: unknown,
    expectationInput: unknown,
    cleanupIdentityInput: unknown
): D1ProbeCloudflareWorkerVersionProjectionV1 | null => {
    const expectation = safeParseV1(D1ProbeCloudflareWorkerVersionSemanticExpectationV1Schema, expectationInput);
    const cleanup = safeParseV1(D1ProbeCloudflareWorkerCleanupIdentityV1Schema, cleanupIdentityInput);
    if (!expectation.success || !cleanup.success) return null;
    const versionIdentity = identityFromUnknown(input);
    const observation = safeParseV1(D1ProbeCloudflareWorkerVersionObservationV1Schema, input);
    if (!observation.success) {
        return {
            cleanup_identity: cleanup.data,
            version_identity: versionIdentity,
            semantic_observation: { accepted: false, code: "missing_or_invalid_semantic_fields" },
        };
    }
    const semanticMatch =
        observation.data.id === expectation.data.version_id &&
        observation.data.annotations["workers/tag"] === expectation.data.version_tag &&
        observation.data.annotations["workers/message"] === expectation.data.version_message &&
        observation.data.modules[0]?.content_base64 === expectation.data.module_content_base64 &&
        timestampInside(observation.data.created_on, expectation.data.not_before_ms, expectation.data.expires_at_ms);
    return {
        cleanup_identity: cleanup.data,
        version_identity: versionIdentity,
        semantic_observation: semanticMatch
            ? { accepted: true, value: observation.data }
            : { accepted: false, code: "semantic_mismatch" },
    };
};

export const projectD1ProbeCloudflareWorkerDeploymentObservationV1 = (
    input: unknown,
    expectationInput: unknown,
    cleanupIdentityInput: unknown
): D1ProbeCloudflareWorkerDeploymentProjectionV1 | null => {
    const expectation = safeParseV1(D1ProbeCloudflareWorkerDeploymentSemanticExpectationV1Schema, expectationInput);
    const cleanup = safeParseV1(D1ProbeCloudflareWorkerCleanupIdentityV1Schema, cleanupIdentityInput);
    if (!expectation.success || !cleanup.success) return null;
    const deploymentIdentity = identityFromUnknown(input);
    const observation = safeParseV1(D1ProbeCloudflareWorkerDeploymentObservationV1Schema, input);
    if (!observation.success) {
        return {
            cleanup_identity: cleanup.data,
            deployment_identity: deploymentIdentity,
            semantic_observation: { accepted: false, code: "missing_or_invalid_semantic_fields" },
        };
    }
    const semanticMatch =
        observation.data.id === expectation.data.deployment_id &&
        observation.data.annotations["workers/message"] === expectation.data.deployment_message &&
        observation.data.versions[0]?.version_id === expectation.data.version_id &&
        timestampInside(observation.data.created_on, expectation.data.not_before_ms, expectation.data.expires_at_ms);
    return {
        cleanup_identity: cleanup.data,
        deployment_identity: deploymentIdentity,
        semantic_observation: semanticMatch
            ? { accepted: true, value: observation.data }
            : { accepted: false, code: "semantic_mismatch" },
    };
};
