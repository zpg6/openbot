import {
    D1_PROBE_RUNTIME_VERSION_HEADER_V1,
    canonicalD1ProbeGatewayTrialHttpBodyV1,
    canonicalD1ProbeGatewayTrialHttpResponseV1,
    computeD1ProbeGatewayReservationRequestDigestV1,
    computeD1ProbeGatewayTrialRequestDigestV1,
    d1ProbeHttpErrorV1,
    d1ProbeRuntimeVersionHeaderV1,
    gatewayTrialResponseV1,
    type D1ProbeGatewayReservationRequestV1,
    type D1ProbeGatewayTrialRequestV1,
    type D1ProbeWriterRoleV1,
    type UnsignedD1ProbeGatewayReservationRequestV1,
    type UnsignedD1ProbeGatewayTrialRequestV1,
} from "@openbot/d1-probe-rpc";
import { describe, expect, it, vi } from "vitest";

import { D1_PROBE_DRIVER_RESPONSE_LIMIT_BYTES_V1, createD1ProbeGatewayTrialTransportV1 } from "../src/transport.js";

const exactUrl = "https://probe.example.test/openbot-d1-probe/writer-a/run-000000000001";
const clientId = `${"b".repeat(32)}.access`;
const clientSecret = "c".repeat(64);
const hex = (character: string): string => character.repeat(64);
const writerARuntimeVersion = {
    id: "writer_a_version_001",
    tag: "probe-writer-a",
    timestamp: "2026-08-24T12:34:56.000Z",
} as const;
const writerBRuntimeVersion = {
    id: "writer_b_version_001",
    tag: "probe-writer-b",
    timestamp: "2026-08-24T12:35:56.000Z",
} as const;

const trialRequest = async (writerRole: D1ProbeWriterRoleV1 = "writer_a") => {
    const unsignedGateway: UnsignedD1ProbeGatewayReservationRequestV1 = {
        schema_version: 1,
        operation: "reserve_gateway_call_v1",
        request_id: "gateway_request_0001",
        probe_run_id: "probe_run_0000001",
        scenario: "gateway_trial_0001",
        writer_role: writerRole,
        request_variant: "exact",
        call_kind: "model",
        logical_call_id: "logical_call_0001",
        attempt_id: "attempt_00000001",
        call_sequence: 1,
        reservation_id: "reservation_0001",
        dispatch_request_digest: hex("3"),
        fault_point: "none",
    };
    const gatewayRequest: D1ProbeGatewayReservationRequestV1 = {
        ...unsignedGateway,
        request_digest: await computeD1ProbeGatewayReservationRequestDigestV1(unsignedGateway),
    };
    const unsignedTrial: UnsignedD1ProbeGatewayTrialRequestV1 = {
        schema_version: 1,
        operation: "run_gateway_trial_v1",
        request_id: "trial_request_0001",
        probe_run_id: "probe_run_0000001",
        trial_id: "gateway_trial_0001",
        child_process_id: "child_process_0001",
        writer_role: writerRole,
        expected_contender_count: 2,
        go_receipt_digest: hex("4"),
        barrier_timeout_ms: 2_000,
        barrier_poll_interval_ms: 25,
        gateway_request: gatewayRequest,
    };
    return {
        ...unsignedTrial,
        request_digest: await computeD1ProbeGatewayTrialRequestDigestV1(unsignedTrial),
    } satisfies D1ProbeGatewayTrialRequestV1;
};

const writerResult = (trial: D1ProbeGatewayTrialRequestV1) =>
    gatewayTrialResponseV1({
        schema_version: 1,
        operation: "run_gateway_trial_v1",
        request_digest: trial.request_digest,
        writer_role: trial.writer_role,
        status: "outcome_unknown",
        error_code: "gateway_execution_unknown",
        readiness: null,
        barrier: null,
        readiness_denial_readback: null,
        gateway_response: null,
    });

const responseFrom = (
    body: string,
    status: number,
    headers: Record<string, string> = {},
    runtimeVersion: typeof writerARuntimeVersion | typeof writerBRuntimeVersion | null = writerARuntimeVersion
): Response =>
    new Response(body, {
        status,
        headers: {
            "cache-control": "no-store",
            "content-length": String(new TextEncoder().encode(body).byteLength),
            "content-type": "application/json; charset=utf-8",
            "referrer-policy": "no-referrer",
            "x-content-type-options": "nosniff",
            ...(runtimeVersion === null
                ? {}
                : { [D1_PROBE_RUNTIME_VERSION_HEADER_V1]: d1ProbeRuntimeVersionHeaderV1(runtimeVersion) }),
            ...headers,
        },
    });

const transport = (
    fetch = vi.fn<typeof globalThis.fetch>(),
    writerRole: D1ProbeWriterRoleV1 = "writer_a",
    triggerUrl = exactUrl
) => ({
    fetch,
    send: createD1ProbeGatewayTrialTransportV1(
        {
            schema_version: 1,
            exact_trigger_url: triggerUrl,
            access_service_token_client_id: clientId,
            writer_role: writerRole,
            request_timeout_ms: 5_000,
        },
        { client_secret: clientSecret },
        { fetch }
    ),
});

describe("D1 probe driver transport", () => {
    it("sends one exact Access-authenticated request and binds the response", async () => {
        const trial = await trialRequest();
        const expectedBody = await canonicalD1ProbeGatewayTrialHttpBodyV1(trial);
        const responseBody = canonicalD1ProbeGatewayTrialHttpResponseV1(writerResult(trial));
        const fetch = vi.fn<typeof globalThis.fetch>(async () => responseFrom(responseBody, 503));
        const candidate = transport(fetch);
        const result = await candidate.send(trial);

        expect(result).toMatchObject({
            status: "delivered",
            request_digest: trial.request_digest,
            writer_role: "writer_a",
            http_status: 503,
            runtime_version: writerARuntimeVersion,
            response: { status: "outcome_unknown", error_code: "gateway_execution_unknown" },
        });
        expect(JSON.stringify(result)).not.toContain(clientSecret);
        expect(fetch).toHaveBeenCalledOnce();
        const [url, init] = fetch.mock.calls[0]!;
        expect(url).toBe(exactUrl);
        expect(init).toMatchObject({
            method: "POST",
            body: expectedBody,
            cache: "no-store",
            credentials: "omit",
            redirect: "error",
            referrerPolicy: "no-referrer",
        });
        expect(init?.headers).toMatchObject({
            "CF-Access-Client-Id": clientId,
            "CF-Access-Client-Secret": clientSecret,
            "content-type": "application/json",
        });
    });

    it("returns a strict server rejection without retrying", async () => {
        const trial = await trialRequest();
        const body = canonicalD1ProbeGatewayTrialHttpResponseV1(d1ProbeHttpErrorV1("access_required"));
        const fetch = vi.fn<typeof globalThis.fetch>(async () => responseFrom(body, 403, {}, null));
        const result = await transport(fetch).send(trial);
        expect(result).toMatchObject({
            status: "server_rejected",
            request_digest: trial.request_digest,
            http_status: 403,
            runtime_version: null,
            response: { code: "access_required" },
        });
        expect(fetch).toHaveBeenCalledOnce();
    });

    it("keeps Writer A and Writer B runtime observations distinct while rejecting body-role substitution", async () => {
        const writerBUrl = "https://probe.example.test/openbot-d1-probe/writer-b/run-000000000001";
        const writerA = await trialRequest("writer_a");
        const writerB = await trialRequest("writer_b");
        const writerAFetch = vi.fn<typeof globalThis.fetch>(async () =>
            responseFrom(canonicalD1ProbeGatewayTrialHttpResponseV1(writerResult(writerA)), 503)
        );
        const writerBFetch = vi.fn<typeof globalThis.fetch>(async () =>
            responseFrom(
                canonicalD1ProbeGatewayTrialHttpResponseV1(writerResult(writerB)),
                503,
                {},
                writerBRuntimeVersion
            )
        );
        await expect(transport(writerAFetch).send(writerA)).resolves.toMatchObject({
            status: "delivered",
            writer_role: "writer_a",
            runtime_version: writerARuntimeVersion,
        });
        await expect(transport(writerBFetch, "writer_b", writerBUrl).send(writerB)).resolves.toMatchObject({
            status: "delivered",
            writer_role: "writer_b",
            runtime_version: writerBRuntimeVersion,
        });

        const substitutedFetch = vi.fn<typeof globalThis.fetch>(async () =>
            responseFrom(
                canonicalD1ProbeGatewayTrialHttpResponseV1(writerResult(writerA)),
                503,
                {},
                writerARuntimeVersion
            )
        );
        await expect(transport(substitutedFetch, "writer_b", writerBUrl).send(writerB)).resolves.toMatchObject({
            status: "outcome_unknown",
            error_code: "response_invalid",
        });
    });

    it("rejects missing, malformed, padded, and noncanonical runtime-version headers", async () => {
        const trial = await trialRequest();
        const body = canonicalD1ProbeGatewayTrialHttpResponseV1(writerResult(trial));
        const whitespaceJson = JSON.stringify(writerARuntimeVersion).replace("{", "{ ");
        const noncanonical = btoa(whitespaceJson).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
        const canonical = d1ProbeRuntimeVersionHeaderV1(writerARuntimeVersion);
        const responses = [
            responseFrom(body, 503, {}, null),
            responseFrom(body, 503, { [D1_PROBE_RUNTIME_VERSION_HEADER_V1]: "not+base64url" }, null),
            responseFrom(body, 503, { [D1_PROBE_RUNTIME_VERSION_HEADER_V1]: `${canonical}=` }, null),
            responseFrom(body, 503, { [D1_PROBE_RUNTIME_VERSION_HEADER_V1]: noncanonical }, null),
        ];
        for (const response of responses) {
            const fetch = vi.fn<typeof globalThis.fetch>(async () => response);
            await expect(transport(fetch).send(trial)).resolves.toMatchObject({
                status: "outcome_unknown",
                error_code: "response_invalid",
            });
        }
    });

    it("rejects runtime metadata leaked on a pre-Access server denial", async () => {
        const trial = await trialRequest();
        const body = canonicalD1ProbeGatewayTrialHttpResponseV1(d1ProbeHttpErrorV1("access_required"));
        const fetch = vi.fn<typeof globalThis.fetch>(async () => responseFrom(body, 403));
        await expect(transport(fetch).send(trial)).resolves.toMatchObject({
            status: "outcome_unknown",
            error_code: "response_invalid",
        });
    });

    it("rejects invalid requests and role substitution before the network", async () => {
        const candidate = transport();
        const invalid = await candidate.send({});
        const writerB = await candidate.send(await trialRequest("writer_b"));
        expect(invalid).toEqual({
            status: "local_rejected",
            request_digest: null,
            writer_role: "writer_a",
            error_code: "invalid_request",
        });
        expect(writerB).toEqual(invalid);
        expect(candidate.fetch).not.toHaveBeenCalled();
    });

    it("does not retry network errors or timeouts", async () => {
        const trial = await trialRequest();
        const networkFetch = vi.fn<typeof globalThis.fetch>(async () => {
            throw new Error("network failed");
        });
        expect(await transport(networkFetch).send(trial)).toMatchObject({
            status: "outcome_unknown",
            error_code: "network_error",
        });
        expect(networkFetch).toHaveBeenCalledOnce();

        const timeoutFetch = vi.fn<typeof globalThis.fetch>(
            (_url, init) =>
                new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
                })
        );
        const send = createD1ProbeGatewayTrialTransportV1(
            {
                schema_version: 1,
                exact_trigger_url: exactUrl,
                access_service_token_client_id: clientId,
                writer_role: "writer_a",
                request_timeout_ms: 1,
            },
            { client_secret: clientSecret },
            { fetch: timeoutFetch }
        );
        expect(await send(trial)).toMatchObject({ status: "outcome_unknown", error_code: "request_timeout" });
        expect(timeoutFetch).toHaveBeenCalledOnce();

        const bodyTimeoutFetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
            const stream = new ReadableStream<Uint8Array>({
                start(controller) {
                    controller.enqueue(new TextEncoder().encode("{"));
                    init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")), {
                        once: true,
                    });
                },
            });
            return new Response(stream, {
                status: 503,
                headers: {
                    "cache-control": "no-store",
                    "content-type": "application/json; charset=utf-8",
                    "referrer-policy": "no-referrer",
                    "x-content-type-options": "nosniff",
                },
            });
        });
        const sendWithBodyTimeout = createD1ProbeGatewayTrialTransportV1(
            {
                schema_version: 1,
                exact_trigger_url: exactUrl,
                access_service_token_client_id: clientId,
                writer_role: "writer_a",
                request_timeout_ms: 1,
            },
            { client_secret: clientSecret },
            { fetch: bodyTimeoutFetch }
        );
        expect(await sendWithBodyTimeout(trial)).toMatchObject({
            status: "outcome_unknown",
            error_code: "request_timeout",
        });
        expect(bodyTimeoutFetch).toHaveBeenCalledOnce();
    });

    it("rejects substituted, noncanonical, redirected, and contradictory responses", async () => {
        const trial = await trialRequest();
        const otherTrial = await trialRequest();
        otherTrial.request_digest = hex("9");
        const validBody = canonicalD1ProbeGatewayTrialHttpResponseV1(writerResult(trial));
        const substitutedBody = canonicalD1ProbeGatewayTrialHttpResponseV1(writerResult(otherTrial));
        const redirected = responseFrom(validBody, 503);
        Object.defineProperty(redirected, "redirected", { value: true });
        const cases = [
            responseFrom(substitutedBody, 503),
            responseFrom(` ${validBody}`, 503),
            responseFrom(validBody, 200),
            responseFrom(validBody, 503, { "content-type": "text/html" }),
            responseFrom(validBody, 503, { "cache-control": "public" }),
            responseFrom(validBody, 503, { "content-encoding": "gzip" }),
            responseFrom(validBody, 503, { "content-length": String(validBody.length + 1) }),
            redirected,
        ];
        for (const response of cases) {
            const fetch = vi.fn<typeof globalThis.fetch>(async () => response);
            expect(await transport(fetch).send(trial)).toMatchObject({
                status: "outcome_unknown",
                error_code: "response_invalid",
            });
            expect(fetch).toHaveBeenCalledOnce();
        }
    });

    it("bounds response bytes and rejects invalid UTF-8", async () => {
        const trial = await trialRequest();
        const oversized = "x".repeat(D1_PROBE_DRIVER_RESPONSE_LIMIT_BYTES_V1 + 1);
        const oversizedFetch = vi.fn<typeof globalThis.fetch>(async () =>
            responseFrom(oversized, 503, { "content-length": String(oversized.length) })
        );
        expect(await transport(oversizedFetch).send(trial)).toMatchObject({
            status: "outcome_unknown",
            error_code: "response_too_large",
        });

        const invalidUtf8Fetch = vi.fn<typeof globalThis.fetch>(
            async () =>
                new Response(new Uint8Array([0xff]), {
                    status: 503,
                    headers: {
                        "cache-control": "no-store",
                        "content-length": "1",
                        "content-type": "application/json; charset=utf-8",
                        "referrer-policy": "no-referrer",
                        "x-content-type-options": "nosniff",
                    },
                })
        );
        expect(await transport(invalidUtf8Fetch).send(trial)).toMatchObject({
            status: "outcome_unknown",
            error_code: "response_invalid",
        });
    });

    it("rejects hostile bootstrap values without reading a secret into output", () => {
        const hostile = new Proxy(
            {},
            {
                ownKeys: () => {
                    throw new Error("hostile bootstrap");
                },
            }
        );
        expect(() => createD1ProbeGatewayTrialTransportV1(hostile, { client_secret: clientSecret })).toThrow(TypeError);
        expect(() =>
            createD1ProbeGatewayTrialTransportV1(
                {
                    schema_version: 1,
                    exact_trigger_url: exactUrl,
                    access_service_token_client_id: clientId,
                    writer_role: "writer_a",
                    request_timeout_ms: 1,
                },
                { client_secret: clientSecret },
                new Proxy({} as never, {
                    get: () => {
                        throw new Error("hostile dependencies");
                    },
                })
            )
        ).toThrow(TypeError);
        expect(() =>
            createD1ProbeGatewayTrialTransportV1(
                {
                    schema_version: 1,
                    exact_trigger_url: "http://probe.example.test/path",
                    access_service_token_client_id: clientId,
                    writer_role: "writer_a",
                    request_timeout_ms: 1,
                },
                { client_secret: clientSecret }
            )
        ).toThrow(TypeError);
        expect(() =>
            createD1ProbeGatewayTrialTransportV1(
                {
                    schema_version: 1,
                    exact_trigger_url: exactUrl,
                    access_service_token_client_id: clientId,
                    writer_role: "writer_a",
                    request_timeout_ms: 1,
                },
                { client_secret: "bad secret" }
            )
        ).toThrow(TypeError);
    });

    it("contains a hostile response object", async () => {
        const trial = await trialRequest();
        const hostileResponse = new Proxy({} as Response, {
            get: (_target, property) => {
                if (property === "then") return undefined;
                throw new Error("hostile response");
            },
        });
        const fetch = vi.fn<typeof globalThis.fetch>(async () => hostileResponse);
        expect(await transport(fetch).send(trial)).toMatchObject({
            status: "outcome_unknown",
            error_code: "response_invalid",
        });
        expect(fetch).toHaveBeenCalledOnce();
    });
});
