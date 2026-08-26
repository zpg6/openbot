const MAX_ICON_BYTES = 64 * 1024;
const safeSlug = value => typeof value === "string" && /^[a-z0-9][a-z0-9-]*$/u.test(value);

export const paginateMetorialSdk = async ({ resourceName, requestPage, maxPages = 100 }) => {
    const items = [];
    let after;
    for (let page = 0; page < maxPages; page += 1) {
        const value = await requestPage({ limit: 100, ...(after === undefined ? {} : { after }) });
        if (!value || !Array.isArray(value.items) || typeof value.pagination?.hasMoreAfter !== "boolean") {
            throw new Error(`unexpected Metorial SDK list shape for ${resourceName}`);
        }
        items.push(...value.items);
        if (!value.pagination.hasMoreAfter) return items;
        const lastId = value.items.at(-1)?.id;
        if (typeof lastId !== "string" || lastId === after) {
            throw new Error(`invalid Metorial SDK pagination for ${resourceName}`);
        }
        after = lastId;
    }
    throw new Error(`Metorial SDK pagination exceeded ${maxPages} pages for ${resourceName}`);
};

export const normalizeIconCandidate = value => value.toLowerCase().replaceAll(/[^a-z0-9]/gu, "");

export const parseReviewedProviderIconMap = value => {
    if (value === null || typeof value !== "object" || Array.isArray(value) || value.schema_version !== 1) {
        throw new Error("reviewed provider icon map must use schema version 1");
    }
    const mappings = value.mappings;
    if (mappings === null || typeof mappings !== "object" || Array.isArray(mappings)) {
        throw new Error("reviewed provider icon map must contain a mappings object");
    }
    const reviewed = new Map();
    for (const [providerId, iconSlug] of Object.entries(mappings)) {
        if (typeof providerId !== "string" || providerId.length === 0 || !safeSlug(iconSlug)) {
            throw new Error("reviewed provider icon map contains an invalid provider ID or theSVG slug");
        }
        reviewed.set(providerId, iconSlug);
    }
    return reviewed;
};

export const buildIconIndexes = icons => {
    const bySlug = new Map();
    const byCandidate = new Map();
    for (const icon of icons) {
        if (!safeSlug(icon?.slug) || typeof icon?.title !== "string" || bySlug.has(icon.slug)) {
            continue;
        }
        bySlug.set(icon.slug, icon);
        for (const candidate of [icon.slug, icon.title, ...(Array.isArray(icon.aliases) ? icon.aliases : [])]) {
            if (typeof candidate !== "string") continue;
            const key = normalizeIconCandidate(candidate);
            if (key.length === 0) continue;
            const existing = byCandidate.get(key) ?? [];
            existing.push(icon);
            byCandidate.set(key, existing);
        }
    }
    return { bySlug, byCandidate };
};

export const resolveProviderIcon = (provider, indexes, reviewedMap) => {
    const reviewedSlug = reviewedMap.get(provider.id);
    if (reviewedSlug !== undefined) {
        const icon = indexes.bySlug.get(reviewedSlug);
        if (icon === undefined) {
            throw new Error(
                `reviewed theSVG slug ${reviewedSlug} was not present for Metorial provider ${provider.id}`
            );
        }
        return { icon, suggestion: null };
    }

    const candidates = new Set([
        ...(indexes.byCandidate.get(normalizeIconCandidate(provider.slug)) ?? []),
        ...(indexes.byCandidate.get(normalizeIconCandidate(provider.name)) ?? []),
    ]);
    return {
        icon: null,
        suggestion: candidates.size === 1 ? [...candidates][0] : null,
    };
};

export const defaultVariantPath = icon => {
    if (icon.variants !== null && typeof icon.variants === "object" && !Array.isArray(icon.variants)) {
        const path = icon.variants.default;
        return typeof path === "string" ? path : null;
    }
    return Array.isArray(icon.variants) && icon.variants.includes("default") ? `/icons/${icon.slug}/default.svg` : null;
};

export const safeSvg = bytes => {
    if (!(bytes instanceof Uint8Array)) throw new Error("integration icon must be bytes");
    if (bytes.byteLength > MAX_ICON_BYTES) throw new Error("integration icon exceeded 64 KiB");
    const svg = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (
        !/^\s*<svg\b/iu.test(svg) ||
        !/\bviewBox\s*=\s*["'][^"']+["']/iu.test(svg) ||
        /<!DOCTYPE|<!ENTITY|<\/?(?:script|foreignObject|iframe|object|embed|image|use|style|animate|set|a)\b|\bon[a-z]+\s*=|\b(?:href|src)\s*=|javascript:|data:|url\s*\(/iu.test(
            svg
        )
    ) {
        throw new Error("integration icon failed the static SVG policy");
    }
    return svg;
};
