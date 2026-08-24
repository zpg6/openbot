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

const preparedDispatchBrandV1: unique symbol = Symbol("openbot.cloudflare-worker-canary.prepared-dispatch.v1");

export interface D1ProbeCloudflareWorkerCanaryPreparedDispatchV1 {
    readonly [preparedDispatchBrandV1]: true;
}

export interface D1ProbeCloudflareWorkerCanaryDispatchIntentV1 {
    readonly sequence: number;
    readonly method: "GET" | "POST" | "DELETE";
    readonly path_digest: string;
    readonly request_digest: string;
    readonly window_class: "forward" | "cleanup";
    readonly intent_observed_at_ms: number;
    readonly dispatch_started_at_ms: number;
}

// This caller-supplied ordering hook cannot prove that its return reflects durable or authentic storage.
export type D1ProbeCloudflareWorkerCanaryRecordDispatchV1 = (
    intent: D1ProbeCloudflareWorkerCanaryDispatchIntentV1
) => Promise<void>;

type PrepareGetV1 = (
    path: string,
    acceptedStatuses?: readonly number[]
) => Promise<D1ProbeCloudflareWorkerCanaryPreparedDispatchV1 | null>;
type PreparePostV1 = (
    path: string,
    body: CanonicalJsonValueV1,
    acceptedStatuses?: readonly number[]
) => Promise<D1ProbeCloudflareWorkerCanaryPreparedDispatchV1 | null>;
type PrepareDeleteV1 = (
    path: string,
    acceptedStatuses?: readonly number[]
) => Promise<D1ProbeCloudflareWorkerCanaryPreparedDispatchV1 | null>;

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
    readonly prepare: {
        readonly forward: { readonly get: PrepareGetV1; readonly post: PreparePostV1 };
        readonly cleanup: { readonly get: PrepareGetV1; readonly delete: PrepareDeleteV1 };
    };
    readonly dispatch: (
        prepared: D1ProbeCloudflareWorkerCanaryPreparedDispatchV1,
        recordIntentAndStarted: D1ProbeCloudflareWorkerCanaryRecordDispatchV1
    ) => Promise<D1ProbeCloudflareWorkerCanaryJsonResponseV1>;
    readonly forward: { readonly get: GetV1; readonly post: PostV1 };
    readonly cleanup: { readonly get: GetV1; readonly delete: DeleteV1 };
}

interface PreparedDispatchStateV1 {
    readonly method: "GET" | "POST" | "DELETE";
    readonly path: string;
    readonly path_digest: string;
    readonly request_digest: string;
    readonly body: string | undefined;
    readonly accepted_statuses: readonly number[];
    readonly window: D1ProbeCloudflareWorkerCanaryTransportWindowV1;
    readonly window_class: "forward" | "cleanup";
    readonly intent_observed_at_ms: number;
    consumed: boolean;
}

const arrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

const toHex = (value: ArrayBuffer): string =>
    [...new Uint8Array(value)].map(byte => byte.toString(16).padStart(2, "0")).join("");

const sha256 = async (bytes: Uint8Array): Promise<string> =>
    toHex(await globalThis.crypto.subtle.digest("SHA-256", arrayBuffer(bytes)));

const canonicalRequest = (method: string, path: string, body?: string) => ({
    method,
    path,
    ...(body === undefined ? {} : { body }),
});

const insideWindow = (value: number, window: D1ProbeCloudflareWorkerCanaryTransportWindowV1): boolean =>
    Number.isSafeInteger(value) && value >= window.not_before_ms && value < window.expires_at_ms;

export const createD1ProbeCloudflareWorkerCanaryTransportV1 = (
    dependencies: D1ProbeCloudflareWorkerCanaryTransportDependenciesV1
): D1ProbeCloudflareWorkerCanaryTransportV1 => {
    const transcript: D1ProbeCloudflareWorkerCanaryTranscriptEntryV1[] = [];
    const preparedDispatches = new WeakMap<D1ProbeCloudflareWorkerCanaryPreparedDispatchV1, PreparedDispatchStateV1>();
    let aggregateBytes = 0;

    const readClock = (): number | null => {
        try {
            const value = dependencies.now();
            return Number.isSafeInteger(value) ? value : null;
        } catch {
            return null;
        }
    };

    const prepareRequest = async (
        method: "GET" | "POST" | "DELETE",
        path: string,
        window: D1ProbeCloudflareWorkerCanaryTransportWindowV1,
        body?: CanonicalJsonValueV1,
        acceptedStatuses: readonly number[] = [200],
        legacyObservedAt?: number,
        windowClass: "forward" | "cleanup" = "forward"
    ): Promise<D1ProbeCloudflareWorkerCanaryPreparedDispatchV1 | null> => {
        let requestDigest: string | null;
        let pathDigest: string;
        let canonicalBody: string | undefined;
        let copiedAcceptedStatuses: readonly number[];
        try {
            canonicalBody = body === undefined ? undefined : canonicalizeJsonV1(body);
            const requestProjection = canonicalRequest(method, path, canonicalBody);
            requestDigest = await digestCanonicalJsonV1(
                REQUEST_DIGEST_DOMAIN_V1,
                requestProjection as CanonicalJsonValueV1
            );
            pathDigest = await sha256(new TextEncoder().encode(path));
            copiedAcceptedStatuses = Object.freeze([...acceptedStatuses]);
        } catch {
            return null;
        }
        if (requestDigest === null) return null;
        const observedAt = legacyObservedAt ?? readClock();
        if (observedAt === null || !insideWindow(observedAt, window)) return null;
        const prepared = Object.freeze({
            [preparedDispatchBrandV1]: true as const,
        });
        preparedDispatches.set(prepared, {
            method,
            path,
            path_digest: pathDigest,
            request_digest: requestDigest,
            body: canonicalBody,
            accepted_statuses: copiedAcceptedStatuses,
            window,
            window_class: windowClass,
            intent_observed_at_ms: observedAt,
            consumed: false,
        });
        return prepared;
    };

    const dispatchPrepared = async (
        prepared: D1ProbeCloudflareWorkerCanaryPreparedDispatchV1,
        recordIntentAndStarted: D1ProbeCloudflareWorkerCanaryRecordDispatchV1,
        legacyObservedAt?: number
    ): Promise<D1ProbeCloudflareWorkerCanaryJsonResponseV1> => {
        const state = preparedDispatches.get(prepared);
        if (state === undefined || state.consumed) return { ok: false, status: null };
        state.consumed = true;
        const dispatchStartedAt = legacyObservedAt ?? readClock();
        if (dispatchStartedAt === null || !insideWindow(dispatchStartedAt, state.window)) {
            return { ok: false, status: null };
        }
        const entry: D1ProbeCloudflareWorkerCanaryTranscriptEntryV1 = {
            sequence: transcript.length + 1,
            method: state.method,
            path_digest: state.path_digest,
            request_digest: state.request_digest,
            response_digest: null,
            status: null,
            observed_at_ms: dispatchStartedAt,
        };
        const transcriptIndex = transcript.push(entry) - 1;
        const intent = Object.freeze({
            sequence: entry.sequence,
            method: state.method,
            path_digest: state.path_digest,
            request_digest: state.request_digest,
            window_class: state.window_class,
            intent_observed_at_ms: state.intent_observed_at_ms,
            dispatch_started_at_ms: dispatchStartedAt,
        });
        try {
            await recordIntentAndStarted(intent);
            const fetchObservedAt = legacyObservedAt ?? readClock();
            if (fetchObservedAt === null || !insideWindow(fetchObservedAt, state.window)) {
                return { ok: false, status: null };
            }
            const remainingMs = state.window.expires_at_ms - fetchObservedAt;
            if (remainingMs <= 0) return { ok: false, status: null };
            const response = await dependencies.fetch(`${API_ROOT_V1}${state.path}`, {
                method: state.method,
                redirect: "manual",
                signal: AbortSignal.timeout(Math.max(1, Math.min(MAX_REQUEST_DURATION_MS_V1, remainingMs))),
                headers: {
                    Accept: "application/json",
                    "Accept-Encoding": "identity",
                    Authorization: `Bearer ${dependencies.api_token}`,
                    ...(state.body === undefined ? {} : { "Content-Type": "application/json" }),
                },
                ...(state.body === undefined ? {} : { body: state.body }),
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
                !insideWindow(responseObservedAt, state.window) ||
                aggregateBytes > MAX_AGGREGATE_RESPONSE_BYTES_V1 ||
                !state.accepted_statuses.includes(response.status)
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

    const requestJson = async (
        method: "GET" | "POST" | "DELETE",
        path: string,
        window: D1ProbeCloudflareWorkerCanaryTransportWindowV1,
        body?: CanonicalJsonValueV1,
        acceptedStatuses: readonly number[] = [200]
    ): Promise<D1ProbeCloudflareWorkerCanaryJsonResponseV1> => {
        const observedAt = readClock();
        if (observedAt === null || !insideWindow(observedAt, window)) return { ok: false, status: null };
        const windowClass = window === dependencies.cleanup_window ? "cleanup" : "forward";
        const prepared = await prepareRequest(method, path, window, body, acceptedStatuses, observedAt, windowClass);
        if (prepared === null) return { ok: false, status: null };
        // The existing runner records nothing here. This adapter grants no persistence or dispatch authority.
        const legacyOrderingAdapter: D1ProbeCloudflareWorkerCanaryRecordDispatchV1 = async () => undefined;
        return await dispatchPrepared(prepared, legacyOrderingAdapter, observedAt);
    };

    return {
        transcript,
        prepare: {
            forward: {
                get: async (path, acceptedStatuses) =>
                    await prepareRequest("GET", path, dependencies.forward_window, undefined, acceptedStatuses),
                post: async (path, body, acceptedStatuses) =>
                    await prepareRequest("POST", path, dependencies.forward_window, body, acceptedStatuses),
            },
            cleanup: {
                get: async (path, acceptedStatuses) =>
                    await prepareRequest(
                        "GET",
                        path,
                        dependencies.cleanup_window,
                        undefined,
                        acceptedStatuses,
                        undefined,
                        "cleanup"
                    ),
                delete: async (path, acceptedStatuses) =>
                    await prepareRequest(
                        "DELETE",
                        path,
                        dependencies.cleanup_window,
                        undefined,
                        acceptedStatuses,
                        undefined,
                        "cleanup"
                    ),
            },
        },
        dispatch: async (prepared, recordIntentAndStarted) => await dispatchPrepared(prepared, recordIntentAndStarted),
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
