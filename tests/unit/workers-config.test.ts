import { describe, expect, it } from "vitest";

import { workerDeploymentOrder } from "../../scripts/workers-config.mjs";

describe("Worker deployment order", () => {
    it("deploys private callees before their callers", () => {
        expect(workerDeploymentOrder.map(worker => worker.name)).toEqual([
            "sandbox-runner",
            "capability-gateway",
            "runtime",
            "orchestrator",
            "control-plane",
        ]);
        expect(workerDeploymentOrder[0]?.config).toBe("apps/sandbox-runner/wrangler.jsonc");
    });
});
