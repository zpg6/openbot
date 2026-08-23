# Support

OpenBot has no supported release yet. The current repository is for design and early implementation, not production workloads.

## Ask for help

Use a public issue for a reproducible problem with repository code or documentation. Search existing issues first. Include:

- the commit or release
- the database profile and deployment environment
- the command you ran
- the expected and observed result
- a minimal reproduction with synthetic data
- redacted logs and a stable OpenBot error code or request ID when available

Remove account data, prompts, model output, tool arguments and results, OAuth state, Metorial references, MCP URLs, cookies, API keys, database URLs, and Cloudflare secrets. If a report cannot be made safe for public view, use the private path in [SECURITY.md](SECURITY.md).

Questions about a Cloudflare, Metorial, OpenRouter, connector, or database outage may need that vendor's support channel. Include OpenBot evidence only after redaction.

## What maintainers can provide

Maintainers may help reproduce a defect, explain a documented contract, or review a focused patch. Response times depend on volunteer availability. The project does not provide an uptime commitment, emergency response, private deployment support, or account recovery.

General installation help will be documented after the read-only release gate passes. Until then, [PLAN.md](PLAN.md) is the accurate statement of intended deployment and limits.

## Feature requests

Check the explicit deferrals in [PLAN.md](PLAN.md) before opening a request. Describe the authority, storage, cleanup, user interface, and failure behavior the feature would need. Requests that weaken fail-closed behavior need a concrete replacement control.
