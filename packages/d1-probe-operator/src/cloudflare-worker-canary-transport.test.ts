import {
    canonicalizeJsonV1,
    digestCanonicalJsonV1,
    type CanonicalJsonValueV1,
} from "@openbot/gate-attestation/internal";
import { describe, expect, it, vi } from "vitest";

import { createD1ProbeCloudflareWorkerCanaryTransportV1 } from "./cloudflare-worker-canary-transport.js";

const token = "x".repeat(32);
const now = Date.parse("2026-08-24T15:00:00.000Z");
const window = { not_before_ms: now - 1, expires_at_ms: now + 60_000 };

const jsonResponse = (body: unknown, status = 200, headers: Record<string, string> = {}): Response =>
    new Response(canonicalizeJsonV1(body as CanonicalJsonValueV1), {
        status,
        headers: { "content-type": "application/json", ...headers },
    });

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
