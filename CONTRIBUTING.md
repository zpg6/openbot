# Contributing

OpenBot is being built from the contracts in [PLAN.md](PLAN.md). Read the part you intend to change before writing code. If a proposal conflicts with the plan, change the design in a focused pull request before implementing it.

## Pick a bounded change

Keep each pull request to one dependency-ordered checklist item or a smaller part of one. Avoid drive-by formatting and unrelated dependency updates. Do not add an abstraction for deferred work.

Security boundaries need an explicit contract and denial test. This includes routes, database operations, service bindings, vendor calls, manifest fields, Durable Object messages, and artifact access.

Before starting a large change, open an issue that names:

- the plan item and completion check
- the packages and Workers affected
- new authority, credentials, bindings, or network destinations
- schema or protocol compatibility changes
- the failure and cleanup behavior

## Development rules

- Use the pinned Node.js and pnpm versions from the repository.
- Keep TypeScript in strict ESM mode.
- Validate every trust boundary with the shared Zod contracts.
- Keep Drizzle drivers inside their database package. Route handlers do not receive a database handle.
- Keep vendor management clients in the orchestrator and vendor data-plane clients in the capability gateway.
- Do not add a public route to the runtime, orchestrator, capability gateway, or artifact gateway.
- Do not log prompts, tool arguments, tool results, credentials, bearer URLs, authorization references, or decrypted configuration.
- Pin direct dependencies exactly. Do not use `@latest` in scripts or documentation.
- Add no generated third-party artwork, screenshots, or copied product UI.

The D1 profile lands first. Work on PostgreSQL, MySQL, and R2 starts only at the gates named in the plan.

## Tests

Every change needs the narrowest useful test and the relevant contract or integration test. Authorization work must include a denial case. State-machine work must cover replay, stale versions, and failure on both sides of a commit or external call where applicable.

The hermetic check is:

```sh
pnpm verify
```

Use `pnpm verify:integration` when the change needs Miniflare or Testcontainers. Use `pnpm verify:preview` only with disposable Cloudflare and vendor resources. A missing script means its checklist item has not landed yet, not that contributors should invent a local replacement.

Never run preview tests with production credentials or real organization data.

## Commits and pull requests

Use short Conventional Commit subjects such as:

```text
feat: add confirmation contract
fix: fence revoked grants
test: cover cleanup replay
docs: define run states
```

Keep generated files, migrations, tests, and documentation required by a change in the same pull request. Do not rewrite an applied migration. Explain any compatibility or deployment-order requirement in the pull request body.

A pull request is ready for review when:

- formatting, type checks, and relevant tests pass
- denial and failure behavior has coverage
- generated output is current
- logs and fixtures contain no secrets
- public behavior and the changelog are updated when needed
- the change contains no unrelated files

Reviewers should assume the model, prompts, skills, MCP server, tool results, artifact bytes, browser input, and network responses are hostile. A happy-path demonstration is not enough.

## Reporting security problems

Follow [SECURITY.md](SECURITY.md). Never open a public issue with exploit details or secrets.
