# ADR 0005: Keep vendor credentials outside the runtime and sandbox

- Status: accepted with open vendor gates
- Decision owners: vendor integration owner and runtime owner
- Recorded: 2026-08-22

## Decision

The capability gateway builds every Metorial and OpenRouter request after it reloads current authority and consumes a sequence reservation. The Durable Object and sandbox never receive a Metorial management key, auth-config reference, MCP URL, OpenRouter key, model alias, provider list, or arbitrary URL.

Metorial bearer references are encrypted per run. The gateway decrypts one reference for one connection, verifies the live tool list against the signed manifest, makes one call, closes the client, and discards protocol state.

OpenRouter receives one literal model ID and one literal provider slug. The request denies fallbacks, requires all sent parameters, denies data-collection endpoints, requires ZDR, and sets explicit output limits. The candidate endpoint does not advertise `parallel_tool_calls`, so the request omits it and OpenBot rejects a response turn containing more than one tool call before any tool execution. A route mismatch becomes an evidence failure even when the model produced an answer.

Sandbox user code runs with `enableInternet = false` and no allowed host. This blocks public internet according to Cloudflare's documented model, but DNS still uses Cloudflare resolvers. The candidate profile remains `public_internet_blocked_unverified_dns`, accepts only a server-seeded synthetic deployed probe, and never accepts a user run.

The candidate may become `enabled` only after an operator-controlled authoritative-domain probe observes no randomized sentinel from every enumerated Node DNS path and image binary during the fixed observation window. A pass records coverage for those observed paths on the exact image, runtime, SDK, and configuration. It is not proof that DNS exfiltration is impossible. The raw report is untrusted. A canonical low-S P-256 attestation must bind its digest to the exact configuration, installation, environment, deployment, and check-set version. The resulting runtime approval lease lasts no more than 24 hours, expires closed, and must be checked on every code authorization. Any failed or incomplete probe blocks the code-enabled release and requires another executor or containment design.

The private sandbox runner has no D1 binding and makes no authorization decision. The run-owned Durable Object calls the capability gateway with its run token and next sequence. The gateway atomically consumes one stored reservation, then passes its ID, a strict request object, and the digest of its versioned canonical field projection through the exclusive `SandboxExecutionService.execute` binding. The gateway store owns execute replay prevention. The orchestrator separately holds the only `SandboxLifecycleService.kill` and `.destroy` binding and sends mechanical fenced lifecycle commands. Neither caller gets the other method set. The runner reconstructs and verifies each canonical field projection and enforces the fixed protocol before the matching Sandbox SDK call. There is no generic actor union, dispatch-signing key, or bearer receipt.

Any future outbound access must use a named Worker-side handler that authenticates the run, rebuilds the request, and injects credentials outside the container. A hostname allowlist is containment, not authorization.

## Current candidate route

Official OpenRouter catalog responses observed on 2026-08-22 list model `mistralai/mistral-small-2603`, provider slug `mistral`, a ZDR endpoint tagged `mistral/zdr`, tool support, and prompt and completion prices of `0.000000165` and `0.00000066` dollars per token on that endpoint. Its metadata does not list `parallel_tool_calls`; the candidate therefore omits that parameter.

This is a probe candidate, not a released route. A real request must still prove no fallback, ZDR enforcement, resolved provider metadata, key expiry, generation reconciliation, and budget behavior. Until then the route gate returns `model_route_unverified`.

## Connector result

Metorial Search is the blocked first probe candidate because it requires no operator-supplied provider auth config and reads public web data. Public documentation proves that sessions accept per-provider tool allowlists and return an MCP connection URL. It does not publish an installation's deployment ID, pinned provider version, exact tool keys, canonical schemas, result limits, or cleanup behavior. A dedicated environment must supply those literals and two independent MCP calls before the candidate can pass. The candidate admits only public or synthetic probe input and cannot serve the normal owner-prompt path. The first-connector gate still returns `connector_evidence_incomplete`.

The candidate uses the `global_public_read_only` resource rule. Its `operator_supplied_provider_auth_config_present: false` flag and target class are descriptive until the policy compiler binds them to an opaque verified `first_connector` decision with exact signed claims. It cannot admit organization data or claim resource-level isolation. Other connectors require a `connector_specific` rule with a reviewed argument mapper, provider enforcement, and a sibling-target denial. Metorial resource URI filters alone do not satisfy that rule.

Metorial's dashboard groups provider tools as read-only, write, and destructive. Its underlying provider-tool contract supplies nullable `readOnly` and `destructive` booleans, not an authoritative category enum. OpenBot stores a normalized `read_only` copy and accepts only internally consistent combinations. Read is raw `readOnly: true` with `destructive` absent or false. Write is raw `readOnly: false` with `destructive` absent or false. Destructive is raw `readOnly: false` with `destructive: true`. Missing, null, contradictory, unknown, or drifted metadata becomes `unclassified` and stays disabled until a new connector release supplies sufficient classification evidence. A composite tool receives the highest effect of any operation it can perform.

Bot permission revisions pin the exact tool key, provider deployment and version, connector release, schema digest, policy revision, and policy digest. The three display groups only bulk-edit those policies. Every Metorial session uses literal `tool_keys` filters for each provider. OpenBot rejects an omitted filter, `allow_all`, tool or resource regex, prompt filters, and parent-filter override state. It checks returned filter equality and exact MCP `tools/list` equality. Effective access is the intersection of the organization ceiling, Bot revision, user connection grant, and current provider tool set. Provider changes can remove access but never add it without review.

OpenBot's redacted audit is authoritative for the product. Metorial session and tool-call logs supplement it with provider execution detail. Normal users do not receive Metorial dashboard access, vendor record identifiers, or raw logged payloads. A future role-checked owner/admin view may follow one configured path on the fixed `https://app.metorial.com` origin. Metorial does not document a stable URL for an individual log record, so OpenBot does not construct one.

Primary sources:

- [Provider concepts](https://metorial.com/docs/concepts-providers)
- [Provider skills and dashboard tool groups](https://metorial.com/docs/product-provider-skills)
- [Provider tools API](https://metorial.com/api/provider-tools)
- [Generated provider-tool type](https://github.com/metorial/metorial-node/blob/main/sdk/gen/src/mt_2026_01_01_magnetar/resources/providers/tools/get.ts)
- [Generated session-create type](https://github.com/metorial/metorial-node/blob/main/sdk/gen/src/mt_2026_01_01_magnetar/resources/sessions/create.ts)
- [Metorial tool tag declaration](https://github.com/metorial/metorial/blob/main/packages/provider/src/action/action.ts)
- [Jira comment tool classifications](https://github.com/metorial/metorial/blob/main/integrations/jira/src/tools/manage-comments.ts)
- [Monitoring](https://metorial.com/docs/concepts-monitoring)
- [Activity review](https://metorial.com/docs/review-activity)
- [Tool calls API](https://metorial.com/api/tool-calls)
