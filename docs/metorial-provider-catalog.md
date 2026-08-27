# Metorial catalog generation

OpenBot generates one catalog from three pinned sources. Each source answers a different question.

Generate it with:

```sh
corepack pnpm generate:metorial-catalog
```

The generator combines these layers:

1. The pinned official [`metorial/integrations`](https://github.com/metorial/integrations) revision supplies source-package provenance.
2. Metorial's published integration catalog defines which providers can be listed now. Each provider's current detail record supplies its runtime provider and version IDs, tools, triggers, and Metorial effect tags.
3. A reviewed 20-entry manifest maps featured providers to icons from a pinned [theSVG](https://github.com/GLINCKER/thesvg) revision. Those sanitized SVGs are embedded. All other providers use Metorial's official icon URL.

The full JSON IR is `apps/control-plane/src/generated/metorial-integration-catalog.json`. It contains every published provider and every tool and trigger exposed by its current public version. The smaller `metorial-integration-picker.json` contains the 20 ranked featured apps first, followed by the searchable remainder. It is the only artifact loaded by the application bundle.

Generation is strict. It verifies pinned commits, provider and capability IDs, unique keys, source counts, effect classes, icon content, and a digest joining the picker to the full catalog. Missing Metorial effect tags default to `write`, never `read`. The checked-in artifact contains no API keys, auth configuration IDs, connection grants, deployments, or session tokens. Set `METORIAL_INTEGRATIONS_DIR` to reuse a local checkout at the pinned revision and `METORIAL_CATALOG_CACHE_DIR` to reuse fetched provider pages.

Catalog metadata is not runtime authority. Listing an app does not connect it. At connection and session time, OpenBot uses the pinned `@metorial/core` SDK to resolve the active Better Auth organization's Metorial deployment, current provider version, connection state, and tools. Organization policy sets the ceiling. A bot can select only connected organization integrations and only a subset of the organization-allowed tools. Each run creates a filtered Metorial session from that subset.

When an environment key is available, generate the runtime enrichment snapshot separately:

```sh
METORIAL_API_KEY=metorial_sk_... \
METORIAL_ENVIRONMENT_LABEL=development \
corepack pnpm generate:metorial-provider-enrichment
```

The optional enrichment generator is a credentialed cross-check against a specific Metorial environment. It paginates active public providers and loads every current-version tool through the SDK's pinned `2026-01-01-magnetar` API. It records provider and tool identities, effect tags, and schema digests. It never stores credentials or account bindings.

No icon is selected by fuzzy matching. The featured mapping is reviewed by provider identifier and theSVG slug. Metorial icon URLs are restricted to Metorial's asset hosts before they reach the browser.

Review generated diffs before committing them. The metadata source repository currently carries `FSL-1.1-ALv2`; theSVG's tooling is MIT-licensed, while individual brand marks retain their own licenses and trademark rules.
