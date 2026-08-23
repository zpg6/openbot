# ADR 0009: Run D1 concurrency probes on disposable deployed resources

- Status: accepted contract, probe not run
- Decision owner: database owner
- Recorded: 2026-08-23

## Decision

OpenBot will test its guarded D1 operations against one newly created disposable Cloudflare D1 database before the D1 schema freeze. Local D1 and Miniflare runs can catch SQL mistakes, but they cannot satisfy this gate.

The probe deploys two writer Workers with distinct script names and version IDs. Both bind the exact same disposable database ID. A third Worker is the synthetic sink and readback service. The sink has its own script name and version ID. It records every request under a new random receipt and never deduplicates requests. A fourth, operator-side driver starts each competing request in a separate process. The driver sends those requests across the network. A `Promise.all` inside one Worker invocation is not evidence of two writers.

All generated names use the recorded safe prefix and a random lowercase suffix. All account IDs, installation IDs, run IDs, calls, receipts, and payloads are synthetic. The probe must reject a production database ID, a reused database, a name outside the prefix, or a resource whose returned ID does not match the create response captured for this probe run.

The writer trigger routes are temporary HTTPS routes protected by Cloudflare Access. They accept one fixed method and path, an Access-authenticated operator, a run-bound one-use request, and no SQL or arbitrary table name. `workers.dev` and preview URLs stay disabled. Writers reach the synthetic sink through a service binding.

The sink/readback Worker also has one temporary Access-protected readback route. It accepts only an exact `GET` path for the generated probe run and returns one fixed response schema. It accepts no SQL, table name, filter, or caller-selected ID. Cleanup first closes a stored run fence and disables both writer routes. The narrow readback route remains available until the final first-primary read completes, then cleanup disables it before deleting any Worker.

## D1 execution rules

Every writer creates a D1 session with `withSession("first-primary")`. It issues each guarded operation once. Automatic application retries are disabled. For a committed batch, the writer returns the session bookmark, each `RETURNING` row, and the `D1Result` metadata for every statement. The collector shape-checks and records result count, success flags, changes, rows read, rows written, database-change flag, primary-serving flag, region, duration, and database size. Metadata counters are diagnostic. They do not prove which row changed. Exact `RETURNING` identity and cardinality, followed by fresh first-primary readback, decide the history.

An intentional tripwire rollback returns a recognized D1 constraint failure instead of successful statement metadata. The collector must distinguish that expected rejection from an unknown failure and prove through first-primary readback that the batch left no guarded rows. A missing, malformed, contradictory, or lost Worker, sink, D1 result, or D1 error response makes the trial inconclusive.

Setup enables D1 read replication and reads that setting back from the deployed database. The required `served_by_primary` metadata field must equal `true`. An absent or false value makes the trial inconclusive. Setup also reads back foreign-key enforcement and runs an isolated failing tripwire canary. First-primary readback must show that the canary batch left no rows. A probe cannot rely on guarded batches until both setup checks pass.

Every decisive read uses a fresh `withSession("first-primary")` session. The collector also opens a session from each returned writer bookmark and checks that writer's receipt. Bookmark reads are supporting evidence. Only the fresh first-primary read decides the final history. The report records the configured read-replication setting, observed `served_by_primary: true` metadata, compatibility date, committed database ID, script IDs, version IDs, bookmarks, and result metadata.

The driver runs both requests in separate operating-system processes. Each writer first records a ready row and waits for both ready rows for the same trial. The audit trial also records the same expected sequence and head hash before releasing its barrier. A timeout, worker restart, lost writer or sink response, unknown platform result, malformed response, or missing ready row is inconclusive. The driver does not rerun the same request ID to turn an ambiguous result into a pass.

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

Two fault trials are mandatory. In the reserve-crash trial, the winning writer stops after the reservation commit and before the sink call. Readback must show one spent reservation and zero sink receipts. The outcome is `outcome_unknown`; no retry occurs. In the response-lost trial, the sink records one receipt but its response never reaches the writer. Readback must show one spent reservation and one receipt. The outcome remains `outcome_unknown`; no retry occurs. These trials prove that the reservation prevents duplicate dispatch. They do not claim delivery certainty.

## Sandbox capacity

The disposable database starts with a capacity limit of four and zero claims. Five independent requests, split across both writer deployments, contend for distinct synthetic claim IDs. A conditional claim plus a foreign-key tripwire must commit four claims and deny the fifth before any synthetic platform call.

Capacity release requires a sink-recorded destroy observation bound to the exact installation ID, run ID, run-attempt fence, claim ID, sandbox ID, and random destroy receipt. Release before observation, release with another claim's receipt, release with another run or fence, and replayed release must not change capacity. One matching release decrements the reserved count once. An unknown or lost destroy response does not count as an observation and leaves the claim reserved for manual review.

## Audit head

Both writers read the same first-primary audit head, record the same expected sequence and hash, and stop at the barrier. They propose different synthetic event IDs and hashes. After release, one guarded batch appends the next event and advances the head. The other conflicts and rolls back. First-primary readback must show one next-sequence event and its matching head.

The loser then performs a separate follow-up command. It reads the new head, uses a new attempt ID, appends at the next sequence, and commits. This is an explicit second phase, not an automatic retry of an ambiguous request. Final readback must show an unbroken two-entry chain.

## Evidence and authority

The checked-in fixture at `docs/fixtures/d1-concurrency-probe.json` is a deployment contract. Its status is `not_run`. It contains no observations and cannot promote `d1_guarded_create` or `gateway_reservation`.

A deployed collector must emit an untrusted report with `platform` equal to `cloudflare_d1_deployed`. It commits to the exact database, Worker deployments, configuration, probe definition, installation, environment, probe run, and redacted transcripts. Every required trial must finish without an inconclusive result. An operator must review and sign that report through the gate-attestation process. A report, fixture, local run, or `passed` field has no authority by itself.

The typed gate-evidence contract requires Sandbox-capacity and audit-head checks under the D1 gate, plus separate `model`, `provider_tool`, and `code` coverage under the gateway gate. Schema freeze remains blocked until a deployed report passes those checks.

## Cleanup

Cleanup uses only the exact resource IDs returned during this probe and checks every generated name against the recorded prefix.

1. Close the stored probe-run fence. Disable both writer routes and their Access entry points. Reject new trial starts, but retain the exact Access-protected readback route.
2. Wait for the recorded in-flight request IDs to finish or mark cleanup `manual_required` if their state is unknown.
3. Call the retained exact readback route. It runs the final first-primary queries and returns only the fixed synthetic response. Store redacted transcript commitments and the required synthetic observations.
4. Disable and delete the exact readback route and its Access entry point.
5. Delete the two exact writer Worker deployments by returned script ID and version ID.
6. Delete the exact sink/readback Worker deployment.
7. Delete the exact remaining Access application, service bindings, and probe driver configuration.
8. Delete the exact disposable D1 database last.
9. Read the Cloudflare control plane and confirm that every recorded resource ID is absent.

A lost delete response, ID mismatch, unexpected resource, failed absence check, or unknown in-flight request sets cleanup to `manual_required`. The collector must not claim cleanup success from a request alone.

## Sources

- [D1 database API](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [D1 sessions API](https://developers.cloudflare.com/d1/worker-api/d1-database-session/)
- [D1 return objects](https://developers.cloudflare.com/d1/worker-api/return-object/)
- [Workers service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/)
- [Workers routes](https://developers.cloudflare.com/workers/configuration/routing/routes/)
