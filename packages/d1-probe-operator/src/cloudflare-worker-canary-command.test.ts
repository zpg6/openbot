import { digestCanonicalJsonV1, type CanonicalJsonValueV1 } from "@openbot/gate-attestation/internal";
import { describe, expect, it, vi } from "vitest";

import {
    classifyD1ProbeCloudflareWorkerCanaryProcessOutcomeV1,
    executeD1ProbeCloudflareWorkerCanaryCommandV1,
    type D1ProbeCloudflareWorkerCanaryCommandDependenciesV1,
} from "./cloudflare-worker-canary-command.js";

const key = "AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE";
const token = "x".repeat(32);
const operationId = "b".repeat(32);
const randomSuffix = "0000000000000001";
const now = Date.parse("2026-08-24T15:00:00.000Z");

const toHex = (value: ArrayBuffer): string =>
    [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");

const keyId = async (keyInput = key): Promise<string> => {
    const raw = Uint8Array.from(atob(keyInput), character => character.charCodeAt(0));
    const domain = new TextEncoder().encode("openbot.d1-probe.commitment-key-id.v1\u0000");
    const preimage = new Uint8Array(domain.byteLength + raw.byteLength);
    preimage.set(domain);
    preimage.set(raw, domain.byteLength);
    return toHex(await crypto.subtle.digest("SHA-256", preimage));
};

const plan = async (commitmentKeyId?: string) => {
    const resolvedCommitmentKeyId = commitmentKeyId ?? (await keyId());
    const projection = {
        schema_version: 1 as const,
        kind: "d1_probe_cloudflare_worker_api_canary_plan" as const,
        account_id: "a".repeat(32),
        commitment_key_id_digest: resolvedCommitmentKeyId,
        operation_id: operationId,
        random_suffix: randomSuffix,
        script_name: `openbot-d1-probe-canary-${randomSuffix}`,
        markers: {
            ownership_tag: `openbot-canary-owner-${operationId}`,
            version_tag: `openbot-canary-version-${operationId}`,
            version_message: `openbot canary version ${operationId}`,
            deployment_message: `openbot canary deployment ${operationId}`,
        },
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

const command = async (commitmentKeyId?: string) => ({
    schema_version: 1 as const,
    kind: "d1_probe_cloudflare_worker_api_canary_command" as const,
    plan: await plan(commitmentKeyId),
});

const noNetworkDependencies = (run: NonNullable<D1ProbeCloudflareWorkerCanaryCommandDependenciesV1["run"]>) => ({
    fetch: vi.fn() as unknown as typeof globalThis.fetch,
    now: () => now,
    run,
    reserve: vi.fn(async () => "reserved" as const),
});

describe("Cloudflare Worker API canary command", () => {
    it("exits zero only for an observed candidate with confirmed control-plane absence", () => {
        const classify = (
            status: "observed_candidate" | "inconclusive" | "manual_required",
            cleanup: "not_needed" | "control_plane_absence_observed" | "manual_required"
        ) =>
            classifyD1ProbeCloudflareWorkerCanaryProcessOutcomeV1({
                status,
                cleanup_status: cleanup,
            } as never);
        expect(classify("observed_candidate", "control_plane_absence_observed")).toEqual({
            exit_code: 0,
            stderr_code: null,
        });
        expect(classify("inconclusive", "control_plane_absence_observed")).toEqual({
            exit_code: 3,
            stderr_code: "worker_api_canary_inconclusive",
        });
        expect(classify("manual_required", "manual_required")).toEqual({
            exit_code: 2,
            stderr_code: "worker_api_canary_manual_required",
        });
        expect(
            classifyD1ProbeCloudflareWorkerCanaryProcessOutcomeV1(
                { status: "observed_candidate", cleanup_status: "control_plane_absence_observed" } as never,
                true
            )
        ).toEqual({ exit_code: 130, stderr_code: "worker_api_canary_interrupted" });
    });

    it("rejects a wrong derived key ID before the core runner or network can run", async () => {
        const run = vi.fn() as unknown as NonNullable<D1ProbeCloudflareWorkerCanaryCommandDependenciesV1["run"]>;
        const dependencies = noNetworkDependencies(run);
        const result = await executeD1ProbeCloudflareWorkerCanaryCommandV1(
            await command("f".repeat(64)),
            key,
            token,
            dependencies
        );
        expect(result).toEqual({ success: false, code: "commitment_key_id_mismatch" });
        expect(run).not.toHaveBeenCalled();
        expect(dependencies.fetch).not.toHaveBeenCalled();
    });

    it("rejects a substituted persisted plan before dispatch", async () => {
        const run = vi.fn() as unknown as NonNullable<D1ProbeCloudflareWorkerCanaryCommandDependenciesV1["run"]>;
        const dependencies = noNetworkDependencies(run);
        const persisted = await command();
        const result = await executeD1ProbeCloudflareWorkerCanaryCommandV1(
            { ...persisted, plan: { ...persisted.plan, account_id: "c".repeat(32) } },
            key,
            token,
            dependencies
        );
        expect(result).toEqual({ success: false, code: "invalid_canary_plan" });
        expect(run).not.toHaveBeenCalled();
        expect(dependencies.fetch).not.toHaveBeenCalled();
    });

    it("validates with the current clock but passes the live clock into the core deadline", async () => {
        const times = [now, now + 60_001];
        const clock = vi.fn(() => times.shift() ?? now + 60_001);
        const run = vi.fn(async (_plan, _credential, _key, dependencies) => {
            return dependencies.now() >= now + 60_000
                ? { success: false as const, code: "canary_plan_not_active" as const }
                : { success: false as const, code: "invalid_canary_plan" as const };
        }) as NonNullable<D1ProbeCloudflareWorkerCanaryCommandDependenciesV1["run"]>;
        const fetchMock = vi.fn() as unknown as typeof globalThis.fetch;
        const result = await executeD1ProbeCloudflareWorkerCanaryCommandV1(await command(), key, token, {
            fetch: fetchMock,
            now: clock,
            run,
            reserve: async () => "reserved",
        });
        expect(result).toEqual({ success: false, code: "canary_plan_not_active" });
        expect(clock).toHaveBeenCalledTimes(2);
        expect(run).toHaveBeenCalledTimes(1);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rejects hostile input, invalid credentials, and an inactive plan before dispatch", async () => {
        const run = vi.fn() as unknown as NonNullable<D1ProbeCloudflareWorkerCanaryCommandDependenciesV1["run"]>;
        const dependencies = noNetworkDependencies(run);
        const hostile = new Proxy(
            {},
            {
                ownKeys: () => {
                    throw new Error("hostile command");
                },
            }
        );
        expect(await executeD1ProbeCloudflareWorkerCanaryCommandV1(hostile, key, token, dependencies)).toEqual({
            success: false,
            code: "invalid_canary_command",
        });
        expect(
            await executeD1ProbeCloudflareWorkerCanaryCommandV1(await command(), "bad", token, dependencies)
        ).toEqual({ success: false, code: "invalid_commitment_key" });
        expect(await executeD1ProbeCloudflareWorkerCanaryCommandV1(await command(), key, "bad", dependencies)).toEqual({
            success: false,
            code: "invalid_api_token",
        });
        expect(
            await executeD1ProbeCloudflareWorkerCanaryCommandV1(await command(), key, token, {
                ...dependencies,
                now: () => now + 60_000,
            })
        ).toEqual({ success: false, code: "canary_plan_not_active" });
        expect(run).not.toHaveBeenCalled();
        expect(dependencies.fetch).not.toHaveBeenCalled();
    });

    it("denies sequential or concurrent plan replay before the core runner", async () => {
        let reserved = false;
        const reserve = vi.fn(async () => {
            if (reserved) return "already_reserved" as const;
            reserved = true;
            return "reserved" as const;
        });
        const run = vi.fn(async () => ({
            success: false as const,
            code: "canary_plan_not_active" as const,
        })) as NonNullable<D1ProbeCloudflareWorkerCanaryCommandDependenciesV1["run"]>;
        const persisted = await command();
        const first = await executeD1ProbeCloudflareWorkerCanaryCommandV1(persisted, key, token, {
            fetch: vi.fn() as unknown as typeof globalThis.fetch,
            now: () => now,
            run,
            reserve,
        });
        const second = await executeD1ProbeCloudflareWorkerCanaryCommandV1(persisted, key, token, {
            fetch: vi.fn() as unknown as typeof globalThis.fetch,
            now: () => now,
            run,
            reserve,
        });
        expect(first).toEqual({ success: false, code: "canary_plan_not_active" });
        expect(second).toEqual({ success: false, code: "canary_plan_already_consumed" });
        expect(run).toHaveBeenCalledTimes(1);
    });
});
