# OpenBot

OpenBot is an open source, self-hosted agent control plane for narrow, reviewable access to external tools. It is in design and early implementation. The repository does not yet contain a production-ready release.

The first target is deliberately small. An authenticated organization owner reviews one task, then starts one short read-only run through one reviewed Metorial connector. The Bot may execute one bounded JavaScript function in a fresh Cloudflare Sandbox owned by that run. OpenBot records the allowed provider tools, code profile, limits, data classes, disclosure destinations, model route, run state, cleanup state, and redacted audit evidence.

OpenBot treats a connection as a credential reference, not permission. A Bot can use a tool only when the organization policy, Bot revision, connector contract, capability grant, filtered Metorial session, and signed run manifest agree. Unsupported resource mappings deny the run.

## Current status

The build order and security contracts live in [PLAN.md](PLAN.md). The plan is the source of truth while the first implementation is taking shape.

Do not deploy OpenBot for real data yet. Authentication, policy enforcement, vendor cleanup, runtime isolation, audit verification, and release checks are not complete.

## Intended first release

- A React 19 client rendered from a narrow versioned page model and served by a Hono control plane on Cloudflare Workers
- TypeScript packages with Zod contracts and Drizzle repositories
- D1 as the first control database, followed by optional Hyperdrive-backed PostgreSQL and MySQL profiles after contract tests pass
- Better Auth magic links and organizations, with invitations, active membership, and owner/admin/member roles
- Metorial for OAuth connections, reviewed tool metadata, and run-owned filtered MCP sessions
- OpenRouter for one explicitly allowed model and provider with no fallback
- One SQLite-backed Durable Object per run for short-lived orchestration state
- One ephemeral Cloudflare Sandbox per code-enabled run, reached through a private sandbox runner with no OpenBot, provider, user, or storage credential in the container
- Append-only, hash-linked, redacted audit records with a documented database-administrator limitation

The first release excludes provider business-data writes, arbitrary MCP servers, interactive shell access, arbitrary command endpoints, package installation, browser control, persistent sandbox files, unattended routine execution, teams, direct Bot handoffs, and persistent conversation memory.

## Product shape

The main interface is a Bot roster, the active Bot's chat, and a settings rail for Bot configuration, exact Metorial access, and routines. A Bot is a chat. Starting a task opens a five-minute confirmation that shows the exact prompt, each provider and connected account label, and every literal tool allow-list before execution. A chat message can also become a reviewed routine draft; saved routines appear in the rail and edits rebind them to the Bot's current exact authority. Routine scheduling and unattended execution remain disabled. Confirming a task creates an independent run and reserves a random run-owned Sandbox identity when code is enabled. Prior runs do not silently become model context.

The planned R2 artifact workspace is separate from the read-only core. It uses versioned collections and snapshot-bound Bot reads instead of a shared cloud computer. Artifact routes stay absent until their security and storage gate passes.

See [docs/product-ui.md](docs/product-ui.md) for the layout and route contract. OpenBot is not affiliated with xAI or Grok Bot. Third-party product research informed the interaction study, but OpenBot uses its own interface and security model.

## Architecture boundaries

OpenBot separates public requests, policy authority, vendor calls, and run state:

```text
browser
   |
   v
control plane ----> orchestrator ----> per-run Durable Object ----> capability gateway
                         |                                             |       |       |
                         | lifecycle                                   |       |       | execute
                         v                                             v       v       v
                   sandbox runner                                  Metorial OpenRouter sandbox runner
                         |                                                               |
                         +------------------------> per-run Sandbox <--------------------+
```

The public control plane cannot sign manifests or decrypt vendor capability references. The runtime has no public route, global database binding, vendor management key, Sandbox binding, browser, or reusable provider credential. The capability gateway reserves each model, provider-tool, or code call against current authority before dispatch. The sandbox runner owns the Sandbox namespace and never places an OpenBot, provider, user, or storage credential in the container.

These are design requirements, not claims that the controls are already implemented.

## Development

The pinned local verification entry point is:

```sh
corepack pnpm verify
```

`corepack pnpm test:integration` runs the local Worker RPC tests. Later database and preview checks use separate commands because they require Docker or disposable platform and vendor resources. Never substitute real organization data in a test account.

The first real-app browser proof runs with:

```sh
corepack pnpm test:app:e2e
```

It opens the production React + Hono application in a headless browser, creates a Bot, adds two organization-scoped Metorial apps from the app grid, verifies their safe read-tool defaults, and opens one app to inspect its exact tool controls. It then chats a task, reviews both connected-account/tool disclosures, starts one claimed run, and reads its plain-text result. The walkthrough also proposes and saves a routine from chat, edits it from the sidebar, and changes the organization's exact permission ceiling. The server-owned authority snapshot binds each opaque connection grant, provider version and specification, policy revision and digest, tool key and effect, and input/output schema digests. A separate semantic session intent pins the configured Metorial API version and serializer identity without pretending to be an unversioned vendor wire body. The private capability gateway must resolve opaque user grants to auth configs and serialize that intent for the pinned Metorial version; authless and deployment-auth providers remain explicit modes, never ambient fallback. Every run writes nine full-page screenshots and `openbot-product-flow.webm` under `test-results/app-e2e/walkthrough`. The HTML report at `playwright-report/index.html` includes the same attachments.

Authentication, storage, and task execution are bounded local substitutions; this command is not provider, model, production-database, or deployment evidence. On macOS it uses installed Google Chrome when available. Elsewhere, install Playwright Chromium or set `OPENBOT_E2E_CHROME_PATH` to a compatible browser executable.

The pinned Metorial provider/type and theSVG icon catalog generator is documented in [docs/metorial-provider-catalog.md](docs/metorial-provider-catalog.md). It requires a server-side Metorial key and a reviewed theSVG commit SHA; generated provider metadata never grants runtime access.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a change. Security reports belong in the private channel described in [SECURITY.md](SECURITY.md).

## License

Apache License 2.0. See [LICENSE](LICENSE).
