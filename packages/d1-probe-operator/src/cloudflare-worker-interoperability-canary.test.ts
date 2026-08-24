import {
    canonicalizeJsonV1,
    digestCanonicalJsonV1,
    type CanonicalJsonValueV1,
} from "@openbot/gate-attestation/internal";
import { describe, expect, it, vi } from "vitest";

import { runD1ProbeCloudflareWorkerApiCanaryV1 } from "./cloudflare-worker-interoperability-canary.js";

const apiRoot = "https://api.cloudflare.com/client/v4";
const accountId = "a".repeat(32);
const operationId = "b".repeat(32);
const randomSuffix = "0000000000000001";
const scriptName = `openbot-d1-probe-canary-${randomSuffix}`;
const workerId = "worker-fixed-immutable-id";
const versionId = "22222222-2222-4222-8222-222222222222";
const deploymentId = "33333333-3333-4333-8333-333333333333";
const token = "t".repeat(32);
const key = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const now = Date.parse("2026-08-24T15:00:00.000Z");
const createdOn = "2026-08-24T15:00:00.000Z";
const deployedOn = "2026-08-24T15:00:01.000Z";
const fixedModuleSource = "export default { fetch() { return new Response(null, { status: 404 }); } };";
const fixedModuleBase64 = btoa(fixedModuleSource);
const attemptTag = `openbot-canary-attempt-${"0c".repeat(16)}`;

const markers = {
    ownership_tag: `openbot-canary-owner-${operationId}`,
    version_tag: `openbot-canary-version-${operationId}`,
    version_message: `openbot canary version ${operationId}`,
    deployment_message: `openbot canary deployment ${operationId}`,
} as const;

const toHex = (value: ArrayBuffer): string =>
    [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");

const arrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const rawKey = (): Uint8Array =>
    Uint8Array.from(atob(key.replace(/-/gu, "+").replace(/_/gu, "/")), character => character.charCodeAt(0));

const keyId = async (): Promise<string> => {
    const raw = rawKey();
    const domain = new TextEncoder().encode("openbot.d1-probe.commitment-key-id.v1\u0000");
    const preimage = new Uint8Array(domain.byteLength + raw.byteLength);
    preimage.set(domain);
    preimage.set(raw, domain.byteLength);
    return toHex(await crypto.subtle.digest("SHA-256", preimage));
};

const hmac = async (domain: string, value: string): Promise<string> => {
    const imported = await crypto.subtle.importKey(
        "raw",
        arrayBuffer(rawKey()),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    return toHex(
        await crypto.subtle.sign(
            "HMAC",
            imported,
            new TextEncoder().encode(`${domain}\u0000${canonicalizeJsonV1(value)}`)
        )
    );
};

const plan = async () => {
    const projection = {
        schema_version: 1 as const,
        kind: "d1_probe_cloudflare_worker_api_canary_plan" as const,
        account_id: accountId,
        commitment_key_id_digest: await keyId(),
        operation_id: operationId,
        random_suffix: randomSuffix,
        script_name: scriptName,
        markers,
        compatibility_date: "2026-08-22" as const,
        not_before_ms: now - 1_000,
        expires_at_ms: now + 60_000,
        authoritative: false as const,
        eligible_for_attestation: false as const,
        lifecycle_advance_allowed: false as const,
        gate_promotion_allowed: false as const,
    };
    const planDigest = await digestCanonicalJsonV1(
        "openbot.d1-probe.cloudflare-worker-api-canary-plan.v1",
        projection as CanonicalJsonValueV1
    );
    if (planDigest === null) throw new Error("plan digest unavailable");
    return { ...projection, plan_digest: planDigest };
};

const envelope = (result: unknown, resultInfo?: unknown) => ({
    success: true,
    errors: [],
    messages: [],
    result,
    ...(resultInfo === undefined ? {} : { result_info: resultInfo }),
});

const jsonResponse = (value: unknown, status = 200): Response =>
    new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json" },
    });

const worker = (deployed = false, id = workerId) => ({
    id,
    name: scriptName,
    created_on: createdOn,
    deployed_on: deployed ? deployedOn : null,
    logpush: false,
    observability: { enabled: false },
    subdomain: { enabled: false, previews_enabled: false },
    tags: [attemptTag, markers.ownership_tag],
    tail_consumers: [],
    references: {},
});

const version = {
    id: versionId,
    created_on: createdOn,
    annotations: {
        "workers/tag": markers.version_tag,
        "workers/message": markers.version_message,
    },
    urls: [],
    main_module: "entry.js",
    compatibility_date: "2026-08-22",
    compatibility_flags: [],
    bindings: [],
    modules: [
        {
            name: "entry.js",
            content_type: "application/javascript+module",
            content_base64: fixedModuleBase64,
        },
    ],
};

const deployment = {
    id: deploymentId,
    created_on: deployedOn,
    strategy: "percentage",
    annotations: { "workers/message": markers.deployment_message },
    versions: [{ version_id: versionId, percentage: 100 }],
};

const pageInfo = (count: number) => ({
    page: 1,
    per_page: 100,
    count,
    total_count: count,
    total_pages: count === 0 ? 0 : 1,
});

const workersPage = (workers: readonly unknown[]): Response =>
    jsonResponse(envelope(workers, pageInfo(workers.length)));
const versionsPage = (versions: readonly unknown[]): Response =>
    jsonResponse(envelope(versions, pageInfo(versions.length)));
const deploymentsPage = (deployments: readonly unknown[]): Response => jsonResponse(envelope({ deployments }));
const subdomainResponse = (): Response => jsonResponse(envelope({ enabled: false, previews_enabled: false }));
const exactAbsenceResponse = (): Response => jsonResponse(envelope(null), 404);

type QueuedResponse = Response | Error;
type RecordedCall = {
    readonly url: string;
    readonly method: string;
    readonly body: string | null;
    readonly acceptEncoding: string | null;
};

const sequenceFetch = (responses: readonly QueuedResponse[]) => {
    const calls: RecordedCall[] = [];
    let index = 0;
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        calls.push({
            url: String(input),
            method: init?.method ?? "GET",
            body: typeof init?.body === "string" ? init.body : null,
            acceptEncoding: new Headers(init?.headers).get("accept-encoding"),
        });
        const next = responses[index];
        index += 1;
        if (next === undefined) throw new Error(`unexpected request ${String(input)}`);
        if (next instanceof Error) throw next;
        return next;
    }) as unknown as typeof globalThis.fetch;
    return { fetch, calls, remaining: () => responses.length - index };
};

const happyResponses = (): Response[] => [
    workersPage([]),
    jsonResponse(envelope(worker())),
    jsonResponse(envelope(worker())),
    subdomainResponse(),
    versionsPage([]),
    deploymentsPage([]),
    jsonResponse(envelope(version)),
    versionsPage([version]),
    jsonResponse(envelope(version)),
    jsonResponse(envelope({ id: versionId, metadata: { hasPreview: false } })),
    deploymentsPage([]),
    jsonResponse(envelope(deployment)),
    deploymentsPage([deployment]),
    jsonResponse(envelope(deployment)),
    jsonResponse(envelope(worker(true))),
    subdomainResponse(),
    jsonResponse(envelope(worker(true))),
    jsonResponse(envelope(null)),
    exactAbsenceResponse(),
    workersPage([]),
];

const run = async (responses: readonly QueuedResponse[], observedNow = now, shouldTerminate?: () => boolean) => {
    const transport = sequenceFetch(responses);
    const result = await runD1ProbeCloudflareWorkerApiCanaryV1(
        await plan(),
        { api_token: token },
        { hmac_key_base64url: key },
        {
            fetch: transport.fetch,
            now: () => observedNow,
            randomBytes: bytes => {
                bytes.fill(12);
                return bytes;
            },
            ...(shouldTerminate === undefined ? {} : { shouldTerminate }),
        }
    );
    return { result, ...transport };
};

const paths = {
    listWorkers: `/accounts/${accountId}/workers/workers?page=1&per_page=100&order_by=name&order=asc`,
    workers: `/accounts/${accountId}/workers/workers`,
    worker: `/accounts/${accountId}/workers/workers/${workerId}`,
    subdomain: `/accounts/${accountId}/workers/scripts/${scriptName}/subdomain`,
    versions: `/accounts/${accountId}/workers/workers/${workerId}/versions?page=1&per_page=100`,
    versionCreate: `/accounts/${accountId}/workers/workers/${workerId}/versions?deploy=false`,
    betaVersion: `/accounts/${accountId}/workers/workers/${workerId}/versions/${versionId}?include=modules`,
    classicVersion: `/accounts/${accountId}/workers/scripts/${scriptName}/versions/${versionId}`,
    deployments: `/accounts/${accountId}/workers/scripts/${scriptName}/deployments`,
    deploymentCreate: `/accounts/${accountId}/workers/scripts/${scriptName}/deployments?force=false`,
    deployment: `/accounts/${accountId}/workers/scripts/${scriptName}/deployments/${deploymentId}`,
} as const;

describe("Cloudflare Worker beta/classic interoperability canary", () => {
    it("runs the exact private-shell, version, deployment, and immutable-ID cleanup sequence", async () => {
        const execution = await run(happyResponses());
        expect(execution.result.success).toBe(true);
        if (!execution.result.success) throw new Error(execution.result.code);
        expect(execution.result.result.status).toBe("observed_candidate");
        expect(execution.result.result.cleanup_status).toBe("control_plane_absence_observed");
        expect(execution.result.result.mutation_attempts).toEqual({
            shell_create: 1,
            version_create: 1,
            deployment_create: 1,
            worker_delete: 1,
        });
        expect(execution.remaining()).toBe(0);
        expect(execution.calls.every(call => call.acceptEncoding === "identity")).toBe(true);
        expect(execution.calls.map(call => [call.method, call.url])).toEqual(
            [
                ["GET", paths.listWorkers],
                ["POST", paths.workers],
                ["GET", paths.worker],
                ["GET", paths.subdomain],
                ["GET", paths.versions],
                ["GET", paths.deployments],
                ["POST", paths.versionCreate],
                ["GET", paths.versions],
                ["GET", paths.betaVersion],
                ["GET", paths.classicVersion],
                ["GET", paths.deployments],
                ["POST", paths.deploymentCreate],
                ["GET", paths.deployments],
                ["GET", paths.deployment],
                ["GET", paths.worker],
                ["GET", paths.subdomain],
                ["GET", paths.worker],
                ["DELETE", paths.worker],
                ["GET", paths.worker],
                ["GET", paths.listWorkers],
            ].map(([method, path]) => [method, `${apiRoot}${path}`])
        );

        const versionRequest = JSON.parse(execution.calls[6]?.body ?? "null") as Record<string, unknown>;
        expect(versionRequest).toEqual({
            annotations: {
                "workers/message": markers.version_message,
                "workers/tag": markers.version_tag,
            },
            bindings: [],
            compatibility_date: "2026-08-22",
            compatibility_flags: [],
            main_module: "entry.js",
            modules: [
                {
                    content_base64: fixedModuleBase64,
                    content_type: "application/javascript+module",
                    name: "entry.js",
                },
            ],
        });
        expect(JSON.parse(execution.calls[11]?.body ?? "null")).toEqual({
            annotations: { "workers/message": markers.deployment_message },
            strategy: "percentage",
            versions: [{ percentage: 100, version_id: versionId }],
        });
    });

    it("uses the exact role-free HMAC identity domains and redacts credentials, assigned IDs, and module bytes", async () => {
        const execution = await run(happyResponses());
        expect(execution.result.success).toBe(true);
        if (!execution.result.success) throw new Error(execution.result.code);
        const observed = execution.result.result;
        expect(observed.account_id_commitment).toBe(await hmac("openbot.identity.cloudflare_account_id.v1", accountId));
        expect(observed.attempt_tag_commitment).toBe(
            await hmac("openbot.identity.cloudflare_worker_canary_attempt_tag.v1", attemptTag)
        );
        expect(observed.worker_id_commitment).toBe(
            await hmac("openbot.identity.cloudflare_worker_script_id.v1", workerId)
        );
        expect(observed.version_id_commitment).toBe(
            await hmac("openbot.identity.cloudflare_worker_version_id.v1", versionId)
        );
        expect(observed.deployment_id_commitment).toBe(
            await hmac("openbot.identity.cloudflare_worker_deployment_id.v1", deploymentId)
        );
        expect(observed.account_id_commitment).not.toBe(
            await hmac("openbot.identity.cloudflare_worker_script_id.v1", accountId)
        );

        const serialized = JSON.stringify(observed);
        for (const secret of [
            token,
            accountId,
            workerId,
            versionId,
            deploymentId,
            fixedModuleSource,
            fixedModuleBase64,
            attemptTag,
        ]) {
            expect(serialized).not.toContain(secret);
        }
        expect(observed).toMatchObject({
            runtime_identity_verified: false,
            caller_mutation_authority: false,
            authoritative: false,
            eligible_for_upload: false,
            eligible_for_attestation: false,
            lifecycle_advance_allowed: false,
            gate_promotion_allowed: false,
        });
    });

    it("rejects an invalid plan, a key-ID mismatch, and an expired window without fetching", async () => {
        const validPlan = await plan();
        const fetch = vi.fn() as unknown as typeof globalThis.fetch;
        expect(
            await runD1ProbeCloudflareWorkerApiCanaryV1(
                { ...validPlan, plan_digest: "f".repeat(64) },
                { api_token: token },
                { hmac_key_base64url: key },
                { fetch, now: () => now }
            )
        ).toEqual({ success: false, code: "invalid_canary_plan" });
        expect(
            await runD1ProbeCloudflareWorkerApiCanaryV1(
                { ...validPlan, commitment_key_id_digest: "f".repeat(64) },
                { api_token: token },
                { hmac_key_base64url: key },
                { fetch, now: () => now }
            )
        ).toEqual({ success: false, code: "invalid_canary_plan" });
        expect(
            await runD1ProbeCloudflareWorkerApiCanaryV1(
                validPlan,
                { api_token: token },
                { hmac_key_base64url: "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI" },
                { fetch, now: () => now }
            )
        ).toEqual({ success: false, code: "commitment_key_id_mismatch" });
        expect(
            await runD1ProbeCloudflareWorkerApiCanaryV1(
                validPlan,
                { api_token: token },
                { hmac_key_base64url: key },
                { fetch, now: () => validPlan.expires_at_ms }
            )
        ).toEqual({ success: false, code: "canary_plan_not_active" });
        expect(fetch).not.toHaveBeenCalled();
    });

    it("stops before dispatch when the clock moves behind the persisted operation window", async () => {
        const validPlan = await plan();
        const times = [now, validPlan.not_before_ms - 1];
        const fetch = vi.fn() as unknown as typeof globalThis.fetch;
        const result = await runD1ProbeCloudflareWorkerApiCanaryV1(
            validPlan,
            { api_token: token },
            { hmac_key_base64url: key },
            { fetch, now: () => times.shift() ?? validPlan.not_before_ms - 1 }
        );
        expect(result).toMatchObject({
            success: true,
            result: { status: "inconclusive", cleanup_status: "not_needed" },
        });
        expect(fetch).not.toHaveBeenCalled();
    });

    it("honors termination before shell creation without a mutation", async () => {
        const execution = await run([workersPage([])], now, () => true);
        expect(execution.result).toMatchObject({
            success: true,
            result: { status: "inconclusive", cleanup_status: "not_needed" },
        });
        expect(execution.calls.map(call => call.method)).toEqual(["GET"]);
        expect(execution.remaining()).toBe(0);
    });

    it.each([
        {
            name: "before Version creation",
            terminationChecks: [false, true],
            responses: () => [
                ...happyResponses().slice(0, 6),
                jsonResponse(envelope(worker())),
                jsonResponse(envelope(null)),
                exactAbsenceResponse(),
                workersPage([]),
            ],
            forbiddenMutation: paths.versionCreate,
        },
        {
            name: "before Deployment creation",
            terminationChecks: [false, false, true],
            responses: () => [
                ...happyResponses().slice(0, 11),
                jsonResponse(envelope(worker())),
                jsonResponse(envelope(null)),
                exactAbsenceResponse(),
                workersPage([]),
            ],
            forbiddenMutation: paths.deploymentCreate,
        },
    ])("enters cleanup when termination is requested $name", async testCase => {
        const checks = [...testCase.terminationChecks];
        const execution = await run(testCase.responses(), now, () => checks.shift() ?? true);
        expect(execution.result).toMatchObject({
            success: true,
            result: { status: "inconclusive", cleanup_status: "control_plane_absence_observed" },
        });
        expect(
            execution.calls.filter(
                call => call.method === "POST" && call.url === `${apiRoot}${testCase.forbiddenMutation}`
            )
        ).toHaveLength(0);
        expect(execution.calls.filter(call => call.method === "DELETE")).toHaveLength(1);
        expect(execution.remaining()).toBe(0);
    });

    it.each([
        {
            name: "lost shell-create response",
            responses: () => [
                workersPage([]),
                new Error("connection lost after dispatch"),
                workersPage([worker()]),
                jsonResponse(envelope(worker())),
                jsonResponse(envelope(null)),
                exactAbsenceResponse(),
                workersPage([]),
            ],
            mutationPath: paths.workers,
        },
        {
            name: "malformed version-create response",
            responses: () => [
                ...happyResponses().slice(0, 6),
                new Response("{", { headers: { "content-type": "application/json" } }),
                jsonResponse(envelope(worker())),
                jsonResponse(envelope(null)),
                exactAbsenceResponse(),
                workersPage([]),
            ],
            mutationPath: paths.versionCreate,
        },
        {
            name: "redirected deployment-create response",
            responses: () => [
                ...happyResponses().slice(0, 11),
                new Response("{}", {
                    status: 302,
                    headers: { "content-type": "application/json", location: "https://example.invalid/" },
                }),
                jsonResponse(envelope(worker())),
                jsonResponse(envelope(null)),
                exactAbsenceResponse(),
                workersPage([]),
            ],
            mutationPath: paths.deploymentCreate,
        },
        {
            name: "oversized deployment-create response",
            responses: () => [
                ...happyResponses().slice(0, 11),
                new Response(JSON.stringify({ value: "x".repeat(256 * 1024) }), {
                    headers: { "content-type": "application/json" },
                }),
                jsonResponse(envelope(worker())),
                jsonResponse(envelope(null)),
                exactAbsenceResponse(),
                workersPage([]),
            ],
            mutationPath: paths.deploymentCreate,
        },
    ])("does not retry a mutation after a $name and cleans up by immutable ID at most once", async testCase => {
        const execution = await run(testCase.responses());
        expect(execution.result.success).toBe(true);
        if (!execution.result.success) throw new Error(execution.result.code);
        expect(execution.result.result.status).toBe("inconclusive");
        expect(execution.result.result.cleanup_status).toBe("control_plane_absence_observed");
        expect(
            execution.calls.filter(call => call.url === `${apiRoot}${testCase.mutationPath}` && call.method === "POST")
        ).toHaveLength(1);
        expect(execution.calls.filter(call => call.method === "DELETE")).toEqual([
            { url: `${apiRoot}${paths.worker}`, method: "DELETE", body: null, acceptEncoding: "identity" },
        ]);
        const deleteIndex = execution.calls.findIndex(call => call.method === "DELETE");
        expect(execution.calls.slice(deleteIndex + 1).map(call => [call.method, call.url])).toEqual([
            ["GET", `${apiRoot}${paths.worker}`],
            ["GET", `${apiRoot}${paths.listWorkers}`],
        ]);
        expect(execution.result.result.mutation_attempts.worker_delete).toBe(1);
        expect(execution.remaining()).toBe(0);
    });

    it.each([
        { name: "lost response", response: new Error("delete acknowledgement lost") },
        {
            name: "definite API rejection",
            response: jsonResponse({ success: false, errors: [{ code: 10091 }], messages: [], result: null }, 401),
        },
        {
            name: "malformed acknowledgement",
            response: new Response("{", { status: 200, headers: { "content-type": "application/json" } }),
        },
    ])("does not retry a cleanup with a $name or promote later absence", async testCase => {
        const lostCleanup: QueuedResponse[] = happyResponses();
        lostCleanup[17] = testCase.response;
        const execution = await run(lostCleanup);
        expect(execution.result.success).toBe(true);
        if (!execution.result.success) throw new Error(execution.result.code);
        expect(execution.result.result.status).toBe("manual_required");
        expect(execution.result.result.cleanup_status).toBe("manual_required");
        expect(execution.calls.filter(call => call.method === "DELETE")).toHaveLength(1);
        expect(execution.calls.slice(-2).map(call => [call.method, call.url])).toEqual([
            ["GET", `${apiRoot}${paths.worker}`],
            ["GET", `${apiRoot}${paths.listWorkers}`],
        ]);
    });

    it("does not adopt or delete another execution after a lost create response", async () => {
        const otherAttemptWorker = {
            ...worker(),
            tags: [markers.ownership_tag, "openbot-canary-attempt-deadbeefdeadbeefdeadbeefdeadbeef"],
        };
        const execution = await run([
            workersPage([]),
            new Error("create response lost"),
            workersPage([otherAttemptWorker]),
        ]);
        expect(execution.result).toMatchObject({
            success: true,
            result: { status: "manual_required", cleanup_status: "manual_required" },
        });
        expect(execution.calls.filter(call => call.method === "DELETE")).toHaveLength(0);
        expect(execution.remaining()).toBe(0);
    });

    it("does not reconcile or delete after a definite shell-create rejection", async () => {
        const execution = await run([
            workersPage([]),
            jsonResponse({ success: false, errors: [{ code: 10090 }], messages: [], result: null }, 409),
        ]);
        expect(execution.result).toMatchObject({
            success: true,
            result: { status: "inconclusive", cleanup_status: "not_needed" },
        });
        expect(execution.calls).toHaveLength(2);
        expect(execution.calls.filter(call => call.method === "DELETE")).toHaveLength(0);
    });

    it("returns manual_required when immutable-ID absence is observed but the exact name remains", async () => {
        const responses = happyResponses();
        responses[19] = workersPage([worker(false, "different-worker-id")]);
        const execution = await run(responses);
        expect(execution.result.success).toBe(true);
        if (!execution.result.success) throw new Error(execution.result.code);
        expect(execution.result.result.status).toBe("manual_required");
        expect(execution.result.result.cleanup_status).toBe("manual_required");
        expect(execution.calls.filter(call => call.method === "DELETE")).toHaveLength(1);
    });
});
