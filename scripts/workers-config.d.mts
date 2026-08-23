export interface WorkerDeployment {
    readonly name: "sandbox-runner" | "capability-gateway" | "runtime" | "orchestrator" | "control-plane";
    readonly config: string;
}

export const workerDeploymentOrder: readonly WorkerDeployment[];
