import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
    buildIconIndexes,
    defaultVariantPath,
    parseReviewedProviderIconMap,
    resolveProviderIcon,
    safeSvg,
} from "./metorial-provider-catalog-lib.mjs";

const METORIAL_BASE_URL = "https://api.metorial.com";
const THESVG_REPOSITORY = "GLINCKER/thesvg";
const OUTPUT_PATH = resolve("apps/control-plane/src/generated/metorial-provider-catalog.ts");
const REVIEWED_ICON_MAP_PATH = resolve("scripts/metorial-provider-icon-map.json");
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_PAGES = 100;

const apiKey = process.env["METORIAL_API_KEY"];
const apiVersion = process.env["METORIAL_API_VERSION"];
const environmentLabel = process.env["METORIAL_ENVIRONMENT_LABEL"];
const theSvgRevision = process.env["THESVG_REVISION"];

if (!apiKey?.startsWith("metorial_sk_") || !apiVersion || !environmentLabel || !theSvgRevision) {
    throw new Error(
        "METORIAL_API_KEY, METORIAL_API_VERSION, METORIAL_ENVIRONMENT_LABEL, and pinned THESVG_REVISION are required"
    );
}
if (!/^[0-9a-f]{40}$/u.test(theSvgRevision)) throw new Error("THESVG_REVISION must be a full Git commit SHA");

const sha256 = value => createHash("sha256").update(value).digest("hex");
const canonicalize = value => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value !== null && typeof value === "object") {
        return Object.fromEntries(
            Object.keys(value)
                .sort()
                .map(key => [key, canonicalize(value[key])])
        );
    }
    return value;
};
const canonical = value => JSON.stringify(canonicalize(value));
const fetchBytes = async (url, headers = {}) => {
    const response = await fetch(url, { headers, redirect: "error" });
    if (!response.ok) throw new Error(`catalog fetch failed with ${response.status} for ${new URL(url).pathname}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > MAX_RESPONSE_BYTES) throw new Error("catalog response exceeded the byte limit");
    return bytes;
};

const fetchJson = async (url, headers = {}) => {
    const bytes = await fetchBytes(url, headers);
    try {
        return { value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)), bytes };
    } catch {
        throw new Error(`catalog response was not canonical UTF-8 JSON for ${new URL(url).pathname}`);
    }
};

const metorialHeaders = {
    Authorization: `Bearer ${apiKey}`,
    "Metorial-Version": apiVersion,
};

const listMetorial = async (path, query = {}) => {
    const items = [];
    let after;
    for (let page = 0; page < MAX_PAGES; page += 1) {
        const url = new URL(path, METORIAL_BASE_URL);
        url.searchParams.set("limit", "100");
        for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
        if (after !== undefined) url.searchParams.set("after", after);
        const { value } = await fetchJson(url, metorialHeaders);
        if (!value || !Array.isArray(value.items) || typeof value.pagination?.has_more_after !== "boolean") {
            throw new Error(`unexpected Metorial list shape for ${path}`);
        }
        items.push(...value.items);
        if (!value.pagination.has_more_after) return items;
        const lastId = value.items.at(-1)?.id;
        if (typeof lastId !== "string" || lastId === after) throw new Error(`invalid Metorial pagination for ${path}`);
        after = lastId;
    }
    throw new Error(`Metorial pagination exceeded ${MAX_PAGES} pages for ${path}`);
};

const providers = await listMetorial("/providers");
const reviewedIconMap = parseReviewedProviderIconMap(JSON.parse(await readFile(REVIEWED_ICON_MAP_PATH, "utf8")));
const providerIds = new Set(providers.map(provider => provider?.id).filter(id => typeof id === "string"));
for (const providerId of reviewedIconMap.keys()) {
    if (!providerIds.has(providerId)) {
        throw new Error(`reviewed provider icon map contains unknown Metorial provider ${providerId}`);
    }
}
const iconManifestUrl = `https://cdn.jsdelivr.net/gh/${THESVG_REPOSITORY}@${theSvgRevision}/src/data/icons.json`;
const { value: iconManifest, bytes: iconManifestBytes } = await fetchJson(iconManifestUrl);
const icons = Array.isArray(iconManifest) ? iconManifest : iconManifest.icons;
if (!Array.isArray(icons)) throw new Error("unexpected theSVG manifest shape");
const iconIndexes = buildIconIndexes(icons);

const generatedProviders = [];
for (const provider of providers) {
    if (
        typeof provider?.id !== "string" ||
        typeof provider?.slug !== "string" ||
        typeof provider?.name !== "string" ||
        typeof provider?.status !== "string"
    ) {
        throw new Error("unexpected Metorial provider shape");
    }
    const { icon, suggestion } = resolveProviderIcon(provider, iconIndexes, reviewedIconMap);
    let generatedIcon = null;
    if (icon !== null) {
        const variantPath = defaultVariantPath(icon);
        if (variantPath !== null) {
            const expectedVariantPath = `/icons/${icon.slug}/default.svg`;
            if (variantPath !== expectedVariantPath) {
                throw new Error(`reviewed theSVG icon ${icon.slug} has an unexpected default variant path`);
            }
            const variant = "default";
            const sourceUrl = `https://cdn.jsdelivr.net/gh/${THESVG_REPOSITORY}@${theSvgRevision}/public${variantPath}`;
            const svgBytes = await fetchBytes(sourceUrl);
            const svg = safeSvg(svgBytes);
            generatedIcon = {
                thesvg_slug: icon.slug,
                variant,
                source_url: sourceUrl,
                source_revision: theSvgRevision,
                sha256: sha256(svgBytes),
                license: typeof icon.license === "string" ? icon.license : "unreviewed_brand_mark",
                brand_url: typeof icon.url === "string" ? icon.url : null,
                match: "reviewed_provider_id_map",
                data_uri: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
            };
        }
    }
    const currentVersionId =
        provider.current_version && typeof provider.current_version.id === "string"
            ? provider.current_version.id
            : null;
    const tools =
        currentVersionId === null
            ? []
            : await listMetorial("/provider-tools", { provider_version_id: currentVersionId });
    generatedProviders.push({
        provider_id: provider.id,
        identifier: typeof provider.identifier === "string" ? provider.identifier : provider.slug,
        slug: provider.slug,
        name: provider.name,
        description: typeof provider.description === "string" ? provider.description : null,
        access: typeof provider.access === "string" ? provider.access : "unknown",
        status: provider.status,
        current_version:
            provider.current_version &&
            typeof provider.current_version.id === "string" &&
            typeof provider.current_version.specification_id === "string"
                ? {
                      provider_version_id: provider.current_version.id,
                      version: String(provider.current_version.version ?? "unknown"),
                      specification_id: provider.current_version.specification_id,
                  }
                : null,
        icon: generatedIcon,
        icon_suggestion:
            suggestion === null
                ? null
                : {
                      thesvg_slug: suggestion.slug,
                      title: suggestion.title,
                      match: "unique_normalized_name_or_slug",
                  },
        tools: tools.map(tool => {
            if (
                typeof tool?.id !== "string" ||
                typeof tool?.key !== "string" ||
                typeof tool?.name !== "string" ||
                typeof tool?.specification_id !== "string"
            ) {
                throw new Error(`unexpected Metorial provider tool shape for ${provider.id}`);
            }
            return {
                tool_id: tool.id,
                key: tool.key,
                name: tool.name,
                description: typeof tool.description === "string" ? tool.description : null,
                specification_id: tool.specification_id,
                input_schema_sha256: sha256(canonical(tool.input_schema ?? null)),
                output_schema_sha256: sha256(canonical(tool.output_schema ?? null)),
            };
        }),
    });
}

generatedProviders.sort((left, right) => left.name.localeCompare(right.name));
const output = {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    metorial_source: {
        base_url: METORIAL_BASE_URL,
        api_version: apiVersion,
        environment_fingerprint: sha256(environmentLabel),
        providers_sha256: sha256(canonical(providers)),
    },
    icon_source: {
        repository: THESVG_REPOSITORY,
        repository_revision: theSvgRevision,
        registry_sha256: sha256(iconManifestBytes),
    },
    providers: generatedProviders,
};

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(
    OUTPUT_PATH,
    `// Generated by scripts/generate-metorial-provider-catalog.mjs. Do not edit.\nexport const METORIAL_PROVIDER_CATALOG_V1 = ${JSON.stringify(
        output,
        null,
        4
    )} as const;\n`,
    { encoding: "utf8", mode: 0o600 }
);
console.log(`generated ${generatedProviders.length} Metorial providers at ${OUTPUT_PATH}`);
