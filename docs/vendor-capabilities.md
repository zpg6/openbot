# Vendor capability record

This record separates public documentation, local repository observations, and deployed probes. A documentation row can justify a design. It cannot close a gate that calls for a real account, concurrent writers, a platform restart, or an observed vendor response.

- Evidence date: 2026-08-23
- Item 2 status: blocked
- Candidate Sandbox data: server-seeded synthetic probe bytes only
- Enabled Sandbox data ceiling: public, synthetic, or organization; restricted and unknown deny
- Staleness rule: refresh catalog and price evidence before each protected-branch preview and reject evidence older than 24 hours where the runtime depends on it

## Gate register

| Gate                  | Owner                    | Documentation status                                               | Deployed status                                                                  | Deny result                        |
| --------------------- | ------------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------- |
| First connector       | vendor integration owner | Metorial Search is a documented probe candidate                    | No pinned deployment, literal tool, or account probe exists                      | `connector_evidence_incomplete`    |
| D1 guarded create     | database owner           | Local workerd exercises disposable SQL and rollback handling       | Two-writer histories, capacity, and audit contention not run                     | `control_store_unverified`         |
| Gateway reservation   | capability gateway owner | Local workerd exercises reservation and SQL sink behavior          | Cross-network writers and private non-deduplicating sink not run                 | `gateway_reservation_unverified`   |
| Metorial provisioning | vendor integration owner | Session creation is documented                                     | Ambiguous-create reconciliation not run                                          | `metorial_provisioning_unverified` |
| Metorial cleanup      | vendor integration owner | Multiple connections per session are documented                    | Second-client cleanup probe not run                                              | Claim only local gateway denial    |
| OpenRouter route      | vendor integration owner | One candidate model and provider are recorded below                | Real completion, metadata, key, and budget probes not run                        | `model_route_unverified`           |
| Runtime wire protocol | runtime owner            | Local request and frame contracts exist                            | Restart, replay, import acknowledgement, and private-route preview probe not run | `runtime_protocol_unverified`      |
| Sandbox execution     | runtime owner            | Isolation, lifecycle, egress, placement, and limits are documented | Candidate only; DNS and other deployed probes have not run                       | `code_execution_unverified`        |
| D1 Better Auth        | identity owner           | SQLite Drizzle adapter and database rate limits are documented     | Closed-registration and session probes not run                                   | `identity_store_unverified`        |
| Jurisdiction          | platform owner           | Profile-specific placement concepts are documented                 | No complete deployed compatibility observation exists                            | `jurisdiction_unverified`          |
| R2 artifact workspace | artifact owner           | Not evaluated for release                                          | Deferred by decision                                                             | `artifact_workspace_not_enabled`   |
| PostgreSQL profile    | database owner           | Drizzle and Better Auth support the dialect                        | No profile package or deployed origin                                            | `database_profile_unsupported`     |
| MySQL profile         | database owner           | Drizzle and Better Auth support the dialect                        | No profile package or deployed origin                                            | `database_profile_unsupported`     |

## Metorial

### Verified documentation

Metorial documents these capabilities:

- A session attaches one or more provider deployments and returns a `connection_url` for MCP clients.
- Each attached provider accepts an allow filter with literal tool keys.
- A session may have multiple independent MCP or direct-tool connections.
- A provider deployment combines a provider version, configuration, and optional auth configuration.
- OAuth setup sessions return an auth-config reference after completion.
- Session messages include input and output. OpenBot therefore must not import them by default.

Sources:

- [Sessions](https://metorial.com/docs/concepts-sessions)
- [OAuth](https://metorial.com/docs/sdk-oauth)
- [Provider concepts](https://metorial.com/docs/concepts-providers)
- [Metorial glossary](https://metorial.com/docs/glossary)
- [Metorial API reference](https://metorial.com/api)

### What documentation does not establish

Public docs do not provide the installation-specific deployment ID, selected provider version, exact read-only tool keys, canonical input and output schemas, OAuth scopes, resource-level enforcement, incidental effects, result limits, or bearer cleanup semantics needed by OpenBot.

Metorial's catalog advertises more than 1,000 integrations, but catalog breadth is not evidence that one exact tool is read-only or resource-scoped. No catalog marketing label closes the connector gate.

### Adoption result

`metorial-search` is the first probe candidate because Metorial documents it as requiring no operator-supplied provider auth config. It is a public-web reader, not an organization-resource connector. The candidate therefore uses the `global_public_read_only` resource rule and admits only public or synthetic probe input. Its `operator_supplied_provider_auth_config_present: false` flag and target class are descriptive, not authority. Before policy implementation, the compiler must bind them to an opaque verified `first_connector` decision whose signed claims name the exact deployment, tool key, schemas, resource rule, and admitted classes. It cannot serve the normal owner-prompt path. It remains blocked until a dedicated Metorial environment supplies a pinned deployment, one literal query-only tool key, canonical input and output schema digests, read-only tag readback, bounded results, two independent MCP calls, and cleanup observations.

An organization connector uses the separate `connector_specific` resource rule. Metorial resource URI filters select MCP resources; they do not prove that a tool argument is limited to one repository, mailbox, drive, channel, or account. That proof requires a reviewed argument mapper plus provider-side enforcement and a sibling-target denial. An unsupported mapping returns `resource_scope_unsupported` before session creation.

The management probe sends `Metorial-Version: 2026-01-01-magnetar` and records the exact observed SDK and generated-client versions. The current official package tree declares `metorial@3.0.9`, `@metorial/sdk@3.0.9`, and `@metorial/generated@3.0.2`. These are research observations, not installed dependencies or product authority. The probe must verify the exact resolved package integrity before use.

The cleanup probe must create a second client before cleanup, request cleanup, and then show what that second client can do. Until it passes, OpenBot may say that its gateway denied later calls. It may not say Metorial revoked the bearer URL.

The confirmation names Metorial and the connector provider as disclosure destinations. OpenBot's local retention setting does not remove input or output already recorded by either vendor.

## OpenRouter

### Verified documentation

OpenRouter documents request routing fields for `provider.order`, `allow_fallbacks`, `require_parameters`, `data_collection`, and `zdr`. Its ZDR list is machine-readable and changes over time. The model and provider catalogs expose literal model IDs, provider slugs, endpoint tags, supported parameters, and prices.

OpenRouter's ZDR definition permits in-memory prompt caching. OpenRouter also stores request metadata such as token counts and latency. ZDR is not a claim that no routing or usage metadata exists.

Sources:

- [Provider routing](https://openrouter.ai/docs/guides/routing/provider-selection)
- [Zero Data Retention](https://openrouter.ai/docs/guides/features/zdr)
- [Models API](https://openrouter.ai/docs/api/api-reference/models/get-models)
- [Providers API](https://openrouter.ai/docs/api/api-reference/providers/list-providers)
- [Generation metadata](https://openrouter.ai/docs/api/api-reference/generations/get-generation)
- [Router metadata](https://openrouter.ai/docs/guides/features/router-metadata)
- [Data collection](https://openrouter.ai/docs/guides/privacy/data-collection)
- [Tool calling](https://openrouter.ai/docs/guides/features/tool-calling)
- [API key creation](https://openrouter.ai/docs/api/api-reference/api-keys/create-keys)

### Candidate route observed from official public APIs

The normalized observation is committed in `docs/fixtures/openrouter-route.json`.

| Field            | Literal value                  |
| ---------------- | ------------------------------ |
| Model ID         | `mistralai/mistral-small-2603` |
| Provider slug    | `mistral`                      |
| ZDR endpoint tag | `mistral/zdr`                  |
| Tool support     | `tools`, `tool_choice`         |
| Prompt price     | `0.000000165` USD per token    |
| Completion price | `0.00000066` USD per token     |
| Context length   | 262,144 tokens                 |

This route is the only candidate for the first deployed probe. It is not active product authority. The route compiler must still require the exact model ID and provider slug, `allow_fallbacks: false`, `require_parameters: true`, `data_collection: "deny"`, and `zdr: true`. The observed endpoint does not list `parallel_tool_calls` support, so the candidate request omits that field. OpenBot rejects more than one tool call in a response turn before executing any tool.

### Unresolved probe

Use a run-owned key and send one bounded tool-capable request with router metadata enabled. Record the requested and resolved model and provider, direct strategy, attempt count, selected endpoint, pipeline stages, generation ID, ZDR result, usage, cost, price snapshot, key expiry, and key deletion. A fallback, second attempt, missing metadata, stale price, unsupported parameter, data-collection endpoint, context compression, plugin, server tool, or unknown pipeline stage denies the route. Router metadata is absent on cache hits, so the probe must test that history and use generation metadata or deny the result.

## Cloudflare D1, Durable Objects, and Sandbox

### Verified documentation

- D1 `batch()` executes statements sequentially and rolls back the batch on failure.
- One D1 database is single-threaded. Paid-plan databases are limited to 10 GB. A row or value is limited to 2 MB, and a query accepts at most 100 bound parameters.
- D1 supports `eu` and `fedramp` jurisdictions. Its location hints are not placement guarantees.
- Durable Objects support `eu`, `us`, and `fedramp` jurisdiction subnamespaces. Cloudflare recommends a jurisdiction subnamespace before `newUniqueId()`.
- Sandbox uses a Worker, Durable Object, and isolated Container VM. Files and processes are shared within one sandbox but isolated from other sandboxes.
- Sandbox files are ephemeral after stop unless storage is mounted. OpenBot mounts nothing in the first release.
- Sandbox internet access is on by default. `enableInternet = false` blocks public internet except explicitly allowed hosts or handlers. Outbound handlers run outside the container and can keep credentials in the Worker.
- Sandbox 1.0 preview uses argv process execution and process handles. A process lifetime timeout stops the supervised process, while observation timeouts stop only the wait.
- The `lite` Container class has 1/16 vCPU, 256 MiB memory, and 2 GB disk.
- Container placement supports `eu` and `fedramp`, but no `us` jurisdiction value.
- Sandbox runs on the Workers Paid plan. The exact 1.0 preview candidate observed from npm is `0.13.0-next.738.2`. The stable SDK and preview have different process APIs and must not be treated as interchangeable.
- The Agents SDK uses Durable Objects and persistent SQL state. Its MCP client persists connection state in Agent SQL and makes connected server tools available through that client.
- Code Mode is experimental. It lets model-written code compose configured tools across a sandbox boundary and leaves authorization in the upstream tool handler or host callback.

Sources:

- [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [D1 limits](https://developers.cloudflare.com/d1/platform/limits/)
- [D1 data location](https://developers.cloudflare.com/d1/configuration/data-location/)
- [Durable Object data location](https://developers.cloudflare.com/durable-objects/reference/data-location/)
- [Sandbox overview](https://developers.cloudflare.com/sandbox/)
- [Sandbox architecture](https://developers.cloudflare.com/sandbox/concepts/architecture/)
- [Sandbox security](https://developers.cloudflare.com/sandbox/concepts/security/)
- [Sandbox lifecycle](https://developers.cloudflare.com/sandbox/concepts/sandboxes/)
- [Sandbox 1.0 preview](https://developers.cloudflare.com/sandbox/1-0-preview/)
- [Sandbox 1.0 process execution](https://developers.cloudflare.com/sandbox/1-0-preview/processes/)
- [Sandbox 1.0 lifecycle](https://developers.cloudflare.com/sandbox/1-0-preview/lifecycle/)
- [Sandbox 1.0 environment](https://developers.cloudflare.com/sandbox/1-0-preview/environment/)
- [Sandbox outbound traffic](https://developers.cloudflare.com/sandbox/guides/outbound-traffic/)
- [Sandbox command behavior](https://developers.cloudflare.com/sandbox/api/commands/)
- [Container limits](https://developers.cloudflare.com/containers/platform-details/limits/)
- [Container placement](https://developers.cloudflare.com/containers/platform-details/placement/)
- [Agents API](https://developers.cloudflare.com/agents/runtime/agents-api/)
- [Agents MCP client](https://developers.cloudflare.com/agents/model-context-protocol/apis/client-api/)
- [Code Mode](https://developers.cloudflare.com/agents/tools/codemode/)
- [Code Mode MCP patterns](https://developers.cloudflare.com/agents/model-context-protocol/codemode/)

### Adoption result

D1 remains the first database. Drizzle owns its schema and migrations. Durable Object native SQLite owns run-local coordination. Sandbox code execution is adopted as a required first-release capability but remains disabled until its private no-D1 runner, image, exact SDK, gateway reservation protocol, egress tests, process timeout, restart handling, placement, and public-route denial pass.

The 256 MiB filesystem and eight-process values in the proposed profile are unverified targets, not hard limits. Cloudflare documents a 2 GB disk for `lite`; current evidence does not name an OS or platform mechanism for the smaller filesystem ceiling or process count. Those targets cannot enter an enabled profile until the mechanism and adversarial probes pass. Otherwise the contract must use the actual platform boundary.

The candidate egress state is `public_internet_blocked_unverified_dns`, not `deny_all`. Cloudflare documents that `enableInternet = false` denies public internet but still permits DNS through Cloudflare resolvers. The candidate accepts one server-seeded synthetic deployed probe and never accepts a user run.

The authoritative-domain probe must attempt randomized-token disclosure through every enumerated Node DNS path and image binary, then correlate the authoritative logs over a fixed observation window. A pass covers only the exact reviewed image, runtime, SDK, configuration, and attempted mechanisms. It does not establish universal no-egress. A failed or incomplete result blocks the code-enabled release and requires another executor or containment design.

Probe output is an untrusted report. Passing checks in that report never authorizes code. An operator process outside the repository and deployed Workers reviews the report, then may sign a canonical low-S P-256 attestation. The signed envelope binds the exact report, probe definition, collector build, configuration, installation, environment, deployment, required check-set version, decision, claims, validity interval, and signer key ID.

Bootstrap owns the gate-attestation public-key registry, clock, installation context, and trusted shared registry-generation reader. Neither a request nor a stored profile may supply them. Verification and final authorization read the current generation every time and deny on mismatch or read failure, including from an old isolate after registry rotation. Verification returns an opaque decision tied to the loaded generation, so parsed JSON or a decision produced under another registry cannot authorize code. A passed Sandbox decision grants a runtime approval lease for at most 24 hours. The profile references the exact attestation digest, configuration digest, and lease expiry. Every code authorization checks that reference, the opaque decision, current installation context, admitted classes, current generation, and current time. Expiry fails closed with `sandbox_profile_not_enabled`.

Historical signed bytes remain available for audit, but they have no authority after expiry. Renewal requires a newly signed envelope and an atomic profile-reference rollout before the old lease expires. A profile cannot become available to user code until a current reference is active. The record's `profile_digest` changes with adoption status, lifecycle, or attestation reference; the immutable `configuration_digest` does not.

An enabled profile may admit public, synthetic, or organization data. The organization compute policy and compute grant each narrow those classes and every numeric limit. The effective execution contract uses their intersection and componentwise minimum with Bot and installation ceilings. `restricted` and `unknown` remain denied. User prompts and skills default to `organization`, model-generated source inherits the highest contributing class, and public commands cannot lower it.

The profile must select `lite` or `basic`. `lite` is only the current probe candidate. The selection remains unresolved until the memory and capacity probes pass.

Worker RPC carries a strict request object, not stable original JSON wire bytes. The runner verifies the digest of a versioned canonical field projection. Kill requires the exact observed process handle. Destroy binds either active run-attempt authority or an exact cleanup-obligation ID and fence. Lifecycle results distinguish `sdk_acknowledged`, `not_found`, and `outcome_unknown`; none is independent proof that the container disappeared. A successful code result is one canonical JSON value with a matching terminal digest.

Use a manual Durable Object model loop and the bounded Sandbox runner. Do not adopt OpenCode, the Agents SDK, or Code Mode for the first release. The Agents MCP persistence model conflicts with run-scoped bearer handling, and Code Mode's code-to-tool bridge is outside the computation-only contract. This is an adoption decision, not a claim that Cloudflare lacks agent features.

The D1 profile supports only `automatic`, `eu`, and `fedramp` installation choices. `us` denies because D1 has no documented `us` jurisdiction. The Sandbox adds the same `us` blocker. External PostgreSQL or MySQL may later satisfy a US control-store requirement, but those profiles remain unsupported.

## Better Auth and Drizzle

### Verified documentation

Better Auth documents a Drizzle adapter for SQLite, PostgreSQL, and MySQL. It also documents database-backed rate-limit storage. Drizzle documents direct D1 support in Workers.

Sources:

- [Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle)
- [Better Auth rate limits](https://better-auth.com/docs/concepts/rate-limit)
- [Drizzle with D1](https://orm.drizzle.team/docs/sqlite/connect-cloudflare-d1)
- [Drizzle migrations](https://orm.drizzle.team/docs/migrations)

### Adoption result

Use Better Auth behind OpenBot's route allowlist and create it per Worker invocation. Use the profile's opaque auth storage adapter. Do not let Better Auth organization plugins replace `account_membership` or Bot authority.

The documentation does not prove closed registration, first-owner concurrency, cookie behavior behind the chosen origin, session rotation, or D1 request lifecycle. Those are deployed identity tests.

## Local repository observations

Observed without vendor credentials on 2026-08-22:

- Node 22 and pnpm 11.22.0 are pinned.
- D1 is the only database package. Its local Drizzle module now defines the planned logical tables, constraints, and Sandbox hard-limit constants, but there is no committed SQL migration or deployed database evidence.
- Worker shells exist for the control plane, orchestrator, capability gateway, Durable Object runtime, and private sandbox runner.
- A local sandbox-protocol package defines request digests, bounded stream frames, lifecycle request shapes, and hard-limit constants. The runner returns `sandbox_unavailable`; it does not call Cloudflare Sandbox yet.
- Wrangler disables `workers_dev`, preview URLs, and observability for the current Worker shells.
- No Cloudflare Sandbox SDK dependency, Container image, Sandbox Durable Object binding, R2 binding, PostgreSQL package, MySQL package, Metorial client, OpenRouter client, Better Auth implementation, vendor credential, committed D1 migration, or deployed probe result exists.
- The route fixture is an inventory. The current public application registers only its health endpoint.

These facts are not failures. They mark the exact boundary between repository foundation and item 2 implementation.

## Evidence handling

Preview evidence must store a redacted request shape, response field allowlist, vendor object IDs as keyed digests, timestamps, software versions, and the final decision. Never commit API keys, OAuth codes, auth-config IDs, MCP URLs, raw prompts, tool arguments, tool results, model responses, Cloudflare account IDs, or database IDs.

If a probe did not run, record `not_run`. Do not use `passed`, `verified`, or `supported` for an intended design.
