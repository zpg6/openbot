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
