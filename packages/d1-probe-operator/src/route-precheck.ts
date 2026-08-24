import { z } from "zod";

import { resolveVerifiedD1ProbePreflightV1, type VerifiedD1ProbePreflightV1 } from "./verified-preflight.js";

const CloudflareIdentifierV1Schema = z.string().regex(/^[0-9a-f]{32}$/u);
const DnsNamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/u;
const DnsNameV1Schema = z.string().max(253).regex(DnsNamePattern);

const CloudflareDnsRecordV1Schema = z
    .object({
        id: CloudflareIdentifierV1Schema,
        name: DnsNameV1Schema,
        type: z.enum(["A", "AAAA", "CNAME"]),
        proxiable: z.boolean(),
        proxied: z.boolean(),
    })
    .strict();

const CloudflareDnsPageV1Schema = z
    .object({
        page: z.number().int().min(1).max(64),
        per_page: z.literal(1000),
        count: z.number().int().min(0).max(64),
        total_count: z.number().int().min(0),
        total_pages: z.number().int().min(1).max(64),
        records: z.array(CloudflareDnsRecordV1Schema).max(64),
    })
    .strict()
    .superRefine((value, context) => {
        if (value.count !== value.records.length) {
            context.addIssue({
                code: "custom",
                path: ["count"],
                message: "DNS page count must equal the captured record count",
            });
        }
        if (value.total_count < value.count) {
            context.addIssue({
                code: "custom",
                path: ["total_count"],
                message: "DNS total count cannot be smaller than the page count",
            });
        }
    });

const UntrustedD1ProbeRouteReadbackV1Schema = z
    .object({
        schema_version: z.literal(1),
        kind: z.literal("untrusted_d1_probe_route_readback"),
        zone: z
            .object({
                id: CloudflareIdentifierV1Schema,
                account_id: CloudflareIdentifierV1Schema,
                name: DnsNameV1Schema,
                status: z.enum(["initializing", "pending", "active", "moved"]),
                type: z.enum(["full", "partial", "secondary", "internal"]),
                paused: z.boolean(),
            })
            .strict(),
        dns_query: z
            .object({
                zone_id: CloudflareIdentifierV1Schema,
                name_exact: DnsNameV1Schema,
                proxied: z.literal(true),
                pages: z.array(CloudflareDnsPageV1Schema).min(1).max(64),
            })
            .strict(),
    })
    .strict();
type UntrustedD1ProbeRouteReadbackV1 = z.infer<typeof UntrustedD1ProbeRouteReadbackV1Schema>;

export type InspectD1ProbeRouteReadbackDenialV1 =
    | "invalid_verified_preflight"
    | "invalid_cloudflare_readback"
    | "cloudflare_account_mismatch"
    | "cloudflare_zone_mismatch"
    | "cloudflare_zone_inactive"
    | "cloudflare_zone_unsupported"
    | "cloudflare_zone_paused"
    | "probe_hostname_outside_zone"
    | "dns_query_mismatch"
    | "dns_pagination_incomplete"
    | "proxied_dns_missing"
    | "dns_record_mismatch"
    | "dns_record_not_proxied";

export interface UntrustedD1ProbeRouteInspectionV1 {
    readonly schema_version: 1;
    readonly kind: "untrusted_d1_probe_route_inspection";
    readonly status: "route_requirements_observed";
    readonly authoritative: false;
    readonly deploy_performed: false;
    readonly eligible_for_deployment: false;
    readonly gate_promotion_allowed: false;
    readonly plan_digest: string;
    readonly dns_record_count: number;
}

const parseReadback = (input: unknown): UntrustedD1ProbeRouteReadbackV1 | null => {
    try {
        const parsed = UntrustedD1ProbeRouteReadbackV1Schema.safeParse(input);
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
};

const belongsToZone = (hostname: string, zoneName: string): boolean =>
    hostname === zoneName || hostname.endsWith(`.${zoneName}`);

export const inspectD1ProbeRouteReadbackV1 = (
    verifiedPreflight: VerifiedD1ProbePreflightV1,
    readbackInput: unknown
):
    | Readonly<{ success: true; inspection: UntrustedD1ProbeRouteInspectionV1 }>
    | Readonly<{ success: false; code: InspectD1ProbeRouteReadbackDenialV1 }> => {
    const context = resolveVerifiedD1ProbePreflightV1(verifiedPreflight);
    if (context === null) return { success: false, code: "invalid_verified_preflight" };

    const readback = parseReadback(readbackInput);
    if (readback === null) return { success: false, code: "invalid_cloudflare_readback" };
    if (readback.zone.account_id !== context.request.account_id) {
        return { success: false, code: "cloudflare_account_mismatch" };
    }
    if (readback.zone.id !== context.request.zone_id || readback.dns_query.zone_id !== context.request.zone_id) {
        return { success: false, code: "cloudflare_zone_mismatch" };
    }
    if (readback.zone.status !== "active") return { success: false, code: "cloudflare_zone_inactive" };
    if (readback.zone.type !== "full") return { success: false, code: "cloudflare_zone_unsupported" };
    if (readback.zone.paused) return { success: false, code: "cloudflare_zone_paused" };

    const hostname = new URL(context.request.probe_origin).hostname;
    if (!belongsToZone(hostname, readback.zone.name)) {
        return { success: false, code: "probe_hostname_outside_zone" };
    }
    if (readback.dns_query.name_exact !== hostname) {
        return { success: false, code: "dns_query_mismatch" };
    }

    const pages = readback.dns_query.pages;
    const totalPages = pages[0]?.total_pages;
    if (
        totalPages === undefined ||
        pages.length !== totalPages ||
        pages.some(
            (page, index) =>
                page.page !== index + 1 ||
                page.total_pages !== totalPages ||
                page.per_page !== pages[0]?.per_page ||
                page.total_count !== pages[0]?.total_count ||
                (totalPages > 1 && page.count === 0)
        )
    ) {
        return { success: false, code: "dns_pagination_incomplete" };
    }

    const records = pages.flatMap(page => page.records);
    if (records.length === 0) return { success: false, code: "proxied_dns_missing" };
    if (
        new Set(records.map(record => record.id)).size !== records.length ||
        records.some(record => record.name !== hostname)
    ) {
        return { success: false, code: "dns_record_mismatch" };
    }
    if (records.some(record => !record.proxiable || !record.proxied)) {
        return { success: false, code: "dns_record_not_proxied" };
    }

    return {
        success: true,
        inspection: Object.freeze({
            schema_version: 1,
            kind: "untrusted_d1_probe_route_inspection",
            status: "route_requirements_observed",
            authoritative: false,
            deploy_performed: false,
            eligible_for_deployment: false,
            gate_promotion_allowed: false,
            plan_digest: context.plan.plan_digest,
            dns_record_count: records.length,
        }),
    };
};
