# Metorial provider catalog generation

OpenBot keeps the provider catalog separate from account authority. The generated catalog describes every Metorial provider template and its pinned-version tools. Runtime access still comes from the account-scoped deployment and connection resolver.

Run:

```sh
METORIAL_API_KEY=metorial_sk_... \
METORIAL_API_VERSION=2025-01-01 \
METORIAL_ENVIRONMENT_LABEL=development \
THESVG_REVISION=<full-reviewed-commit-sha> \
corepack pnpm generate:metorial-catalog
```

The generator paginates Metorial's official `/providers` catalog and loads `/provider-tools` for every pinned current provider version. It stores provider and tool identity plus schema digests, never credentials, auth-config IDs, deployment configuration, or arbitrary metadata.

Brand icons come from a pinned theSVG repository revision. A provider receives an icon only when `scripts/metorial-provider-icon-map.json` maps its exact Metorial provider ID to a reviewed theSVG slug. Unique normalized name or slug matches are emitted only as `icon_suggestion` records for review. They are never rendered automatically. Ambiguous and missing matches stay `null` and render OpenBot's generic integration mark.

The generator reads theSVG's source manifest, including its object-shaped `variants` field, and accepts only the declared `default` path for a reviewed slug. Downloaded SVGs must pass a strict static-image policy and are emitted as local data URIs; the browser makes no theSVG request.

Review the generated diff before committing it. In particular, verify provider-to-brand matches and every reported icon license. theSVG's tooling is MIT-licensed, while individual brand marks retain their own licenses and trademark rules.

The generated file is `apps/control-plane/src/generated/metorial-provider-catalog.ts`. Environment-specific provider deployments and user auth-config bindings do not belong in that file.
