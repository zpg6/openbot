# ADR 0009: Run D1 concurrency probes on disposable deployed resources

- Status: accepted contract, probe not run
- Decision owner: database owner
- Recorded: 2026-08-23

## Decision

OpenBot will test its guarded D1 operations against one newly created disposable Cloudflare D1 database before the D1 schema freeze. Local D1 and Miniflare runs can catch SQL mistakes, but they cannot satisfy this gate.

The probe deploys two writer Workers with distinct script names and version IDs. Both bind the exact same disposable database ID. A third Worker is the synthetic sink and readback service. The sink has its own script name and version ID. Each writer has one narrow service binding to the exact sink script. The report commits the canonical binding configurations. The sink deployment sends 100 percent of traffic to one version, and the awaited RPC response reports that runtime version for comparison with the deployment record. The sink records every request under a new random receipt and never deduplicates requests. A fourth, operator-side driver starts each competing request in a separate process. The driver sends those requests across the network. A `Promise.all` inside one Worker invocation is not evidence of two writers.

All generated names use the recorded safe prefix and a random lowercase suffix. The Cloudflare account and zone IDs are real operational identifiers. The report stores only their domain-separated HMAC commitments. Probe installation IDs, run IDs, calls, receipts, and payloads are synthetic. The probe must reject a production database ID, a reused database, a name outside the prefix, or a resource whose returned ID does not match the create response captured for this probe run.

The writer trigger routes are temporary HTTPS routes protected by Cloudflare Access. They accept one fixed method and path, an Access-authenticated operator, a run-bound one-use request, and no SQL or arbitrary table name. Cloudflare routes do not enforce methods, so each Worker rejects every other method, path, query string, media type, body size, or body shape. `workers.dev` and preview URLs stay disabled. Writers reach the sink through awaited service-binding RPC methods. Access context does not cross that binding, so only the public fetch handlers require Access identity.

The sink/readback Worker also has one temporary Access-protected readback route. It accepts only an exact `GET` path for the generated probe run and returns one fixed response schema. It accepts no SQL, table name, filter, or caller-selected ID. Cleanup first closes a stored run fence so both writers reject new work. Access and all three exact routes remain active until the final first-primary read completes. Cleanup then revokes the service token and removes every route before deleting any Worker.

## Operator preflight

`pnpm d1-probe:plan` is the implemented preflight boundary. It is private Node-only code with no package export. It accepts no arguments, reads one bounded canonical JSON request from standard input, and reads the unpadded HMAC key only from file descriptor 3. It performs no network request, Cloudflare mutation, report assessment, or gate promotion. The emitted plan states that it is non-authoritative and that no deployment occurred.

The operator creates every 16-character lowercase suffix with a cryptographically secure random source before invoking the command. Preflight validates syntax and pairwise uniqueness; it does not treat that validation as evidence of randomness. The plan stores domain-separated HMAC commitments for the real Cloudflare account and zone, every operator-listed production database ID, and each generated resource name. The lifecycle journal copies those commitments from the plan. Every resource event must match the planned name and exact returned resource ID. Database creation stops if the returned database ID commitment matches the operator deny-list.

The journal accepts only the fixed create and cleanup prefix below. Skipped, repeated, renamed, or substituted resources deny. An ambiguous create, delete, in-flight state, or absence observation moves the journal to terminal `manual_required`; the operator cannot continue the same plan blindly. This preflight and journal make a later deployment driver safer, but they do not implement that driver or close a D1 gate.

## D1 execution rules

Every writer creates a D1 session with `withSession("first-primary")`. It issues each guarded operation once. OpenBot adds no application retry. D1 may retry read-only queries, so the collector records `total_attempts` and does not require it to equal one. For a committed batch, the writer returns the session bookmark, each `RETURNING` row, and the `D1Result` metadata for every statement. A recognized rejected batch need not produce a bookmark; its fresh first-primary no-partial-write readback is decisive. The collector shape-checks and records result count, success flags, changes, rows read, rows written, database-change flag, `served_by`, primary-serving flag, region, duration, SQL duration, total attempts, last row ID, and database size. Metadata counters are diagnostic. They do not prove which row changed. Exact `RETURNING` identity and cardinality, followed by fresh first-primary readback, decide the history.

An intentional tripwire rollback returns a recognized D1 constraint failure instead of successful statement metadata. The collector must distinguish that expected rejection from an unknown failure and prove through first-primary readback that the batch left no guarded rows. A missing, malformed, contradictory, or lost Worker, sink, D1 result, or D1 error response makes the trial inconclusive.

Setup enables D1 read replication and reads that setting back from the deployed database. The required `served_by_primary` metadata field must equal `true`. An absent or false value makes the trial inconclusive. Setup also reads back foreign-key enforcement and runs an isolated failing tripwire canary. First-primary readback must show that the canary batch left no rows. A probe cannot rely on guarded batches until both setup checks pass.

Only the first query in a `first-primary` session is guaranteed to use the primary. Each decisive snapshot therefore uses one aggregate SQL statement in a fresh session, or one fresh session for every `SELECT`. The collector also opens a session from each returned writer bookmark and checks that writer's receipt. Bookmark reads are supporting evidence. Only the fresh first-primary query decides the final history. The report records the configured read-replication setting, observed `served_by_primary: true` metadata, compatibility date, committed database ID, script IDs, deployment IDs, runtime-observed version IDs, bookmarks, and result metadata.

The parent driver forks one child per contender. Guarded-create, gateway, and audit trials use two children. Capacity uses five. Each child signals local readiness over IPC and waits. The parent sends one `GO` message to each child and records one receipt per child. Each child sends exactly one network request to its assigned Worker. Each Worker records a readiness row tied to that child. The report binds the child, readiness-row, `GO` receipt, and network-request identity sets. Each Worker polls with fresh first-primary sessions until every contender is ready before running its guarded batch once. The audit trial also records the same expected sequence and head hash. A timeout, worker restart, lost writer or sink response, unknown platform result, malformed response, or missing ready row is inconclusive. The driver does not rerun the same request ID to turn an ambiguous result into a pass.

## Guarded create and revoke

Probe-only tables model an active authority row, a live-confirmation slot, a confirmation, a run, a cancellation outbox row, and an assertion row whose foreign key points at the run. They are not product migrations.

The create writer executes one D1 batch. It conditionally consumes the exact confirmation and clears its live-confirmation slot while authority is active, inserts the run, and inserts the assertion. The assertion is an intentional foreign-key tripwire. If the guarded statements did not create the exact run, the tripwire fails and D1 rolls back the batch.

Revoke invalidates the dependent confirmation and clears its live-confirmation slot. If the run already exists, revoke changes it to `cancellation_requested` and inserts one cancellation outbox row in the same guarded batch. The probe forces and then verifies these histories:

1. Create commits first. It consumes the confirmation and clears the live-confirmation slot. Revoke commits second. The first-primary read shows the consumed confirmation, a clear slot, one `cancellation_requested` run, one assertion, one cancellation outbox row, and revoked authority.
2. Revoke commits first. It discards the dependent confirmation and clears the live-confirmation slot. Create reaches the tripwire and the batch rolls back. The first-primary read shows the discarded confirmation, a clear slot, no run, no assertion, no cancellation outbox row, and revoked authority.
3. An equal-release race produces exactly one of those two histories. Any third state fails.

The race repeats with writer roles swapped. The report records both deployment identities for every trial.

## Gateway reservation

The probe runs the same contention case for `model`, `provider_tool`, and `code`. Two writers receive the same synthetic call kind, logical call ID, attempt ID, sequence, request digest, and reservation key. A unique reservation plus a foreign-key tripwire lets exactly one writer commit the spent reservation. Only that writer may call the sink.

The sink records every received request before replying. It creates a new random receipt for each request and does not deduplicate on call kind, call ID, attempt ID, reservation ID, or request digest. The first-primary read must show one spent reservation and one sink receipt. The losing writer must show a guarded denial and no outbound call.

Each call kind also runs a changed-digest contention case. One exact request may commit. The request with the substituted digest must receive a guarded denial and must not create another sink receipt.

Two fault trials are mandatory. In the reserve-crash trial, the winning writer stops after the reservation commit and before the sink call. Readback must show one spent reservation and zero sink receipts. The outcome is `outcome_unknown`; no retry occurs. In the response-lost trial, the sink records one receipt but its response never reaches the writer. Readback must show one spent reservation and one receipt. The outcome remains `outcome_unknown`; no retry occurs. These trials prove that the reservation prevents duplicate dispatch. They do not claim delivery certainty.

## Sandbox capacity

The disposable database starts with a capacity limit of four and zero claims. Five independent requests, split across both writer deployments, contend for distinct synthetic claim IDs. A conditional claim plus a foreign-key tripwire must commit four claims and deny the fifth before any synthetic platform call.

Capacity release requires a sink-recorded destroy observation bound to the exact installation ID, run ID, run-attempt fence, claim ID, sandbox ID, and random destroy receipt. Separate typed operations substitute each value in turn. Release before observation, every mismatched target, and replayed release must not change capacity. One matching release decrements the reserved count once, after which the fifth claim commits. An unknown or lost destroy response does not count as an observation and leaves the claim reserved for manual review.

## Audit head

Both writers read the same first-primary audit head, record the same expected sequence and hash, and stop at the barrier. They propose different synthetic event IDs and hashes. After release, one guarded batch appends the next event and advances the head. The other conflicts and rolls back. First-primary readback must show one next-sequence event and its matching head.

The loser then performs a separate follow-up command. It reads the new head, uses a new attempt ID, appends at the next sequence, and commits. This is an explicit second phase, not an automatic retry of an ambiguous request. Separate operations prove that a stale sequence, a gap, and the wrong previous hash are denied without splitting the head from the event chain. Final readback must show an unbroken two-entry chain.

## Evidence and authority

The checked-in fixture at `docs/fixtures/d1-concurrency-probe.json` is a deployment contract. Its status is `not_run`. It contains no observations and cannot promote `d1_guarded_create` or `gateway_reservation`. The preflight plan and lifecycle journal also carry no such authority.

A deployed collector emits either a strict candidate-pass report or a typed `inconclusive` or `manual_required` failure envelope. The candidate report uses `platform` equal to `cloudflare_d1_deployed` and required check-set version 1. Its pre-run deployment projection commits the Cloudflare account and zone, exact database, Worker scripts, deployments, routes, Access resources, binding configurations, generated-name guards, and operator database deny-list. Setup and runtime observations remain outside that deployment digest. The report also binds the probe configuration, collector build, installation, environment, probe run, final current-state digest, cleanup outcome, and redacted transcripts. Each identity type uses one shared domain-separated HMAC preimage across all roles, so reusing one script cannot produce distinct commitments. The assessment recomputes the deployment and final-state digests and compares every context digest with operator-supplied expected values. Every required trial must finish without an inconclusive result. Failure envelopes are valid records but never eligible for review. The pure gate-evidence assessment must return `eligible_for_operator_review` before the offline operator command may sign a candidate report. That result is not authority. A report, fixture, local run, assessment result, or `passed` field has no authority by itself.

The typed gate-evidence contract requires Sandbox-capacity and audit-head checks under the D1 gate, plus separate `model`, `provider_tool`, and `code` coverage under the gateway gate. Schema freeze remains blocked until a deployed report passes those checks.

## Cleanup

Cleanup uses only the exact resource IDs returned during this probe and checks every generated name against the recorded prefix.

1. Close the stored probe-run fence. Reject new trial starts while retaining Access on every active route.
2. Wait for the recorded in-flight request IDs to finish or mark cleanup `manual_required` if their state is unknown.
3. Call the retained exact readback route. It runs the final first-primary query for the current state and returns only the fixed synthetic response. Recompute the canonical final-state digest. Store a redacted HMAC transcript commitment plus a typed response projection that names that digest; never equate the HMAC with the raw digest.
4. Revoke the Access service token.
5. Delete the three exact route IDs and confirm their absence.
6. Delete the exact Access application and reusable policy.
7. Delete the two writer scripts without `force`.
8. Delete the sink script after its service-binding callers are gone. Service bindings disappear with their caller configurations, so cleanup does not treat them as separate resources.
9. Delete the exact disposable D1 database last.
10. Read the Cloudflare control plane and confirm that every recorded resource ID is absent.

A lost delete response, ID mismatch, unexpected resource, failed absence check, or unknown in-flight request sets cleanup to `manual_required`. The collector must not claim cleanup success from a request alone.

## Sources

- [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [D1 sessions API](https://developers.cloudflare.com/d1/worker-api/d1-database-session/)
- [D1 return objects](https://developers.cloudflare.com/d1/worker-api/return-object/)
- [D1 retry behavior](https://developers.cloudflare.com/d1/best-practices/retry-queries/)
- [Workers service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
- [Workers version metadata](https://developers.cloudflare.com/workers/runtime-apis/bindings/version-metadata/)
- [Workers routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)
- [Workers script deletion](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/methods/delete/)
- [Cloudflare Access service policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/common-policies/)
