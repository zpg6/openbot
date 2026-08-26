# Metorial catalog generation

OpenBot has two Metorial data layers with different authority.

The public discovery catalog comes from the official `metorial/integrations` repository. It lets the UI list every supported app without a Metorial API key:

```sh
corepack pnpm generate:metorial-catalog
```

The generator checks out a pinned repository commit, reads each integration's `slate.json` and README, validates its metadata, and writes `apps/control-plane/src/generated/metorial-integration-catalog.json`. It also writes the compact page-adapter payload `metorial-integration-picker.json`. The checked-in JSON IR contains names, descriptions, categories, skills, package names, and manifest-supplied logo references. It contains no deployment IDs, auth configuration, connection grants, API keys, or sessions. Set `METORIAL_INTEGRATIONS_DIR` to reuse a local checkout at the pinned revision.

This catalog is discovery metadata, not permission authority. Listing an app does not make it connected. A control-plane adapter supplies the compact discovery summaries separately from the organization integration resolver, so catalog size does not inflate the authorization module or ordinary unit tests. At runtime OpenBot uses the pinned `@metorial/core` SDK to load the active Better Auth organization's Metorial deployments, provider versions, connection state, and tools. The organization policy limits that tool set globally. A bot may select only connected organization integrations and only a subset of the organization-allowed tools.

When an environment key is available, generate the runtime enrichment snapshot separately:

```sh
METORIAL_API_KEY=metorial_sk_... \
METORIAL_ENVIRONMENT_LABEL=development \
corepack pnpm generate:metorial-provider-enrichment
```

The enrichment generator paginates active public providers and loads every tool from each current provider version through the SDK's pinned `2026-01-01-magnetar` API. It records provider and tool identities, effect tags, and schema digests. It never stores credentials or account bindings.

Brand art has two sources. Official manifest logo references are exact discovery metadata from Metorial. Reviewed, locally embedded theSVG marks remain available to the enrichment generator; guessed name matches are emitted only as review suggestions and are never rendered automatically. Runtime UI should serve reviewed or cached local art rather than hotlinking arbitrary remote images.

Review generated diffs before committing them. The metadata source repository currently carries `FSL-1.1-ALv2`; theSVG's tooling is MIT-licensed, while individual brand marks retain their own licenses and trademark rules.
