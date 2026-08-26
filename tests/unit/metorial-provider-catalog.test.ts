import { describe, expect, it } from "vitest";

import {
    buildIconIndexes,
    defaultVariantPath,
    paginateMetorialSdk,
    parseMetorialIntegrationManifest,
    parseMetorialReadmeDisplayName,
    parseReviewedProviderIconMap,
    resolveProviderIcon,
    safeSvg,
} from "../../scripts/metorial-provider-catalog-lib.mjs";

const icon = {
    slug: "linear",
    title: "Linear",
    aliases: ["Linear App"],
    variants: { default: "/icons/linear/default.svg", mono: "/icons/linear/mono.svg" },
};
const provider = { id: "pro_linear", slug: "linear", name: "Linear" };

describe("Metorial provider catalog icon generation", () => {
    it("parses the official repository manifest as discovery metadata", () => {
        expect(
            parseMetorialIntegrationManifest({
                directoryName: "google-calendar",
                manifest: {
                    name: "@google/google-calendar",
                    description: "Create and manage calendar events.",
                    categories: ["scheduling-and-calendars"],
                    skills: ["create events", "check availability"],
                    logoUrl: "https://provider-logos.metorial-cdn.com/google-calendar.svg",
                },
                readme: '# <img src="https://provider-logos.metorial-cdn.com/google-calendar.svg" height="20"> Google Calendar\n',
            })
        ).toEqual({
            identifier: "google-calendar",
            package_name: "@google/google-calendar",
            manifest_version: null,
            display_name: "Google Calendar",
            description: "Create and manage calendar events.",
            categories: ["scheduling-and-calendars"],
            skills: ["create events", "check availability"],
            official_logo_url: "https://provider-logos.metorial-cdn.com/google-calendar.svg",
            repository_logo_path: null,
        });
    });

    it("rejects insecure catalog logo URLs", () => {
        expect(() =>
            parseMetorialIntegrationManifest({
                directoryName: "slack",
                manifest: {
                    name: "@metorial/slack",
                    description: "Work with Slack messages.",
                    categories: ["email-and-messaging"],
                    skills: ["send messages"],
                    logoUrl: "http://example.com/slack.svg",
                },
                readme: "# Slack\n",
            })
        ).toThrow("non-canonical logo URL");
    });

    it("extracts a plain display name instead of retaining README markup", () => {
        expect(parseMetorialReadmeDisplayName('# <img src="logo.svg" height="20"> GitHub\n')).toBe("GitHub");
    });

    it("paginates the typed SDK without dropping providers", async () => {
        const queries: { readonly limit: number; readonly after?: string }[] = [];
        const providers = await paginateMetorialSdk({
            resourceName: "providers",
            requestPage: async query => {
                queries.push(query);
                return query.after === undefined
                    ? { items: [{ id: "provider_1" }], pagination: { hasMoreAfter: true } }
                    : { items: [{ id: "provider_2" }], pagination: { hasMoreAfter: false } };
            },
        });

        expect(providers).toEqual([{ id: "provider_1" }, { id: "provider_2" }]);
        expect(queries).toEqual([{ limit: 100 }, { limit: 100, after: "provider_1" }]);
    });

    it("rejects a Metorial SDK page that cannot advance", async () => {
        await expect(
            paginateMetorialSdk({
                resourceName: "providers",
                requestPage: async () => ({ items: [], pagination: { hasMoreAfter: true } }),
            })
        ).rejects.toThrow("invalid Metorial SDK pagination for providers");
    });

    it("accepts an object-shaped default variant only through the reviewed provider map", () => {
        const indexes = buildIconIndexes([icon]);
        const reviewed = parseReviewedProviderIconMap({
            schema_version: 1,
            mappings: { pro_linear: "linear" },
        });

        const resolved = resolveProviderIcon(provider, indexes, reviewed);

        expect(resolved).toEqual({ icon, suggestion: null });
        expect(defaultVariantPath(resolved.icon!)).toBe("/icons/linear/default.svg");
    });

    it("leaves an automatic exact-name match as a suggestion", () => {
        const resolved = resolveProviderIcon(provider, buildIconIndexes([icon]), new Map());

        expect(resolved.icon).toBeNull();
        expect(resolved.suggestion).toBe(icon);
    });

    it("rejects reviewed slugs that are absent from the pinned manifest", () => {
        const reviewed = parseReviewedProviderIconMap({
            schema_version: 1,
            mappings: { pro_linear: "missing-linear" },
        });

        expect(() => resolveProviderIcon(provider, buildIconIndexes([icon]), reviewed)).toThrow(
            "reviewed theSVG slug missing-linear was not present"
        );
    });

    it("accepts a static SVG and rejects active or externally linked content", () => {
        const bytes = (value: string): Uint8Array => new TextEncoder().encode(value);

        expect(safeSvg(bytes('<svg viewBox="0 0 16 16"><path d="M0 0h16v16z"/></svg>'))).toContain("<path");
        expect(() => safeSvg(bytes('<svg viewBox="0 0 16 16"><script>alert(1)</script></svg>'))).toThrow(
            "static SVG policy"
        );
        expect(() => safeSvg(bytes('<svg viewBox="0 0 16 16"><path onload="alert(1)"/></svg>'))).toThrow(
            "static SVG policy"
        );
        expect(() =>
            safeSvg(bytes('<svg viewBox="0 0 16 16"><use href="https://evil.invalid/a.svg#x"/></svg>'))
        ).toThrow("static SVG policy");
    });
});
