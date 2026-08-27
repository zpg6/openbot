import {
    canonicalizeJsonV1,
    digestCanonicalJsonV1,
    type CanonicalJsonValueV1,
} from "@openbot/gate-attestation/internal";
import { readdir, unlink } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
    compileD1ProbeCloudflareWorkerCanaryCleanupCommandV1,
    executeD1ProbeCloudflareWorkerCanaryCleanupCommandV1,
} from "../src/cloudflare-worker-canary-cleanup.js";
import {
    buildNextD1ProbeCloudflareWorkerCanaryOperationV1,
    prepareD1ProbeCloudflareWorkerCanaryOperationV1,
} from "../src/cloudflare-worker-canary-operation.js";
import {
    createD1ProbeCloudflareWorkerCanaryStateV1,
    d1ProbeCloudflareWorkerCanaryStatePathV1,
    transitionD1ProbeCloudflareWorkerCanaryStateV1,
} from "../src/cloudflare-worker-canary-state.js";

const accountId = "a".repeat(32);
const operationId = "b".repeat(32);
const randomSuffix = "0000000000000001";
const scriptName = `openbot-d1-probe-canary-${randomSuffix}`;
const workerId = "worker-fixed-immutable-id";
const attemptTag = `openbot-canary-attempt-${"0c".repeat(16)}`;
const key = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const token = "x".repeat(32);
const notBefore = Date.parse("2026-08-24T15:00:00.000Z");
const planExpires = notBefore + 60_000;
const cleanupNow = planExpires + 1;
let statePath: string | null = null;

afterEach(async () => {
    if (statePath !== null) {
        const stateRoot = statePath.slice(0, statePath.lastIndexOf("/"));
        const planDigest = (await makePlan()).plan_digest;
        const names = await readdir(stateRoot).catch(() => []);
        for (const name of names) {
            if (name.startsWith(planDigest)) await unlink(`${stateRoot}/${name}`).catch(() => undefined);
        }
        statePath = null;
    }
});

const arrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const toHex = (value: ArrayBuffer): string =>
    [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");

const rawKey = (): Uint8Array => Uint8Array.from(atob(key), character => character.charCodeAt(0));

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

const makePlan = async () => {
    const projection = {
        schema_version: 1 as const,
        kind: "d1_probe_cloudflare_worker_api_canary_plan" as const,
        account_id: accountId,
        commitment_key_id_digest: await keyId(),
        operation_id: operationId,
        random_suffix: randomSuffix,
        script_name: scriptName,
        markers: {
            ownership_tag: `openbot-canary-owner-${operationId}`,
            version_tag: `openbot-canary-version-${operationId}`,
            version_message: `openbot canary version ${operationId}`,
            deployment_message: `openbot canary deployment ${operationId}`,
        },
        compatibility_date: "2026-08-22" as const,
        not_before_ms: notBefore,
        expires_at_ms: planExpires,
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

const makeCommand = async () => {
    const compiled = await compileD1ProbeCloudflareWorkerCanaryCleanupCommandV1(await makePlan(), {
        worker_id: workerId,
        worker_id_commitment: await hmac("openbot.identity.cloudflare_worker_script_id.v1", workerId),
        attempt_tag_commitment: await hmac("openbot.identity.cloudflare_worker_canary_attempt_tag.v1", attemptTag),
    });
    if (!compiled.success) throw new Error(compiled.code);
    return compiled.command;
};

const prepareCleanupState = async (retainedWorkerId: string | null = workerId) => {
    const canaryPlan = await makePlan();
    const prepared = await prepareD1ProbeCloudflareWorkerCanaryOperationV1(canaryPlan, attemptTag, notBefore + 1);
    if (!prepared.success) throw new Error(prepared.code);
    statePath = d1ProbeCloudflareWorkerCanaryStatePathV1(canaryPlan.plan_digest);
    if (statePath === null) throw new Error("state path unavailable");
    const stateRoot = statePath.slice(0, statePath.lastIndexOf("/"));
    const names = await readdir(stateRoot).catch(() => []);
    for (const name of names) {
        if (name.startsWith(canaryPlan.plan_digest)) await unlink(`${stateRoot}/${name}`).catch(() => undefined);
    }
    const created = await createD1ProbeCloudflareWorkerCanaryStateV1(prepared.operation);
    if (!created.success) throw new Error(created.code);
    const cleanupCandidate = buildNextD1ProbeCloudflareWorkerCanaryOperationV1(
        created.operation,
        "cleanup_reconciling",
        notBefore + 2,
        { worker_id: retainedWorkerId }
    );
    const transitioned = await transitionD1ProbeCloudflareWorkerCanaryStateV1(
        canaryPlan.plan_digest,
        created.operation.revision,
        cleanupCandidate
    );
    if (!transitioned.success) throw new Error(transitioned.code);
};

const worker = (overrides: Record<string, unknown> = {}) => ({
    id: workerId,
    name: scriptName,
    created_on: new Date(notBefore + 1_000).toISOString(),
    deployed_on: new Date(notBefore + 2_000).toISOString(),
    logpush: false,
    observability: { enabled: false },
    subdomain: { enabled: false, previews_enabled: false },
    tags: [`openbot-canary-owner-${operationId}`, attemptTag],
    tail_consumers: [],
    references: {},
    ...overrides,
});

const envelope = (result: unknown, resultInfo?: unknown) => ({
    success: true,
    errors: [],
    messages: [],
    result,
    ...(resultInfo === undefined ? {} : { result_info: resultInfo }),
});

const deleteEnvelope = () => ({ success: true, errors: [], messages: [] });

const listEnvelope = (workers: unknown[], page = 1, totalPages = 1, totalCount = workers.length) =>
    envelope(workers, {
        page,
        per_page: 100,
        count: workers.length,
        total_count: totalCount,
        total_pages: totalPages,
    });

const response = (body: unknown, status = 200): Response =>
    new Response(canonicalizeJsonV1(body as CanonicalJsonValueV1), {
        status,
        headers: { "content-type": "application/json" },
    });

const happyFetch = () => {
    const replies = [
        response(listEnvelope([worker()])),
        response(envelope(worker())),
        response(deleteEnvelope()),
        response({ success: false, errors: [{ code: 10090 }], messages: [] }, 404),
        response(listEnvelope([])),
    ];
    return vi.fn(async () => replies.shift() ?? response({ unexpected: true }, 500));
};

const execute = async (
    fetchMock: ReturnType<typeof vi.fn>,
    now = cleanupNow,
    context = { attempt_tag: attemptTag }
) => {
    await prepareCleanupState();
    return await executeD1ProbeCloudflareWorkerCanaryCleanupCommandV1(await makeCommand(), context, key, token, {
        fetch: fetchMock as unknown as typeof globalThis.fetch,
        now: () => now,
    });
};

describe("Cloudflare Worker canary automatic cleanup", () => {
    it("derives a separately digested grace from forward-plan start through ten minutes after expiry", async () => {
        const command = await makeCommand();
        expect(command.cleanup_grace).toMatchObject({
            plan_digest: command.plan.plan_digest,
            worker_id: workerId,
            automatic_cleanup_not_before_ms: command.plan.not_before_ms,
            automatic_cleanup_expires_at_ms: command.plan.expires_at_ms + 600_000,
            authoritative: false,
            eligible_for_attestation: false,
            lifecycle_advance_allowed: false,
            gate_promotion_allowed: false,
        });
        expect(command.cleanup_grace.cleanup_grace_digest).toMatch(/^[0-9a-f]{64}$/u);
    });

    it("deletes the one exactly owned immutable Worker ID and proves both forms of absence", async () => {
        const fetchMock = happyFetch();
        const result = await execute(fetchMock);
        expect(result).toEqual({
            success: true,
            result: expect.objectContaining({
                status: "control_plane_absence_observed",
                cleanup_execution_scope: "automatic_grace_active",
                worker_delete_attempts: 1,
                worker_id_404_observed: true,
                complete_list_absence_observed: true,
                authoritative: false,
                eligible_for_upload: false,
                eligible_for_attestation: false,
                lifecycle_advance_allowed: false,
                gate_promotion_allowed: false,
            }),
        });
        const calls = (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>).map(([url, init]) => ({
            method: init.method,
            path: new URL(url).pathname + new URL(url).search,
        }));
        expect(calls).toEqual([
            {
                method: "GET",
                path: `/client/v4/accounts/${accountId}/workers/workers?page=1&per_page=100&order_by=name&order=asc`,
            },
            { method: "GET", path: `/client/v4/accounts/${accountId}/workers/workers/${workerId}` },
            { method: "DELETE", path: `/client/v4/accounts/${accountId}/workers/workers/${workerId}` },
            { method: "GET", path: `/client/v4/accounts/${accountId}/workers/workers/${workerId}` },
            {
                method: "GET",
                path: `/client/v4/accounts/${accountId}/workers/workers?page=1&per_page=100&order_by=name&order=asc`,
            },
        ]);
        expect(calls.every(call => call.method === "GET" || call.method === "DELETE")).toBe(true);
        expect(calls.filter(call => call.method === "DELETE")).toHaveLength(1);
        expect(calls.every(call => !call.path.includes("/versions") && !call.path.includes("/deployments"))).toBe(true);
    });

    it("rejects use before the plan and after the automatic cleanup grace expires", async () => {
        const earlyFetch = vi.fn();
        expect(await execute(earlyFetch, notBefore - 1)).toEqual({
            success: false,
            code: "cleanup_not_active",
            worker_delete_attempts: 0,
        });
        expect(earlyFetch).not.toHaveBeenCalled();

        const expiredFetch = vi.fn();
        expect(await execute(expiredFetch, planExpires + 600_000)).toEqual({
            success: false,
            code: "cleanup_not_active",
            worker_delete_attempts: 0,
        });
        expect(expiredFetch).not.toHaveBeenCalled();
    });

    it("rejects a substituted raw attempt tag or HMAC commitment before network access", async () => {
        const fetchMock = vi.fn();
        expect(
            await execute(fetchMock, cleanupNow, { attempt_tag: `openbot-canary-attempt-${"0d".repeat(16)}` })
        ).toEqual({ success: false, code: "cleanup_identity_mismatch", worker_delete_attempts: 0 });
        expect(fetchMock).not.toHaveBeenCalled();

        const command = await makeCommand();
        const tampered = {
            ...command,
            cleanup_grace: { ...command.cleanup_grace, attempt_tag_commitment: "f".repeat(64) },
        };
        expect(
            await executeD1ProbeCloudflareWorkerCanaryCleanupCommandV1(
                tampered,
                {
                    attempt_tag: attemptTag,
                },
                key,
                token,
                {
                    fetch: fetchMock as unknown as typeof globalThis.fetch,
                    now: () => cleanupNow,
                }
            )
        ).toEqual({ success: false, code: "invalid_cleanup_grace", worker_delete_attempts: 0 });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects hostile commands, context extras, and a wrong key before network access", async () => {
        const fetchMock = vi.fn();
        const hostile = new Proxy(
            {},
            {
                ownKeys: () => {
                    throw new Error("hostile command");
                },
            }
        );
        expect(
            await executeD1ProbeCloudflareWorkerCanaryCleanupCommandV1(
                hostile,
                {
                    attempt_tag: attemptTag,
                },
                key,
                token,
                { fetch: fetchMock as unknown as typeof globalThis.fetch, now: () => cleanupNow }
            )
        ).toEqual({ success: false, code: "invalid_cleanup_command", worker_delete_attempts: 0 });
        expect(
            await executeD1ProbeCloudflareWorkerCanaryCleanupCommandV1(
                await makeCommand(),
                { attempt_tag: attemptTag, manual_operator_acknowledgement: "unreviewed" },
                key,
                token,
                { fetch: fetchMock as unknown as typeof globalThis.fetch, now: () => cleanupNow }
            )
        ).toEqual({ success: false, code: "invalid_cleanup_context", worker_delete_attempts: 0 });
        expect(
            await executeD1ProbeCloudflareWorkerCanaryCleanupCommandV1(
                await makeCommand(),
                {
                    attempt_tag: attemptTag,
                },
                "AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI",
                token,
                { fetch: fetchMock as unknown as typeof globalThis.fetch, now: () => cleanupNow }
            )
        ).toEqual({ success: false, code: "commitment_key_id_mismatch", worker_delete_attempts: 0 });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("fails closed on missing, duplicate, or cross-linked ownership before deletion", async () => {
        const cases = [
            [],
            [worker(), worker({ id: "second-id" })],
            [worker({ tags: [`openbot-canary-owner-${operationId}`, `openbot-canary-attempt-${"0d".repeat(16)}`] })],
            [worker(), worker({ id: "unrelated-id", name: "unrelated", tags: [attemptTag] })],
        ];
        for (const workers of cases) {
            const fetchMock = vi.fn(async () => response(listEnvelope(workers)));
            expect(await execute(fetchMock)).toEqual({
                success: false,
                code: "planned_worker_ambiguous",
                worker_delete_attempts: 0,
            });
            expect(fetchMock).toHaveBeenCalledTimes(1);
        }
    });

    it("requires an exact ownership readback before deletion", async () => {
        const replies = [response(listEnvelope([worker()])), response(envelope(worker({ name: "substituted" })))];
        const fetchMock = vi.fn(async () => replies.shift() ?? response({ unexpected: true }, 500));
        expect(await execute(fetchMock)).toEqual({
            success: false,
            code: "planned_worker_readback_mismatch",
            worker_delete_attempts: 0,
        });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("follows declared pagination before deletion and rejects contradictory list metadata", async () => {
        const hiddenWorker = { id: "hidden", name: "hidden", tags: ["other"] };
        const pageOneWorkers = [
            worker(),
            ...Array.from({ length: 99 }, (_, index) => ({
                id: `unrelated-${index}`,
                name: `unrelated-${index}`,
                tags: ["other"],
            })),
        ];
        const replies = [
            response(listEnvelope(pageOneWorkers, 1, 2, 101)),
            response(listEnvelope([hiddenWorker], 2, 2, 101)),
            response(envelope(worker())),
            response(deleteEnvelope()),
            response({ success: false, errors: [], messages: [] }, 404),
            response(listEnvelope([], 1, 2, 1)),
        ];
        const fetchMock = vi.fn(async () => replies.shift() ?? response({ unexpected: true }, 500));
        expect(await execute(fetchMock)).toEqual({
            success: false,
            code: "complete_list_absence_not_observed",
            worker_delete_attempts: 1,
        });
        expect(fetchMock).toHaveBeenCalledTimes(6);

        const contradictoryFetch = vi.fn(async () => response(listEnvelope([worker()], 1, 2, 1)));
        expect(await execute(contradictoryFetch)).toEqual({
            success: false,
            code: "initial_worker_list_unavailable",
            worker_delete_attempts: 0,
        });
        expect(contradictoryFetch).toHaveBeenCalledTimes(1);
    });

    it("attempts deletion once and never retries after any post-delete failure", async () => {
        const cases: Array<{ replies: Response[]; code: string; calls: number }> = [
            {
                replies: [
                    response(listEnvelope([worker()])),
                    response(envelope(worker())),
                    response({ error: true }, 500),
                ],
                code: "worker_delete_unacknowledged",
                calls: 3,
            },
            {
                replies: [
                    response(listEnvelope([worker()])),
                    response(envelope(worker())),
                    response(deleteEnvelope()),
                    response(envelope(worker())),
                ],
                code: "worker_id_absence_not_observed",
                calls: 4,
            },
            {
                replies: [
                    response(listEnvelope([worker()])),
                    response(envelope(worker())),
                    response(deleteEnvelope()),
                    response({ success: false, errors: [], messages: [] }, 404),
                    response(listEnvelope([worker()])),
                ],
                code: "complete_list_absence_not_observed",
                calls: 5,
            },
        ];
        for (const fixture of cases) {
            const replies = [...fixture.replies];
            const fetchMock = vi.fn(async () => replies.shift() ?? response({ unexpected: true }, 500));
            expect(await execute(fetchMock)).toEqual({
                success: false,
                code: fixture.code,
                worker_delete_attempts: 1,
            });
            expect(fetchMock).toHaveBeenCalledTimes(fixture.calls);
            expect(
                (fetchMock.mock.calls as unknown as Array<[string, RequestInit]>).filter(
                    ([, init]) => init.method === "DELETE"
                )
            ).toHaveLength(1);
        }
    });

    it("persists the delete fence before dispatch and rejects replay after ambiguity", async () => {
        await prepareCleanupState();
        const command = await makeCommand();
        const firstReplies = [
            response(listEnvelope([worker()])),
            response(envelope(worker())),
            response({ error: true }, 500),
        ];
        const firstFetch = vi.fn(async () => firstReplies.shift() ?? response({ unexpected: true }, 500));
        expect(
            await executeD1ProbeCloudflareWorkerCanaryCleanupCommandV1(
                command,
                { attempt_tag: attemptTag },
                key,
                token,
                { fetch: firstFetch as unknown as typeof globalThis.fetch, now: () => cleanupNow }
            )
        ).toEqual({ success: false, code: "worker_delete_unacknowledged", worker_delete_attempts: 1 });

        const replayFetch = vi.fn();
        expect(
            await executeD1ProbeCloudflareWorkerCanaryCleanupCommandV1(
                command,
                { attempt_tag: attemptTag },
                key,
                token,
                { fetch: replayFetch as unknown as typeof globalThis.fetch, now: () => cleanupNow }
            )
        ).toEqual({ success: false, code: "cleanup_state_unavailable", worker_delete_attempts: 0 });
        expect(replayFetch).not.toHaveBeenCalled();
        expect(
            (firstFetch.mock.calls as unknown as Array<[string, RequestInit]>).filter(
                ([, init]) => init.method === "DELETE"
            )
        ).toHaveLength(1);
    });

    it("supports unknown Worker ID recovery through complete declared pagination", async () => {
        const command = await compileD1ProbeCloudflareWorkerCanaryCleanupCommandV1(await makePlan(), {
            worker_id: null,
            worker_id_commitment: null,
            attempt_tag_commitment: await hmac("openbot.identity.cloudflare_worker_canary_attempt_tag.v1", attemptTag),
        });
        if (!command.success) throw new Error(command.code);
        const unrelatedWorkers = Array.from({ length: 99 }, (_, index) => ({
            id: `unrelated-${index}`,
            name: `unrelated-${index}`,
            tags: ["other"],
        }));
        const replies = [
            response(listEnvelope([worker(), ...unrelatedWorkers], 1, 2, 101)),
            response(listEnvelope([{ id: "unrelated-100", name: "unrelated-100", tags: ["other"] }], 2, 2, 101)),
            response(envelope(worker())),
            response(deleteEnvelope()),
            response({ success: false, errors: [], messages: [] }, 404),
            response(listEnvelope([])),
        ];
        const fetchMock = vi.fn(async () => replies.shift() ?? response({ unexpected: true }, 500));
        await prepareCleanupState(null);
        expect(
            await executeD1ProbeCloudflareWorkerCanaryCleanupCommandV1(
                command.command,
                {
                    attempt_tag: attemptTag,
                },
                key,
                token,
                { fetch: fetchMock as unknown as typeof globalThis.fetch, now: () => cleanupNow }
            )
        ).toEqual({
            success: true,
            result: expect.objectContaining({ complete_list_absence_observed: true }),
        });
        expect(fetchMock).toHaveBeenCalledTimes(6);
    });
});
