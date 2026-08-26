import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";

import { format, resolveConfig } from "prettier";

import { parseMetorialIntegrationManifest } from "./metorial-provider-catalog-lib.mjs";

const execFileAsync = promisify(execFile);
const REPOSITORY = "https://github.com/metorial/integrations.git";
const REPOSITORY_REVISION = "e0179f7d85450c1f7cc9d47ac60f4c9a17512569";
const OUTPUT_PATH = resolve("apps/control-plane/src/generated/metorial-integration-catalog.json");
const PICKER_OUTPUT_PATH = resolve("apps/control-plane/src/generated/metorial-integration-picker.json");
const suppliedSourceDirectory = process.env["METORIAL_INTEGRATIONS_DIR"];
const suppliedSourceRevision = process.env["METORIAL_INTEGRATIONS_REVISION"];

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
    const integrations = [];
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
        integrations.push(parseMetorialIntegrationManifest({ directoryName: entry.name, manifest, readme }));
    }
    integrations.sort((left, right) =>
        left.display_name.localeCompare(right.display_name, "en", { sensitivity: "base" })
    );
    if (
        integrations.length < 1_000 ||
        new Set(integrations.map(value => value.identifier)).size !== integrations.length
    ) {
        throw new Error("Metorial integration catalog was unexpectedly small or contained duplicate identifiers");
    }

    const output = {
        schema_version: 1,
        generated_at: sourceCommitTimestamp,
        source: {
            repository: REPOSITORY,
            revision: actualRevision,
            path: "integrations",
            manifest: "slate.json",
            readme: "README.md",
            repository_license: "FSL-1.1-ALv2",
            integration_count: integrations.length,
            catalog_sha256: sha256(canonical(integrations)),
        },
        authority_model: {
            discovery_only: true,
            organization_deployments_from_metorial_sdk: true,
            organization_permission_ceiling_from_openbot: true,
            bot_permissions_are_subset_of_organization_ceiling: true,
        },
        integrations,
    };

    await mkdir(dirname(OUTPUT_PATH), { recursive: true });
    const prettierOptions = (await resolveConfig(OUTPUT_PATH)) ?? {};
    await writeFile(OUTPUT_PATH, await format(JSON.stringify(output), { ...prettierOptions, parser: "json" }), {
        encoding: "utf8",
        mode: 0o600,
    });
    const pickerEntries = integrations.map(entry => {
        const characters = Array.from(entry.description);
        const summary = characters.length <= 240 ? entry.description : `${characters.slice(0, 239).join("")}…`;
        const logoUrl =
            entry.official_logo_url !== null &&
            new URL(entry.official_logo_url).hostname === "provider-logos.metorial-cdn.com"
                ? entry.official_logo_url
                : null;
        return [entry.identifier, entry.display_name, summary, entry.categories, logoUrl];
    });
    const pickerOutput = { schema_version: 1, source_revision: actualRevision, integrations: pickerEntries };
    await writeFile(
        PICKER_OUTPUT_PATH,
        await format(JSON.stringify(pickerOutput), { ...prettierOptions, parser: "json" }),
        { encoding: "utf8", mode: 0o600 }
    );
    console.log(`generated ${integrations.length} official Metorial integrations at ${OUTPUT_PATH}`);
} finally {
    if (temporaryCheckout !== null) await rm(temporaryCheckout, { recursive: true, force: true });
}
