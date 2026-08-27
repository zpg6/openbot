import { unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { reserveD1ProbeCloudflareWorkerCanaryPlanV1 } from "../src/cloudflare-worker-canary-reservation.js";

const stateRoot = fileURLToPath(new URL("../../../.build/d1-probe-canary-state/", import.meta.url));

describe("Cloudflare Worker API canary reservation", () => {
    it("allows one durable reservation and denies concurrent or sequential replay", async () => {
        const digest = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte =>
            byte.toString(16).padStart(2, "0")
        ).join("");
        const path = `${stateRoot}/${digest}.lock`;
        try {
            const results = await Promise.all([
                reserveD1ProbeCloudflareWorkerCanaryPlanV1(digest),
                reserveD1ProbeCloudflareWorkerCanaryPlanV1(digest),
            ]);
            expect(results.sort()).toEqual(["already_reserved", "reserved"]);
            await expect(reserveD1ProbeCloudflareWorkerCanaryPlanV1(digest)).resolves.toBe("already_reserved");
        } finally {
            await unlink(path).catch(() => undefined);
        }
    });

    it("rejects an invalid plan digest without creating a reservation", async () => {
        await expect(reserveD1ProbeCloudflareWorkerCanaryPlanV1("../escape")).resolves.toBe("reservation_unavailable");
    });
});
