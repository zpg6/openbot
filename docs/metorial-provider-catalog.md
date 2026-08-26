# Metorial provider catalog generation

OpenBot keeps the provider catalog separate from account authority. The generated catalog describes every Metorial provider template and its pinned-version tools. Runtime access still comes from the account-scoped deployment and connection resolver.

Run:

```sh
METORIAL_API_KEY=metorial_sk_... \
METORIAL_ENVIRONMENT_LABEL=development \
corepack pnpm generate:metorial-catalog
```

The dev-time generator uses the pinned `@metorial/core` SDK and its `2026-01-01-magnetar` generated client. It paginates every active public provider and loads every tool from each pinned current provider version. The output records the exact SDK version, provider and tool identity, Metorial effect tags, and schema digests. It never stores credentials, auth-config IDs, deployment configuration, or arbitrary metadata. `METORIAL_API_VERSION` is optional; when set, it must match the SDK's pinned version.

Brand icons come from the theSVG revision pinned in the generator. A provider receives an icon only when `scripts/metorial-provider-icon-map.json` maps its exact Metorial provider ID to a reviewed theSVG slug. Unique normalized name or slug matches are emitted only as `icon_suggestion` records for review. They are never rendered automatically. Ambiguous and missing matches stay `null` and render OpenBot's generic integration mark.

The generator reads theSVG's source manifest, including its object-shaped `variants` field, and accepts only the declared `default` path for a reviewed slug. Downloaded SVGs must pass a strict static-image policy and are emitted as local data URIs; the browser makes no theSVG request.

Review the generated diff before committing it. In particular, verify provider-to-brand matches and every reported icon license. theSVG's tooling is MIT-licensed, while individual brand marks retain their own licenses and trademark rules.

The generated JSON IR is `apps/control-plane/src/generated/metorial-provider-catalog.json`. Commit and review that file so the Bot app picker can render a stable catalog without calling Metorial during a page request. Environment-specific provider deployments and user auth-config bindings do not belong in it. Runtime code joins this public catalog to the current Better Auth organization, that organization's Metorial deployments, and the user's opaque connection grants.
