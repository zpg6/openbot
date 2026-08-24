import {
    canonicalizeJsonV1,
    digestCanonicalJsonV1,
    type CanonicalJsonValueV1,
} from "@openbot/gate-attestation/internal";
import { describe, expect, it, vi } from "vitest";

import { executeD1ProbeCloudflareWorkerCanaryCommandV1 } from "./cloudflare-worker-canary-command.js";
import {
    generateD1ProbeCloudflareWorkerApiCanaryCommandV1,
    type D1ProbeCloudflareWorkerApiCanaryPlanGeneratorDependenciesV1,
} from "./cloudflare-worker-canary-plan.js";

const now = Date.parse("2026-08-24T15:00:00.000Z");
const accountId = "a".repeat(32);
const rawKey = new Uint8Array(32).fill(1);
const hmacKey = {
    hmac_key_base64url: btoa(String.fromCharCode(...rawKey))
        .replace(/=/gu, "")
        .replace(/\+/gu, "-")
        .replace(/\//gu, "_"),
};
const request = () => ({
    schema_version: 1 as const,
    kind: "d1_probe_cloudflare_worker_api_canary_plan_request" as const,
    account_id: accountId,
});

const toHex = (value: ArrayBuffer): string =>
    [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");

const expectedKeyId = async (): Promise<string> => {
    const domain = new TextEncoder().encode("openbot.d1-probe.commitment-key-id.v1\u0000");
    const preimage = new Uint8Array(domain.byteLength + rawKey.byteLength);
    preimage.set(domain);
    preimage.set(rawKey, domain.byteLength);
    return toHex(await crypto.subtle.digest("SHA-256", preimage));
};

const deterministicRandom = (operationByte = 1, suffixByte = 2) =>
    vi.fn((length: number) => {
        if (length === 16) return new Uint8Array(length).fill(operationByte);
        if (length === 32) return new Uint8Array(length).fill(suffixByte);
        throw new Error("unexpected random byte request");
    });

const dependencies = (
    randomBytes = deterministicRandom()
): D1ProbeCloudflareWorkerApiCanaryPlanGeneratorDependenciesV1 => ({
    now: () => now,
    randomBytes,
});

describe("Cloudflare Worker API canary offline plan generator", () => {
    it("emits a deterministic command accepted by the existing command contract", async () => {
        const randomBytes = deterministicRandom();
        const generated = await generateD1ProbeCloudflareWorkerApiCanaryCommandV1(
            request(),
            hmacKey,
            dependencies(randomBytes)
        );
        expect(generated.success).toBe(true);
        if (!generated.success) return;

        const { plan } = generated.command;
        expect(generated.command.schema_version).toBe(1);
        expect(generated.command.kind).toBe("d1_probe_cloudflare_worker_api_canary_command");
        expect(plan.operation_id).toBe("01".repeat(16));
        expect(plan.random_suffix).toBe("c".repeat(16));
        expect(plan.script_name).toBe(`openbot-d1-probe-canary-${"c".repeat(16)}`);
        expect(plan.commitment_key_id_digest).toBe(await expectedKeyId());
        expect(plan.not_before_ms).toBe(now);
        expect(plan.expires_at_ms).toBe(now + 300_000);
        expect({
            authoritative: plan.authoritative,
            eligible_for_attestation: plan.eligible_for_attestation,
            lifecycle_advance_allowed: plan.lifecycle_advance_allowed,
            gate_promotion_allowed: plan.gate_promotion_allowed,
        }).toEqual({
            authoritative: false,
            eligible_for_attestation: false,
            lifecycle_advance_allowed: false,
            gate_promotion_allowed: false,
        });
        const { plan_digest: _digest, ...unsignedPlan } = plan;
        await expect(
            digestCanonicalJsonV1(
                "openbot.d1-probe.cloudflare-worker-api-canary-plan.v1",
                unsignedPlan as CanonicalJsonValueV1
            )
        ).resolves.toBe(plan.plan_digest);
        expect(randomBytes.mock.calls.map(call => call[0])).toEqual([16, 32]);

        const run = vi.fn(async () => ({ success: false as const, code: "canary_plan_not_active" as const }));
        const executed = await executeD1ProbeCloudflareWorkerCanaryCommandV1(
            generated.command,
            hmacKey.hmac_key_base64url,
            "x".repeat(32),
            {
                fetch: vi.fn() as unknown as typeof globalThis.fetch,
                now: () => now,
                reserve: async () => "reserved",
                run,
            }
        );
        expect(executed).toEqual({ success: false, code: "canary_plan_not_active" });
        expect(run).toHaveBeenCalledTimes(1);
    });

    it("produces byte-for-byte stable output for the same clock and random bytes", async () => {
        const first = await generateD1ProbeCloudflareWorkerApiCanaryCommandV1(
            request(),
            hmacKey,
            dependencies(deterministicRandom(7, 35))
        );
        const second = await generateD1ProbeCloudflareWorkerApiCanaryCommandV1(
            request(),
            hmacKey,
            dependencies(deterministicRandom(7, 35))
        );
        expect(first.success && second.success).toBe(true);
        if (!first.success || !second.success) return;
        expect(canonicalizeJsonV1(first.command as unknown as CanonicalJsonValueV1)).toBe(
            canonicalizeJsonV1(second.command as unknown as CanonicalJsonValueV1)
        );
    });

    it("uses independent random draws to produce unique operation IDs and suffixes", async () => {
        const first = await generateD1ProbeCloudflareWorkerApiCanaryCommandV1(
            request(),
            hmacKey,
            dependencies(deterministicRandom(1, 2))
        );
        const second = await generateD1ProbeCloudflareWorkerApiCanaryCommandV1(
            request(),
            hmacKey,
            dependencies(deterministicRandom(3, 4))
        );
        expect(first.success && second.success).toBe(true);
        if (!first.success || !second.success) return;
        expect(first.command.plan.operation_id).not.toBe(second.command.plan.operation_id);
        expect(first.command.plan.random_suffix).not.toBe(second.command.plan.random_suffix);
        expect(first.command.plan.plan_digest).not.toBe(second.command.plan.plan_digest);
    });

    it("uses rejection sampling for the 36-character suffix alphabet", async () => {
        let call = 0;
        const randomBytes = vi.fn((length: number) => {
            call += 1;
            if (length === 16) return new Uint8Array(length).fill(0);
            if (call === 2) return new Uint8Array(length).fill(252);
            return new Uint8Array(length).fill(251);
        });
        const generated = await generateD1ProbeCloudflareWorkerApiCanaryCommandV1(
            request(),
            hmacKey,
            dependencies(randomBytes)
        );
        expect(generated.success).toBe(true);
        if (!generated.success) return;
        expect(generated.command.plan.random_suffix).toBe("9".repeat(16));
        expect(randomBytes.mock.calls.map(entry => entry[0])).toEqual([16, 32, 32]);
    });

    it("does not mutate buffers returned by the injected random source", async () => {
        const operation = new Uint8Array(16).fill(9);
        const suffix = new Uint8Array(32).fill(10);
        const randomBytes = vi.fn((length: number) => (length === 16 ? operation : suffix));
        const generated = await generateD1ProbeCloudflareWorkerApiCanaryCommandV1(
            request(),
            hmacKey,
            dependencies(randomBytes)
        );
        expect(generated.success).toBe(true);
        expect(operation).toEqual(new Uint8Array(16).fill(9));
        expect(suffix).toEqual(new Uint8Array(32).fill(10));
    });

    it("rejects noncanonical, malformed, and accessor-hostile requests before randomness", async () => {
        const randomBytes = deterministicRandom();
        const hostile = Object.create(null) as Record<string, unknown>;
        Object.defineProperty(hostile, "schema_version", {
            enumerable: true,
            get: () => {
                throw new Error("hostile getter");
            },
        });
        for (const input of [
            { ...request(), extra: true },
            { ...request(), account_id: "A".repeat(32) },
            { ...request(), account_id: "a".repeat(31) },
            hostile,
            null,
        ]) {
            await expect(
                generateD1ProbeCloudflareWorkerApiCanaryCommandV1(input, hmacKey, dependencies(randomBytes))
            ).resolves.toEqual({ success: false, code: "invalid_canary_plan_request" });
        }
        expect(randomBytes).not.toHaveBeenCalled();
    });

    it("rejects malformed or noncanonical keys without exposing them", async () => {
        const randomBytes = deterministicRandom();
        for (const keyInput of [
            "not-an-object",
            { hmac_key_base64url: "x".repeat(43) },
            { hmac_key_base64url: hmacKey.hmac_key_base64url, extra: true },
            { hmac_key_base64url: `${hmacKey.hmac_key_base64url}=` },
        ]) {
            const result = await generateD1ProbeCloudflareWorkerApiCanaryCommandV1(
                request(),
                keyInput,
                dependencies(randomBytes)
            );
            expect(result).toEqual({ success: false, code: "invalid_commitment_key" });
            expect(JSON.stringify(result)).not.toContain(hmacKey.hmac_key_base64url);
        }
        expect(randomBytes).not.toHaveBeenCalled();
    });

    it("rejects unsafe clocks and overflow without requesting randomness", async () => {
        const invalidClocks = [
            () => -1,
            () => 1.5,
            () => Number.NaN,
            () => Number.MAX_SAFE_INTEGER - 299_999,
            () => {
                throw new Error("clock failed");
            },
        ];
        for (const clock of invalidClocks) {
            const randomBytes = deterministicRandom();
            await expect(
                generateD1ProbeCloudflareWorkerApiCanaryCommandV1(request(), hmacKey, {
                    now: clock,
                    randomBytes,
                })
            ).resolves.toEqual({ success: false, code: "clock_unavailable" });
            expect(randomBytes).not.toHaveBeenCalled();
        }
    });

    it("fails closed on malformed, throwing, or exhausted randomness", async () => {
        const sources = [
            vi.fn(() => new Uint8Array(15)),
            vi.fn(() => {
                throw new Error("rng failed");
            }),
            vi.fn((length: number) => (length === 16 ? new Uint8Array(length) : new Uint8Array(length).fill(255))),
        ];
        for (const randomBytes of sources) {
            await expect(
                generateD1ProbeCloudflareWorkerApiCanaryCommandV1(request(), hmacKey, {
                    now: () => now,
                    randomBytes,
                })
            ).resolves.toEqual({ success: false, code: "randomness_unavailable" });
        }
        expect(sources[2]).toHaveBeenCalledTimes(9);
    });

    it("never serializes the HMAC key into the command", async () => {
        const generated = await generateD1ProbeCloudflareWorkerApiCanaryCommandV1(request(), hmacKey, dependencies());
        expect(generated.success).toBe(true);
        expect(JSON.stringify(generated)).not.toContain(hmacKey.hmac_key_base64url);
    });
});
