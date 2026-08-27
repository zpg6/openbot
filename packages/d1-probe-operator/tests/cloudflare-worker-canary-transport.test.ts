import {
    canonicalizeJsonV1,
    digestCanonicalJsonV1,
    type CanonicalJsonValueV1,
} from "@openbot/gate-attestation/internal";
import { describe, expect, it, vi } from "vitest";

import { createD1ProbeCloudflareWorkerCanaryTransportV1 } from "../src/cloudflare-worker-canary-transport.js";

const token = "x".repeat(32);
const now = Date.parse("2026-08-24T15:00:00.000Z");
const window = { not_before_ms: now - 1, expires_at_ms: now + 60_000 };

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
    new Response(canonicalizeJsonV1(body as CanonicalJsonValueV1), {
        status,
        headers: { "content-type": "application/json", ...headers },
    });

const sha256Hex = async (value: string): Promise<string> =>
    [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))]
        .map(byte => byte.toString(16).padStart(2, "0"))
        .join("");

const createTransport = (fetch: typeof globalThis.fetch, clock: () => number = () => now) =>
    createD1ProbeCloudflareWorkerCanaryTransportV1({
        api_token: token,
        fetch,
        now: clock,
        forward_window: window,
        cleanup_window: window,
    });

describe("Cloudflare Worker canary shared transport", () => {
    it("records one redacted exact intent before a prepared dispatch", async () => {
        const order: string[] = [];
        const fetchMock = vi.fn(async () => {
            order.push("fetch");
            return jsonResponse({ created: true });
        });
        const transport = createTransport(fetchMock as unknown as typeof globalThis.fetch);
        const body = { secret_value: "body-must-stay-private", ordinal: 7 } satisfies CanonicalJsonValueV1;
        const prepared = await transport.prepare.forward.post("/accounts/raw-account/workers/scripts/raw-name", body);
        expect(prepared).not.toBeNull();
        expect(JSON.stringify(prepared)).toBe("{}");

        await expect(
            transport.dispatch(prepared!, async intent => {
                order.push("record");
                expect(Object.isFrozen(intent)).toBe(true);
                expect(intent).toEqual({
                    sequence: 1,
                    method: "POST",
                    path_digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
                    request_digest: await digestCanonicalJsonV1(
                        "openbot.d1-probe.cloudflare-worker-api-canary-request.v1",
                        {
                            method: "POST",
                            path: "/accounts/raw-account/workers/scripts/raw-name",
                            body: canonicalizeJsonV1(body),
                        }
                    ),
                    window_class: "forward",
                    intent_observed_at_ms: now,
                    dispatch_started_at_ms: now,
                });
                expect(JSON.stringify(intent)).not.toContain("raw-account");
                expect(JSON.stringify(intent)).not.toContain("raw-name");
                expect(JSON.stringify(intent)).not.toContain("body-must-stay-private");
                expect(JSON.stringify(intent)).not.toContain(token);
            })
        ).resolves.toMatchObject({ ok: true, status: 200 });
        expect(order).toEqual(["record", "fetch"]);
    });

    it("consumes a prepared dispatch before the caller record hook and never fetches when it fails", async () => {
        const fetchMock = vi.fn();
        const record = vi.fn(async () => {
            throw new Error("durable record failed");
        });
        const transport = createTransport(fetchMock as unknown as typeof globalThis.fetch);
        const prepared = await transport.prepare.cleanup.delete("/accounts/raw-account/workers/scripts/raw-name");
        expect(prepared).not.toBeNull();

        await expect(transport.dispatch(prepared!, record)).resolves.toEqual({ ok: false, status: null });
        await expect(transport.dispatch(prepared!, record)).resolves.toEqual({ ok: false, status: null });
        expect(record).toHaveBeenCalledTimes(1);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(transport.transcript).toEqual([
            expect.objectContaining({ sequence: 1, method: "DELETE", response_digest: null, status: null }),
        ]);
    });

    it("does not fetch while the caller record hook is unresolved", async () => {
        const fetchMock = vi.fn(async () => jsonResponse({ created: true }));
        const transport = createTransport(fetchMock as unknown as typeof globalThis.fetch);
        const prepared = await transport.prepare.forward.post("/wait-for-record", { value: true });
        expect(prepared).not.toBeNull();
        let release: (() => void) | undefined;
        const record = vi.fn(
            async () =>
                await new Promise<void>(resolve => {
                    release = resolve;
                })
        );

        const result = transport.dispatch(prepared!, record);
        await vi.waitFor(() => expect(record).toHaveBeenCalledOnce());
        expect(fetchMock).not.toHaveBeenCalled();
        release!();
        await expect(result).resolves.toMatchObject({ ok: true, status: 200 });
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("awaits a frozen redacted response capture with an isolated exact byte copy", async () => {
        const order: string[] = [];
        const exactBody = '{ "secret_response": "kept-exact", "value": 7 }';
        const fetchMock = vi.fn(async () => {
            order.push("fetch");
            return new Response(exactBody, {
                status: 201,
                headers: {
                    "content-type": "application/json; charset=utf-8",
                    "content-encoding": "identity",
                },
            });
        });
        const transport = createTransport(fetchMock as unknown as typeof globalThis.fetch);
        const prepared = await transport.prepare.forward.post(
            "/accounts/raw-account/scripts/raw-name",
            {
                secret_request: "must-not-leak",
            },
            [201]
        );
        expect(prepared).not.toBeNull();
        let release: (() => void) | undefined;
        let retainedBytes: Uint8Array | undefined;
        let resultSettled = false;

        const result = transport.dispatch(
            prepared!,
            async () => {
                order.push("record");
            },
            async (context, exactResponseBytes) => {
                order.push("capture");
                expect(Object.isFrozen(context)).toBe(true);
                expect(context).toEqual({
                    transcript_sequence: 1,
                    request_method: "POST",
                    request_path_digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
                    request_digest: expect.stringMatching(/^[0-9a-f]{64}$/u),
                    response_status: 201,
                    response_digest: await sha256Hex(exactBody),
                    caller_asserted_response_content_type: "application/json; charset=utf-8",
                    caller_asserted_response_content_encoding: "identity",
                    caller_asserted_response_observed_at_ms: now,
                });
                expect(context.response_digest).toBe(transport.transcript[0]?.response_digest);
                const serialized = JSON.stringify(context);
                expect(serialized).not.toContain("raw-account");
                expect(serialized).not.toContain("raw-name");
                expect(serialized).not.toContain("must-not-leak");
                expect(serialized).not.toContain(token);
                expect(new TextDecoder().decode(exactResponseBytes)).toBe(exactBody);
                expect(() =>
                    Object.assign(context as unknown as Record<string, unknown>, { response_status: 500 })
                ).toThrow();
                retainedBytes = exactResponseBytes;
                exactResponseBytes.fill(0x78);
                await new Promise<void>(resolve => {
                    release = resolve;
                });
            }
        );
        void result.finally(() => {
            resultSettled = true;
        });

        await vi.waitFor(() => expect(order).toEqual(["record", "fetch", "capture"]));
        await vi.waitFor(() => expect(release).toBeTypeOf("function"));
        expect(resultSettled).toBe(false);
        release!();
        await expect(result).resolves.toEqual({
            ok: true,
            status: 201,
            json: { secret_response: "kept-exact", value: 7 },
        });
        expect(retainedBytes).toBeDefined();
        expect([...retainedBytes!].every(byte => byte === 0)).toBe(true);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("returns an ambiguous local failure after a rejected capture and consumes POST and DELETE dispatches", async () => {
        const fetchMock = vi.fn(async () => jsonResponse({ observed: true }));
        let rejectedCallbackBytes: Uint8Array | undefined;
        const capture = vi.fn(async (_context, bytes: Uint8Array) => {
            rejectedCallbackBytes = bytes;
            throw new Error("archive unavailable after response");
        });
        const record = vi.fn(async () => undefined);
        const transport = createTransport(fetchMock as unknown as typeof globalThis.fetch);
        const post = await transport.prepare.forward.post("/post-once", { value: true });
        const deletion = await transport.prepare.cleanup.delete("/delete-once");
        expect(post).not.toBeNull();
        expect(deletion).not.toBeNull();

        await expect(transport.dispatch(post!, record, capture)).resolves.toEqual({ ok: false, status: null });
        expect([...rejectedCallbackBytes!].every(byte => byte === 0)).toBe(true);
        await expect(transport.dispatch(post!, record, capture)).resolves.toEqual({ ok: false, status: null });
        await expect(transport.dispatch(deletion!, record, capture)).resolves.toEqual({ ok: false, status: null });
        expect([...rejectedCallbackBytes!].every(byte => byte === 0)).toBe(true);
        await expect(transport.dispatch(deletion!, record, capture)).resolves.toEqual({ ok: false, status: null });

        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(record).toHaveBeenCalledTimes(2);
        expect(capture).toHaveBeenCalledTimes(2);
        expect(transport.transcript).toEqual([
            expect.objectContaining({ method: "POST", status: 200, response_digest: expect.any(String) }),
            expect.objectContaining({ method: "DELETE", status: 200, response_digest: expect.any(String) }),
        ]);
    });

    it("keeps parser bytes isolated when a hostile capture transfers its callback buffer", async () => {
        const exactBody = '{"detached":true}';
        const fetchMock = vi.fn(
            async () => new Response(exactBody, { headers: { "content-type": "application/json" } })
        );
        const transport = createTransport(fetchMock as unknown as typeof globalThis.fetch);
        const prepared = await transport.prepare.forward.get("/detached-callback-copy");
        expect(prepared).not.toBeNull();
        let callerRetainedCopy: Uint8Array | undefined;

        await expect(
            transport.dispatch(
                prepared!,
                async () => undefined,
                async (_context, bytes) => {
                    callerRetainedCopy = structuredClone(bytes, { transfer: [bytes.buffer] });
                    expect(bytes.byteLength).toBe(0);
                }
            )
        ).resolves.toEqual({ ok: true, status: 200, json: { detached: true } });
        expect(new TextDecoder().decode(callerRetainedCopy)).toBe(exactBody);
        expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("captures bounded malformed JSON but not oversized or encoded responses", async () => {
        const malformed = "{not-json";
        const oversized = JSON.stringify("a".repeat(256 * 1024));
        const replies = [
            new Response(malformed, { headers: { "content-type": "application/json" } }),
            new Response(oversized, { headers: { "content-type": "application/json" } }),
            new Response("{}", {
                headers: { "content-type": "application/json", "content-encoding": "gzip" },
            }),
        ];
        const fetchMock = vi.fn(async () => replies.shift()!);
        const capture = vi.fn(async (_context, bytes: Uint8Array) => {
            expect(new TextDecoder().decode(bytes)).toBe(malformed);
        });
        const transport = createTransport(fetchMock as unknown as typeof globalThis.fetch);

        for (const path of ["/malformed", "/oversized", "/encoded"] as const) {
            const prepared = await transport.prepare.forward.get(path);
            expect(prepared).not.toBeNull();
            await expect(transport.dispatch(prepared!, async () => undefined, capture)).resolves.toEqual({
                ok: false,
                status: 200,
            });
        }

        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(capture).toHaveBeenCalledOnce();
        expect(transport.transcript[0]).toMatchObject({ status: 200, response_digest: await sha256Hex(malformed) });
        expect(transport.transcript[1]).toMatchObject({ status: null, response_digest: null });
        expect(transport.transcript[2]).toMatchObject({ status: null, response_digest: null });
    });

    it("rejects capture metadata that the response archive cannot represent without changing the legacy path", async () => {
        const contentType = `application/json; note=${"a".repeat(513)}`;
        const fetchMock = vi.fn(async () => new Response("{}", { headers: { "content-type": contentType } }));
        const transport = createTransport(fetchMock as unknown as typeof globalThis.fetch);
        const prepared = await transport.prepare.forward.get("/unrepresentable-content-type");
        expect(prepared).not.toBeNull();
        const capture = vi.fn(async () => undefined);

        await expect(transport.dispatch(prepared!, async () => undefined, capture)).resolves.toEqual({
            ok: false,
            status: 200,
        });
        await expect(transport.forward.get("/legacy-long-content-type")).resolves.toEqual({
            ok: true,
            status: 200,
            json: {},
        });
        expect(capture).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("rejects copied, forged, and foreign prepared capabilities", async () => {
        const fetchMock = vi.fn(async () => jsonResponse({ unexpected: true }));
        const record = vi.fn(async () => undefined);
        const transport = createTransport(fetchMock as unknown as typeof globalThis.fetch);
        const other = createTransport(fetchMock as unknown as typeof globalThis.fetch);
        const prepared = await transport.prepare.forward.post("/exact-path", { exact: "body" });
        expect(prepared).not.toBeNull();

        const copied = { ...prepared } as unknown as NonNullable<typeof prepared>;
        await expect(transport.dispatch(copied, record)).resolves.toEqual({ ok: false, status: null });
        await expect(transport.dispatch({} as NonNullable<typeof prepared>, record)).resolves.toEqual({
            ok: false,
            status: null,
        });
        await expect(other.dispatch(prepared!, record)).resolves.toEqual({ ok: false, status: null });
        expect(record).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("rechecks the clock after recording and spends no expired request timeout", async () => {
        const readings = [now, now + 10, window.expires_at_ms];
        const fetchMock = vi.fn();
        const transport = createTransport(fetchMock as unknown as typeof globalThis.fetch, () => readings.shift()!);
        const prepared = await transport.prepare.forward.get("/expires-during-record");
        expect(prepared).not.toBeNull();
        const record = vi.fn(async intent => {
            expect(intent.dispatch_started_at_ms).toBe(now + 10);
        });

        await expect(transport.dispatch(prepared!, record)).resolves.toEqual({ ok: false, status: null });
        expect(record).toHaveBeenCalledTimes(1);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("caps a prepared fetch timeout from the post-hook clock reading", async () => {
        const readings = [now, now + 100, now + 50_000, now + 50_001];
        const fetchMock = vi.fn(async () => jsonResponse({ bounded: true }));
        const timeoutSpy = vi.spyOn(AbortSignal, "timeout").mockReturnValue(new AbortController().signal);
        try {
            const transport = createTransport(fetchMock as unknown as typeof globalThis.fetch, () => readings.shift()!);
            const prepared = await transport.prepare.forward.get("/bounded-timeout");
            expect(prepared).not.toBeNull();

            await expect(transport.dispatch(prepared!, async () => undefined)).resolves.toMatchObject({
                ok: true,
                status: 200,
            });
            expect(timeoutSpy).toHaveBeenCalledOnce();
            expect(timeoutSpy).toHaveBeenCalledWith(10_000);
        } finally {
            timeoutSpy.mockRestore();
        }
    });

    it("returns a typed preparation failure when accepted statuses cannot be copied", async () => {
        const fetchMock = vi.fn();
        const transport = createTransport(fetchMock as unknown as typeof globalThis.fetch);
        const hostileStatuses = {
            [Symbol.iterator]() {
                throw new Error("iterator unavailable");
            },
        } as unknown as readonly number[];

        await expect(transport.prepare.forward.get("/hostile-statuses", hostileStatuses)).resolves.toBeNull();
        await expect(transport.forward.get("/legacy-hostile-statuses", hostileStatuses)).resolves.toEqual({
            ok: false,
            status: null,
        });
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("exposes narrow forward and cleanup methods over one redacted transcript", async () => {
        const replies = [
            jsonResponse({ listed: true }),
            jsonResponse({ created: true }),
            jsonResponse({ success: true, errors: [], messages: [] }),
            jsonResponse({ success: false, errors: [], messages: [] }, 404),
        ];
        const fetchMock = vi.fn(async () => replies.shift() ?? jsonResponse({ unexpected: true }, 500));
        const transport = createTransport(fetchMock as unknown as typeof globalThis.fetch);
        const body = { z: 1, a: "canonical" } satisfies CanonicalJsonValueV1;

        await expect(transport.forward.get("/forward-list")).resolves.toMatchObject({ ok: true, status: 200 });
        await expect(transport.forward.post("/forward-create", body)).resolves.toMatchObject({ ok: true, status: 200 });
        await expect(transport.cleanup.delete("/cleanup-delete")).resolves.toMatchObject({ ok: true, status: 200 });
        await expect(transport.cleanup.get("/cleanup-absence", [404])).resolves.toMatchObject({
            ok: true,
            status: 404,
        });

        const calls = fetchMock.mock.calls as unknown as Array<[string, RequestInit]>;
        expect(calls.map(([, init]) => init.method)).toEqual(["GET", "POST", "DELETE", "GET"]);
        expect(calls.map(([, init]) => init.redirect)).toEqual(["manual", "manual", "manual", "manual"]);
        expect(calls.every(([, init]) => init.signal instanceof AbortSignal)).toBe(true);
        expect(new Headers(calls[1]?.[1].headers).get("Accept-Encoding")).toBe("identity");
        expect(new Headers(calls[1]?.[1].headers).get("Authorization")).toBe(`Bearer ${token}`);
        expect(calls[1]?.[1].body).toBe(canonicalizeJsonV1(body));

        expect(transport.transcript.map(entry => [entry.sequence, entry.method, entry.status])).toEqual([
            [1, "GET", 200],
            [2, "POST", 200],
            [3, "DELETE", 200],
            [4, "GET", 404],
        ]);
        const expectedPostDigest = await digestCanonicalJsonV1(
            "openbot.d1-probe.cloudflare-worker-api-canary-request.v1",
            {
                method: "POST",
                path: "/forward-create",
                body: canonicalizeJsonV1(body),
            }
        );
        expect(transport.transcript[1]?.request_digest).toBe(expectedPostDigest);
        expect(transport.transcript.every(entry => /^[0-9a-f]{64}$/u.test(entry.path_digest))).toBe(true);
        expect(transport.transcript.every(entry => /^[0-9a-f]{64}$/u.test(entry.response_digest ?? ""))).toBe(true);
        const serialized = JSON.stringify(transport.transcript);
        expect(serialized).not.toContain(token);
        expect(serialized).not.toContain("/forward-create");
        expect(serialized).not.toContain("canonical");
    });

    it("shares one fixed aggregate response budget across forward and cleanup capabilities", async () => {
        const maximumJson = JSON.stringify("a".repeat(256 * 1024 - 2));
        expect(new TextEncoder().encode(maximumJson)).toHaveLength(256 * 1024);
        const fetchMock = vi.fn(
            async () => new Response(maximumJson, { headers: { "content-type": "application/json" } })
        );
        const transport = createTransport(fetchMock as unknown as typeof globalThis.fetch);

        for (let index = 0; index < 8; index += 1) {
            await expect(transport.forward.get(`/page-${index}`)).resolves.toMatchObject({ ok: true });
        }
        await expect(transport.cleanup.get("/cleanup-over-budget")).resolves.toEqual({ ok: false, status: 200 });
        expect(fetchMock).toHaveBeenCalledTimes(9);
        expect(transport.transcript).toHaveLength(9);
    });

    it("bounds each response and rejects redirects or content encoding before parsing", async () => {
        const oversized = JSON.stringify("a".repeat(256 * 1024));
        const replies: Array<Response | Record<string, unknown>> = [
            new Response(oversized, { headers: { "content-type": "application/json" } }),
            new Response("{}", {
                headers: { "content-type": "application/json", "content-encoding": "gzip" },
            }),
            {
                type: "opaqueredirect",
                status: 0,
                headers: new Headers({ "content-type": "application/json" }),
                body: new Response("{}").body,
            },
        ];
        const fetchMock = vi.fn(async () => replies.shift() as Response);
        const transport = createTransport(fetchMock as unknown as typeof globalThis.fetch);

        await expect(transport.forward.get("/oversized")).resolves.toEqual({ ok: false, status: 200 });
        await expect(transport.forward.get("/encoded")).resolves.toEqual({ ok: false, status: 200 });
        await expect(transport.cleanup.get("/redirect")).resolves.toEqual({ ok: false, status: 0 });
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    it("enforces its fixed deadline and never retries a failed dispatch", async () => {
        const failingFetch = vi.fn(async () => {
            throw new Error("ambiguous network failure");
        });
        const active = createTransport(failingFetch as unknown as typeof globalThis.fetch);
        await expect(active.forward.post("/mutate-once", { value: true })).resolves.toEqual({
            ok: false,
            status: null,
        });
        await expect(active.cleanup.delete("/delete-once")).resolves.toEqual({ ok: false, status: null });
        expect(failingFetch).toHaveBeenCalledTimes(2);
        expect(active.transcript).toHaveLength(2);
        expect(active.transcript[0]).toMatchObject({ method: "POST", response_digest: null, status: null });
        expect(active.transcript[1]).toMatchObject({ method: "DELETE", response_digest: null, status: null });

        const expiredFetch = vi.fn();
        const expired = createTransport(expiredFetch as unknown as typeof globalThis.fetch, () => window.expires_at_ms);
        await expect(expired.cleanup.delete("/expired-delete")).resolves.toEqual({ ok: false, status: null });
        expect(expiredFetch).not.toHaveBeenCalled();
        expect(expired.transcript).toHaveLength(0);
    });

    it("returns a typed transport failure when the injected clock throws", async () => {
        const fetchMock = vi.fn();
        const transport = createTransport(fetchMock as unknown as typeof globalThis.fetch, () => {
            throw new Error("clock unavailable");
        });
        await expect(transport.forward.get("/clock-failure")).resolves.toEqual({ ok: false, status: null });
        expect(fetchMock).not.toHaveBeenCalled();
        expect(transport.transcript).toEqual([]);
    });

    it("keeps the legacy clock and transcript vector unchanged without a capture hook", async () => {
        const path = "/legacy-vector";
        const responseBody = canonicalizeJsonV1({ legacy: true });
        const readings = [now, now + 25];
        const clock = vi.fn(() => readings.shift()!);
        const fetchMock = vi.fn(
            async () => new Response(responseBody, { headers: { "content-type": "application/json" } })
        );
        const transport = createTransport(fetchMock as unknown as typeof globalThis.fetch, clock);

        await expect(transport.forward.get(path)).resolves.toEqual({
            ok: true,
            status: 200,
            json: { legacy: true },
        });
        expect(clock).toHaveBeenCalledTimes(2);
        expect(transport.transcript).toEqual([
            {
                sequence: 1,
                method: "GET",
                path_digest: await sha256Hex(path),
                request_digest: await digestCanonicalJsonV1(
                    "openbot.d1-probe.cloudflare-worker-api-canary-request.v1",
                    { method: "GET", path }
                ),
                response_digest: await sha256Hex(responseBody),
                status: 200,
                observed_at_ms: now + 25,
            },
        ]);
    });

    it("does not expose an untranscribed response status when the post-response clock fails", async () => {
        let clockReads = 0;
        const fetchMock = vi.fn(async () => jsonResponse({ rejected: true }, 409));
        const transport = createTransport(fetchMock as unknown as typeof globalThis.fetch, () => {
            clockReads += 1;
            if (clockReads === 2) throw new Error("post-response clock unavailable");
            return now;
        });
        await expect(transport.forward.post("/clock-failure-after-dispatch", { value: true })).resolves.toEqual({
            ok: false,
            status: null,
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(clockReads).toBe(2);
        expect(transport.transcript).toEqual([
            expect.objectContaining({ method: "POST", response_digest: null, status: null }),
        ]);
    });
});
