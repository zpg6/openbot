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
