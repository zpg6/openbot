import { z } from "zod";

import {
    inspectD1ProbeRouteReadbackV1,
    type InspectD1ProbeRouteReadbackDenialV1,
    type UntrustedD1ProbeRouteInspectionV1,
} from "./route-precheck.js";
import { resolveVerifiedD1ProbePreflightV1, type VerifiedD1ProbePreflightV1 } from "./verified-preflight.js";

const CLOUDFLARE_API_ORIGIN_V1 = "https://api.cloudflare.com";
const CLOUDFLARE_API_PREFIX_V1 = "/client/v4";
const CLOUDFLARE_RESPONSE_LIMIT_BYTES_V1 = 262_144;
const CLOUDFLARE_AGGREGATE_LIMIT_BYTES_V1 = 1_048_576;
const CLOUDFLARE_TOTAL_TIMEOUT_MS_V1 = 20_000;
const CLOUDFLARE_DNS_PER_PAGE_V1 = 1000;
export const D1_PROBE_ROUTE_OBSERVATION_MAX_AGE_MS_V1 = 300_000;

const CloudflareIdentifierV1Schema = z.string().regex(/^[0-9a-f]{32}$/u);
const CloudflareApiTokenV1Schema = z
    .object({
        api_token: z.string().regex(/^[A-Za-z0-9_-]{20,256}$/u),
    })
    .strict();

const CloudflareResponseInfoV1Schema = z
    .object({
        code: z.number().int(),
        message: z.string(),
    })
    .passthrough();

const CloudflareZoneResponseV1Schema = z
    .object({
        success: z.literal(true),
        errors: z.array(CloudflareResponseInfoV1Schema).length(0),
        result: z
            .object({
                id: CloudflareIdentifierV1Schema,
                account: z.object({ id: CloudflareIdentifierV1Schema }).passthrough(),
                name: z.string(),
                status: z.enum(["initializing", "pending", "active", "moved"]),
                type: z.enum(["full", "partial", "secondary", "internal"]),
                paused: z.boolean(),
            })
            .passthrough(),
    })
    .passthrough();

const CloudflareDnsResponseV1Schema = z
    .object({
        success: z.literal(true),
        errors: z.array(CloudflareResponseInfoV1Schema).length(0),
        result: z
            .array(
                z
                    .object({
                        id: CloudflareIdentifierV1Schema,
                        name: z.string(),
                        type: z.enum(["A", "AAAA", "CNAME"]),
                        proxiable: z.boolean(),
                        proxied: z.boolean(),
                    })
                    .passthrough()
            )
            .max(64),
        result_info: z
            .object({
                count: z.number().int().min(0),
                page: z.number().int().min(1),
                per_page: z.number().int().min(1),
                total_count: z.number().int().min(0),
                total_pages: z.number().int().min(1),
            })
            .passthrough(),
    })
    .passthrough();

export interface D1ProbeCloudflareRouteReaderDependenciesV1 {
    readonly fetch: typeof globalThis.fetch;
}

export interface ObservedD1ProbeCloudflareRouteV1 {
    readonly schema_version: 1;
    readonly kind: "observed_d1_probe_cloudflare_route";
}

interface ObservedD1ProbeCloudflareRouteContextV1 {
    readonly verified_preflight: VerifiedD1ProbePreflightV1;
    readonly observed_at_ms: number;
}

const observedRoutes = new WeakMap<ObservedD1ProbeCloudflareRouteV1, ObservedD1ProbeCloudflareRouteContextV1>();

export const resolveObservedD1ProbeCloudflareRouteV1 = (
    observed: ObservedD1ProbeCloudflareRouteV1
): ObservedD1ProbeCloudflareRouteContextV1 | null => observedRoutes.get(observed) ?? null;

export type ReadD1ProbeCloudflareRouteDenialV1 =
    | InspectD1ProbeRouteReadbackDenialV1
    | "invalid_api_token"
    | "cloudflare_request_failed"
    | "cloudflare_response_invalid"
    | "cloudflare_response_too_large";

type BoundedResponse = Readonly<{ value: unknown; byte_count: number }>;

const cancelResponseBody = async (response: Response, reason: string): Promise<void> => {
    try {
        await response.body?.cancel(reason);
    } catch {
        // The response is already unusable. Cancellation is best-effort cleanup only.
    }
};

const parseCredential = (input: unknown): z.infer<typeof CloudflareApiTokenV1Schema> | null => {
    try {
        const parsed = CloudflareApiTokenV1Schema.safeParse(input);
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
};

const readBoundedJson = async (response: Response): Promise<BoundedResponse | "invalid" | "too_large"> => {
    if (response.status !== 200 || response.redirected || response.body === null) {
        await cancelResponseBody(response, "Cloudflare response status was invalid");
        return "invalid";
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/u.test(contentType)) {
        await cancelResponseBody(response, "Cloudflare response content type was invalid");
        return "invalid";
    }
    const contentEncoding = response.headers.get("content-encoding")?.toLowerCase();
    if (contentEncoding !== undefined && contentEncoding !== "identity") {
        await cancelResponseBody(response, "Cloudflare response content encoding was invalid");
        return "invalid";
    }

    const declared = response.headers.get("content-length");
    let declaredLength: number | null = null;
    if (declared !== null) {
        if (!/^(?:0|[1-9][0-9]{0,6})$/u.test(declared)) {
            await cancelResponseBody(response, "Cloudflare response content length was invalid");
            return "invalid";
        }
        declaredLength = Number(declared);
        if (!Number.isSafeInteger(declaredLength)) {
            await cancelResponseBody(response, "Cloudflare response content length was invalid");
            return "invalid";
        }
        if (declaredLength > CLOUDFLARE_RESPONSE_LIMIT_BYTES_V1) {
            await cancelResponseBody(response, "Cloudflare response exceeded its declared byte limit");
            return "too_large";
        }
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const part = await reader.read();
            if (part.done) break;
            total += part.value.byteLength;
            if (total > CLOUDFLARE_RESPONSE_LIMIT_BYTES_V1) {
                await reader.cancel("Cloudflare response exceeded its byte limit");
                return "too_large";
            }
            chunks.push(part.value);
        }
    } catch {
        return "invalid";
    } finally {
        reader.releaseLock();
    }
    if (declaredLength !== null && declaredLength !== total) return "invalid";

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    let text: string;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        return "invalid";
    }
    try {
        return { value: JSON.parse(text) as unknown, byte_count: total };
    } catch {
        return "invalid";
    }
};

const fetchCloudflareJson = async (
    url: string,
    apiToken: string,
    signal: AbortSignal,
    dependencies: D1ProbeCloudflareRouteReaderDependenciesV1
): Promise<BoundedResponse | "request_failed" | "invalid" | "too_large"> => {
    try {
        const response = await dependencies.fetch(url, {
            method: "GET",
            headers: {
                accept: "application/json",
                "accept-encoding": "identity",
                authorization: `Bearer ${apiToken}`,
            },
            cache: "no-store",
            credentials: "omit",
            redirect: "manual",
            signal,
        });
        return await readBoundedJson(response);
    } catch {
        return "request_failed";
    }
};

const mapReadFailure = (
    result: "request_failed" | "invalid" | "too_large"
): Readonly<{ success: false; code: ReadD1ProbeCloudflareRouteDenialV1 }> => ({
    success: false,
    code:
        result === "request_failed"
            ? "cloudflare_request_failed"
            : result === "too_large"
              ? "cloudflare_response_too_large"
              : "cloudflare_response_invalid",
});

export const readD1ProbeCloudflareRouteV1 = async (
    verifiedPreflight: VerifiedD1ProbePreflightV1,
    credentialInput: unknown,
    dependencies: D1ProbeCloudflareRouteReaderDependenciesV1 = { fetch: globalThis.fetch }
): Promise<
    | Readonly<{
          success: true;
          inspection: UntrustedD1ProbeRouteInspectionV1;
          observed: ObservedD1ProbeCloudflareRouteV1;
      }>
    | Readonly<{ success: false; code: ReadD1ProbeCloudflareRouteDenialV1 }>
> => {
    const context = resolveVerifiedD1ProbePreflightV1(verifiedPreflight);
    if (context === null) return { success: false, code: "invalid_verified_preflight" };
    const credential = parseCredential(credentialInput);
    if (credential === null) return { success: false, code: "invalid_api_token" };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLOUDFLARE_TOTAL_TIMEOUT_MS_V1);
    try {
        const zoneUrl = `${CLOUDFLARE_API_ORIGIN_V1}${CLOUDFLARE_API_PREFIX_V1}/zones/${context.request.zone_id}`;
        const zoneResponse = await fetchCloudflareJson(zoneUrl, credential.api_token, controller.signal, dependencies);
        if (typeof zoneResponse === "string") return mapReadFailure(zoneResponse);
        const parsedZone = CloudflareZoneResponseV1Schema.safeParse(zoneResponse.value);
        if (!parsedZone.success) return { success: false, code: "cloudflare_response_invalid" };

        const hostname = new URL(context.request.probe_origin).hostname;
        const dnsPages: Array<{
            page: number;
            per_page: 1000;
            count: number;
            total_count: number;
            total_pages: number;
            records: Array<{
                id: string;
                name: string;
                type: "A" | "AAAA" | "CNAME";
                proxiable: boolean;
                proxied: boolean;
            }>;
        }> = [];
        let aggregateBytes = zoneResponse.byte_count;
        let nextPage = 1;
        let expectedTotalPages: number | null = null;
        while (expectedTotalPages === null || nextPage <= expectedTotalPages) {
            if (nextPage > 64) return { success: false, code: "cloudflare_response_too_large" };
            const query = new URLSearchParams({
                match: "all",
                "name.exact": hostname,
                page: String(nextPage),
                per_page: String(CLOUDFLARE_DNS_PER_PAGE_V1),
                proxied: "true",
            });
            const dnsUrl = `${CLOUDFLARE_API_ORIGIN_V1}${CLOUDFLARE_API_PREFIX_V1}/zones/${context.request.zone_id}/dns_records?${query.toString()}`;
            const dnsResponse = await fetchCloudflareJson(
                dnsUrl,
                credential.api_token,
                controller.signal,
                dependencies
            );
            if (typeof dnsResponse === "string") return mapReadFailure(dnsResponse);
            aggregateBytes += dnsResponse.byte_count;
            if (aggregateBytes > CLOUDFLARE_AGGREGATE_LIMIT_BYTES_V1) {
                return { success: false, code: "cloudflare_response_too_large" };
            }
            const parsedDns = CloudflareDnsResponseV1Schema.safeParse(dnsResponse.value);
            if (!parsedDns.success) return { success: false, code: "cloudflare_response_invalid" };
            const resultInfo = parsedDns.data.result_info;
            if (
                resultInfo.page !== nextPage ||
                resultInfo.per_page !== CLOUDFLARE_DNS_PER_PAGE_V1 ||
                resultInfo.count !== parsedDns.data.result.length ||
                resultInfo.total_pages > 64 ||
                (expectedTotalPages !== null && resultInfo.total_pages !== expectedTotalPages)
            ) {
                return { success: false, code: "cloudflare_response_invalid" };
            }
            expectedTotalPages = resultInfo.total_pages;
            dnsPages.push({
                page: resultInfo.page,
                per_page: CLOUDFLARE_DNS_PER_PAGE_V1,
                count: resultInfo.count,
                total_count: resultInfo.total_count,
                total_pages: resultInfo.total_pages,
                records: parsedDns.data.result.map(record => ({
                    id: record.id,
                    name: record.name,
                    type: record.type,
                    proxiable: record.proxiable,
                    proxied: record.proxied,
                })),
            });
            nextPage += 1;
        }

        const inspected = inspectD1ProbeRouteReadbackV1(verifiedPreflight, {
            schema_version: 1,
            kind: "untrusted_d1_probe_route_readback",
            zone: {
                id: parsedZone.data.result.id,
                account_id: parsedZone.data.result.account.id,
                name: parsedZone.data.result.name,
                status: parsedZone.data.result.status,
                type: parsedZone.data.result.type,
                paused: parsedZone.data.result.paused,
            },
            dns_query: {
                zone_id: context.request.zone_id,
                name_exact: hostname,
                proxied: true,
                pages: dnsPages,
            },
        });
        if (!inspected.success) return inspected;
        const observed = Object.freeze({
            schema_version: 1 as const,
            kind: "observed_d1_probe_cloudflare_route" as const,
        });
        observedRoutes.set(
            observed,
            Object.freeze({ verified_preflight: verifiedPreflight, observed_at_ms: Date.now() })
        );
        return { ...inspected, observed };
    } finally {
        clearTimeout(timer);
    }
};
