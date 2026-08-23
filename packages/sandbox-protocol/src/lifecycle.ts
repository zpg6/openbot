import { z } from "zod";

import { SANDBOX_PROTOCOL_VERSION_V1 } from "./constants.js";

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);

export const SandboxLifecycleAckV1Schema = z
    .object({
        schema_version: z.literal(SANDBOX_PROTOCOL_VERSION_V1),
        request_digest: DigestSchema,
        operation: z.enum(["kill_sandbox_process_v1", "destroy_sandbox_v1"]),
        status: z.enum(["sdk_acknowledged", "not_found", "outcome_unknown", "rejected", "unavailable"]),
        error_code: z
            .enum(["invalid_request", "outcome_unknown", "runner_internal_error", "sandbox_unavailable"])
            .nullable(),
    })
    .strict()
    .superRefine((ack, context) => {
        const validStatusError =
            ((ack.status === "sdk_acknowledged" || ack.status === "not_found") && ack.error_code === null) ||
            (ack.status === "outcome_unknown" && ack.error_code === "outcome_unknown") ||
            (ack.status === "rejected" && ack.error_code === "invalid_request") ||
            (ack.status === "unavailable" &&
                (ack.error_code === "sandbox_unavailable" || ack.error_code === "runner_internal_error"));
        if (!validStatusError) {
            context.addIssue({
                code: "custom",
                path: ["error_code"],
                message: "Lifecycle status and error code do not agree",
            });
        }
    });
export type SandboxLifecycleAckV1 = z.infer<typeof SandboxLifecycleAckV1Schema>;

export interface SandboxExecutionServiceV1 {
    execute(request: unknown): Promise<ReadableStream<Uint8Array>>;
}

export interface SandboxLifecycleServiceV1 {
    kill(request: unknown): Promise<SandboxLifecycleAckV1>;
    destroy(request: unknown): Promise<SandboxLifecycleAckV1>;
}
