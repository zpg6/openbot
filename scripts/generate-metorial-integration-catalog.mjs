import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { format, resolveConfig } from "prettier";

import {
    buildIconIndexes,
    defaultVariantPath,
    parseMetorialIntegrationManifest,
    safeSvg,
} from "./metorial-provider-catalog-lib.mjs";
import { parseMetorialPublicCatalogHtml, parseMetorialPublicProviderHtml } from "./metorial-public-catalog-lib.mjs";

const execFileAsync = promisify(execFile);
const REPOSITORY = "https://github.com/metorial/integrations.git";
const REPOSITORY_REVISION = "e0179f7d85450c1f7cc9d47ac60f4c9a17512569";
const PUBLIC_CATALOG_URL = "https://metorial.com/integrations";
const THESVG_REPOSITORY = "GLINCKER/thesvg";
const THESVG_REVISION = "7870bc1c5f657d9accbb7f96cc457b8dd3363ee8";
const THESVG_MANIFEST_URL = `https://cdn.jsdelivr.net/gh/${THESVG_REPOSITORY}@${THESVG_REVISION}/src/data/icons.json`;
const OUTPUT_PATH = resolve("apps/control-plane/src/generated/metorial-integration-catalog.json");
const PICKER_OUTPUT_PATH = resolve("apps/control-plane/src/generated/metorial-integration-picker.json");
const FEATURED_PATH = resolve("scripts/metorial-featured-integrations.json");
const CACHE_DIRECTORY = resolve(process.env["METORIAL_CATALOG_CACHE_DIR"] ?? ".build/metorial-catalog-cache");
const suppliedSourceDirectory = process.env["METORIAL_INTEGRATIONS_DIR"];
const suppliedSourceRevision = process.env["METORIAL_INTEGRATIONS_REVISION"];
const concurrency = Number.parseInt(process.env["METORIAL_CATALOG_CONCURRENCY"] ?? "8", 10);
const MAX_RESPONSE_BYTES = 64 * 1024 * 1024;

if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) {
    throw new Error("METORIAL_CATALOG_CONCURRENCY must be an integer from 1 through 16");
}

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
const wait = milliseconds => new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds));

const fetchBytes = async (url, maximumBytes = MAX_RESPONSE_BYTES) => {
    let lastError;
    for (let attempt = 1; attempt <= 4; attempt += 1) {
        try {
            const response = await fetch(url, {
                headers: { "User-Agent": "OpenBot-Metorial-Catalog/1.0" },
                redirect: "error",
            });
            if (response.status === 429 || response.status >= 500) {
                const retryAfter = Number.parseInt(response.headers.get("retry-after") ?? "", 10);
                await wait(Number.isFinite(retryAfter) ? retryAfter * 1_000 : attempt * 1_000);
                continue;
            }
            if (!response.ok) throw new Error(`catalog fetch failed with ${response.status} for ${url}`);
            const declaredLength = Number.parseInt(response.headers.get("content-length") ?? "", 10);
            if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
                throw new Error(`catalog response exceeded the byte limit for ${url}`);
            }
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes.byteLength > maximumBytes) throw new Error(`catalog response exceeded the byte limit for ${url}`);
            return bytes;
        } catch (error) {
            lastError = error;
            if (attempt < 4) await wait(attempt * 500);
        }
    }
    throw new Error(`catalog fetch failed after retries for ${url}`, { cause: lastError });
};

const fetchText = async url => new TextDecoder("utf-8", { fatal: true }).decode(await fetchBytes(url));
const readJson = async path => JSON.parse(await readFile(path, "utf8"));

const featuredConfig = await readJson(FEATURED_PATH);
if (
    featuredConfig?.schema_version !== 1 ||
    !Array.isArray(featuredConfig.integrations) ||
    featuredConfig.integrations.length !== 20
) {
    throw new Error("featured Metorial integration config must contain exactly 20 entries");
}
const featuredIdentifiers = featuredConfig.integrations.map(value => value?.identifier);
const featuredIconSlugs = featuredConfig.integrations.map(value => value?.thesvg_slug);
if (
    new Set(featuredIdentifiers).size !== 20 ||
    new Set(featuredIconSlugs).size !== 20 ||
    !featuredIdentifiers.every(value => typeof value === "string") ||
    !featuredIconSlugs.every(value => typeof value === "string")
) {
    throw new Error("featured Metorial integrations and icon slugs must be unique strings");
}

let checkoutDirectory = suppliedSourceDirectory ? resolve(suppliedSourceDirectory) : null;
let temporaryCheckout = null;
try {
    if (checkoutDirectory === null) {
        temporaryCheckout = await mkdtemp(join(tmpdir(), "openbot-metorial-integrations-"));
        await execFileAsync("git", ["clone", "--filter=blob:none", "--no-checkout", REPOSITORY, temporaryCheckout]);
        await execFileAsync("git", ["-C", temporaryCheckout, "checkout", "--detach", REPOSITORY_REVISION]);
        checkoutDirectory = temporaryCheckout;
    }

    const { stdout } = await execFileAsync("git", ["-C", checkoutDirectory, "rev-parse", "HEAD"]);
    const actualRevision = stdout.trim();
    const expectedRevision = suppliedSourceRevision ?? REPOSITORY_REVISION;
    if (actualRevision !== expectedRevision) {
        throw new Error(
            `Metorial integrations checkout revision ${actualRevision} did not match expected revision ${expectedRevision}`
        );
    }
    const { stdout: commitTimestampOutput } = await execFileAsync("git", [
        "-C",
        checkoutDirectory,
        "show",
        "-s",
        "--format=%cI",
        actualRevision,
    ]);
    const sourceCommitTimestamp = new Date(commitTimestampOutput.trim()).toISOString();

    const integrationsDirectory = join(checkoutDirectory, "integrations");
    const entries = await readdir(integrationsDirectory, { withFileTypes: true });
    const repositoryIntegrations = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const directory = join(integrationsDirectory, entry.name);
        let manifest;
        try {
            manifest = JSON.parse(await readFile(join(directory, "slate.json"), "utf8"));
        } catch (error) {
            throw new Error(`Could not parse Metorial integration ${entry.name}/slate.json`, { cause: error });
        }
        const readme = await readFile(join(directory, "README.md"), "utf8");
        repositoryIntegrations.push(parseMetorialIntegrationManifest({ directoryName: entry.name, manifest, readme }));
    }
    repositoryIntegrations.sort((left, right) => left.identifier.localeCompare(right.identifier));
    if (
        repositoryIntegrations.length < 1_000 ||
        new Set(repositoryIntegrations.map(value => value.identifier)).size !== repositoryIntegrations.length
    ) {
        throw new Error("Metorial repository catalog was unexpectedly small or contained duplicate identifiers");
    }

    await mkdir(CACHE_DIRECTORY, { recursive: true });
    const publicCatalogHtml = await fetchText(PUBLIC_CATALOG_URL);
    const publicProviders = parseMetorialPublicCatalogHtml(publicCatalogHtml);
    const publicProviderIds = new Set(publicProviders.map(provider => provider.identifier));
    for (const identifier of featuredIdentifiers) {
        if (!publicProviderIds.has(identifier)) {
            throw new Error(`featured integration ${identifier} is not in the published Metorial catalog`);
        }
    }

    const repositoryByIdentifier = new Map(repositoryIntegrations.map(value => [value.identifier, value]));
    const repositoryByPackageBasename = new Map();
    const repositoryByGlobalIdentifier = new Map();
    const normalizeName = value => value.toLocaleLowerCase("en").replaceAll(/[^a-z0-9]/gu, "");
    const repositoryByName = new Map();
    for (const integration of repositoryIntegrations) {
        const packageBasename = integration.package_name.split("/").at(-1);
        if (packageBasename !== undefined) {
            repositoryByPackageBasename.set(packageBasename, [
                ...(repositoryByPackageBasename.get(packageBasename) ?? []),
                integration,
            ]);
        }
        const packageGlobalIdentifier = integration.package_name.replace(/^@/u, "").replaceAll("/", "");
        repositoryByGlobalIdentifier.set(packageGlobalIdentifier, [
            ...(repositoryByGlobalIdentifier.get(packageGlobalIdentifier) ?? []),
            integration,
        ]);
        const key = normalizeName(integration.display_name);
        repositoryByName.set(key, [...(repositoryByName.get(key) ?? []), integration]);
    }
    const repositorySourceFor = provider => {
        const direct = repositoryByIdentifier.get(provider.identifier);
        if (direct !== undefined) return direct;
        const byPackageBasename = repositoryByPackageBasename.get(provider.identifier) ?? [];
        if (byPackageBasename.length === 1) return byPackageBasename[0];
        const providerGlobalIdentifier = provider.global_identifier.replace(/-[a-z0-9]{6}$/u, "");
        const byGlobalIdentifier = repositoryByGlobalIdentifier.get(providerGlobalIdentifier) ?? [];
        if (byGlobalIdentifier.length === 1) return byGlobalIdentifier[0];
        const byName = repositoryByName.get(normalizeName(provider.display_name)) ?? [];
        return byName.length === 1 ? byName[0] : null;
    };

    const iconManifestBytes = await fetchBytes(THESVG_MANIFEST_URL, 16 * 1024 * 1024);
    const iconManifest = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(iconManifestBytes));
    const icons = Array.isArray(iconManifest) ? iconManifest : iconManifest.icons;
    if (!Array.isArray(icons)) throw new Error("unexpected theSVG manifest shape");
    const iconIndexes = buildIconIndexes(icons);
    const featuredIcons = new Map();
    for (const featured of featuredConfig.integrations) {
        const icon = iconIndexes.bySlug.get(featured.thesvg_slug);
        if (icon === undefined) {
            throw new Error(`reviewed theSVG icon ${featured.thesvg_slug} is missing for ${featured.identifier}`);
        }
        const variantPath = defaultVariantPath(icon);
        const expectedVariantPath = `/icons/${icon.slug}/default.svg`;
        if (variantPath !== expectedVariantPath) {
            throw new Error(`reviewed theSVG icon ${icon.slug} has an unexpected default variant path`);
        }
        const sourceUrl = `https://cdn.jsdelivr.net/gh/${THESVG_REPOSITORY}@${THESVG_REVISION}/public${variantPath}`;
        const svgBytes = await fetchBytes(sourceUrl, 64 * 1024);
        const svg = safeSvg(svgBytes);
        featuredIcons.set(featured.identifier, {
            thesvg_slug: icon.slug,
            source_url: sourceUrl,
            source_revision: THESVG_REVISION,
            sha256: sha256(svgBytes),
            license: typeof icon.license === "string" ? icon.license : "unreviewed_brand_mark",
            brand_url: typeof icon.url === "string" ? icon.url : null,
            data_uri: `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`,
        });
    }

    const detailByIdentifier = new Map();
    let nextProviderIndex = 0;
    const loadProviderDetail = async provider => {
        const cachePath = join(CACHE_DIRECTORY, `${provider.identifier}.html`);
        try {
            const html = await readFile(cachePath, "utf8");
            const cached = parseMetorialPublicProviderHtml(html, provider.identifier);
            if (cached.marketplace_id !== provider.marketplace_id) throw new Error("stale provider cache");
            return cached;
        } catch {
            const html = await fetchText(`${PUBLIC_CATALOG_URL}/${encodeURIComponent(provider.identifier)}`);
            let parsed;
            try {
                parsed = parseMetorialPublicProviderHtml(html, provider.identifier);
            } catch (error) {
                throw new Error(`Could not parse Metorial public provider ${provider.identifier}`, { cause: error });
            }
            if (parsed.marketplace_id !== provider.marketplace_id) {
                throw new Error(`Metorial provider detail did not match summary for ${provider.identifier}`);
            }
            await writeFile(cachePath, html, { encoding: "utf8", mode: 0o600 });
            return parsed;
        }
    };
    const detailWorkers = Array.from({ length: concurrency }, async () => {
        for (;;) {
            const index = nextProviderIndex;
            nextProviderIndex += 1;
            const provider = publicProviders[index];
            if (provider === undefined) return;
            const detail = await loadProviderDetail(provider);
            detailByIdentifier.set(provider.identifier, detail);
            if (detailByIdentifier.size % 50 === 0 || detailByIdentifier.size === publicProviders.length) {
                console.log(`loaded ${detailByIdentifier.size}/${publicProviders.length} Metorial provider details`);
            }
        }
    });
    await Promise.all(detailWorkers);
    if (detailByIdentifier.size !== publicProviders.length) {
        throw new Error("Metorial detail generation did not cover every published provider");
    }

    const featuredRank = new Map(featuredIdentifiers.map((identifier, index) => [identifier, index]));
    const integrations = publicProviders.map(provider => {
        const detail = detailByIdentifier.get(provider.identifier);
        if (detail === undefined) throw new Error(`missing generated detail for ${provider.identifier}`);
        const repository = repositorySourceFor(detail);
        return {
            marketplace_id: provider.marketplace_id,
            provider_id: detail.provider_id,
            global_identifier: detail.global_identifier,
            current_version_id: detail.current_version_id,
            identifier: provider.identifier,
            display_name: provider.display_name,
            description: provider.description,
            categories: provider.categories,
            skills: provider.skills,
            official_icon_url: provider.official_icon_url,
            featured_rank: featuredRank.get(provider.identifier) ?? null,
            featured_icon: featuredIcons.get(provider.identifier) ?? null,
            repository_source:
                repository === null
                    ? null
                    : {
                          identifier: repository.identifier,
                          package_name: repository.package_name,
                          manifest_version: repository.manifest_version,
                      },
            updated_at: detail.updated_at,
            tools: detail.tools,
            triggers: detail.triggers,
        };
    });
    integrations.sort((left, right) => left.identifier.localeCompare(right.identifier));
    const generatedAt = integrations
        .map(integration => integration.updated_at)
        .sort()
        .at(-1);
    if (generatedAt === undefined) throw new Error("Metorial generated catalog had no update timestamp");
    const totalTools = integrations.reduce((total, integration) => total + integration.tools.length, 0);
    const totalTriggers = integrations.reduce((total, integration) => total + integration.triggers.length, 0);
    const linkedPublishedProviders = integrations.filter(integration => integration.repository_source !== null).length;

    const output = {
        schema_version: 2,
        generated_at: generatedAt,
        sources: {
            repository: {
                url: REPOSITORY,
                revision: actualRevision,
                committed_at: sourceCommitTimestamp,
                path: "integrations",
                integration_count: repositoryIntegrations.length,
                linked_published_provider_count: linkedPublishedProviders,
                public_only_provider_count: integrations.length - linkedPublishedProviders,
                integrations_sha256: sha256(canonical(repositoryIntegrations)),
                license: "FSL-1.1-ALv2",
            },
            public_catalog: {
                url: PUBLIC_CATALOG_URL,
                published_provider_count: publicProviders.length,
                provider_detail_count: detailByIdentifier.size,
                tool_count: totalTools,
                trigger_count: totalTriggers,
                providers_sha256: sha256(canonical(publicProviders)),
            },
            icons: {
                repository: THESVG_REPOSITORY,
                revision: THESVG_REVISION,
                registry_sha256: sha256(iconManifestBytes),
                reviewed_icon_count: featuredIcons.size,
            },
        },
        authority_model: {
            published_catalog_defines_listable_integrations: true,
            current_provider_version_defines_tools_and_triggers: true,
            metorial_effect_tags_define_permission_class: true,
            organization_permission_ceiling_from_openbot: true,
            bot_permissions_are_subset_of_organization_ceiling: true,
            runtime_sessions_use_metorial_tool_filters: true,
        },
        featured_identifiers: featuredIdentifiers,
        integrations,
    };

    const pickerEntries = [...integrations]
        .sort((left, right) => {
            const leftRank = left.featured_rank ?? Number.MAX_SAFE_INTEGER;
            const rightRank = right.featured_rank ?? Number.MAX_SAFE_INTEGER;
            return leftRank - rightRank || left.display_name.localeCompare(right.display_name, "en");
        })
        .map(entry => {
            const characters = Array.from(entry.description);
            const summary = characters.length <= 240 ? entry.description : `${characters.slice(0, 239).join("")}…`;
            return [
                entry.identifier,
                entry.display_name,
                summary,
                entry.categories,
                entry.official_icon_url,
                entry.featured_rank,
                entry.featured_icon?.data_uri ?? null,
                entry.provider_id,
                entry.current_version_id,
            ];
        });
    const pickerOutput = {
        schema_version: 3,
        source_revision: actualRevision,
        catalog_sha256: sha256(canonical(integrations)),
        featured_identifiers: featuredIdentifiers,
        integrations: pickerEntries,
    };

    await mkdir(dirname(OUTPUT_PATH), { recursive: true });
    const prettierOptions = (await resolveConfig(OUTPUT_PATH)) ?? {};
    await writeFile(OUTPUT_PATH, await format(JSON.stringify(output), { ...prettierOptions, parser: "json" }), {
        encoding: "utf8",
        mode: 0o600,
    });
    await writeFile(
        PICKER_OUTPUT_PATH,
        await format(JSON.stringify(pickerOutput), { ...prettierOptions, parser: "json" }),
        { encoding: "utf8", mode: 0o600 }
    );
    console.log(
        `generated ${integrations.length} published Metorial integrations with ${totalTools} tools and ${totalTriggers} triggers`
    );
} finally {
    if (temporaryCheckout !== null) await rm(temporaryCheckout, { recursive: true, force: true });
}
