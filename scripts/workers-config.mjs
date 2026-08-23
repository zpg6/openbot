export const workerDeploymentOrder = Object.freeze([
    Object.freeze({ name: "sandbox-runner", config: "apps/sandbox-runner/wrangler.jsonc" }),
    Object.freeze({ name: "capability-gateway", config: "apps/capability-gateway/wrangler.d1.jsonc" }),
    Object.freeze({ name: "runtime", config: "apps/runtime/wrangler.d1.jsonc" }),
    Object.freeze({ name: "orchestrator", config: "apps/orchestrator/wrangler.d1.jsonc" }),
    Object.freeze({ name: "control-plane", config: "apps/control-plane/wrangler.d1.jsonc" }),
]);
