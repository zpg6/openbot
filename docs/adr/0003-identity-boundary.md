# ADR 0003: Use Better Auth magic links and organizations behind an OpenBot allowlist

- Status: accepted with open D1 identity gate
- Decision owner: identity owner
- Recorded: 2026-08-22

## Decision

The first release uses Better Auth's magic-link and organization plugins. Better Auth owns users, sessions, organization records, memberships, invitations, roles, and the active organization on a session. OpenBot does not maintain a parallel membership table.

Signing in with a magic link may create a user. After sign-in, OpenBot resolves invitations for that verified email. An invited user accepts the invitation before entering that organization. A user with no accepted membership must create an organization before entering the product. Creating an organization makes the creator its owner and sets it active. A returning member with no valid active organization selects one of their current memberships; a removed member cannot keep using a stale active-organization value.

The control plane constructs Better Auth for each Worker invocation with that invocation's database binding. It mounts only the reviewed magic-link, session, sign-out, organization, membership, and invitation endpoints required by these flows. Every unlisted Better Auth route fails before dispatch. Better Auth and its plugins use the same pinned HTTPS origin; OpenBot does not enable cross-origin auth requests.

Better Auth's active organization and current member role are the identity and tenancy boundary. They are not provider authority. OpenBot stores organization integrations, exact organization tool-policy ceilings, Bot permission subsets, routine revisions, confirmations, run fences, and audit records keyed by the Better Auth organization ID. The effective provider-tool set is the intersection of the current organization ceiling, the immutable Bot revision, the current connection grant, and the provider's current reviewed tool set.

Organization roles authorize OpenBot action classes only after a fresh membership read. Owners may manage organization connections, global permission ceilings, invitations, and member roles. Members may use Bots within the current organization ceiling. No Better Auth role directly grants a connector, model, sandbox, artifact, Bot, routine, or Metorial tool capability.

Changing an organization ceiling or connection appends a new OpenBot revision and advances a revocation fence. Pending confirmations become stale, queued runs are denied, and the private gateway rechecks the fence and exact policy pins before every provider dispatch. A vendor call already dispatched may become `outcome_unknown`; permission removal cannot recall an external side effect.

## Browser rules

- Pin the HTTPS origin. Do not derive it from `Host` or forwarded host headers.
- Use a secure host-only session cookie with `HttpOnly`, `SameSite=Lax`, and `Path=/`.
- Check `Origin` and a synchronizer CSRF token on every OpenBot browser mutation.
- Store rate-limit counters in the database and enable them in every environment.
- Magic-link tokens are single-use, short-lived, stored only as digests by the identity system, and never returned by OpenBot views or logs.
- Return the same magic-link request response for existing, invited, and new email addresses.
- Accept an invitation only in a session whose verified email matches the invitation. Invitation metadata on a magic-link request is navigation context, not authority.
- Re-read active membership on every privileged mutation, confirmation, run claim, and provider dispatch. Clear or replace an active organization that no longer has a membership.
- Rotate the session after sign-in and security-sensitive membership changes. Never reflect session, invitation, magic-link, provider-auth, or connection-grant tokens.

## Open gate

The Better Auth dependency, secure magic-link and organization configuration, database-backed rate-limit configuration, cookie policy, and exact raw-handler allowlist are pinned and unit tested. OpenBot still needs a generated reviewed D1 migration, request-scoped mounting, real email delivery, and deployed D1 tests for magic-link enumeration, single-use redemption, invite/email binding, organization-creation races, active-organization switching, membership removal, session rotation, and stale-session denial. Production identity remains disabled until those tests pass.
