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
        expect(failingFetch).toHaveBeenCalledTimes(1);
        expect(active.transcript).toHaveLength(1);
        expect(active.transcript[0]).toMatchObject({ method: "POST", response_digest: null, status: null });

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
        expect(transport.transcript).toEqual([
            expect.objectContaining({ method: "POST", response_digest: null, status: null }),
        ]);
    });
});
