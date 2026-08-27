const MAX_ICON_BYTES = 64 * 1024;
const safeSlug = value => typeof value === "string" && /^[a-z0-9][a-z0-9-]*$/u.test(value);
const safePackageName = value => typeof value === "string" && /^@[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/u.test(value);
const safeCatalogText = (value, maximumLength) =>
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength &&
    value === value.trim() &&
    !/[\u0000-\u001f\u007f]/u.test(value);
const safeStringList = (value, maximumItems, maximumItemLength, slugOnly = false) =>
    Array.isArray(value) &&
    value.length <= maximumItems &&
    new Set(value).size === value.length &&
    value.every(item => (slugOnly ? safeSlug(item) : safeCatalogText(item, maximumItemLength) && !/[<>]/u.test(item)));

export const parseMetorialReadmeDisplayName = readme => {
    if (typeof readme !== "string" || readme.length > 2 * 1024 * 1024) {
        throw new Error("Metorial integration README must be UTF-8 text under 2 MiB");
    }
    const heading = readme.match(/^#\s+(?:<img\b[^>]*>\s*)?([^\r\n]+)\s*$/mu)?.[1]?.trim();
    if (!safeCatalogText(heading, 160) || /[<>\[\]`]/u.test(heading)) {
        throw new Error("Metorial integration README is missing a safe display-name heading");
    }
    return heading;
};

export const parseMetorialIntegrationManifest = ({ directoryName, manifest, readme }) => {
    if (!safeSlug(directoryName)) throw new Error("Metorial integration directory has an invalid identifier");
    if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
        throw new Error(`Metorial integration ${directoryName} has an invalid slate.json object`);
    }
    const keys = Object.keys(manifest).sort();
    const allowedKeys = ["categories", "description", "logoUrl", "name", "skills", "version"];
    if (keys.some(key => !allowedKeys.includes(key))) {
        throw new Error(`Metorial integration ${directoryName} has an unexpected slate.json field`);
    }
    if (
        !safePackageName(manifest.name) ||
        !safeCatalogText(manifest.description, 16_384) ||
        !safeStringList(manifest.categories, 32, 128, true) ||
        !safeStringList(manifest.skills, 128, 512)
    ) {
        throw new Error(`Metorial integration ${directoryName} has invalid catalog metadata`);
    }
    let officialLogoUrl = null;
    let repositoryLogoPath = null;
    const manifestVersion = manifest.version === undefined ? null : manifest.version;
    if (manifestVersion !== null && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(manifestVersion)) {
        throw new Error(`Metorial integration ${directoryName} has an invalid manifest version`);
    }
    if (manifest.logoUrl === "logo.svg") {
        repositoryLogoPath = `integrations/${directoryName}/logo.svg`;
    } else if (manifest.logoUrl !== undefined) {
        let parsed;
        try {
            parsed = new URL(manifest.logoUrl);
        } catch {
            throw new Error(`Metorial integration ${directoryName} has an invalid logo URL`);
        }
        if (
            parsed.protocol !== "https:" ||
            parsed.hostname.length === 0 ||
            parsed.username !== "" ||
            parsed.password !== "" ||
            parsed.port !== "" ||
            parsed.hash !== "" ||
            parsed.toString().length > 4_096
        ) {
            throw new Error(`Metorial integration ${directoryName} has a non-canonical logo URL`);
        }
        officialLogoUrl = parsed.toString();
    }
    return {
        identifier: directoryName,
        package_name: manifest.name,
        manifest_version: manifestVersion,
        display_name: parseMetorialReadmeDisplayName(readme),
        description: manifest.description,
        categories: [...manifest.categories].sort(),
        skills: [...manifest.skills],
        official_logo_url: officialLogoUrl,
        repository_logo_path: repositoryLogoPath,
    };
};

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
    const withoutLocalPaintReferences = svg.replaceAll(
        /url\(\s*(["']?)#[A-Za-z_][A-Za-z0-9_.:-]*\1\s*\)/gu,
        "local-fragment"
    );
    if (
        !/^\s*<svg\b/iu.test(svg) ||
        !/\bviewBox\s*=\s*["'][^"']+["']/iu.test(svg) ||
        /<!DOCTYPE|<!ENTITY|<\/?(?:script|foreignObject|iframe|object|embed|image|use|style|animate|set|a)\b|\bon[a-z]+\s*=|\b(?:href|src)\s*=|javascript:|data:|url\s*\(/iu.test(
            withoutLocalPaintReferences
        )
    ) {
        throw new Error("integration icon failed the static SVG policy");
    }
    return svg;
};
