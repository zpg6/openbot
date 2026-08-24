import { parseAndVerifyD1ProbeGatewayTrialRequestV1 } from "@openbot/d1-probe-rpc";
import { z } from "zod";

import { D1ProbeDriverServiceTokenV1Schema, type D1ProbeDriverServiceTokenV1 } from "./transport.js";
import {
    D1ProbeGatewayChildAssignmentV1Schema,
    D1ProbeGatewayChildGoV1Schema,
    D1ProbeGatewayChildReadyV1Schema,
    D1ProbeGatewayChildResultV1Schema,
    canonicalD1ProbeGatewayChildAssignmentV1,
    goForD1ProbeGatewayChildV1,
    type D1ProbeGatewayChildAssignmentV1,
    type D1ProbeGatewayChildGoV1,
    type D1ProbeGatewayChildReadyV1,
    type D1ProbeGatewayChildResultV1,
} from "./child.js";

export const D1_PROBE_PARENT_ASSIGNMENT_LIMIT_BYTES_V1 = 65_536 as const;
export const D1_PROBE_PARENT_READY_TIMEOUT_MS_V1 = 5_000 as const;
export const D1_PROBE_PARENT_RESULT_TIMEOUT_MS_V1 = 20_000 as const;
export const D1_PROBE_PARENT_TERMINATION_TIMEOUT_MS_V1 = 1_000 as const;

const OpaqueIdSchema = z
    .string()
    .min(16)
    .max(128)
    .regex(/^[A-Za-z0-9._~-]+$/u);

const ChildAssignmentTupleV1Schema = z.tuple([
    D1ProbeGatewayChildAssignmentV1Schema,
    D1ProbeGatewayChildAssignmentV1Schema,
]);

export const D1ProbeGatewayParentAssignmentV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("d1_probe_gateway_parent_assignment"),
        parent_run_id: OpaqueIdSchema,
        children: ChildAssignmentTupleV1Schema,
    })
    .strict()
    .superRefine((parent, context) => {
        const [writerA, writerB] = parent.children;
        const a = writerA.trial;
        const b = writerB.trial;
        if (a.writer_role !== "writer_a" || b.writer_role !== "writer_b") {
            context.addIssue({
                code: "custom",
                path: ["children"],
                message: "Parent children must use the fixed Writer A then Writer B order",
            });
        }
        if (
            a.probe_run_id !== b.probe_run_id ||
            a.trial_id !== b.trial_id ||
            a.expected_contender_count !== b.expected_contender_count ||
            a.gateway_request.call_kind !== b.gateway_request.call_kind ||
            a.gateway_request.logical_call_id !== b.gateway_request.logical_call_id ||
            a.gateway_request.attempt_id !== b.gateway_request.attempt_id ||
            a.gateway_request.call_sequence !== b.gateway_request.call_sequence ||
            a.gateway_request.reservation_id !== b.gateway_request.reservation_id
        ) {
            context.addIssue({
                code: "custom",
                path: ["children"],
                message: "Parent children must describe one shared gateway contention trial",
            });
        }
        const uniquePairs: ReadonlyArray<readonly [string, string]> = [
            [a.child_process_id, b.child_process_id],
            [a.request_id, b.request_id],
            [a.request_digest, b.request_digest],
            [a.go_receipt_digest, b.go_receipt_digest],
            [a.gateway_request.request_id, b.gateway_request.request_id],
            [writerA.transport_config.exact_trigger_url, writerB.transport_config.exact_trigger_url],
        ];
        if (uniquePairs.some(([left, right]) => left === right)) {
            context.addIssue({
                code: "custom",
                path: ["children"],
                message: "Parent child, request, receipt, and Writer route identities must be distinct",
            });
        }
        if (
            writerA.transport_config.access_service_token_client_id !==
                writerB.transport_config.access_service_token_client_id ||
            writerA.transport_config.request_timeout_ms !== writerB.transport_config.request_timeout_ms ||
            new URL(writerA.transport_config.exact_trigger_url).origin !==
                new URL(writerB.transport_config.exact_trigger_url).origin
        ) {
            context.addIssue({
                code: "custom",
                path: ["children"],
                message: "Parent children must use one reviewed Access identity, origin, and request timeout",
            });
        }
    });
export type D1ProbeGatewayParentAssignmentV1 = z.infer<typeof D1ProbeGatewayParentAssignmentV1Schema>;

const ParentResultBaseV1Schema = z.object({
    schema_version: z.literal(1),
    kind: z.literal("d1_probe_gateway_parent_result"),
    authoritative: z.literal(false),
    eligible_for_attestation: z.literal(false),
    gate_promotion_allowed: z.literal(false),
    parent_run_id: OpaqueIdSchema,
    probe_run_id: OpaqueIdSchema,
    trial_id: z
        .string()
        .min(16)
        .max(64)
        .regex(/^[a-z0-9][a-z0-9_-]*$/u),
});

export const D1ProbeGatewayParentResultV1Schema = z
    .discriminatedUnion("status", [
        ParentResultBaseV1Schema.extend({
            status: z.literal("completed"),
            error_code: z.null(),
            go_release_attempted: z.literal(true),
            children: z.tuple([D1ProbeGatewayChildResultV1Schema, D1ProbeGatewayChildResultV1Schema]),
        }).strict(),
        ParentResultBaseV1Schema.extend({
            status: z.literal("inconclusive"),
            error_code: z.enum([
                "child_spawn_failed",
                "child_ready_failed",
                "child_go_failed",
                "child_result_failed",
                "child_termination_failed",
            ]),
            go_release_attempted: z.boolean(),
            children: z.tuple([]),
        }).strict(),
    ])
    .superRefine((result, context) => {
        if (result.status !== "completed") return;
        const [writerA, writerB] = result.children;
        if (
            writerA.writer_role !== "writer_a" ||
            writerB.writer_role !== "writer_b" ||
            writerA.child_process_id === writerB.child_process_id ||
            writerA.request_digest === writerB.request_digest ||
            writerA.go_receipt_digest === writerB.go_receipt_digest ||
            writerA.transport_result.status === "local_rejected" ||
            writerB.transport_result.status === "local_rejected"
        ) {
            context.addIssue({
                code: "custom",
                path: ["children"],
                message: "Completed parent result must bind two distinct children in fixed Writer order",
            });
        }
    });
export type D1ProbeGatewayParentResultV1 = z.infer<typeof D1ProbeGatewayParentResultV1Schema>;

export interface D1ProbeGatewayParentChildHandleV1 {
    readonly ready: Promise<D1ProbeGatewayChildReadyV1>;
    release(go: D1ProbeGatewayChildGoV1): Promise<D1ProbeGatewayChildResultV1>;
    terminate(): Promise<void>;
}

export interface D1ProbeGatewayParentDependenciesV1 {
    spawnChild(
        assignment: D1ProbeGatewayChildAssignmentV1,
        serviceToken: D1ProbeDriverServiceTokenV1
    ): Promise<D1ProbeGatewayParentChildHandleV1>;
}

export type D1ProbeGatewayParentExecutionV1 =
    | Readonly<{ success: true; result: D1ProbeGatewayParentResultV1 }>
    | Readonly<{ success: false; code: "invalid_assignment" | "service_token_unavailable" }>;

const safeParse = <T>(schema: z.ZodType<T>, input: unknown): T | null => {
    try {
        const parsed = schema.safeParse(input);
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
};

const matchesReady = (assignment: D1ProbeGatewayChildAssignmentV1, ready: D1ProbeGatewayChildReadyV1): boolean =>
    ready.child_process_id === assignment.trial.child_process_id &&
    ready.writer_role === assignment.trial.writer_role &&
    ready.request_digest === assignment.trial.request_digest;

const matchesResult = (assignment: D1ProbeGatewayChildAssignmentV1, result: D1ProbeGatewayChildResultV1): boolean =>
    result.child_process_id === assignment.trial.child_process_id &&
    result.writer_role === assignment.trial.writer_role &&
    result.request_digest === assignment.trial.request_digest &&
    result.go_receipt_digest === assignment.trial.go_receipt_digest &&
    result.transport_result.status !== "local_rejected";

const buildResult = (
    parent: D1ProbeGatewayParentAssignmentV1,
    value:
        | Readonly<{
              status: "completed";
              error_code: null;
              go_release_attempted: true;
              children: readonly [D1ProbeGatewayChildResultV1, D1ProbeGatewayChildResultV1];
          }>
        | Readonly<{
              status: "inconclusive";
              error_code: Extract<D1ProbeGatewayParentResultV1, { status: "inconclusive" }>["error_code"];
              go_release_attempted: boolean;
              children: readonly [];
          }>
): D1ProbeGatewayParentResultV1 =>
    D1ProbeGatewayParentResultV1Schema.parse({
        schema_version: 1,
        kind: "d1_probe_gateway_parent_result",
        authoritative: false,
        eligible_for_attestation: false,
        gate_promotion_allowed: false,
        parent_run_id: parent.parent_run_id,
        probe_run_id: parent.children[0].trial.probe_run_id,
        trial_id: parent.children[0].trial.trial_id,
        ...value,
    });

const terminateAll = async (handles: readonly D1ProbeGatewayParentChildHandleV1[]): Promise<boolean> => {
    try {
        await Promise.all(handles.map(async handle => await handle.terminate()));
        return true;
    } catch {
        return false;
    }
};

export const executeD1ProbeGatewayParentV1 = async (
    assignmentInput: unknown,
    serviceTokenInput: unknown,
    dependencies: D1ProbeGatewayParentDependenciesV1
): Promise<D1ProbeGatewayParentExecutionV1> => {
    const parent = safeParse(D1ProbeGatewayParentAssignmentV1Schema, assignmentInput);
    if (parent === null) return { success: false, code: "invalid_assignment" };
    try {
        await Promise.all(
            parent.children.map(async child => await parseAndVerifyD1ProbeGatewayTrialRequestV1(child.trial))
        );
    } catch {
        return { success: false, code: "invalid_assignment" };
    }
    const serviceToken = safeParse(D1ProbeDriverServiceTokenV1Schema, serviceTokenInput);
    if (serviceToken === null) return { success: false, code: "service_token_unavailable" };

    const handles: D1ProbeGatewayParentChildHandleV1[] = [];
    try {
        for (const child of parent.children) {
            const handle = await dependencies.spawnChild(child, serviceToken);
            void handle.ready.catch(() => undefined);
            handles.push(handle);
        }
    } catch {
        const terminated = await terminateAll(handles);
        return {
            success: true,
            result: buildResult(parent, {
                status: "inconclusive",
                error_code: terminated ? "child_spawn_failed" : "child_termination_failed",
                go_release_attempted: false,
                children: [],
            }),
        };
    }

    let ready: D1ProbeGatewayChildReadyV1[];
    try {
        ready = await Promise.all(handles.map(async handle => await handle.ready));
        if (
            ready.some((message, index) => {
                const parsed = safeParse(D1ProbeGatewayChildReadyV1Schema, message);
                return parsed === null || !matchesReady(parent.children[index]!, parsed);
            })
        ) {
            throw new TypeError("Child READY mismatch");
        }
    } catch {
        const terminated = await terminateAll(handles);
        return {
            success: true,
            result: buildResult(parent, {
                status: "inconclusive",
                error_code: terminated ? "child_ready_failed" : "child_termination_failed",
                go_release_attempted: false,
                children: [],
            }),
        };
    }

    const go = parent.children.map(child =>
        D1ProbeGatewayChildGoV1Schema.parse({
            schema_version: 1,
            kind: "d1_probe_gateway_child_go",
            child_process_id: child.trial.child_process_id,
            writer_role: child.trial.writer_role,
            request_digest: child.trial.request_digest,
            go_receipt_digest: child.trial.go_receipt_digest,
        })
    );
    if (go.some((message, index) => goForD1ProbeGatewayChildV1(parent.children[index], message) === null)) {
        const terminated = await terminateAll(handles);
        return {
            success: true,
            result: buildResult(parent, {
                status: "inconclusive",
                error_code: terminated ? "child_go_failed" : "child_termination_failed",
                go_release_attempted: false,
                children: [],
            }),
        };
    }

    let results: D1ProbeGatewayChildResultV1[];
    try {
        results = await Promise.all(handles.map(async (handle, index) => await handle.release(go[index]!)));
        if (
            results.some((message, index) => {
                const parsed = safeParse(D1ProbeGatewayChildResultV1Schema, message);
                return parsed === null || !matchesResult(parent.children[index]!, parsed);
            })
        ) {
            throw new TypeError("Child result mismatch");
        }
    } catch {
        const terminated = await terminateAll(handles);
        return {
            success: true,
            result: buildResult(parent, {
                status: "inconclusive",
                error_code: terminated ? "child_result_failed" : "child_termination_failed",
                go_release_attempted: true,
                children: [],
            }),
        };
    }
    const children = results as [D1ProbeGatewayChildResultV1, D1ProbeGatewayChildResultV1];
    return {
        success: true,
        result: buildResult(parent, {
            status: "completed",
            error_code: null,
            go_release_attempted: true,
            children,
        }),
    };
};

export const canonicalD1ProbeGatewayParentAssignmentV1 = async (input: unknown): Promise<string> => {
    const parent = safeParse(D1ProbeGatewayParentAssignmentV1Schema, input);
    if (parent === null) throw new TypeError("Invalid D1 probe parent assignment");
    const children = await Promise.all(
        parent.children.map(async child => JSON.parse(await canonicalD1ProbeGatewayChildAssignmentV1(child)) as unknown)
    );
    return JSON.stringify({
        schema_version: parent.schema_version,
        kind: parent.kind,
        parent_run_id: parent.parent_run_id,
        children,
    });
};

export const canonicalD1ProbeGatewayParentResultV1 = (input: unknown): string =>
    JSON.stringify(D1ProbeGatewayParentResultV1Schema.parse(input));
