# ADR 0007: Bind keys, jurisdiction, and start confirmation to one installation

- Status: accepted with open compatibility probes
- Decision owners: security owner and release owner
- Recorded: 2026-08-22

## Key decision

Use separate key domains for browser sessions, operator authentication, manifest signing, prompt and result content, declarative skill content, Metorial auth references, per-run vendor capabilities, runtime envelopes, keyed record digests, and run-event authentication. There is no sandbox-dispatch signing key. The capability gateway's store owns execute reservations and replay prevention. It alone binds the runner's execute entry point. The orchestrator alone binds the runner's kill and destroy entry points. The runner has no authority or replay-store access, and neither caller receives the other method set.

Every encrypted record carries a key ID, format version, random 96-bit nonce, encryption domain, and authenticated context containing account ID, record ID, field type, and schema version. One service cannot decrypt a key domain it does not need. A lost active key is an operator-visible recovery failure, not permission to reset evidence.

The first implementation may use Cloudflare secrets for active key material, but it must document backup, restore, overlap, rewrap, and retirement before production. Cloudflare secret storage does not remove the need for application envelope formats and key separation.

## Jurisdiction decision

An installation selects `automatic`, `eu`, `us`, or `fedramp` once. The setting is disclosed and cannot change in place. D1 documents `eu` and `fedramp`. Durable Objects document `eu`, `us`, and `fedramp`. Container constraints document `eu` and `fedramp`. The D1 profile cannot satisfy the OpenBot `us` choice. Metorial and the candidate OpenRouter route still lack a complete placement record.

A location hint is not a residency guarantee. OpenBot enables a run only when every disclosure destination has a compatible recorded placement rule. Missing mapping returns `jurisdiction_unverified`.

## Confirmation decision

Submitting a task creates a five-minute, session-bound confirmation. It shows the exact prompt, Bot and catalog revisions, code-execution capability, enabled active execution `profile_digest` and immutable `configuration_digest`, tool allowlist, inherited data class, disclosure destinations, expiry, and effective numeric limits. Code execution names Cloudflare Sandbox. A candidate, disabled, or evidence-expired profile never reaches confirmation. The effective code classes and limits are the intersection of profile, organization policy, compute grant, Bot, and installation ceilings. Restricted and unknown data always deny. The user cannot lower the inherited class. `Start run` creates a new independent run. It does not approve a provider business-data write and never creates an `Always allow` rule.

Any changed prompt, revision, connector schema, resource mapping, model route, code limit, destination, grant fence, or jurisdiction makes the confirmation stale. The server recompiles and compares exact bytes before run creation.

## Deferred claims

- No provider business-data writes before a digest-bound write broker passes its own gate.
- No immutable-ledger claim. The audit is an append-only application record with a hash link, and an operator with database authority can still alter storage.
- No artifact encryption claim. R2 artifacts do not exist in the first release.
