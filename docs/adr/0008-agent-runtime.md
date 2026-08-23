# ADR 0008: Use a manual Durable Object loop and a bounded Sandbox runner

- Status: accepted for the first release
- Decision owners: runtime owner and security owner
- Recorded: 2026-08-22

## Decision

Do not use OpenCode, the Cloudflare Agents SDK, or Cloudflare Code Mode in the first release.

A plain Durable Object with native SQLite owns the run attempt, manual model loop, call-boundary journal, counters, and terminal tombstone. The capability gateway owns Metorial and OpenRouter data-plane calls. The private Sandbox runner supplies one bounded JavaScript computation through the reviewed execution profile. These pieces provide the selected product behavior without importing another runtime's tool registry, persistence rules, approval model, or code-to-tool bridge.

This is not a claim that those runtimes are incapable. It is a boundary decision. The first release exposes at most four known model tools, forbids provider-tool calls from model-written code, creates a fresh filtered Metorial session per run, and treats its URL as a run-scoped bearer capability. A general agent framework does not remove any of OpenBot's authorization, reservation, evidence, cleanup, or restart obligations.

## Verified Cloudflare behavior

Cloudflare documents these current behaviors:

- The Agents SDK `Agent` class uses a Durable Object and supplies persistent SQL state, client connections, scheduling, queues, workflows, and other agent facilities.
- Its MCP client persists connection state in the Agent's SQL storage. Connected server tools become available through that client.
- Code Mode is experimental. It lets generated code call configured tools across a sandbox boundary and says authorization remains in upstream tool handlers or the host callback.
- Cloudflare recommends direct tool calls for a small fixed tool set and Code Mode for composition, discovery, loops, or a large catalog.

Sources:

- [Agents API](https://developers.cloudflare.com/agents/runtime/agents-api/)
- [MCP client](https://developers.cloudflare.com/agents/model-context-protocol/apis/client-api/)
- [Code Mode](https://developers.cloudflare.com/agents/tools/codemode/)
- [Code Mode MCP patterns](https://developers.cloudflare.com/agents/model-context-protocol/codemode/)

## Why the native frameworks stay out

Persisting an MCP connection URL in Agent SQL conflicts with the rule that the Metorial bearer reference remains encrypted outside the run Durable Object and is discarded after one run. Automatically importing a connected server's tools also does not express OpenBot's intersection of organization policy, Bot selection, connector contract, provider grant, live tool-list digest, and manifest.

Code Mode is built to let generated code compose underlying tools. OpenBot's first code capability is computation only: it receives one JSON input, has no provider credential or outbound handler, and cannot call Metorial tools. Using Code Mode would add a bridge the product must then prove absent or re-authorize. The fixed Sandbox runner is the smaller contract.

OpenCode is unnecessary for the selected loop. OpenBot does not expose a coding workspace, editable repository, terminal, package installation, executable skills, subagents, browser, or arbitrary MCP registration. If one of those becomes an approved product capability, it receives its own authority and threat-model review before the runtime choice is reopened.

## Completion checks

- Runtime and Sandbox-runner bundles contain no OpenCode, Agents SDK, Code Mode, or AI SDK package.
- The run Durable Object contains no Metorial URL, auth-config reference, provider key, or reusable model key.
- Tool exposure comes only from the signed manifest and gateway checks; no framework registry can add a tool.
- One model request, one provider-tool call, and one JavaScript call can each cross their own gateway reservation and restart boundary without a framework retry.
