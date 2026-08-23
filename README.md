# OpenBot

OpenBot is an open source, self-hosted agent control plane for narrow, reviewable access to external tools. It is in design and early implementation. The repository does not yet contain a production-ready release.

The first target is deliberately small. An authenticated organization owner reviews one task, then starts one short read-only run through one reviewed Metorial connector. OpenBot records the allowed tools, limits, data classes, disclosure destinations, model route, run state, cleanup state, and redacted audit evidence.

OpenBot treats a connection as a credential reference, not permission. A Bot can use a tool only when the organization policy, Bot revision, connector contract, capability grant, filtered Metorial session, and signed run manifest agree. Unsupported resource mappings deny the run.

## Current status

The build order and security contracts live in [PLAN.md](PLAN.md). The plan is the source of truth while the first implementation is taking shape.

Do not deploy OpenBot for real data yet. Authentication, policy enforcement, vendor cleanup, runtime isolation, audit verification, and release checks are not complete.

## Intended first release

- A server-rendered Hono control plane on Cloudflare Workers
- TypeScript packages with Zod contracts and Drizzle repositories
- D1 as the first control database, followed by optional Hyperdrive-backed PostgreSQL and MySQL profiles after contract tests pass
- Better Auth with closed registration and one organization owner role
- Metorial for OAuth connections, reviewed tool metadata, and run-owned filtered MCP sessions
- OpenRouter for one explicitly allowed model and provider with no fallback
- One SQLite-backed Durable Object per run for short-lived orchestration state
- Append-only, hash-linked, redacted audit records with a documented database-administrator limitation

The first release excludes provider business-data writes, arbitrary MCP servers, shell access, browser control, general filesystem access, schedules, teams, direct Bot handoffs, and persistent conversation memory.

## Product shape

The main interface is a Bot roster and a single-column Bot workspace. Starting a task opens a five-minute confirmation that shows the exact prompt, tools, selected declarative skills, possible data classes, destinations, and limits. Confirming creates an independent run. Prior runs do not silently become model context.

The planned R2 artifact workspace is separate from the read-only core. It uses versioned collections and snapshot-bound Bot reads instead of a shared cloud computer. Artifact routes stay absent until their security and storage gate passes.

See [docs/product-ui.md](docs/product-ui.md) for the layout and route contract. OpenBot is not affiliated with xAI or Grok Bot. Third-party product research informed the interaction study, but OpenBot uses its own interface and security model.

## Architecture boundaries

OpenBot separates public requests, policy authority, vendor calls, and run state:

```text
browser
   |
   v
control plane ----> orchestrator ----> per-run Durable Object
                         |                       |
                         v                       v
                 signed manifest       capability gateway
                                                 |
                                   +-------------+-------------+
                                   |                           |
                                Metorial                   OpenRouter
```

The public control plane cannot sign manifests or decrypt vendor capability references. The runtime has no public route, global database binding, vendor management key, shell, browser, or reusable provider credential. The capability gateway reserves each model or tool call against current authority before dispatch.

These are design requirements, not claims that the controls are already implemented.

## Development

Repository tooling is being added in dependency order. Once the root scripts exist, the local verification entry point is:

```sh
pnpm verify
```

Integration and preview checks use separate commands because they require Docker or disposable vendor resources. Never substitute real organization data in a test account.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change. Security reports belong in the private channel described in [SECURITY.md](SECURITY.md).

## License

Apache License 2.0. See [LICENSE](LICENSE).
