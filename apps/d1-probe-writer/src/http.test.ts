import {
    canonicalD1ProbeGatewayTrialHttpBodyV1,
    computeD1ProbeGatewayReservationRequestDigestV1,
    computeD1ProbeGatewayTrialRequestDigestV1,
    gatewayTrialResponseV1,
    type D1ProbeGatewayReservationRequestV1,
    type D1ProbeGatewayTrialRequestV1,
    type D1ProbeWriterRoleV1,
    type UnsignedD1ProbeGatewayReservationRequestV1,
    type UnsignedD1ProbeGatewayTrialRequestV1,
} from "@openbot/d1-probe-rpc";
import { describe, expect, it, vi } from "vitest";

import { createD1ProbeWriterHttpHandlerV1, type D1ProbeAccessContextV1 } from "./http.js";

const exactUrl = "https://probe.example.test/openbot-d1-probe/writer-a/run-000000000001";
const audience = "a".repeat(64);
const serviceTokenClientId = `${"b".repeat(32)}.access`;
const hex = (character: string): string => character.repeat(64);

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

const access = (overrides: Partial<D1ProbeAccessContextV1> = {}): D1ProbeAccessContextV1 => ({
    aud: audience,
    getIdentity: async () => ({
        service_token_status: true,
        service_token_id: serviceTokenClientId,
        ignored_vendor_field: "not-authority",
    }),
    ...overrides,
});

const requestFrom = (body: string, overrides: RequestInit = {}, url = exactUrl): Request =>
    new Request(url, {
        method: "POST",
        headers: {
            "content-length": String(new TextEncoder().encode(body).byteLength),
            "content-type": "application/json",
        },
        body,
        ...overrides,
    });

const unknownResult = (trial: D1ProbeGatewayTrialRequestV1) =>
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

const handler = (runGatewayTrial = vi.fn(async (trial: D1ProbeGatewayTrialRequestV1) => unknownResult(trial))) => ({
    runGatewayTrial,
    handle: createD1ProbeWriterHttpHandlerV1(
        {
            schema_version: 1,
            exact_trigger_url: exactUrl,
            access_audience: audience,
            access_service_token_client_id: serviceTokenClientId,
            writer_role: "writer_a",
        },
        { runGatewayTrial }
    ),
});

const responseBody = async (response: Response) => JSON.parse(await response.text()) as Record<string, unknown>;

describe("D1 probe Writer HTTP boundary", () => {
    it("admits one canonical request from the exact Access service token", async () => {
        const trial = await trialRequest();
        const body = await canonicalD1ProbeGatewayTrialHttpBodyV1(trial);
        const { handle, runGatewayTrial } = handler();
        const response = await handle(requestFrom(body), access());
        expect(response.status).toBe(503);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(response.headers.get("x-content-type-options")).toBe("nosniff");
        expect(await responseBody(response)).toMatchObject({
            status: "outcome_unknown",
            request_digest: trial.request_digest,
            writer_role: "writer_a",
        });
        expect(runGatewayTrial).toHaveBeenCalledOnce();
        expect(runGatewayTrial).toHaveBeenCalledWith(trial);
    });

    it.each([
        ["missing context", undefined],
        ["wrong audience", access({ aud: hex("c") })],
        ["non-service identity", access({ getIdentity: async () => ({ service_token_status: false }) })],
        [
            "wrong service token",
            access({
                getIdentity: async () => ({
                    service_token_status: true,
                    service_token_id: `${"d".repeat(32)}.access`,
                }),
            }),
        ],
        ["identity failure", access({ getIdentity: async () => Promise.reject(new Error("Access unavailable")) })],
    ] as const)("rejects %s before execution", async (_label, context) => {
        const trial = await trialRequest();
        const { handle, runGatewayTrial } = handler();
        const response = await handle(requestFrom(await canonicalD1ProbeGatewayTrialHttpBodyV1(trial)), context);
        expect(response.status).toBe(403);
        expect(await responseBody(response)).toEqual({
            schema_version: 1,
            kind: "d1_probe_http_error",
            code: "access_required",
        });
        expect(runGatewayTrial).not.toHaveBeenCalled();
    });

    it("rejects the wrong route, query, method, media type, or content encoding", async () => {
        const trial = await trialRequest();
        const body = await canonicalD1ProbeGatewayTrialHttpBodyV1(trial);
        const { handle, runGatewayTrial } = handler();
        const cases = [
            requestFrom(body, {}, `${exactUrl}/extra`),
            requestFrom(body, {}, `${exactUrl}?sql=SELECT`),
            requestFrom(body, { method: "PUT" }),
            requestFrom(body, { headers: { "content-length": String(body.length), "content-type": "text/plain" } }),
            requestFrom(body, {
                headers: {
                    "content-encoding": "gzip",
                    "content-length": String(body.length),
                    "content-type": "application/json",
                },
            }),
        ];
        const responses = await Promise.all(cases.map(candidate => handle(candidate, access())));
        expect(responses.map(response => response.status)).toEqual([404, 404, 405, 415, 415]);
        expect(runGatewayTrial).not.toHaveBeenCalled();
    });

    it("rejects missing, oversized, mismatched, noncanonical, and duplicate-key bodies", async () => {
        const trial = await trialRequest();
        const canonical = await canonicalD1ProbeGatewayTrialHttpBodyV1(trial);
        const duplicate = canonical.replace('"schema_version":1', '"schema_version":1,"schema_version":1');
        const { handle, runGatewayTrial } = handler();
        const requests = [
            new Request(exactUrl, { method: "POST", headers: { "content-type": "application/json" }, body: canonical }),
            requestFrom(canonical, { headers: { "content-length": "16385", "content-type": "application/json" } }),
            requestFrom(canonical, {
                headers: { "content-length": String(canonical.length - 1), "content-type": "application/json" },
            }),
            requestFrom(` ${canonical}`),
            requestFrom(duplicate),
        ];
        const responses = await Promise.all(requests.map(candidate => handle(candidate, access())));
        expect(responses.map(response => response.status)).toEqual([411, 413, 413, 400, 400]);
        expect(runGatewayTrial).not.toHaveBeenCalled();
    });

    it("rejects invalid UTF-8 before execution", async () => {
        const { handle, runGatewayTrial } = handler();
        const response = await handle(
            new Request(exactUrl, {
                method: "POST",
                headers: { "content-length": "1", "content-type": "application/json" },
                body: new Uint8Array([0xff]),
            }),
            access()
        );
        expect(response.status).toBe(400);
        expect(await responseBody(response)).toMatchObject({ code: "invalid_body" });
        expect(runGatewayTrial).not.toHaveBeenCalled();
    });

    it("rejects a role substitution and contains malformed or thrown execution results", async () => {
        const writerB = await trialRequest("writer_b");
        const roleHandler = handler();
        const roleResponse = await roleHandler.handle(
            requestFrom(await canonicalD1ProbeGatewayTrialHttpBodyV1(writerB)),
            access()
        );
        expect(roleResponse.status).toBe(400);
        expect(roleHandler.runGatewayTrial).not.toHaveBeenCalled();

        const trial = await trialRequest();
        const body = await canonicalD1ProbeGatewayTrialHttpBodyV1(trial);
        const malformed = handler(vi.fn(async () => ({}) as never));
        const thrown = handler(
            vi.fn(async () => {
                throw new Error("unknown execution state");
            })
        );
        for (const candidate of [malformed, thrown]) {
            const response = await candidate.handle(requestFrom(body), access());
            expect(response.status).toBe(503);
            expect(await responseBody(response)).toMatchObject({
                status: "outcome_unknown",
                error_code: "gateway_execution_unknown",
                request_digest: trial.request_digest,
            });
        }
    });

    it("rejects invalid bootstrap configuration and hostile Access identity objects", async () => {
        expect(() =>
            createD1ProbeWriterHttpHandlerV1(
                {
                    schema_version: 1,
                    exact_trigger_url: "http://probe.example.test/path",
                    access_audience: audience,
                    access_service_token_client_id: serviceTokenClientId,
                    writer_role: "writer_a",
                },
                { runGatewayTrial: async trial => unknownResult(trial) }
            )
        ).toThrow(TypeError);
        expect(() =>
            createD1ProbeWriterHttpHandlerV1(
                new Proxy(
                    {},
                    {
                        ownKeys: () => {
                            throw new Error("hostile configuration");
                        },
                    }
                ),
                { runGatewayTrial: async trial => unknownResult(trial) }
            )
        ).toThrow(TypeError);
        const hostileIdentity = new Proxy(
            {},
            {
                ownKeys: () => {
                    throw new Error("hostile identity");
                },
            }
        );
        const trial = await trialRequest();
        const candidate = handler();
        const response = await candidate.handle(
            requestFrom(await canonicalD1ProbeGatewayTrialHttpBodyV1(trial)),
            access({ getIdentity: async () => hostileIdentity })
        );
        expect(response.status).toBe(403);
        expect(candidate.runGatewayTrial).not.toHaveBeenCalled();
    });
});
