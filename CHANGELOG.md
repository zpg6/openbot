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
