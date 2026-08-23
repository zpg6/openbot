# Release policy

OpenBot has not published a supported release. This file defines how releases will work once the read-only release gate in [PLAN.md](PLAN.md) passes.

## Versioning

OpenBot uses Semantic Versioning.

- `0.x` releases may change APIs, manifests, database schemas, deployment bindings, and configuration.
- A patch release fixes behavior without intentionally changing a documented contract.
- A minor `0.x` release may introduce a breaking change. Its release note must name the migration and rollback limits.
- `1.0.0` requires a documented compatibility policy for public APIs, stored data, manifests, and Worker-to-Worker protocols.

The repository version covers the coordinated control plane, orchestrator, gateways, runtime, database packages, migrations, and operator commands. These components are not versioned independently.

## Changelog

[CHANGELOG.md](CHANGELOG.md) records user-visible behavior, security fixes, migrations, operational changes, and compatibility breaks. Merge commits use short Conventional Commit subjects, but commit type alone does not decide the released version.

Do not put secrets, private report details, or exploit instructions in an unreleased changelog entry. Link a public advisory after disclosure.

## Release requirements

A release candidate must satisfy the completion checks for its plan item. For the first read-only release this includes:

- hermetic, integration, and disposable preview verification
- a fresh-account install
- database backup and restore for each supported profile
- key rotation and retention checks
- vendor outage, queue backlog, dead-letter replay, cleanup, and previous-code rollback exercises
- confirmation that private Workers and the runtime have no public route
- dependency license review and generated artifact checks

The R2 artifact workspace and provider business-data writes release separately after their own gates pass. Their routes must remain absent from earlier releases.

## Release procedure

1. Freeze the intended commit and record every direct dependency and Cloudflare compatibility date.
2. Update `CHANGELOG.md`, migration notes, support status, and security notes.
3. Run the required verification commands against disposable resources.
4. Test upgrade and rollback from the previous supported release. State any point after which rollback is unsafe.
5. Tag the exact verified commit with its Semantic Versioning number.
6. Publish checksums and release notes with the supported database profiles and deployment order.
7. Promote the same tested artifacts. Do not rebuild from a different commit.

If any required check fails or evidence is missing, do not publish the release.
