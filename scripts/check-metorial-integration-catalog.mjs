import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const CATALOG_PATH = "apps/control-plane/src/generated/metorial-integration-catalog.json";
const PICKER_PATH = "apps/control-plane/src/generated/metorial-integration-picker.json";
const EXPECTED_REPOSITORY_REVISION = "e0179f7d85450c1f7cc9d47ac60f4c9a17512569";
const EXPECTED_FEATURED_COUNT = 20;
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
const summary = description => {
    const characters = Array.from(description);
    return characters.length <= 240 ? description : `${characters.slice(0, 239).join("")}…`;
};
const validIdentifier = value => typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,127}$/u.test(value);

const catalog = JSON.parse(await readFile(CATALOG_PATH, "utf8"));
const picker = JSON.parse(await readFile(PICKER_PATH, "utf8"));
const errors = [];
const integrations = Array.isArray(catalog.integrations) ? catalog.integrations : [];
const featuredIdentifiers = Array.isArray(catalog.featured_identifiers) ? catalog.featured_identifiers : [];

if (catalog.schema_version !== 2) errors.push("catalog schema version must be 2");
if (catalog.sources?.repository?.revision !== EXPECTED_REPOSITORY_REVISION) {
    errors.push("official integration source revision is not pinned");
}
if (catalog.sources?.repository?.integration_count < 1_000) {
    errors.push("official source repository coverage is unexpectedly small");
}
const linkedPublishedProviders = integrations.filter(value => value.repository_source !== null).length;
if (
    catalog.sources?.repository?.linked_published_provider_count !== linkedPublishedProviders ||
    catalog.sources?.repository?.public_only_provider_count !== integrations.length - linkedPublishedProviders ||
    linkedPublishedProviders < 1_000
) {
    errors.push("published provider source provenance is incomplete or stale");
}
if (
    catalog.sources?.public_catalog?.published_provider_count !== integrations.length ||
    catalog.sources?.public_catalog?.provider_detail_count !== integrations.length ||
    integrations.length < 1_000
) {
    errors.push("every published Metorial provider must have a generated detail record");
}
if (
    featuredIdentifiers.length !== EXPECTED_FEATURED_COUNT ||
    new Set(featuredIdentifiers).size !== EXPECTED_FEATURED_COUNT
) {
    errors.push("catalog must define exactly 20 unique featured providers");
}
if (
    new Set(integrations.map(value => value.identifier)).size !== integrations.length ||
    new Set(integrations.map(value => value.marketplace_id)).size !== integrations.length ||
    new Set(integrations.map(value => value.provider_id)).size !== integrations.length
) {
    errors.push("provider identifiers and runtime IDs must be unique");
}

let toolCount = 0;
let triggerCount = 0;
for (const integration of integrations) {
    if (
        !validIdentifier(integration.identifier) ||
        typeof integration.display_name !== "string" ||
        typeof integration.description !== "string" ||
        !/^plg_[A-Za-z0-9]+$/u.test(integration.marketplace_id) ||
        !/^pro_[A-Za-z0-9]+$/u.test(integration.provider_id) ||
        !/^prv_[A-Za-z0-9]+$/u.test(integration.current_version_id) ||
        !Array.isArray(integration.categories) ||
        !Array.isArray(integration.skills) ||
        !Array.isArray(integration.tools) ||
        !Array.isArray(integration.triggers)
    ) {
        errors.push(`provider ${String(integration.identifier)} has invalid generated metadata`);
        continue;
    }
    toolCount += integration.tools.length;
    triggerCount += integration.triggers.length;
    const capabilities = [...integration.tools, ...integration.triggers];
    if (
        new Set(capabilities.map(value => value.capability_id)).size !== capabilities.length ||
        new Set(integration.tools.map(value => value.key)).size !== integration.tools.length ||
        new Set(integration.triggers.map(value => value.key)).size !== integration.triggers.length
    ) {
        errors.push(`provider ${integration.identifier} has duplicate capabilities`);
    }
    if (
        !integration.tools.every(
            tool =>
                ["read", "write", "destructive"].includes(tool.effect) &&
                tool.read_only === (tool.effect === "read") &&
                tool.destructive === (tool.effect === "destructive") &&
                ["metorial_tags", "default_write"].includes(tool.effect_source)
        ) ||
        !integration.triggers.every(
            trigger =>
                trigger.effect === "trigger" &&
                trigger.effect_source === "trigger" &&
                trigger.read_only === false &&
                trigger.destructive === false
        )
    ) {
        errors.push(`provider ${integration.identifier} has invalid permission effects`);
    }
    const expectedRank = featuredIdentifiers.indexOf(integration.identifier);
    if (integration.featured_rank !== (expectedRank < 0 ? null : expectedRank)) {
        errors.push(`provider ${integration.identifier} has a stale featured rank`);
    }
    if (
        expectedRank >= 0 &&
        (!integration.featured_icon ||
            !/^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+=*$/u.test(integration.featured_icon.data_uri) ||
            typeof integration.featured_icon.source_revision !== "string")
    ) {
        errors.push(`featured provider ${integration.identifier} is missing its reviewed embedded icon`);
    }
}
if (catalog.sources?.public_catalog?.tool_count !== toolCount) errors.push("generated tool count is stale");
if (catalog.sources?.public_catalog?.trigger_count !== triggerCount) errors.push("generated trigger count is stale");

const digest = sha256(JSON.stringify(canonicalize(integrations)));
if (
    picker.schema_version !== 3 ||
    picker.source_revision !== EXPECTED_REPOSITORY_REVISION ||
    picker.catalog_sha256 !== digest ||
    picker.integrations?.length !== integrations.length ||
    JSON.stringify(picker.featured_identifiers) !== JSON.stringify(featuredIdentifiers)
) {
    errors.push("compact picker does not identify the generated full catalog");
}
const expectedPicker = [...integrations]
    .sort((left, right) => {
        const leftRank = left.featured_rank ?? Number.MAX_SAFE_INTEGER;
        const rightRank = right.featured_rank ?? Number.MAX_SAFE_INTEGER;
        return leftRank - rightRank || left.display_name.localeCompare(right.display_name, "en");
    })
    .map(value => [
        value.identifier,
        value.display_name,
        summary(value.description),
        value.categories,
        value.official_icon_url,
        value.featured_rank,
        value.featured_icon?.data_uri ?? null,
        value.provider_id,
        value.current_version_id,
    ]);
if (JSON.stringify(picker.integrations) !== JSON.stringify(expectedPicker)) {
    errors.push("compact picker projection is stale or malformed");
}
const forbiddenAuthorityFields = new Set([
    "api_key",
    "auth_config_id",
    "connection_grant_id",
    "provider_deployment_id",
    "session_token",
]);
const containsAuthorityField = value =>
    value !== null &&
    typeof value === "object" &&
    Object.entries(value).some(
        ([key, child]) => forbiddenAuthorityFields.has(key.toLocaleLowerCase()) || containsAuthorityField(child)
    );
if (containsAuthorityField(catalog)) {
    errors.push("catalog must not contain environment authority or credentials");
}
if (
    catalog.authority_model?.published_catalog_defines_listable_integrations !== true ||
    catalog.authority_model?.current_provider_version_defines_tools_and_triggers !== true ||
    catalog.authority_model?.organization_permission_ceiling_from_openbot !== true ||
    catalog.authority_model?.bot_permissions_are_subset_of_organization_ceiling !== true ||
    catalog.authority_model?.runtime_sessions_use_metorial_tool_filters !== true
) {
    errors.push("catalog authority model is incomplete");
}

if (errors.length > 0) {
    for (const error of [...new Set(errors)]) console.error(`- ${error}`);
    process.exitCode = 1;
} else {
    console.log(
        `validated ${integrations.length} Metorial providers, ${toolCount} tools, and ${triggerCount} triggers`
    );
}
