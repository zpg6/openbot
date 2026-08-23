import { readFile } from "node:fs/promises";

const coreFixture = JSON.parse(await readFile("apps/control-plane/fixtures/core-routes.json", "utf8"));
const denyFixture = JSON.parse(await readFile("apps/control-plane/fixtures/artifact-prefix-deny.json", "utf8"));
const keys = coreFixture.routes.map(route => `${route.method} ${route.path}`);
const errors = [];

if (coreFixture.schema_version !== 1 || coreFixture.routes.length === 0) {
    errors.push("core-routes.json must contain a nonempty version 1 route list");
}

if (new Set(keys).size !== keys.length) {
    errors.push("core-routes.json contains a duplicate method and path");
}

for (const route of coreFixture.routes) {
    if (denyFixture.denied_prefixes.some(prefix => route.path.startsWith(prefix))) {
        errors.push(`deferred artifact prefix registered: ${route.method} ${route.path}`);
    }
    if (denyFixture.denied_fragments.some(fragment => route.path.includes(fragment))) {
        errors.push(`deferred artifact fragment registered: ${route.method} ${route.path}`);
    }
}

if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exitCode = 1;
} else {
    console.log(`checked ${keys.length} core routes and artifact deny rules`);
}
