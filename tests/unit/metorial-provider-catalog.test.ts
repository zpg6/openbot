import { describe, expect, it } from "vitest";

import {
    buildIconIndexes,
    defaultVariantPath,
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
