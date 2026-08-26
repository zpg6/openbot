import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createMetorialCoreSDK } from "@metorial/core";
import metorialCorePackage from "@metorial/core/package.json" with { type: "json" };

import {
    buildIconIndexes,
    defaultVariantPath,
    paginateMetorialSdk,
    parseReviewedProviderIconMap,
    resolveProviderIcon,
    safeSvg,
} from "./metorial-provider-catalog-lib.mjs";

const METORIAL_BASE_URL = "https://api.metorial.com";
const METORIAL_API_VERSION = "2026-01-01-magnetar";
const THESVG_REPOSITORY = "GLINCKER/thesvg";
const THESVG_REVISION = "7870bc1c5f657d9accbb7f96cc457b8dd3363ee8";
const OUTPUT_PATH = resolve("apps/control-plane/src/generated/metorial-provider-catalog.json");
const REVIEWED_ICON_MAP_PATH = resolve("scripts/metorial-provider-icon-map.json");
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

const apiKey = process.env["METORIAL_API_KEY"];
const configuredApiVersion = process.env["METORIAL_API_VERSION"] ?? METORIAL_API_VERSION;
const environmentLabel = process.env["METORIAL_ENVIRONMENT_LABEL"];

if (!apiKey || !/^metorial_(?:uk|mk|sk|ak|pk)_/u.test(apiKey) || !environmentLabel) {
    throw new Error("METORIAL_API_KEY and METORIAL_ENVIRONMENT_LABEL are required");
}
if (configuredApiVersion !== METORIAL_API_VERSION) {
    throw new Error(`METORIAL_API_VERSION must match the pinned SDK version ${METORIAL_API_VERSION}`);
}

const sha256 = value => createHash("sha256").update(value).digest("hex");
const canonicalize = value => {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (value instanceof Date) return value.toISOString();
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

const metorial = createMetorialCoreSDK({
    apiKey,
    apiVersion: METORIAL_API_VERSION,
    apiHost: METORIAL_BASE_URL,
});

const allProviders = await paginateMetorialSdk({
    resourceName: "providers",
    requestPage: query => metorial.providers.list(query),
});
const providers = allProviders.filter(provider => provider.status === "active" && provider.access === "public");
const reviewedIconMap = parseReviewedProviderIconMap(JSON.parse(await readFile(REVIEWED_ICON_MAP_PATH, "utf8")));
const providerIds = new Set(providers.map(provider => provider?.id).filter(id => typeof id === "string"));
for (const providerId of reviewedIconMap.keys()) {
    if (!providerIds.has(providerId)) {
        throw new Error(`reviewed provider icon map contains unknown Metorial provider ${providerId}`);
    }
}
const iconManifestUrl = `https://cdn.jsdelivr.net/gh/${THESVG_REPOSITORY}@${THESVG_REVISION}/src/data/icons.json`;
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
            const sourceUrl = `https://cdn.jsdelivr.net/gh/${THESVG_REPOSITORY}@${THESVG_REVISION}/public${variantPath}`;
            const svgBytes = await fetchBytes(sourceUrl);
            const svg = safeSvg(svgBytes);
            generatedIcon = {
                thesvg_slug: icon.slug,
                variant,
                source_url: sourceUrl,
                source_revision: THESVG_REVISION,
                sha256: sha256(svgBytes),
                license: typeof icon.license === "string" ? icon.license : "unreviewed_brand_mark",
                brand_url: typeof icon.url === "string" ? icon.url : null,
                match: "reviewed_provider_id_map",
                data_uri: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
            };
        }
    }
    const currentVersionId =
        provider.currentVersion && typeof provider.currentVersion.id === "string" ? provider.currentVersion.id : null;
    const tools =
        currentVersionId === null
            ? []
            : await paginateMetorialSdk({
                  resourceName: `provider tools for ${provider.id}`,
                  requestPage: query =>
                      metorial.providers.tools.list({ ...query, providerVersionId: currentVersionId }),
              });
    generatedProviders.push({
        provider_id: provider.id,
        identifier: typeof provider.identifier === "string" ? provider.identifier : provider.slug,
        slug: provider.slug,
        name: provider.name,
        description: typeof provider.description === "string" ? provider.description : null,
        access: typeof provider.access === "string" ? provider.access : "unknown",
        status: provider.status,
        current_version:
            provider.currentVersion &&
            typeof provider.currentVersion.id === "string" &&
            typeof provider.currentVersion.specificationId === "string"
                ? {
                      provider_version_id: provider.currentVersion.id,
                      version: String(provider.currentVersion.version ?? "unknown"),
                      specification_id: provider.currentVersion.specificationId,
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
                typeof tool?.specificationId !== "string"
            ) {
                throw new Error(`unexpected Metorial provider tool shape for ${provider.id}`);
            }
            return {
                tool_id: tool.id,
                key: tool.key,
                name: tool.name,
                description: typeof tool.description === "string" ? tool.description : null,
                specification_id: tool.specificationId,
                effect_tags:
                    tool.tags === null
                        ? null
                        : {
                              read_only: tool.tags.readOnly,
                              destructive: tool.tags.destructive,
                          },
                input_schema_sha256: sha256(canonical(tool.inputSchema?.schema ?? null)),
                output_schema_sha256: sha256(canonical(tool.outputSchema?.schema ?? null)),
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
        api_version: METORIAL_API_VERSION,
        sdk_package: metorialCorePackage.name,
        sdk_version: metorialCorePackage.version,
        environment_fingerprint: sha256(environmentLabel),
        fetched_provider_count: allProviders.length,
        supported_provider_count: providers.length,
        providers_sha256: sha256(canonical(allProviders)),
    },
    icon_source: {
        repository: THESVG_REPOSITORY,
        repository_revision: THESVG_REVISION,
        registry_sha256: sha256(iconManifestBytes),
    },
    providers: generatedProviders,
};

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(output, null, 4)}\n`, { encoding: "utf8", mode: 0o600 });
console.log(`generated ${generatedProviders.length} Metorial providers at ${OUTPUT_PATH}`);
