# Changelog

OpenBot records user-visible and operator-visible changes here. The project follows Keep a Changelog and uses semantic versioning once releases begin.

## Unreleased

### Added

- Initial implementation plan for the self-hosted read-only Bot runtime.
- TypeScript repository foundation, core contracts, and public project documentation.
- Cloudflare Workers tests use the current Vitest plugin package.
- First-release JavaScript execution contracts for one run-owned Cloudflare Sandbox, with separate compute grants, private runner protocols, strict limits, and explicit cleanup state.
- Strict untrusted Item 2 probe-report contracts and recorded blocker inspection, with no gate-promotion authority.
- P-256 gate-attestation verification, shared-generation revocation, typed connector claims, and opaque Sandbox decisions. Raw reports and copied decisions cannot authorize execution.
- Hermetic disposable-D1 protocol tests and a blocked deployed two-writer probe contract for guarded create, gateway reservation, Sandbox capacity, and audit contention.
- Fail-closed adjudication contracts for deployed D1 evidence, including exact worker participation, primary readbacks, ambiguity cases, and cleanup commitments. Adjudication remains non-authoritative and does not promote a gate.
- Bot identity and permission foundations with palette identity, a deferred internal local-icon contract, reserved owner/admin/user role vocabulary, exact pinned tool selections, read/write/destructive views, proposal-only provider mutations, server-authored connection cards, and a provider-activity view contract for a future role-checked use case.
- Offline D1 gate-attestation signing with mandatory report adjudication, canonical low-S P-256 output, a separate reviewer record, and private-key input isolated to file descriptor 3.
- Private D1 probe preflight planning with HMAC-committed Cloudflare resources, production-database denial, and a fail-closed create and cleanup journal. The command performs no deployment and cannot promote a gate.
- Private D1 probe receipt RPC with role-pinned writer entrypoints, a non-deduplicating D1 sink, explicit post-call uncertainty, and local-only Worker dry runs. No public probe route or deployment command exists yet.
- Guarded local-only D1 gateway-reservation writers with exact replay and substitution denial, one post-commit sink call, fixed crash and response-loss faults, and no automatic retry or gate-promotion path.
- A local-only one-use gateway trial envelope and D1 readiness barrier that bind each assigned child and GO receipt before gateway reservation. No public trigger or deployment was added.
- An unwired D1 probe Writer HTTP adapter that requires an exact Access service-token identity, canonical bounded JSON, a fixed route, and role-bound execution. Checked-in Workers remain private and route-free.
- A private D1 probe network transport and parent-only child command that bind canonical assignment, READY, GO, credential-file-descriptor, request, and result boundaries. The child reads the Access secret only after valid GO, sends once without retry, and adds no root command, stored credential, route, or deployment.
- A private two-child D1 gateway coordinator that binds one Writer A and Writer B trial, waits for both READY messages before GO, bounds each child result, and terminates partial or substituted runs as inconclusive. It remains an unregistered library and cannot promote a gate.
- A private D1 gateway parent command with canonical stdin, file-descriptor-only Access credentials, signal-driven child cleanup, fixed exit codes, and no root command or deployment path.
- An opaque D1 preflight verification boundary that recompiles the complete HMAC-bound plan, rejects substituted canonical bytes, freezes resolved deployment inputs, and retains no commitment key.
- HMAC-bound D1 probe routing that derives two exact Writer paths, one exact readback path, their target scripts and methods, and one narrow Access application path from a canonical HTTPS origin.
- A non-authoritative D1 route-readback inspector that binds the verified preflight to an active full Cloudflare zone and a complete exact-name proxied DNS projection. It performs no API call or deployment and cannot authorize either.
- A private read-only D1 route-check command with canonical standard input, file-descriptor-only HMAC and Cloudflare credentials, fixed zone and DNS endpoints, bounded responses, and no credential or raw-ID output. It cannot mutate, deploy, or authorize a gate.
- An unwired D1 creation adapter that requires an opaque live route observation, rechecks the HMAC-bound preflight and lifecycle journal, enables read replication, binds jurisdiction, and makes ambiguous creation terminal without exposing the returned database ID.
- An unwired one-use D1 deletion adapter that rechecks the opaque created target and lifecycle binding, makes ambiguous responses terminal, and records Cloudflare acknowledgement without claiming verified absence.
- An unwired D1 absence read that checks bounded Cloudflare list pagination for the exact created ID and name, while leaving final cleanup confirmation and gate authority unavailable.
- An opaque D1 database-absence context that binds the exact created target and lifecycle journal. Forged or copied objects cannot satisfy the future cleanup matcher.
