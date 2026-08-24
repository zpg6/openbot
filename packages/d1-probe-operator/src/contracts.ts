import { z } from "zod";

export const D1_PROBE_RESOURCE_PREFIX_V1 = "openbot-d1-probe-";
export const D1_PROBE_ROUTE_PATH_PREFIX_V1 = "/_openbot-d1-probe";
export const D1_PROBE_COMPATIBILITY_DATE_V1 = "2026-08-22";
export const D1_PROBE_WRANGLER_VERSION_V1 = "4.125.0";

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const AccountOrZoneIdSchema = z.string().regex(/^[0-9a-f]{32}$/u);
const DatabaseIdSchema = z
    .string()
    .regex(/^(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/u);
const SuffixSchema = z.string().regex(/^[a-z0-9]{16}$/u);
const ProbeHostnamePattern =
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;

const ProbeOriginSchema = z
    .string()
    .min(9)
    .max(262)
    .superRefine((origin, context) => {
        try {
            const url = new URL(origin);
            if (
                url.protocol !== "https:" ||
                url.username !== "" ||
                url.password !== "" ||
                url.port !== "" ||
                url.pathname !== "/" ||
                url.search !== "" ||
                url.hash !== "" ||
                url.origin !== origin ||
                !ProbeHostnamePattern.test(url.hostname)
            ) {
                context.addIssue({ code: "custom", message: "Probe origin must be one canonical HTTPS DNS origin" });
            }
        } catch {
            context.addIssue({ code: "custom", message: "Probe origin must be one canonical HTTPS DNS origin" });
        }
    });

export const D1ProbeResourceKindV1Schema = z.enum([
    "database",
    "sink_script",
    "writer_a_script",
    "writer_b_script",
    "access_application",
    "access_policy",
    "access_service_token",
    "writer_a_route",
    "writer_b_route",
    "readback_route",
]);
export type D1ProbeResourceKindV1 = z.infer<typeof D1ProbeResourceKindV1Schema>;

export const D1_PROBE_RESOURCE_KINDS_V1 = Object.freeze([...D1ProbeResourceKindV1Schema.options]);

const ResourceSuffixesV1Schema = z
    .object(
        Object.fromEntries(D1_PROBE_RESOURCE_KINDS_V1.map(kind => [kind, SuffixSchema])) as Record<
            D1ProbeResourceKindV1,
            typeof SuffixSchema
        >
    )
    .strict()
    .refine(suffixes => new Set(Object.values(suffixes)).size === D1_PROBE_RESOURCE_KINDS_V1.length, {
        message: "Every disposable resource must use a distinct random suffix",
    });

export const D1ProbePreflightRequestV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("d1_probe_preflight_request"),
        account_id: AccountOrZoneIdSchema,
        zone_id: AccountOrZoneIdSchema,
        probe_origin: ProbeOriginSchema,
        database_jurisdiction: z.enum(["automatic", "eu", "us", "fedramp"]),
        installation_digest: DigestSchema,
        environment_digest: DigestSchema,
        configuration_digest: DigestSchema,
        probe_definition_digest: DigestSchema,
        collector_build_digest: DigestSchema,
        commitment_key_id_digest: DigestSchema,
        operator_database_deny_list: z
            .array(DatabaseIdSchema)
            .min(1)
            .max(128)
            .refine(values => new Set(values).size === values.length, {
                message: "Operator database deny-list IDs must be unique",
            }),
        resource_suffixes: ResourceSuffixesV1Schema,
    })
    .strict()
    .refine(request => request.account_id !== request.zone_id, {
        path: ["zone_id"],
        message: "Account and zone identifiers must differ",
    });
export type D1ProbePreflightRequestV1 = z.infer<typeof D1ProbePreflightRequestV1Schema>;

export const D1ProbeCommitmentKeyV1Schema = z
    .object({
        hmac_key_base64url: z.string().regex(/^[A-Za-z0-9_-]{43,86}$/u),
    })
    .strict();

export const D1_PROBE_CREATE_STEPS_V1 = Object.freeze([
    "database_created",
    "sink_deployed",
    "writer_a_deployed",
    "writer_b_deployed",
    "access_application_created",
    "access_policy_created",
    "access_service_token_created",
    "writer_a_route_created",
    "writer_b_route_created",
    "readback_route_created",
    "probe_ready",
] as const);

export const D1_PROBE_CLEANUP_STEPS_V1 = Object.freeze([
    "run_fenced",
    "inflight_requests_settled",
    "final_readback_captured",
    "access_service_token_revoked",
    "writer_a_route_deleted",
    "writer_b_route_deleted",
    "readback_route_deleted",
    "routes_absence_confirmed",
    "access_policy_deleted",
    "access_application_deleted",
    "writer_a_script_deleted_without_force",
    "writer_b_script_deleted_without_force",
    "sink_script_deleted_without_force",
    "database_deleted",
    "all_resource_absence_confirmed",
] as const);

export const D1_PROBE_LIFECYCLE_STEPS_V1 = Object.freeze([...D1_PROBE_CREATE_STEPS_V1, ...D1_PROBE_CLEANUP_STEPS_V1]);
export const D1ProbeLifecycleStepV1Schema = z.enum(D1_PROBE_LIFECYCLE_STEPS_V1);
export type D1ProbeLifecycleStepV1 = z.infer<typeof D1ProbeLifecycleStepV1Schema>;

const D1ProbePlannedRouteV1Schema = z
    .object({
        resource_kind: z.enum(["writer_a_route", "writer_b_route", "readback_route"]),
        target_script_kind: z.enum(["writer_a_script", "writer_b_script", "sink_script"]),
        target_script_name: z.string().regex(/^openbot-d1-probe-[a-z0-9]{16}$/u),
        http_method: z.enum(["GET", "POST"]),
        exact_url: z.string().max(512),
        route_pattern: z.string().max(512),
        route_pattern_commitment: DigestSchema,
    })
    .strict();

const D1ProbePlannedRoutesV1Schema = z.tuple([
    D1ProbePlannedRouteV1Schema,
    D1ProbePlannedRouteV1Schema,
    D1ProbePlannedRouteV1Schema,
]);

export const D1ProbePreflightPlanV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("d1_probe_preflight_plan"),
        authoritative: z.literal(false),
        deploy_performed: z.literal(false),
        gate_promotion_allowed: z.literal(false),
        resource_prefix: z.literal(D1_PROBE_RESOURCE_PREFIX_V1),
        compatibility_date: z.literal(D1_PROBE_COMPATIBILITY_DATE_V1),
        wrangler_version: z.literal(D1_PROBE_WRANGLER_VERSION_V1),
        account_id_commitment: DigestSchema,
        zone_id_commitment: DigestSchema,
        probe_origin: ProbeOriginSchema,
        probe_origin_commitment: DigestSchema,
        database_jurisdiction: z.enum(["automatic", "eu", "us", "fedramp"]),
        access_application_domain: z.string().min(1).max(512),
        access_application_domain_commitment: DigestSchema,
        installation_digest: DigestSchema,
        environment_digest: DigestSchema,
        configuration_digest: DigestSchema,
        probe_definition_digest: DigestSchema,
        collector_build_digest: DigestSchema,
        commitment_key_id_digest: DigestSchema,
        operator_database_deny_list_commitment: DigestSchema,
        operator_database_deny_id_commitments: z
            .array(DigestSchema)
            .min(1)
            .max(128)
            .refine(values => new Set(values).size === values.length, {
                message: "Operator database deny-list commitments must be unique",
            }),
        resources: z
            .array(
                z
                    .object({
                        resource_kind: D1ProbeResourceKindV1Schema,
                        generated_name: z.string().regex(/^openbot-d1-probe-[a-z0-9]{16}$/u),
                        generated_name_commitment: DigestSchema,
                    })
                    .strict()
            )
            .length(D1_PROBE_RESOURCE_KINDS_V1.length)
            .refine(resources => new Set(resources.map(resource => resource.resource_kind)).size === resources.length, {
                message: "Preflight resources must contain every resource kind once",
            })
            .refine(
                resources => new Set(resources.map(resource => resource.generated_name)).size === resources.length,
                {
                    message: "Generated resource names must be unique",
                }
            ),
        routes: D1ProbePlannedRoutesV1Schema,
        create_steps: z
            .array(z.enum(D1_PROBE_CREATE_STEPS_V1))
            .length(D1_PROBE_CREATE_STEPS_V1.length)
            .refine(steps => steps.every((step, index) => step === D1_PROBE_CREATE_STEPS_V1[index]), {
                message: "Create steps must use the fixed deployment order",
            }),
        cleanup_steps: z
            .array(z.enum(D1_PROBE_CLEANUP_STEPS_V1))
            .length(D1_PROBE_CLEANUP_STEPS_V1.length)
            .refine(steps => steps.every((step, index) => step === D1_PROBE_CLEANUP_STEPS_V1[index]), {
                message: "Cleanup steps must use the fixed teardown order",
            }),
        plan_digest: DigestSchema,
    })
    .strict()
    .superRefine((plan, context) => {
        let hostname = "";
        try {
            hostname = new URL(plan.probe_origin).hostname;
        } catch {
            context.addIssue({
                code: "custom",
                path: ["probe_origin"],
                message: "Probe origin could not be resolved for route validation",
            });
            return;
        }
        if (plan.access_application_domain !== `${hostname}${D1_PROBE_ROUTE_PATH_PREFIX_V1}/*`) {
            context.addIssue({
                code: "custom",
                path: ["access_application_domain"],
                message: "Access application domain must cover only the generated probe route prefix",
            });
        }
        const expected = [
            ["writer_a_route", "writer_a_script", "POST"],
            ["writer_b_route", "writer_b_script", "POST"],
            ["readback_route", "sink_script", "GET"],
        ] as const;
        for (const [index, [resourceKind, targetScriptKind, method]] of expected.entries()) {
            const route = plan.routes[index];
            const routeResource = plan.resources.find(resource => resource.resource_kind === resourceKind);
            const targetResource = plan.resources.find(resource => resource.resource_kind === targetScriptKind);
            const suffix = routeResource?.generated_name.slice(D1_PROBE_RESOURCE_PREFIX_V1.length);
            const exactUrl = `${plan.probe_origin}${D1_PROBE_ROUTE_PATH_PREFIX_V1}/${suffix ?? ""}`;
            if (
                route?.resource_kind !== resourceKind ||
                route.target_script_kind !== targetScriptKind ||
                route.target_script_name !== targetResource?.generated_name ||
                route.http_method !== method ||
                route.exact_url !== exactUrl ||
                route.route_pattern !== exactUrl
            ) {
                context.addIssue({
                    code: "custom",
                    path: ["routes", index],
                    message: "Planned route must match its generated route resource and target script",
                });
            }
        }
        if (new Set(plan.routes.map(route => route.route_pattern)).size !== plan.routes.length) {
            context.addIssue({ code: "custom", path: ["routes"], message: "Planned route patterns must be unique" });
        }
    });
export type D1ProbePreflightPlanV1 = z.infer<typeof D1ProbePreflightPlanV1Schema>;

export const D1ProbeLifecycleJournalV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("d1_probe_lifecycle_journal"),
        plan_digest: DigestSchema,
        planned_resources: z
            .array(
                z
                    .object({
                        resource_kind: D1ProbeResourceKindV1Schema,
                        generated_name_commitment: DigestSchema,
                    })
                    .strict()
            )
            .length(D1_PROBE_RESOURCE_KINDS_V1.length)
            .refine(resources => new Set(resources.map(resource => resource.resource_kind)).size === resources.length, {
                message: "Lifecycle journal must bind every planned resource kind once",
            }),
        operator_database_deny_id_commitments: z
            .array(DigestSchema)
            .min(1)
            .max(128)
            .refine(values => new Set(values).size === values.length, {
                message: "Lifecycle database deny-list commitments must be unique",
            }),
        state: z.enum(["planned", "provisioning", "ready", "cleaning_up", "cleanup_confirmed", "manual_required"]),
        completed_steps: z.array(D1ProbeLifecycleStepV1Schema).max(D1_PROBE_LIFECYCLE_STEPS_V1.length),
        observations: z
            .array(
                z
                    .object({
                        step: D1ProbeLifecycleStepV1Schema,
                        observation_digest: DigestSchema,
                        resource_kind: D1ProbeResourceKindV1Schema.nullable(),
                        resource_name_commitment: DigestSchema.nullable(),
                        resource_id_commitment: DigestSchema.nullable(),
                    })
                    .strict()
            )
            .max(D1_PROBE_LIFECYCLE_STEPS_V1.length),
        manual_required: z
            .object({
                failed_step: D1ProbeLifecycleStepV1Schema,
                reason: z.enum([
                    "ambiguous_create",
                    "ambiguous_delete",
                    "id_mismatch",
                    "name_mismatch",
                    "inflight_state_unknown",
                    "absence_unverified",
                    "unexpected_platform_result",
                ]),
                observation_digest: DigestSchema,
            })
            .strict()
            .nullable(),
    })
    .strict()
    .superRefine((journal, context) => {
        if (
            journal.completed_steps.length !== journal.observations.length ||
            journal.completed_steps.some((step, index) => step !== D1_PROBE_LIFECYCLE_STEPS_V1[index]) ||
            journal.observations.some((observation, index) => observation.step !== journal.completed_steps[index])
        ) {
            context.addIssue({
                code: "custom",
                path: ["completed_steps"],
                message: "Journal steps and observations must be the exact lifecycle prefix",
            });
        }
        if ((journal.state === "manual_required") !== (journal.manual_required !== null)) {
            context.addIssue({
                code: "custom",
                path: ["manual_required"],
                message: "Only manual-required journals may carry failure details",
            });
        }
        const completedLength = journal.completed_steps.length;
        const expectedState =
            completedLength === 0
                ? "planned"
                : completedLength < D1_PROBE_CREATE_STEPS_V1.length
                  ? "provisioning"
                  : completedLength === D1_PROBE_CREATE_STEPS_V1.length
                    ? "ready"
                    : completedLength < D1_PROBE_LIFECYCLE_STEPS_V1.length
                      ? "cleaning_up"
                      : "cleanup_confirmed";
        if (journal.state !== "manual_required" && journal.state !== expectedState) {
            context.addIssue({
                code: "custom",
                path: ["state"],
                message: "Journal state must match the completed lifecycle prefix",
            });
        }
        if (
            journal.manual_required !== null &&
            journal.manual_required.failed_step !== D1_PROBE_LIFECYCLE_STEPS_V1[completedLength]
        ) {
            context.addIssue({
                code: "custom",
                path: ["manual_required", "failed_step"],
                message: "Manual review must identify the exact next lifecycle step",
            });
        }
    });
export type D1ProbeLifecycleJournalV1 = z.infer<typeof D1ProbeLifecycleJournalV1Schema>;
