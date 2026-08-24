import {
    D1ProbeGatewayTrialRequestV1Schema,
    canonicalD1ProbeGatewayTrialHttpBodyV1,
    parseAndVerifyD1ProbeGatewayTrialRequestV1,
} from "@openbot/d1-probe-rpc";
import { z } from "zod";

import {
    D1ProbeDriverServiceTokenV1Schema,
    D1ProbeDriverTransportConfigV1Schema,
    D1ProbeDriverTransportResultV1Schema,
    createD1ProbeGatewayTrialTransportV1,
    type D1ProbeDriverTransportDependenciesV1,
} from "./transport.js";

export const D1_PROBE_CHILD_ASSIGNMENT_LIMIT_BYTES_V1 = 32_768 as const;
export const D1_PROBE_CHILD_GO_TIMEOUT_MS_V1 = 10_000 as const;

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/u);
const OpaqueIdSchema = z
    .string()
    .min(16)
    .max(128)
    .regex(/^[A-Za-z0-9._~-]+$/u);
const WriterRoleSchema = z.enum(["writer_a", "writer_b"]);

export const D1ProbeGatewayChildAssignmentV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("d1_probe_gateway_child_assignment"),
        transport_config: D1ProbeDriverTransportConfigV1Schema,
        trial: D1ProbeGatewayTrialRequestV1Schema,
    })
    .strict()
    .superRefine((assignment, context) => {
        if (assignment.transport_config.writer_role !== assignment.trial.writer_role) {
            context.addIssue({
                code: "custom",
                path: ["transport_config", "writer_role"],
                message: "Child assignment transport and trial roles must match",
            });
        }
    });
export type D1ProbeGatewayChildAssignmentV1 = z.infer<typeof D1ProbeGatewayChildAssignmentV1Schema>;

export const D1ProbeGatewayChildReadyV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("d1_probe_gateway_child_ready"),
        child_process_id: OpaqueIdSchema,
        writer_role: WriterRoleSchema,
        request_digest: DigestSchema,
    })
    .strict();
export type D1ProbeGatewayChildReadyV1 = z.infer<typeof D1ProbeGatewayChildReadyV1Schema>;

export const D1ProbeGatewayChildGoV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("d1_probe_gateway_child_go"),
        child_process_id: OpaqueIdSchema,
        writer_role: WriterRoleSchema,
        request_digest: DigestSchema,
        go_receipt_digest: DigestSchema,
    })
    .strict();
export type D1ProbeGatewayChildGoV1 = z.infer<typeof D1ProbeGatewayChildGoV1Schema>;

export const D1ProbeGatewayChildResultV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("d1_probe_gateway_child_result"),
        child_process_id: OpaqueIdSchema,
        writer_role: WriterRoleSchema,
        request_digest: DigestSchema,
        go_receipt_digest: DigestSchema,
        transport_result: D1ProbeDriverTransportResultV1Schema,
    })
    .strict()
    .superRefine((result, context) => {
        if (
            result.transport_result.writer_role !== result.writer_role ||
            (result.transport_result.request_digest !== null &&
                result.transport_result.request_digest !== result.request_digest)
        ) {
            context.addIssue({
                code: "custom",
                path: ["transport_result"],
                message: "Child result transport fields must match the assignment",
            });
        }
    });
export type D1ProbeGatewayChildResultV1 = z.infer<typeof D1ProbeGatewayChildResultV1Schema>;

export type D1ProbeGatewayChildExecutionV1 =
    | Readonly<{ success: true; result: D1ProbeGatewayChildResultV1 }>
    | Readonly<{
          success: false;
          code:
              | "invalid_assignment"
              | "invalid_go"
              | "service_token_unavailable"
              | "transport_initialization_failed"
              | "child_result_invalid";
      }>;

const safeParse = <T>(schema: z.ZodType<T>, input: unknown): T | null => {
    try {
        const parsed = schema.safeParse(input);
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
};

const goMatchesAssignment = (assignment: D1ProbeGatewayChildAssignmentV1, go: D1ProbeGatewayChildGoV1): boolean =>
    go.child_process_id === assignment.trial.child_process_id &&
    go.writer_role === assignment.trial.writer_role &&
    go.request_digest === assignment.trial.request_digest &&
    go.go_receipt_digest === assignment.trial.go_receipt_digest;

export const goForD1ProbeGatewayChildV1 = (
    assignmentInput: unknown,
    goInput: unknown
): D1ProbeGatewayChildGoV1 | null => {
    const assignment = safeParse(D1ProbeGatewayChildAssignmentV1Schema, assignmentInput);
    const go = safeParse(D1ProbeGatewayChildGoV1Schema, goInput);
    return assignment !== null && go !== null && goMatchesAssignment(assignment, go) ? go : null;
};

export const readyForD1ProbeGatewayChildV1 = (input: unknown): D1ProbeGatewayChildReadyV1 | null => {
    const assignment = safeParse(D1ProbeGatewayChildAssignmentV1Schema, input);
    if (assignment === null) return null;
    return D1ProbeGatewayChildReadyV1Schema.parse({
        schema_version: 1,
        kind: "d1_probe_gateway_child_ready",
        child_process_id: assignment.trial.child_process_id,
        writer_role: assignment.trial.writer_role,
        request_digest: assignment.trial.request_digest,
    });
};

export const executeD1ProbeGatewayChildV1 = async (
    assignmentInput: unknown,
    goInput: unknown,
    serviceTokenInput: unknown,
    dependencies?: D1ProbeDriverTransportDependenciesV1
): Promise<D1ProbeGatewayChildExecutionV1> => {
    const assignment = safeParse(D1ProbeGatewayChildAssignmentV1Schema, assignmentInput);
    if (assignment === null) return { success: false, code: "invalid_assignment" };
    try {
        await parseAndVerifyD1ProbeGatewayTrialRequestV1(assignment.trial);
    } catch {
        return { success: false, code: "invalid_assignment" };
    }
    const go = safeParse(D1ProbeGatewayChildGoV1Schema, goInput);
    if (go === null || !goMatchesAssignment(assignment, go)) return { success: false, code: "invalid_go" };
    if (safeParse(D1ProbeDriverServiceTokenV1Schema, serviceTokenInput) === null) {
        return { success: false, code: "service_token_unavailable" };
    }

    let send: ReturnType<typeof createD1ProbeGatewayTrialTransportV1>;
    try {
        send = createD1ProbeGatewayTrialTransportV1(assignment.transport_config, serviceTokenInput, dependencies);
    } catch {
        return { success: false, code: "transport_initialization_failed" };
    }
    try {
        const transportResult = await send(assignment.trial);
        const result = safeParse(D1ProbeGatewayChildResultV1Schema, {
            schema_version: 1,
            kind: "d1_probe_gateway_child_result",
            child_process_id: assignment.trial.child_process_id,
            writer_role: assignment.trial.writer_role,
            request_digest: assignment.trial.request_digest,
            go_receipt_digest: assignment.trial.go_receipt_digest,
            transport_result: transportResult,
        });
        return result === null ? { success: false, code: "child_result_invalid" } : { success: true, result };
    } catch {
        return { success: false, code: "child_result_invalid" };
    }
};

export const canonicalD1ProbeGatewayChildAssignmentV1 = async (input: unknown): Promise<string> => {
    const assignment = safeParse(D1ProbeGatewayChildAssignmentV1Schema, input);
    if (assignment === null) throw new TypeError("Invalid D1 probe child assignment");
    const trial = await parseAndVerifyD1ProbeGatewayTrialRequestV1(assignment.trial);
    const canonicalTrial = JSON.parse(await canonicalD1ProbeGatewayTrialHttpBodyV1(trial)) as unknown;
    return JSON.stringify({
        schema_version: assignment.schema_version,
        kind: assignment.kind,
        transport_config: {
            schema_version: assignment.transport_config.schema_version,
            exact_trigger_url: assignment.transport_config.exact_trigger_url,
            access_service_token_client_id: assignment.transport_config.access_service_token_client_id,
            writer_role: assignment.transport_config.writer_role,
            request_timeout_ms: assignment.transport_config.request_timeout_ms,
        },
        trial: canonicalTrial,
    });
};

export const canonicalD1ProbeGatewayChildReadyV1 = (input: unknown): string =>
    JSON.stringify(D1ProbeGatewayChildReadyV1Schema.parse(input));

export const canonicalD1ProbeGatewayChildGoV1 = (input: unknown): string =>
    JSON.stringify(D1ProbeGatewayChildGoV1Schema.parse(input));

export const canonicalD1ProbeGatewayChildResultV1 = (input: unknown): string =>
    JSON.stringify(D1ProbeGatewayChildResultV1Schema.parse(input));
