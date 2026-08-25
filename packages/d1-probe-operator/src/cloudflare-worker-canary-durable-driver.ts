import {
    bootstrapD1ProbeCloudflareWorkerCanaryDriverV1,
    type D1ProbeCloudflareWorkerCanaryDriverBootstrapInputV1,
    type D1ProbeCloudflareWorkerCanaryDriverBootstrapResultV1,
} from "./cloudflare-worker-canary-driver-bootstrap.js";
import {
    validateD1ProbeCloudflareWorkerCanaryOperationV1,
    type D1ProbeCloudflareWorkerCanaryOperationV1,
} from "./cloudflare-worker-canary-operation.js";
import {
    createD1ProbeCloudflareWorkerCanaryResponseClaimsV1,
    type D1ProbeCloudflareWorkerCanaryResponseClaimsInputV1,
    type D1ProbeCloudflareWorkerCanaryResponseClaimsResultV1,
} from "./cloudflare-worker-canary-response-claims.js";

interface FalseAuthorityV1 {
    readonly remote_dispatch_authorized: false;
    readonly cleanup_authorized: false;
    readonly caller_mutation_authority: false;
    readonly authoritative: false;
    readonly eligible_for_upload: false;
    readonly eligible_for_attestation: false;
    readonly lifecycle_advance_allowed: false;
    readonly gate_promotion_allowed: false;
}

const falseAuthority: FalseAuthorityV1 = Object.freeze({
    remote_dispatch_authorized: false,
    cleanup_authorized: false,
    caller_mutation_authority: false,
    authoritative: false,
    eligible_for_upload: false,
    eligible_for_attestation: false,
    lifecycle_advance_allowed: false,
    gate_promotion_allowed: false,
});

export interface D1ProbeCloudflareWorkerCanaryDurableDriverRequestInputV1 {
    readonly operation: unknown;
    readonly workflow_step: unknown;
    readonly archive_key: unknown;
}

export type D1ProbeCloudflareWorkerCanaryDurableDriverRequestResultV1 =
    | ({ readonly success: false; readonly code: "invalid_request_session" } & FalseAuthorityV1)
    | ({
          readonly success: true;
          readonly durable_claim_recording_ready: true;
          readonly record_dispatch_and_bind: Extract<
              D1ProbeCloudflareWorkerCanaryResponseClaimsResultV1,
              { readonly success: true }
          >["record_dispatch_and_bind"];
          readonly capture_response_preimage: Extract<
              D1ProbeCloudflareWorkerCanaryResponseClaimsResultV1,
              { readonly success: true }
          >["capture_response_preimage"];
          readonly discard: Extract<
              D1ProbeCloudflareWorkerCanaryResponseClaimsResultV1,
              { readonly success: true }
          >["discard"];
      } & FalseAuthorityV1);

export interface D1ProbeCloudflareWorkerCanaryDurableDriverSessionV1 extends FalseAuthorityV1 {
    readonly schema_version: 1;
    readonly kind: "d1_probe_cloudflare_worker_api_canary_durable_driver_session";
    readonly plan_digest: string;
    readonly execution_nonce_commitment: string;
    readonly cleanup_obligation_digest: string;
    readonly durable_pre_dispatch_records_ready: true;
    readonly create_request_session: (
        input: D1ProbeCloudflareWorkerCanaryDurableDriverRequestInputV1
    ) => Promise<D1ProbeCloudflareWorkerCanaryDurableDriverRequestResultV1>;
}

export type D1ProbeCloudflareWorkerCanaryDurableDriverResultV1 =
    | ({ readonly success: false; readonly code: "durable_driver_unavailable" } & FalseAuthorityV1)
    | ({
          readonly success: true;
          readonly session: D1ProbeCloudflareWorkerCanaryDurableDriverSessionV1;
      } & FalseAuthorityV1);

export interface D1ProbeCloudflareWorkerCanaryDurableDriverTestOnlyDependenciesV1 {
    readonly bootstrap: (
        input: D1ProbeCloudflareWorkerCanaryDriverBootstrapInputV1
    ) => Promise<D1ProbeCloudflareWorkerCanaryDriverBootstrapResultV1>;
    readonly create_response_claims: (
        input: D1ProbeCloudflareWorkerCanaryResponseClaimsInputV1
    ) => Promise<D1ProbeCloudflareWorkerCanaryResponseClaimsResultV1>;
    readonly validate_operation: typeof validateD1ProbeCloudflareWorkerCanaryOperationV1;
}

const fixedDependencies: D1ProbeCloudflareWorkerCanaryDurableDriverTestOnlyDependenciesV1 = Object.freeze({
    bootstrap: bootstrapD1ProbeCloudflareWorkerCanaryDriverV1,
    create_response_claims: createD1ProbeCloudflareWorkerCanaryResponseClaimsV1,
    validate_operation: validateD1ProbeCloudflareWorkerCanaryOperationV1,
});

const exactBootstrapKeys = (input: unknown): input is D1ProbeCloudflareWorkerCanaryDriverBootstrapInputV1 => {
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

const exactRequestKeys = (input: unknown): input is D1ProbeCloudflareWorkerCanaryDurableDriverRequestInputV1 => {
    try {
        if (typeof input !== "object" || input === null || Array.isArray(input)) return false;
        const keys = Object.keys(input).sort();
        return keys.length === 3 && keys[0] === "archive_key" && keys[1] === "operation" && keys[2] === "workflow_step";
    } catch {
        return false;
    }
};

interface ExecutionIdentityV1 {
    readonly plan_digest: string;
    readonly execution_nonce: string;
    readonly script_name: string;
    readonly ownership_tag: string;
    readonly attempt_tag: string;
}

const identityFor = (operation: D1ProbeCloudflareWorkerCanaryOperationV1): ExecutionIdentityV1 =>
    Object.freeze({
        plan_digest: operation.plan.plan_digest,
        execution_nonce: operation.execution_nonce,
        script_name: operation.script_name,
        ownership_tag: operation.ownership_tag,
        attempt_tag: operation.attempt_tag,
    });

const sameIdentity = (operation: D1ProbeCloudflareWorkerCanaryOperationV1, identity: ExecutionIdentityV1): boolean =>
    operation.plan.plan_digest === identity.plan_digest &&
    operation.execution_nonce === identity.execution_nonce &&
    operation.script_name === identity.script_name &&
    operation.ownership_tag === identity.ownership_tag &&
    operation.attempt_tag === identity.attempt_tag;

const deniedDriver = (): D1ProbeCloudflareWorkerCanaryDurableDriverResultV1 => ({
    success: false,
    code: "durable_driver_unavailable",
    ...falseAuthority,
});

const deniedRequest = (): D1ProbeCloudflareWorkerCanaryDurableDriverRequestResultV1 => ({
    success: false,
    code: "invalid_request_session",
    ...falseAuthority,
});

const createWithDependencies = async (
    input: unknown,
    dependencies: D1ProbeCloudflareWorkerCanaryDurableDriverTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryDurableDriverResultV1> => {
    if (!exactBootstrapKeys(input)) return deniedDriver();
    try {
        const bootstrap = await dependencies.bootstrap(input);
        if (!bootstrap.success) return deniedDriver();
        const identity = identityFor(bootstrap.session.operation);
        const owner = bootstrap.session.driver_lease_owner;
        const executionNonceCommitment = bootstrap.session.cleanup_obligation.execution_nonce_commitment;
        const cleanupObligationDigest = bootstrap.session.cleanup_obligation.obligation_digest;
        const createRequestSession = async (
            requestInput: D1ProbeCloudflareWorkerCanaryDurableDriverRequestInputV1
        ): Promise<D1ProbeCloudflareWorkerCanaryDurableDriverRequestResultV1> => {
            if (!exactRequestKeys(requestInput)) return deniedRequest();
            try {
                const operation = await dependencies.validate_operation(requestInput.operation);
                if (operation === null || !sameIdentity(operation, identity)) return deniedRequest();
                const responseClaims = await dependencies.create_response_claims({
                    operation,
                    driver_lease_owner: owner,
                    workflow_step: requestInput.workflow_step,
                    archive_key: requestInput.archive_key,
                });
                if (!responseClaims.success) return deniedRequest();
                return Object.freeze({
                    success: true,
                    durable_claim_recording_ready: true,
                    record_dispatch_and_bind: responseClaims.record_dispatch_and_bind,
                    capture_response_preimage: responseClaims.capture_response_preimage,
                    discard: responseClaims.discard,
                    ...falseAuthority,
                });
            } catch {
                return deniedRequest();
            }
        };
        return Object.freeze({
            success: true,
            session: Object.freeze({
                schema_version: 1,
                kind: "d1_probe_cloudflare_worker_api_canary_durable_driver_session",
                plan_digest: identity.plan_digest,
                execution_nonce_commitment: executionNonceCommitment,
                cleanup_obligation_digest: cleanupObligationDigest,
                durable_pre_dispatch_records_ready: true,
                create_request_session: createRequestSession,
                ...falseAuthority,
            }),
            ...falseAuthority,
        });
    } catch {
        return deniedDriver();
    }
};

export const createD1ProbeCloudflareWorkerCanaryDurableDriverV1 = async (
    input: unknown
): Promise<D1ProbeCloudflareWorkerCanaryDurableDriverResultV1> =>
    await createWithDependencies(input, fixedDependencies);

/** Test-only dependency seam. Production callers use the fixed bootstrap and response-claim factory. */
export const createD1ProbeCloudflareWorkerCanaryDurableDriverWithDependenciesTestOnlyV1 = async (
    input: unknown,
    dependencies: D1ProbeCloudflareWorkerCanaryDurableDriverTestOnlyDependenciesV1
): Promise<D1ProbeCloudflareWorkerCanaryDurableDriverResultV1> =>
    await createWithDependencies(input, Object.freeze({ ...dependencies }));
