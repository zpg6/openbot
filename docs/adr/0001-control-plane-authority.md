# ADR 0001: Keep authority in the OpenBot control plane

- Status: accepted
- Decision owner: control-plane owner
- Recorded: 2026-08-22

## Decision

OpenBot owns identities, organization membership, Bot revisions, catalog revisions, grants, confirmations, signed execution manifests, run state, revocation fences, audit records, and user-facing APIs.

A connection proves that Metorial can reach a provider account. It grants no Bot permission. A run may expose a provider tool only when the active organization tool policy, Bot revision, connector contract, provider capability grant, filtered Metorial session, and signed manifest name the same tool and scope. That provider grant cannot authorize code.

Code has independent authority. The reviewed installation profile must have `enabled` adoption status and `active` lifecycle. An active organization compute policy narrows its admitted data classes and numeric limits. The Bot revision selects that policy. A separate unexpired compute grant binds the Bot revision, policy digest, purpose, a further-narrowed data-class set, further-narrowed limits, and expiry. The manifest and current gateway reservation must match every dependency. A candidate profile is probe authority only and cannot back an organization policy or user run. A disabled profile cannot back either one, regardless of its adoption status.

The control-plane Worker authenticates users and renders views. It cannot sign manifests or decrypt per-run vendor capabilities. The orchestrator signs manifests, manages vendor resources, and alone owns run-lifecycle transitions. The capability gateway authorizes and reserves every model, tool, and code-execution call. For code, it atomically consumes one reservation before calling the runner's private `SandboxExecutionService.execute` entry point with the consumed reservation ID, strict request object, and digest of the versioned canonical field projection. Only the gateway has that binding.

The orchestrator alone binds the runner's separate `SandboxLifecycleService.kill` and `SandboxLifecycleService.destroy` entry points. A lifecycle command carries the consumed reservation ID, run ID, call sequence, Sandbox reference, execution-request digest, fence kind and value, command kind, and canonical-field-projection digest. Kill requires the exact process-handle ID and a run-attempt fence. Destroy uses either the active run-attempt fence or an exact cleanup-obligation ID and fence. The gateway cannot call lifecycle, and the orchestrator cannot call execute. The private runner has no D1 binding; it trusts each private caller only for its narrow entry point, enforces the fixed mechanical protocol, and invokes the matching Sandbox SDK method. The runtime, runner, and sandbox never decide authority.

## Invariants

- Public handlers call typed use cases. They never receive a Drizzle handle.
- The runtime has no public route, control-database binding, vendor management key, reusable provider credential, or authority mutation method.
- A skill is untrusted instruction text. It cannot add a tool, destination, data class, mount, or limit.
- A provider connection or capability grant cannot satisfy a compute-policy or compute-grant check.
- Unsupported resource mappings deny before a vendor call.
- Revocation denies the next gateway reservation. A reservation that completed first may still reach a vendor, and the run records that race.

## Consequences

The Worker, Durable Object, sandbox, Metorial session, and model provider can all fail or behave unexpectedly without gaining authority. This split costs more internal calls and requires signed, versioned contracts. That cost is intentional.

## Completion evidence

Item 2 remains open until deployed two-writer reservation and create-versus-revoke probes pass. Documentation does not substitute for those observations.
