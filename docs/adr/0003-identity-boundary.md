# ADR 0003: Use Better Auth behind an OpenBot allowlist

- Status: accepted with open D1 identity gate
- Decision owner: identity owner
- Recorded: 2026-08-22

## Decision

The first release uses Better Auth email and password sessions stored in the selected control database through its Drizzle adapter. Public registration stays closed. OpenBot creates the first owner through a separate, audited operator-token flow.

The control plane constructs Better Auth for each Worker invocation with that invocation's database adapter. It exposes only the committed sign-in, session-read, password-change, and POST sign-out routes. Every unlisted Better Auth route fails before dispatch.

`account_membership` is the only path from an authenticated user to organization authority. Better Auth proves identity. It does not grant a Bot, connector, model, sandbox, or artifact capability.

## Browser rules

- Pin the HTTPS origin. Do not derive it from `Host` or forwarded host headers.
- Use a secure host-only session cookie with `HttpOnly`, `SameSite=Lax`, and `Path=/`.
- Check `Origin` and a synchronizer CSRF token on every OpenBot browser mutation.
- Store rate-limit counters in the database and enable them in every environment.
- Rotate the session after login, password reset, and authority changes.
- Return uniform login failures and never reflect password or token fields.

## Open gate

Better Auth documents a Drizzle adapter for SQLite and database-backed rate limits. OpenBot still needs deployed D1 tests for closed registration, first-owner races, request-scoped construction, session rotation, password vectors, and the exact route allowlist. Identity work denies until those tests pass.
