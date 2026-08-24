import {
    canonicalizeJsonV1,
    digestCanonicalJsonV1,
    type CanonicalJsonValueV1,
} from "@openbot/gate-attestation/internal";

const API_ROOT_V1 = "https://api.cloudflare.com/client/v4";
const REQUEST_DIGEST_DOMAIN_V1 = "openbot.d1-probe.cloudflare-worker-api-canary-request.v1";
const MAX_RESPONSE_BYTES_V1 = 256 * 1024;
const MAX_AGGREGATE_RESPONSE_BYTES_V1 = 2 * 1024 * 1024;
const MAX_REQUEST_DURATION_MS_V1 = 20_000;

export interface D1ProbeCloudflareWorkerCanaryTranscriptEntryV1 {
    readonly sequence: number;
    readonly method: "GET" | "POST" | "DELETE";
    readonly path_digest: string;
    readonly request_digest: string;
    readonly response_digest: string | null;
    readonly status: number | null;
    readonly observed_at_ms: number;
}

export type D1ProbeCloudflareWorkerCanaryJsonResponseV1 =
    | { readonly ok: false; readonly status: number | null }
    | { readonly ok: true; readonly status: number; readonly json: unknown };

export interface D1ProbeCloudflareWorkerCanaryTransportWindowV1 {
    readonly not_before_ms: number;
    readonly expires_at_ms: number;
}

export interface D1ProbeCloudflareWorkerCanaryTransportDependenciesV1 {
    readonly api_token: string;
    readonly fetch: typeof globalThis.fetch;
    readonly now: () => number;
    readonly forward_window: D1ProbeCloudflareWorkerCanaryTransportWindowV1;
    readonly cleanup_window: D1ProbeCloudflareWorkerCanaryTransportWindowV1;
}

type GetV1 = (
    path: string,
    acceptedStatuses?: readonly number[]
) => Promise<D1ProbeCloudflareWorkerCanaryJsonResponseV1>;
type PostV1 = (
    path: string,
    body: CanonicalJsonValueV1,
    acceptedStatuses?: readonly number[]
) => Promise<D1ProbeCloudflareWorkerCanaryJsonResponseV1>;
type DeleteV1 = (
    path: string,
    acceptedStatuses?: readonly number[]
) => Promise<D1ProbeCloudflareWorkerCanaryJsonResponseV1>;

export interface D1ProbeCloudflareWorkerCanaryTransportV1 {
    readonly transcript: readonly D1ProbeCloudflareWorkerCanaryTranscriptEntryV1[];
    readonly forward: { readonly get: GetV1; readonly post: PostV1 };
    readonly cleanup: { readonly get: GetV1; readonly delete: DeleteV1 };
}

const arrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const toHex = (value: ArrayBuffer): string =>
    [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");

const sha256 = async (bytes: Uint8Array): Promise<string> =>
    toHex(await globalThis.crypto.subtle.digest("SHA-256", arrayBuffer(bytes)));

const canonicalRequest = (method: string, path: string, body?: CanonicalJsonValueV1) => ({
    method,
    path,
    ...(body === undefined ? {} : { body: canonicalizeJsonV1(body) }),
});

const insideWindow = (value: number, window: D1ProbeCloudflareWorkerCanaryTransportWindowV1): boolean =>
    Number.isSafeInteger(value) && value >= window.not_before_ms && value < window.expires_at_ms;

export const createD1ProbeCloudflareWorkerCanaryTransportV1 = (
    dependencies: D1ProbeCloudflareWorkerCanaryTransportDependenciesV1
): D1ProbeCloudflareWorkerCanaryTransportV1 => {
    const transcript: D1ProbeCloudflareWorkerCanaryTranscriptEntryV1[] = [];
    let aggregateBytes = 0;

    const readClock = (): number | null => {
        try {
            const value = dependencies.now();
            return Number.isSafeInteger(value) ? value : null;
        } catch {
            return null;
        }
    };

    const requestJson = async (
        method: "GET" | "POST" | "DELETE",
        path: string,
        window: D1ProbeCloudflareWorkerCanaryTransportWindowV1,
        body?: CanonicalJsonValueV1,
        acceptedStatuses: readonly number[] = [200]
    ): Promise<D1ProbeCloudflareWorkerCanaryJsonResponseV1> => {
        const observedAt = readClock();
        if (observedAt === null || !insideWindow(observedAt, window)) return { ok: false, status: null };
        let requestDigest: string | null;
        let pathDigest: string;
        try {
            const requestProjection = canonicalRequest(method, path, body);
            requestDigest = await digestCanonicalJsonV1(
                REQUEST_DIGEST_DOMAIN_V1,
                requestProjection as CanonicalJsonValueV1
            );
            pathDigest = await sha256(new TextEncoder().encode(path));
        } catch {
            return { ok: false, status: null };
        }
        if (requestDigest === null) return { ok: false, status: null };
        const entry: D1ProbeCloudflareWorkerCanaryTranscriptEntryV1 = {
            sequence: transcript.length + 1,
            method,
            path_digest: pathDigest,
            request_digest: requestDigest,
            response_digest: null,
            status: null,
            observed_at_ms: observedAt,
        };
        const transcriptIndex = transcript.push(entry) - 1;
        try {
            const remainingMs = window.expires_at_ms - observedAt;
            if (remainingMs <= 0) return { ok: false, status: null };
            const response = await dependencies.fetch(`${API_ROOT_V1}${path}`, {
                method,
                redirect: "manual",
                signal: AbortSignal.timeout(Math.max(1, Math.min(MAX_REQUEST_DURATION_MS_V1, remainingMs))),
                headers: {
                    Accept: "application/json",
                    "Accept-Encoding": "identity",
                    Authorization: `Bearer ${dependencies.api_token}`,
                    ...(body === undefined ? {} : { "Content-Type": "application/json" }),
                },
                ...(body === undefined ? {} : { body: canonicalizeJsonV1(body) }),
            });
            const encoding = response.headers.get("content-encoding");
            const contentType = response.headers.get("content-type") ?? "";
            if (response.type === "opaqueredirect" || (encoding !== null && encoding !== "identity")) {
                return { ok: false, status: response.status };
            }
            const declaredLength = response.headers.get("content-length");
            if (
                declaredLength !== null &&
                (!/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES_V1)
            ) {
                return { ok: false, status: response.status };
            }
            const reader = response.body?.getReader();
            if (reader === undefined) return { ok: false, status: response.status };
            const chunks: Uint8Array[] = [];
            let responseSize = 0;
            for (;;) {
                const chunk = await reader.read();
                if (chunk.done) break;
                responseSize += chunk.value.byteLength;
                if (responseSize > MAX_RESPONSE_BYTES_V1) {
                    await reader.cancel().catch(() => undefined);
                    return { ok: false, status: response.status };
                }
                chunks.push(chunk.value);
            }
            const bytes = new Uint8Array(responseSize);
            let offset = 0;
            for (const chunk of chunks) {
                bytes.set(chunk, offset);
                offset += chunk.byteLength;
            }
            aggregateBytes += bytes.byteLength;
            const responseObservedAt = readClock();
            if (responseObservedAt === null) return { ok: false, status: null };
            transcript[transcriptIndex] = {
                ...entry,
                response_digest: await sha256(bytes),
                status: response.status,
                observed_at_ms: responseObservedAt,
            };
            if (
                !insideWindow(responseObservedAt, window) ||
                aggregateBytes > MAX_AGGREGATE_RESPONSE_BYTES_V1 ||
                !acceptedStatuses.includes(response.status)
            ) {
                return { ok: false, status: response.status };
            }
            if (!contentType.toLowerCase().startsWith("application/json")) {
                return { ok: false, status: response.status };
            }
            try {
                return {
                    ok: true,
                    status: response.status,
                    json: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown,
                };
            } catch {
                return { ok: false, status: response.status };
            }
        } catch {
            return { ok: false, status: null };
        }
    };

    return {
        transcript,
        forward: {
            get: async (path, acceptedStatuses) =>
                await requestJson("GET", path, dependencies.forward_window, undefined, acceptedStatuses),
            post: async (path, body, acceptedStatuses) =>
                await requestJson("POST", path, dependencies.forward_window, body, acceptedStatuses),
        },
        cleanup: {
            get: async (path, acceptedStatuses) =>
                await requestJson("GET", path, dependencies.cleanup_window, undefined, acceptedStatuses),
            delete: async (path, acceptedStatuses) =>
                await requestJson("DELETE", path, dependencies.cleanup_window, undefined, acceptedStatuses),
        },
    };
};
