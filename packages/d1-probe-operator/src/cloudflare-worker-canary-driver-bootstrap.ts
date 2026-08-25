import {
    compileD1ProbeCloudflareWorkerCanaryCleanupObligationV1,
    publishD1ProbeCloudflareWorkerCanaryCleanupObligationV1,
    readD1ProbeCloudflareWorkerCanaryCleanupObligationReadOnlyV1,
    type D1ProbeCloudflareWorkerCanaryCleanupObligationV1,
} from "./cloudflare-worker-canary-cleanup-obligation.js";
import {
    acquireD1ProbeCloudflareWorkerCanaryDriverLeaseV1,
    assertCurrentD1ProbeCloudflareWorkerCanaryDriverLeaseV1,
    type D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1,
    type D1ProbeCloudflareWorkerCanaryDriverLeaseV1,
} from "./cloudflare-worker-canary-driver-lease.js";
import {
    commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1,
    digestD1ProbeCloudflareWorkerCanaryOperationRecordV1,
    readD1ProbeCloudflareWorkerCanaryEffectJournalReadOnlyV1,
    type D1ProbeCloudflareWorkerCanaryEffectJournalReadResultV1,
} from "./cloudflare-worker-canary-effect-journal.js";
import {
    validateD1ProbeCloudflareWorkerCanaryOperationV1,
    type D1ProbeCloudflareWorkerCanaryOperationV1,
} from "./cloudflare-worker-canary-operation.js";
import {
    readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1,
    type D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryResultV1,
} from "./cloudflare-worker-canary-response-archive.js";
import {
    createD1ProbeCloudflareWorkerCanaryStateV1,
    readD1ProbeCloudflareWorkerCanaryStateReadOnlyV1,
    type D1ProbeCloudflareWorkerCanaryStateResultV1,
} from "./cloudflare-worker-canary-state.js";

const MAX_LEASE_DURATION_MS_V1 = 300_000;

export interface D1ProbeCloudflareWorkerCanaryDriverBootstrapInputV1 {
    readonly operation: unknown;
    readonly cleanup_grace: unknown;
    readonly lease_duration_ms: unknown;
}

export type D1ProbeCloudflareWorkerCanaryDriverBootstrapDenialV1 =
    | "invalid_bootstrap_input"
    | "operation_not_prepared"
    | "operation_state_unavailable"
    | "operation_state_conflict"
    | "cleanup_obligation_unavailable"
    | "cleanup_obligation_conflict"
    | "prior_effect_history_present"
    | "prior_archive_history_present"
    | "driver_lease_unavailable"
    | "final_driver_lease_reassertion_failed"
    | "final_operation_state_reassertion_failed"
    | "final_cleanup_obligation_reassertion_failed"
    | "final_history_reassertion_failed";

export interface D1ProbeCloudflareWorkerCanaryDriverBootstrapSessionV1 {
    readonly schema_version: 1;
    readonly kind: "d1_probe_cloudflare_worker_api_canary_driver_bootstrap_session";
    readonly operation: D1ProbeCloudflareWorkerCanaryOperationV1;
    readonly cleanup_obligation: D1ProbeCloudflareWorkerCanaryCleanupObligationV1;
    readonly driver_lease: D1ProbeCloudflareWorkerCanaryDriverLeaseV1;
    readonly driver_lease_owner: D1ProbeCloudflareWorkerCanaryDriverLeaseOwnerV1;
    readonly durable_pre_dispatch_records_ready: true;
    readonly remote_dispatch_authorized: false;
    readonly cleanup_authorized: false;
    readonly caller_mutation_authority: false;
    readonly authoritative: false;
    readonly eligible_for_upload: false;
    readonly eligible_for_attestation: false;
    readonly lifecycle_advance_allowed: false;
    readonly gate_promotion_allowed: false;
}

export type D1ProbeCloudflareWorkerCanaryDriverBootstrapResultV1 =
    | { readonly success: false; readonly code: D1ProbeCloudflareWorkerCanaryDriverBootstrapDenialV1 }
    | { readonly success: true; readonly session: D1ProbeCloudflareWorkerCanaryDriverBootstrapSessionV1 };

export interface D1ProbeCloudflareWorkerCanaryDriverBootstrapTestOnlyDependenciesV1 {
    readonly compile_cleanup_obligation: typeof compileD1ProbeCloudflareWorkerCanaryCleanupObligationV1;
    readonly publish_cleanup_obligation: typeof publishD1ProbeCloudflareWorkerCanaryCleanupObligationV1;
    readonly read_cleanup_obligation: typeof readD1ProbeCloudflareWorkerCanaryCleanupObligationReadOnlyV1;
    readonly acquire_driver_lease: typeof acquireD1ProbeCloudflareWorkerCanaryDriverLeaseV1;
    readonly assert_current_driver_lease: typeof assertCurrentD1ProbeCloudflareWorkerCanaryDriverLeaseV1;
    readonly commit_execution_nonce: typeof commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1;
    readonly digest_operation: typeof digestD1ProbeCloudflareWorkerCanaryOperationRecordV1;
    readonly read_effect_journal: (
        planDigest: string
    ) => Promise<D1ProbeCloudflareWorkerCanaryEffectJournalReadResultV1>;
    readonly validate_operation: typeof validateD1ProbeCloudflareWorkerCanaryOperationV1;
    readonly read_archive_inventory: (
        planDigest: string
    ) => Promise<D1ProbeCloudflareWorkerCanaryResponseArchiveInventoryResultV1>;
    readonly create_state: typeof createD1ProbeCloudflareWorkerCanaryStateV1;
    readonly read_state: (planDigest: string) => Promise<D1ProbeCloudflareWorkerCanaryStateResultV1>;
}

const fixedDependencies: D1ProbeCloudflareWorkerCanaryDriverBootstrapTestOnlyDependenciesV1 = {
    compile_cleanup_obligation: compileD1ProbeCloudflareWorkerCanaryCleanupObligationV1,
    publish_cleanup_obligation: publishD1ProbeCloudflareWorkerCanaryCleanupObligationV1,
    read_cleanup_obligation: readD1ProbeCloudflareWorkerCanaryCleanupObligationReadOnlyV1,
    acquire_driver_lease: acquireD1ProbeCloudflareWorkerCanaryDriverLeaseV1,
    assert_current_driver_lease: assertCurrentD1ProbeCloudflareWorkerCanaryDriverLeaseV1,
    commit_execution_nonce: commitD1ProbeCloudflareWorkerCanaryExecutionNonceV1,
    digest_operation: digestD1ProbeCloudflareWorkerCanaryOperationRecordV1,
    read_effect_journal: readD1ProbeCloudflareWorkerCanaryEffectJournalReadOnlyV1,
    validate_operation: validateD1ProbeCloudflareWorkerCanaryOperationV1,
    read_archive_inventory: readD1ProbeCloudflareWorkerCanaryResponseArchiveInventoryReadOnlyV1,
    create_state: createD1ProbeCloudflareWorkerCanaryStateV1,
    read_state: readD1ProbeCloudflareWorkerCanaryStateReadOnlyV1,
};

const exactInputKeys = (input: unknown): input is D1ProbeCloudflareWorkerCanaryDriverBootstrapInputV1 => {
    try {
        if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
        const keys = Object.keys(input).sort();
        return (
            keys.length === 3 &&
            keys[0] === "cleanup_grace" &&
            keys[1] === "lease_duration_ms" &&
            keys[2] === "operation"
        );
    } catch {
        return false;
    }
};

const exactOperation = async (
    operation: D1ProbeCloudflareWorkerCanaryOperationV1,
    candidate: D1ProbeCloudflareWorkerCanaryOperationV1,
    dependencies: D1ProbeCloudflareWorkerCanaryDriverBootstrapTestOnlyDependenciesV1
): Promise<boolean> => {
    const [expected, observed] = await Promise.all([
        dependencies.digest_operation(operation),
        dependencies.digest_operation(candidate),
    ]);
    return expected !== null && expected === observed;
};

const historiesAbsent = async (
    planDigest: string,
    dependencies: D1ProbeCloudflareWorkerCanaryDriverBootstrapTestOnlyDependenciesV1
): Promise<
    | { readonly success: true }
    | { readonly success: false; readonly code: "prior_effect_history_present" | "prior_archive_history_present" }
> => {
    const [journal, archive] = await Promise.all([
        dependencies.read_effect_journal(planDigest),
        dependencies.read_archive_inventory(planDigest),
    ]);
    if (journal.success || journal.code !== "journal_not_found") {
        return { success: false, code: "prior_effect_history_present" };
    }
    const archiveAbsent = archive.success
        ? archive.inventory.plan_digest === planDigest &&
          archive.inventory.record_count === 0 &&
          archive.inventory.records.length === 0 &&
          archive.inventory.cloudflare_origin_authenticated === false &&
          archive.inventory.archive_key_possession_proven === false &&
          archive.inventory.archive_decryptability_proven === false &&
          archive.inventory.effect_claim_persistence_proven === false &&
          archive.inventory.response_authenticated === false &&
          archive.inventory.authoritative === false &&
          archive.inventory.eligible_for_upload === false &&
          archive.inventory.eligible_for_attestation === false &&
          archive.inventory.lifecycle_advance_allowed === false &&
          archive.inventory.gate_promotion_allowed === false
        : archive.code === "archive_not_found";
    if (!archiveAbsent) {
        return { success: false, code: "prior_archive_history_present" };
    }
    return { success: true };
};

const ensureState = async (
    operation: D1ProbeCloudflareWorkerCanaryOperationV1,
    dependencies: D1ProbeCloudflareWorkerCanaryDriverBootstrapTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryDriverBootstrapDenialV1 | null> => {
    let current = await dependencies.read_state(operation.plan.plan_digest);
    if (!current.success && current.code === "state_not_found") {
        const created = await dependencies.create_state(operation);
        if (created.success)
            return (await exactOperation(operation, created.operation, dependencies))
                ? null
                : "operation_state_conflict";
        if (created.code !== "state_already_exists" && created.code !== "concurrent_state_write") {
            return "operation_state_unavailable";
        }
        current = await dependencies.read_state(operation.plan.plan_digest);
    }
    if (!current.success) return "operation_state_unavailable";
    return (await exactOperation(operation, current.operation, dependencies)) ? null : "operation_state_conflict";
};

const ensureObligation = async (
    obligation: D1ProbeCloudflareWorkerCanaryCleanupObligationV1,
    dependencies: D1ProbeCloudflareWorkerCanaryDriverBootstrapTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryDriverBootstrapDenialV1 | null> => {
    let current = await dependencies.read_cleanup_obligation(
        obligation.plan_digest,
        obligation.execution_nonce_commitment
    );
    if (!current.success && current.code === "obligation_not_found") {
        const published = await dependencies.publish_cleanup_obligation(obligation);
        if (published.success) {
            return published.obligation.obligation_digest === obligation.obligation_digest
                ? null
                : "cleanup_obligation_conflict";
        }
        if (published.code !== "obligation_already_exists") return "cleanup_obligation_unavailable";
        current = await dependencies.read_cleanup_obligation(
            obligation.plan_digest,
            obligation.execution_nonce_commitment
        );
    }
    if (!current.success) return "cleanup_obligation_unavailable";
    return current.obligation.obligation_digest === obligation.obligation_digest ? null : "cleanup_obligation_conflict";
};

const bootstrapWithDependencies = async (
    input: unknown,
    dependencies: D1ProbeCloudflareWorkerCanaryDriverBootstrapTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryDriverBootstrapResultV1> => {
    if (!exactInputKeys(input)) return { success: false, code: "invalid_bootstrap_input" };
    try {
        if (
            typeof input.lease_duration_ms !== "number" ||
            !Number.isSafeInteger(input.lease_duration_ms) ||
            input.lease_duration_ms <= 0 ||
            input.lease_duration_ms > MAX_LEASE_DURATION_MS_V1
        ) {
            return { success: false, code: "invalid_bootstrap_input" };
        }
        const operation = await dependencies.validate_operation(input.operation);
        if (operation === null || operation.revision !== 0 || operation.state !== "prepared") {
            return { success: false, code: "operation_not_prepared" };
        }
        const compiled = await dependencies.compile_cleanup_obligation(operation, input.cleanup_grace);
        if (!compiled.success) return { success: false, code: "cleanup_obligation_unavailable" };
        const nonceCommitment = await dependencies.commit_execution_nonce(operation.execution_nonce);
        if (
            nonceCommitment === null ||
            compiled.obligation.execution_nonce_commitment !== nonceCommitment ||
            compiled.obligation.operation.plan.plan_digest !== operation.plan.plan_digest
        ) {
            return { success: false, code: "cleanup_obligation_conflict" };
        }

        const initialHistories = await historiesAbsent(operation.plan.plan_digest, dependencies);
        if (!initialHistories.success) return initialHistories;
        const stateDenial = await ensureState(operation, dependencies);
        if (stateDenial !== null) return { success: false, code: stateDenial };
        const obligationDenial = await ensureObligation(compiled.obligation, dependencies);
        if (obligationDenial !== null) return { success: false, code: obligationDenial };
        const beforeLeaseHistories = await historiesAbsent(operation.plan.plan_digest, dependencies);
        if (!beforeLeaseHistories.success) return beforeLeaseHistories;

        const acquired = await dependencies.acquire_driver_lease({
            plan_digest: operation.plan.plan_digest,
            execution_nonce: operation.execution_nonce,
            lease_duration_ms: input.lease_duration_ms,
        });
        if (!acquired.success) return { success: false, code: "driver_lease_unavailable" };

        const [asserted, finalState, finalObligation, finalHistories] = await Promise.all([
            dependencies.assert_current_driver_lease(acquired.owner),
            dependencies.read_state(operation.plan.plan_digest),
            dependencies.read_cleanup_obligation(operation.plan.plan_digest, nonceCommitment),
            historiesAbsent(operation.plan.plan_digest, dependencies),
        ]);
        if (!asserted.success) return { success: false, code: "final_driver_lease_reassertion_failed" };
        if (!finalState.success || !(await exactOperation(operation, finalState.operation, dependencies))) {
            return { success: false, code: "final_operation_state_reassertion_failed" };
        }
        if (
            !finalObligation.success ||
            finalObligation.obligation.obligation_digest !== compiled.obligation.obligation_digest
        ) {
            return { success: false, code: "final_cleanup_obligation_reassertion_failed" };
        }
        if (!finalHistories.success) return { success: false, code: "final_history_reassertion_failed" };
        return {
            success: true,
            session: Object.freeze({
                schema_version: 1,
                kind: "d1_probe_cloudflare_worker_api_canary_driver_bootstrap_session",
                operation,
                cleanup_obligation: compiled.obligation,
                driver_lease: acquired.lease,
                driver_lease_owner: acquired.owner,
                durable_pre_dispatch_records_ready: true,
                remote_dispatch_authorized: false,
                cleanup_authorized: false,
                caller_mutation_authority: false,
                authoritative: false,
                eligible_for_upload: false,
                eligible_for_attestation: false,
                lifecycle_advance_allowed: false,
                gate_promotion_allowed: false,
            }),
        };
    } catch {
        return { success: false, code: "invalid_bootstrap_input" };
    }
};

export const bootstrapD1ProbeCloudflareWorkerCanaryDriverV1 = async (
    input: unknown
): Promise<D1ProbeCloudflareWorkerCanaryDriverBootstrapResultV1> =>
    await bootstrapWithDependencies(input, fixedDependencies);

/** Test-only dependency seam. Production callers use the fixed private storage and lease APIs. */
export const bootstrapD1ProbeCloudflareWorkerCanaryDriverWithDependenciesTestOnlyV1 = async (
    input: unknown,
    dependencies: D1ProbeCloudflareWorkerCanaryDriverBootstrapTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryDriverBootstrapResultV1> =>
    await bootstrapWithDependencies(input, Object.freeze({ ...dependencies }));
