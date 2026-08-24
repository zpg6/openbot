import {
    D1_PROBE_CREATE_STEPS_V1,
    D1_PROBE_LIFECYCLE_STEPS_V1,
    D1ProbeLifecycleJournalV1Schema,
    D1ProbeLifecycleStepV1Schema,
    D1ProbePreflightPlanV1Schema,
    D1ProbeResourceKindV1Schema,
    type D1ProbeLifecycleJournalV1,
    type D1ProbeLifecycleStepV1,
    type D1ProbePreflightPlanV1,
    type D1ProbeResourceKindV1,
} from "./contracts.js";

const DigestPattern = /^[0-9a-f]{64}$/u;

const resourceByStep = Object.freeze({
    database_created: "database",
    sink_deployed: "sink_script",
    writer_a_deployed: "writer_a_script",
    writer_b_deployed: "writer_b_script",
    access_application_created: "access_application",
    access_policy_created: "access_policy",
    access_service_token_created: "access_service_token",
    writer_a_route_created: "writer_a_route",
    writer_b_route_created: "writer_b_route",
    readback_route_created: "readback_route",
    access_service_token_revoked: "access_service_token",
    writer_a_route_deleted: "writer_a_route",
    writer_b_route_deleted: "writer_b_route",
    readback_route_deleted: "readback_route",
    access_policy_deleted: "access_policy",
    access_application_deleted: "access_application",
    writer_a_script_deleted_without_force: "writer_a_script",
    writer_b_script_deleted_without_force: "writer_b_script",
    sink_script_deleted_without_force: "sink_script",
    database_deleted: "database",
} as const satisfies Partial<Record<D1ProbeLifecycleStepV1, D1ProbeResourceKindV1>>);

const stateForLength = (length: number): D1ProbeLifecycleJournalV1["state"] => {
    if (length === 0) return "planned";
    if (length < D1_PROBE_CREATE_STEPS_V1.length) return "provisioning";
    if (length === D1_PROBE_CREATE_STEPS_V1.length) return "ready";
    if (length < D1_PROBE_LIFECYCLE_STEPS_V1.length) return "cleaning_up";
    return "cleanup_confirmed";
};

const parseBoundLifecycle = (
    planInput: unknown,
    journalInput: unknown
): { plan: D1ProbePreflightPlanV1; journal: D1ProbeLifecycleJournalV1 } | null => {
    try {
        const plan = D1ProbePreflightPlanV1Schema.safeParse(planInput);
        const journal = D1ProbeLifecycleJournalV1Schema.safeParse(journalInput);
        if (!plan.success || !journal.success || journal.data.plan_digest !== plan.data.plan_digest) return null;
        const resourcesMatch = plan.data.resources.every(resource =>
            journal.data.planned_resources.some(
                candidate =>
                    candidate.resource_kind === resource.resource_kind &&
                    candidate.generated_name_commitment === resource.generated_name_commitment
            )
        );
        const deniedDatabasesMatch =
            journal.data.operator_database_deny_id_commitments.length ===
                plan.data.operator_database_deny_id_commitments.length &&
            plan.data.operator_database_deny_id_commitments.every(commitment =>
                journal.data.operator_database_deny_id_commitments.includes(commitment)
            );
        return resourcesMatch && deniedDatabasesMatch ? { plan: plan.data, journal: journal.data } : null;
    } catch {
        return null;
    }
};

export const createD1ProbeLifecycleJournalV1 = (
    planInput: unknown
):
    | { success: true; journal: D1ProbeLifecycleJournalV1 }
    | { success: false; code: "invalid_preflight_plan" | "invalid_lifecycle_journal" } => {
    let plan: ReturnType<typeof D1ProbePreflightPlanV1Schema.safeParse>;
    try {
        plan = D1ProbePreflightPlanV1Schema.safeParse(planInput);
    } catch {
        return { success: false, code: "invalid_preflight_plan" };
    }
    if (!plan.success) return { success: false, code: "invalid_preflight_plan" };
    const journal = D1ProbeLifecycleJournalV1Schema.safeParse({
        schema_version: 1,
        kind: "d1_probe_lifecycle_journal",
        plan_digest: plan.data.plan_digest,
        planned_resources: plan.data.resources.map(resource => ({
            resource_kind: resource.resource_kind,
            generated_name_commitment: resource.generated_name_commitment,
        })),
        operator_database_deny_id_commitments: plan.data.operator_database_deny_id_commitments,
        state: "planned",
        completed_steps: [],
        observations: [],
        manual_required: null,
    });
    return journal.success
        ? { success: true, journal: journal.data }
        : { success: false, code: "invalid_lifecycle_journal" };
};

const createdResourceCommitments = (
    journal: D1ProbeLifecycleJournalV1,
    resourceKind: D1ProbeResourceKindV1
): { id: string; name: string } | null => {
    const observation = journal.observations.find(
        candidate =>
            candidate.resource_kind === resourceKind &&
            candidate.step ===
                Object.entries(resourceByStep).find(
                    ([step, kind]) => kind === resourceKind && D1_PROBE_CREATE_STEPS_V1.includes(step as never)
                )?.[0]
    );
    if (
        observation === undefined ||
        observation.resource_id_commitment === null ||
        observation.resource_name_commitment === null
    ) {
        return null;
    }
    return { id: observation.resource_id_commitment, name: observation.resource_name_commitment };
};

export const advanceD1ProbeLifecycleJournalV1 = (
    planInput: unknown,
    journalInput: unknown,
    eventInput: unknown
):
    | { success: true; journal: D1ProbeLifecycleJournalV1 }
    | {
          success: false;
          code:
              | "invalid_lifecycle_journal"
              | "invalid_lifecycle_event"
              | "manual_review_required"
              | "unexpected_lifecycle_step"
              | "resource_binding_mismatch"
              | "production_database_denied";
      } => {
    const bound = parseBoundLifecycle(planInput, journalInput);
    if (bound === null) return { success: false, code: "invalid_lifecycle_journal" };
    const journal = bound.journal;
    if (journal.state === "manual_required") return { success: false, code: "manual_review_required" };
    const eventSchema = D1ProbeLifecycleStepV1Schema.transform(step => step);
    const nullableResourceSchema = D1ProbeResourceKindV1Schema.nullable();
    let step: ReturnType<typeof eventSchema.safeParse>;
    let resourceKind: ReturnType<typeof nullableResourceSchema.safeParse>;
    const record = eventInput as Record<string, unknown>;
    try {
        if (
            typeof eventInput !== "object" ||
            eventInput === null ||
            Array.isArray(eventInput) ||
            Object.keys(eventInput).sort().join(",") !==
                "observation_digest,resource_id_commitment,resource_kind,resource_name_commitment,step"
        ) {
            return { success: false, code: "invalid_lifecycle_event" };
        }
        step = eventSchema.safeParse(record["step"]);
        resourceKind = nullableResourceSchema.safeParse(record["resource_kind"]);
    } catch {
        return { success: false, code: "invalid_lifecycle_event" };
    }
    const observationDigest = record["observation_digest"];
    const resourceIdCommitment = record["resource_id_commitment"];
    const resourceNameCommitment = record["resource_name_commitment"];
    if (
        !step.success ||
        !resourceKind.success ||
        typeof observationDigest !== "string" ||
        !DigestPattern.test(observationDigest) ||
        !(
            resourceIdCommitment === null ||
            (typeof resourceIdCommitment === "string" && DigestPattern.test(resourceIdCommitment))
        ) ||
        !(
            resourceNameCommitment === null ||
            (typeof resourceNameCommitment === "string" && DigestPattern.test(resourceNameCommitment))
        )
    ) {
        return { success: false, code: "invalid_lifecycle_event" };
    }
    const expectedStep = D1_PROBE_LIFECYCLE_STEPS_V1[journal.completed_steps.length];
    if (step.data !== expectedStep) return { success: false, code: "unexpected_lifecycle_step" };
    const expectedResource = resourceByStep[step.data as keyof typeof resourceByStep] ?? null;
    if (
        resourceKind.data !== expectedResource ||
        (expectedResource === null) !== (resourceIdCommitment === null) ||
        (expectedResource === null) !== (resourceNameCommitment === null)
    ) {
        return { success: false, code: "resource_binding_mismatch" };
    }
    if (expectedResource !== null) {
        const plannedResource = journal.planned_resources.find(resource => resource.resource_kind === expectedResource);
        if (plannedResource?.generated_name_commitment !== resourceNameCommitment) {
            return { success: false, code: "resource_binding_mismatch" };
        }
    }
    if (
        step.data === "database_created" &&
        typeof resourceIdCommitment === "string" &&
        journal.operator_database_deny_id_commitments.includes(resourceIdCommitment)
    ) {
        return { success: false, code: "production_database_denied" };
    }
    if (expectedResource !== null && !D1_PROBE_CREATE_STEPS_V1.includes(step.data as never)) {
        const createdCommitments = createdResourceCommitments(journal, expectedResource);
        if (
            createdCommitments === null ||
            createdCommitments.id !== resourceIdCommitment ||
            createdCommitments.name !== resourceNameCommitment
        ) {
            return { success: false, code: "resource_binding_mismatch" };
        }
    }
    const completedSteps = [...journal.completed_steps, step.data];
    const next = D1ProbeLifecycleJournalV1Schema.safeParse({
        ...journal,
        state: stateForLength(completedSteps.length),
        completed_steps: completedSteps,
        observations: [
            ...journal.observations,
            {
                step: step.data,
                observation_digest: observationDigest,
                resource_kind: resourceKind.data,
                resource_name_commitment: resourceNameCommitment,
                resource_id_commitment: resourceIdCommitment,
            },
        ],
    });
    return next.success ? { success: true, journal: next.data } : { success: false, code: "invalid_lifecycle_journal" };
};

export const markD1ProbeLifecycleAmbiguousV1 = (
    planInput: unknown,
    journalInput: unknown,
    failureInput: unknown
):
    | { success: true; journal: D1ProbeLifecycleJournalV1 }
    | {
          success: false;
          code: "invalid_lifecycle_journal" | "invalid_lifecycle_failure" | "terminal_lifecycle_state";
      } => {
    const bound = parseBoundLifecycle(planInput, journalInput);
    if (bound === null) return { success: false, code: "invalid_lifecycle_journal" };
    const journal = bound.journal;
    if (journal.state === "manual_required" || journal.state === "cleanup_confirmed") {
        return { success: false, code: "terminal_lifecycle_state" };
    }
    const failureSchema = D1ProbeLifecycleJournalV1Schema.shape.manual_required.unwrap();
    let failure: ReturnType<typeof failureSchema.safeParse>;
    try {
        failure = failureSchema.safeParse(failureInput);
    } catch {
        return { success: false, code: "invalid_lifecycle_failure" };
    }
    if (!failure.success) return { success: false, code: "invalid_lifecycle_failure" };
    const next = D1ProbeLifecycleJournalV1Schema.safeParse({
        ...journal,
        state: "manual_required",
        manual_required: failure.data,
    });
    return next.success ? { success: true, journal: next.data } : { success: false, code: "invalid_lifecycle_journal" };
};

export const lifecycleResourceForStepV1 = (step: D1ProbeLifecycleStepV1): D1ProbeResourceKindV1 | null =>
    resourceByStep[step as keyof typeof resourceByStep] ?? null;

export const isD1ProbeLifecycleJournalReadyForStepV1 = (
    planInput: unknown,
    journalInput: unknown,
    expectedStep: D1ProbeLifecycleStepV1
): boolean => {
    const bound = parseBoundLifecycle(planInput, journalInput);
    return (
        bound !== null &&
        bound.journal.state !== "manual_required" &&
        bound.journal.state !== "cleanup_confirmed" &&
        D1_PROBE_LIFECYCLE_STEPS_V1[bound.journal.completed_steps.length] === expectedStep
    );
};

export const isD1ProbeLifecycleJournalBoundV1 = (planInput: unknown, journalInput: unknown): boolean =>
    parseBoundLifecycle(planInput, journalInput) !== null;

export const isD1ProbePlanV1 = (input: unknown): input is D1ProbePreflightPlanV1 => {
    try {
        return D1ProbePreflightPlanV1Schema.safeParse(input).success;
    } catch {
        return false;
    }
};
