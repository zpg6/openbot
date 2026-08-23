# ADR 0002: Start with D1 and keep run coordination in Durable Object storage

- Status: accepted with open deployment gates
- Decision owner: database owner
- Recorded: 2026-08-22

## Decision

The first control store is Cloudflare D1 through Drizzle. Drizzle owns schemas, generated SQL migrations, and repository implementations. D1 SQL remains available inside the database package for guarded operations that the query builder cannot express safely.

PostgreSQL and MySQL behind Hyperdrive are later profiles. They must pass the same repository, identity, concurrency, backup, restore, and Worker bundle tests before the project calls them supported. One deployed Worker bundle contains one database driver.

Each active run owns one Durable Object. Its native SQLite storage holds coordination metadata, call boundaries, counters, event digests, and a terminal tombstone. It does not hold raw prompts, raw results, vendor URLs, provider keys, or reusable authority. Global run state stays in the control store.

## Verified documentation

- Cloudflare documents that a D1 `batch()` executes statements sequentially and rolls back the whole batch when a statement fails.
- Cloudflare documents a 10 GB paid-plan limit per D1 database, a 2 MB row or value limit, 100 bound parameters per query, and single-threaded execution per database.
- Drizzle documents the `drizzle-orm/d1` driver for Workers and D1.

These facts support the choice. They do not prove OpenBot's guarded SQL under contention.

## Required deployed evidence

- Both legal run-create versus revoke histories with two writers
- One spent gateway reservation and one outbound call for concurrent duplicates
- Audit-head contention
- Durable Object migration failure and tombstone replay
- D1 Time Travel restore for the operator guide

Any failed concurrency probe blocks the schema freeze. PostgreSQL and MySQL packages remain absent until their named gates start.
