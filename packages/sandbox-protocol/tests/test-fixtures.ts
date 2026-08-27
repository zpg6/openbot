import { SANDBOX_EXECUTION_HARD_LIMITS_V1, SANDBOX_PROTOCOL_VERSION_V1 } from "../src/constants.js";
import {
    computeExecuteJavaScriptRequestDigestV1,
    computeLifecycleRequestDigestV1,
    type DestroySandboxRequestV1,
    type ExecuteJavaScriptRequestV1,
    type KillSandboxProcessRequestV1,
    type UnsignedExecuteJavaScriptRequestV1,
} from "../src/requests.js";
import { sha256HexV1 } from "../src/text.js";

export const TEST_RUNTIME_PROFILE_DIGEST_V1 = "a".repeat(64);

export const createExecuteJavaScriptRequestFixtureV1 = async (
    overrides: Partial<UnsignedExecuteJavaScriptRequestV1> = {}
): Promise<ExecuteJavaScriptRequestV1> => {
    const source =
        overrides.source ?? "export default async function main(input) { return { answer: input.value + 1 }; }";
    const inputJson = overrides.input_json ?? '{"value":41}';
    const unsigned: UnsignedExecuteJavaScriptRequestV1 = {
        schema_version: SANDBOX_PROTOCOL_VERSION_V1,
        operation: "execute_javascript_v1",
        request_id: "request_00000001",
        consumed_reservation_id: "reservation_000001",
        run_id: "run_000000000001",
        run_attempt_fence: 7,
        sandbox_id: "a".repeat(64),
        call_sequence: 0,
        manifest_digest: "c".repeat(64),
        reviewed_runtime_profile_digest: TEST_RUNTIME_PROFILE_DIGEST_V1,
        source,
        source_digest: await sha256HexV1(source),
        input_json: inputJson,
        input_digest: await sha256HexV1(inputJson),
        limits: { ...SANDBOX_EXECUTION_HARD_LIMITS_V1 },
        ...overrides,
    };
    return { ...unsigned, request_digest: await computeExecuteJavaScriptRequestDigestV1(unsigned) };
};

export const createKillRequestFixtureV1 = async (): Promise<KillSandboxProcessRequestV1> => {
    const unsigned = {
        schema_version: SANDBOX_PROTOCOL_VERSION_V1,
        operation: "kill_sandbox_process_v1" as const,
        request_id: "request_kill_0001",
        consumed_reservation_id: "reservation_000001",
        run_id: "run_000000000001",
        sandbox_id: "a".repeat(64),
        call_sequence: 1,
        execution_request_digest: "b".repeat(64),
        fence_kind: "run_attempt" as const,
        fence_value: 7,
        expected_process_handle_id: "process_000000001",
    };
    return { ...unsigned, request_digest: await computeLifecycleRequestDigestV1(unsigned) };
};

export const createDestroyRequestFixtureV1 = async (): Promise<DestroySandboxRequestV1> => {
    const unsigned = {
        schema_version: SANDBOX_PROTOCOL_VERSION_V1,
        operation: "destroy_sandbox_v1" as const,
        request_id: "request_destroy_01",
        consumed_reservation_id: "reservation_000001",
        run_id: "run_000000000001",
        sandbox_id: "a".repeat(64),
        call_sequence: 2,
        execution_request_digest: "b".repeat(64),
        fence_kind: "cleanup" as const,
        fence_value: 7,
        cleanup_obligation_id: "cleanup_obligation_000001",
        expected_process_handle_id: null,
    };
    return { ...unsigned, request_digest: await computeLifecycleRequestDigestV1(unsigned) };
};
