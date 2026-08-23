# ADR 0006: Defer shared artifacts and never share a Bot computer

- Status: accepted
- Decision owner: artifact owner
- Recorded: 2026-08-22

## Decision

The first release does not share a filesystem, browser profile, login, process tree, or Sandbox between Bots. A run-owned Sandbox is temporary compute, not a project workspace.

Shared work arrives only after the R2 artifact gate passes. The planned design uses organization collections, append-only artifact versions, database-controlled logical paths, snapshot-bound read mounts, and a private artifact gateway. Durable Object storage remains run coordination storage. It never becomes the shared project body store.

In that later design, the runtime receives no R2 binding or bucket credential. Bot-produced drafts would land through a run-owned private output capability. An owner could then publish a specific observed version to a shared path. Another Bot could read that version only on a later run whose signed manifest names the exact snapshot and prefix.

## First-release consequence

Code execution receives no bucket mount, backup, restored directory, user upload, or prior-run file. Artifact routes remain unregistered. Any request for an attachment, shared folder, publication, or model-visible document returns `artifact_workspace_not_enabled`.

This deferral prevents a quick bucket mount from turning object-storage credentials and mutable shared files into ambient Bot authority.
