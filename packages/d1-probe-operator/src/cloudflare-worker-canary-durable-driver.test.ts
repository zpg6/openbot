import { describe, expect, it, vi } from "vitest";

import type { D1ProbeCloudflareWorkerCanaryDriverBootstrapResultV1 } from "./cloudflare-worker-canary-driver-bootstrap.js";
import {
    createD1ProbeCloudflareWorkerCanaryDurableDriverWithDependenciesTestOnlyV1,
    type D1ProbeCloudflareWorkerCanaryDurableDriverTestOnlyDependenciesV1,
} from "./cloudflare-worker-canary-durable-driver.js";
import {
    prepareD1ProbeCloudflareWorkerCanaryOperationV1,
    validateD1ProbeCloudflareWorkerCanaryOperationV1,
    type D1ProbeCloudflareWorkerCanaryOperationV1,
} from "./cloudflare-worker-canary-operation.js";
import { generateD1ProbeCloudflareWorkerApiCanaryCommandV1 } from "./cloudflare-worker-canary-plan.js";
import type { D1ProbeCloudflareWorkerCanaryResponseClaimsResultV1 } from "./cloudflare-worker-canary-response-claims.js";

const hmacKey = Buffer.from(new Uint8Array(32).fill(47)).toString("base64url");
const digest = (character: string): string => character.repeat(64);

const operationFixture = async (accountId = "a".repeat(32)): Promise<D1ProbeCloudflareWorkerCanaryOperationV1> => {
    const now = Date.now();
    let draw = 0;
    const generated = await generateD1ProbeCloudflareWorkerApiCanaryCommandV1(
        {
            schema_version: 1,
            kind: "d1_probe_cloudflare_worker_api_canary_plan_request",
            account_id: accountId,
        },
        { hmac_key_base64url: hmacKey },
        {
            now: () => now,
            randomBytes: byteLength => new Uint8Array(byteLength).fill(++draw + 3),
        }
    );
    if (!generated.success) throw new Error(generated.code);
    const prepared = await prepareD1ProbeCloudflareWorkerCanaryOperationV1(
        generated.command.plan,
        `openbot-canary-attempt-${"c".repeat(32)}`,
        now
    );
    if (!prepared.success) throw new Error(prepared.code);
    return prepared.operation;
};

const setup = async (overrides: Partial<D1ProbeCloudflareWorkerCanaryDurableDriverTestOnlyDependenciesV1> = {}) => {
    const operation = await operationFixture();
    const owner = Object.freeze({
        plan_digest: operation.plan.plan_digest,
        execution_nonce: operation.execution_nonce,
        generation: 0,
        owner_pid: 42,
        owner_nonce: "A".repeat(43),
    });
    const record = vi.fn(async () => undefined);
    const capture = vi.fn(async () => undefined);
    const discard = vi.fn();
    const bootstrapSession = {
        operation,
        cleanup_obligation: {
            execution_nonce_commitment: digest("d"),
            obligation_digest: digest("e"),
        },
        driver_lease_owner: owner,
    };
    const bootstrap = vi.fn(
        async (): Promise<D1ProbeCloudflareWorkerCanaryDriverBootstrapResultV1> =>
            ({
                success: true,
                session: bootstrapSession,
            }) as unknown as D1ProbeCloudflareWorkerCanaryDriverBootstrapResultV1
    );
    const createResponseClaims = vi.fn(
        async (): Promise<D1ProbeCloudflareWorkerCanaryResponseClaimsResultV1> =>
            ({
                success: true,
                record_dispatch_and_bind: record,
                capture_response_preimage: capture,
                discard,
                remote_dispatch_authorized: false,
                cleanup_authorized: false,
                caller_mutation_authority: false,
                authoritative: false,
                eligible_for_upload: false,
                eligible_for_attestation: false,
                lifecycle_advance_allowed: false,
                gate_promotion_allowed: false,
            }) as unknown as D1ProbeCloudflareWorkerCanaryResponseClaimsResultV1
    );
    return {
        operation,
        owner,
        record,
        capture,
        discard,
        bootstrap,
        createResponseClaims,
        input: {
            operation,
            cleanup_grace: { exact: "caller-supplied-grace" },
            lease_duration_ms: 300_000,
        },
        dependencies: {
            bootstrap,
            create_response_claims: createResponseClaims,
            validate_operation: validateD1ProbeCloudflareWorkerCanaryOperationV1,
            ...overrides,
        } satisfies D1ProbeCloudflareWorkerCanaryDurableDriverTestOnlyDependenciesV1,
    };
};

describe("Cloudflare Worker canary durable driver session", () => {
    it("keeps lease ownership private and creates the exact composed request hooks", async () => {
        const context = await setup();
        const result = await createD1ProbeCloudflareWorkerCanaryDurableDriverWithDependenciesTestOnlyV1(
            context.input,
            context.dependencies
        );
        expect(result).toMatchObject({
            success: true,
            session: {
                plan_digest: context.operation.plan.plan_digest,
                execution_nonce_commitment: digest("d"),
                cleanup_obligation_digest: digest("e"),
                durable_pre_dispatch_records_ready: true,
                remote_dispatch_authorized: false,
                cleanup_authorized: false,
                caller_mutation_authority: false,
                authoritative: false,
                eligible_for_upload: false,
                eligible_for_attestation: false,
                lifecycle_advance_allowed: false,
                gate_promotion_allowed: false,
            },
        });
        if (!result.success) return;
        const serialized = JSON.stringify(result);
        expect(serialized).not.toContain(context.owner.owner_nonce);
        expect(serialized).not.toContain(context.operation.execution_nonce);
        expect(serialized).not.toContain(context.operation.attempt_tag);
        expect(serialized).not.toContain(context.operation.script_name);

        const archiveKey = new Uint8Array(32).fill(9);
        const request = await result.session.create_request_session({
            operation: context.operation,
            workflow_step: "prepared_worker_list",
            archive_key: archiveKey,
        });
        expect(request).toMatchObject({
            success: true,
            durable_claim_recording_ready: true,
            remote_dispatch_authorized: false,
            cleanup_authorized: false,
            caller_mutation_authority: false,
            authoritative: false,
        });
        if (!request.success) return;
        expect(request.record_dispatch_and_bind).toBe(context.record);
        expect(request.capture_response_preimage).toBe(context.capture);
        expect(request.discard).toBe(context.discard);
        expect(context.createResponseClaims).toHaveBeenCalledWith({
            operation: context.operation,
            driver_lease_owner: context.owner,
            workflow_step: "prepared_worker_list",
            archive_key: archiveKey,
        });
    });

    it("rejects immutable execution-identity substitutions before claim-session creation", async () => {
        const context = await setup();
        const result = await createD1ProbeCloudflareWorkerCanaryDurableDriverWithDependenciesTestOnlyV1(
            context.input,
            context.dependencies
        );
        if (!result.success) throw new Error(result.code);
        const foreignPlanOperation = await operationFixture("b".repeat(32));
        for (const operation of [
            foreignPlanOperation,
            { ...context.operation, execution_nonce: "f".repeat(32) },
            { ...context.operation, script_name: `${context.operation.script_name}x` },
            { ...context.operation, ownership_tag: `${context.operation.ownership_tag}x` },
            { ...context.operation, attempt_tag: `openbot-canary-attempt-${"f".repeat(32)}` },
        ]) {
            await expect(
                result.session.create_request_session({
                    operation,
                    workflow_step: "prepared_worker_list",
                    archive_key: new Uint8Array(32),
                })
            ).resolves.toMatchObject({
                success: false,
                code: "invalid_request_session",
                remote_dispatch_authorized: false,
                cleanup_authorized: false,
            });
        }
        expect(context.createResponseClaims).not.toHaveBeenCalled();
    });

    it("fails closed on bootstrap and composed-session denials", async () => {
        const bootstrapDenied = await setup({
            bootstrap: async () =>
                ({
                    success: false,
                    code: "driver_lease_unavailable",
                }) as D1ProbeCloudflareWorkerCanaryDriverBootstrapResultV1,
        });
        await expect(
            createD1ProbeCloudflareWorkerCanaryDurableDriverWithDependenciesTestOnlyV1(
                bootstrapDenied.input,
                bootstrapDenied.dependencies
            )
        ).resolves.toMatchObject({
            success: false,
            code: "durable_driver_unavailable",
            remote_dispatch_authorized: false,
            cleanup_authorized: false,
        });

        const responseDenied = await setup({
            create_response_claims: async () => ({
                success: false,
                code: "invalid_response_claim_context",
                caller_mutation_authority: false,
                authoritative: false,
                eligible_for_upload: false,
                eligible_for_attestation: false,
                lifecycle_advance_allowed: false,
                gate_promotion_allowed: false,
            }),
        });
        const opened = await createD1ProbeCloudflareWorkerCanaryDurableDriverWithDependenciesTestOnlyV1(
            responseDenied.input,
            responseDenied.dependencies
        );
        if (!opened.success) throw new Error(opened.code);
        await expect(
            opened.session.create_request_session({
                operation: responseDenied.operation,
                workflow_step: "prepared_worker_list",
                archive_key: new Uint8Array(32),
            })
        ).resolves.toMatchObject({
            success: false,
            code: "invalid_request_session",
            remote_dispatch_authorized: false,
            cleanup_authorized: false,
        });
    });

    it("returns fixed denials for extra fields, hostile objects, and dependency throws", async () => {
        const context = await setup();
        for (const input of [null, {}, { ...context.input, extra: true }]) {
            await expect(
                createD1ProbeCloudflareWorkerCanaryDurableDriverWithDependenciesTestOnlyV1(input, context.dependencies)
            ).resolves.toMatchObject({ success: false, code: "durable_driver_unavailable" });
        }
        const hostile = new Proxy(
            {},
            {
                ownKeys: () => {
                    throw new Error("hostile");
                },
            }
        );
        await expect(
            createD1ProbeCloudflareWorkerCanaryDurableDriverWithDependenciesTestOnlyV1(hostile, context.dependencies)
        ).resolves.toMatchObject({ success: false, code: "durable_driver_unavailable" });

        const opened = await createD1ProbeCloudflareWorkerCanaryDurableDriverWithDependenciesTestOnlyV1(
            context.input,
            context.dependencies
        );
        if (!opened.success) throw new Error(opened.code);
        await expect(
            opened.session.create_request_session({
                operation: context.operation,
                workflow_step: "prepared_worker_list",
                archive_key: new Uint8Array(32),
                extra: true,
            } as never)
        ).resolves.toMatchObject({ success: false, code: "invalid_request_session" });
        await expect(opened.session.create_request_session(hostile as never)).resolves.toMatchObject({
            success: false,
            code: "invalid_request_session",
        });

        const throwing = await setup({
            validate_operation: async () => {
                throw new Error("validation failed");
            },
        });
        const throwingOpened = await createD1ProbeCloudflareWorkerCanaryDurableDriverWithDependenciesTestOnlyV1(
            throwing.input,
            throwing.dependencies
        );
        if (!throwingOpened.success) throw new Error(throwingOpened.code);
        await expect(
            throwingOpened.session.create_request_session({
                operation: throwing.operation,
                workflow_step: "prepared_worker_list",
                archive_key: new Uint8Array(32),
            })
        ).resolves.toMatchObject({ success: false, code: "invalid_request_session" });
    });
});
