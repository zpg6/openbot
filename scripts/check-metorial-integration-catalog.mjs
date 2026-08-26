import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const CATALOG_PATH = "apps/control-plane/src/generated/metorial-integration-catalog.json";
const PICKER_PATH = "apps/control-plane/src/generated/metorial-integration-picker.json";
const EXPECTED_REVISION = "e0179f7d85450c1f7cc9d47ac60f4c9a17512569";
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

const catalog = JSON.parse(await readFile(CATALOG_PATH, "utf8"));
const picker = JSON.parse(await readFile(PICKER_PATH, "utf8"));
const errors = [];
if (catalog.schema_version !== 1) errors.push("catalog schema version must be 1");
if (catalog.source?.revision !== EXPECTED_REVISION) errors.push("catalog source revision is not pinned");
if (catalog.source?.integration_count !== catalog.integrations?.length || catalog.integrations?.length < 1_000) {
    errors.push("catalog must contain the full official integration set");
}
if (new Set(catalog.integrations?.map(value => value.identifier)).size !== catalog.integrations?.length) {
    errors.push("catalog integration identifiers must be unique");
}
const digest = sha256(JSON.stringify(canonicalize(catalog.integrations)));
if (catalog.source?.catalog_sha256 !== digest) errors.push("catalog digest does not match its integrations");
if (
    picker.schema_version !== 1 ||
    picker.source_revision !== EXPECTED_REVISION ||
    picker.integrations?.length !== catalog.integrations?.length
) {
    errors.push("compact picker catalog does not match the pinned full catalog");
}
if (
    !picker.integrations?.every((entry, index) => {
        const source = catalog.integrations[index];
        if (!Array.isArray(entry) || entry.length !== 5 || source === undefined) return false;
        const characters = Array.from(source.description);
        const summary = characters.length <= 240 ? source.description : `${characters.slice(0, 239).join("")}…`;
        const logoUrl =
            source.official_logo_url !== null &&
            new URL(source.official_logo_url).hostname === "provider-logos.metorial-cdn.com"
                ? source.official_logo_url
                : null;
        return (
            entry[0] === source.identifier &&
            entry[1] === source.display_name &&
            entry[2] === summary &&
            JSON.stringify(entry[3]) === JSON.stringify(source.categories) &&
            entry[4] === logoUrl
        );
    })
) {
    errors.push("compact picker projection is stale or malformed");
}
if (
    /(?:api[_-]?key|auth[_-]?config|connection[_-]?grant|deployment[_-]?id|session[_-]?token)/iu.test(
        JSON.stringify(catalog)
    )
) {
    errors.push("catalog must not contain environment authority or credentials");
}
if (
    !catalog.integrations?.every(
        value =>
            typeof value.identifier === "string" &&
            typeof value.package_name === "string" &&
            typeof value.display_name === "string" &&
            typeof value.description === "string" &&
            Array.isArray(value.categories) &&
            Array.isArray(value.skills)
    )
) {
    errors.push("catalog contains an invalid integration summary");
}

if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
} else {
    console.log(`validated ${catalog.integrations.length} official Metorial integrations`);
}
