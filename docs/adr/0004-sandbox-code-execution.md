# ADR 0004: Add one JavaScript execution in a run-owned Cloudflare Sandbox

- Status: accepted with missing literals and open deployed gates
- Decision owner: runtime owner
- Recorded: 2026-08-22

## Context

The product requires bounded Bot code execution in the first release. Implementation remains blocked on exact runtime and image literals plus deployed security, lifecycle, resource, placement, and failure probes.

Cloudflare documents Sandbox as a Worker SDK over a Durable Object and a Container. Each sandbox runs in its own VM with isolated files, processes, network stack, and resource limits. A Sandbox ID can outlive its current container. Processes, handles, and local files disappear when that container stops or is replaced.

Cloudflare recommends the 1.0 preview for new work. The candidate package observed from npm on 2026-08-22 is `@cloudflare/sandbox@0.13.0-next.738.2`. Its `exec(argv)` API returns a supervised process handle. This pin is a design candidate. No dependency or image has been added.

## Decision

The first code capability performs one bounded JavaScript execution per run. There is no Python, TypeScript cell interpreter, interpreter extension, language negotiation, user shell, terminal, browser, package installation, network tool, persistent filesystem, port, tunnel, or background-service API.

The model proposes JavaScript source with one default async `main(input)` export and one JSON input. Another module shape denies. The capability gateway reloads current authority and atomically consumes the run sequence, code-call budget, and one stored dispatch reservation. It then calls the private sandbox runner with the consumed reservation ID, strict request object, and digest of the versioned canonical field projection. Worker RPC structured clone does not preserve original JSON wire bytes, so this protocol does not claim byte identity across the binding.

The run-owned Durable Object asks the capability gateway to dispatch a code call using its run token and next sequence. The gateway reloads authority and alone binds `SandboxExecutionService.execute`. The runner has the Sandbox Durable Object binding, has no D1 binding or public route, recomputes the canonical request digest, checks fixed mechanical limits, and invokes the execute SDK path once. A changed digest denies before Sandbox creation.

The orchestrator alone binds `SandboxLifecycleService.kill` and `SandboxLifecycleService.destroy`. Each mechanical command contains the consumed reservation ID, run ID, call sequence, Sandbox reference, execution-request digest, fence kind and exact value, command kind, and canonical-field-projection digest. Kill requires the exact process-handle ID and a run-attempt fence. Destroy discriminates an active-attempt command from a cleanup command. The latter carries the exact cleanup-obligation ID and fence. The runner checks shape and digest, then calls only that lifecycle method. The gateway has no lifecycle binding; the orchestrator has no execute binding. The runner holds neither authority records nor replay state.

The consumed gateway reservation binds the account, run, random sandbox ID, run-attempt fence, manifest digest, source digest, input digest, image digest, fixed runner profile, limits, sequence, canonical request digest, and expiry. The gateway store owns replay prevention. The runner trusts its sole private caller for the consumed-reservation assertion; it cannot independently reload authority or replay state. The sandbox never receives the reservation ID, gateway token, policy record, or reusable credential.

## Initial execution contract

| Field            | Rule                                                                                                                                                                                                                                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sandbox identity | Random 256-bit, run-owned ID. Never derived from account, Bot, prompt, or model text.                                                                                                                                                                                                                                     |
| SDK candidate    | Exact `@cloudflare/sandbox@0.13.0-next.738.2` preview package. Re-pin only with a reviewed API and image update.                                                                                                                                                                                                          |
| Container image  | Exact immutable image digest, still unresolved. No runtime package installation.                                                                                                                                                                                                                                          |
| Language         | JavaScript on one pinned Node runtime, still unresolved. Other languages deny.                                                                                                                                                                                                                                            |
| Source           | Strict UTF-8, at most 32 KiB, written to `/workspace/openbot/main.mjs`.                                                                                                                                                                                                                                                   |
| Input            | One strict JSON value, at most 128 KiB, written to `/workspace/openbot/input.json`.                                                                                                                                                                                                                                       |
| Invocation       | Candidate argv is exactly `[/usr/local/bin/node, /opt/openbot/runner.mjs]`. No request byte enters argv.                                                                                                                                                                                                                  |
| Executions       | One supervised runner process per run. A second reservation denies.                                                                                                                                                                                                                                                       |
| Environment      | The reviewed image environment plus a fixed allowlist of non-secret configuration. No model-controlled environment value and no live credential.                                                                                                                                                                          |
| Output           | Stream stdout and stderr through process logs. Result chunks concatenate to one canonical JSON value; the terminal frame binds its media type, byte count, and SHA-256 digest. Cap stdout at 48 KiB, stderr at 16 KiB, the result at 64 KiB, and their aggregate at 128 KiB. Any truncation or overflow denies.           |
| Wire frames      | At most 64 canonical NDJSON frames, each at most 16 KiB.                                                                                                                                                                                                                                                                  |
| Resource class   | The profile must select `lite` or `basic`. The current probe candidate is `lite`, with 1/16 vCPU, 256 MiB memory, and 2 GB ephemeral disk. Selection remains unresolved until the memory probe passes.                                                                                                                    |
| Clock            | 60 seconds startup, 15 seconds remote process lifetime, 30 seconds teardown, 120 seconds maximum Sandbox age, and 240 seconds run wall time. Observation timeouts never imply process termination.                                                                                                                        |
| Network          | The candidate state is `public_internet_blocked_unverified_dns`. Set `enableInternet = false`, no allowed hosts or handlers, and outbound request budget zero. Cloudflare DNS still needs a sentinel.                                                                                                                     |
| Data profile     | The candidate accepts only server-seeded synthetic probe bytes. An enabled profile may accept public, synthetic, or organization bytes after the DNS and disclosure gates pass. `restricted` and `unknown` always deny.                                                                                                   |
| Filesystem       | Fresh container and fixed run files. The proposed 256 MiB target is unverified and cannot enter an enabled profile until its OS mechanism passes. Cloudflare's documented `lite` disk boundary is 2 GB. No mount or reuse.                                                                                                |
| Processes        | The proposed eight-process target is unverified and cannot enter an enabled profile until its OS mechanism passes. The model receives no OpenBot shell or arbitrary command interface.                                                                                                                                    |
| Outbound calls   | Zero public outbound requests. DNS remains a separately tested platform path because `enableInternet = false` does not disable Cloudflare's resolver.                                                                                                                                                                     |
| Ports            | No preview URL, tunnel, port exposure, bridge route, or inbound route.                                                                                                                                                                                                                                                    |
| Cleanup          | The orchestrator requests `destroy()` through its lifecycle-only binding in every history. `sdk_acknowledged` records only the SDK response, `not_found` records the provider result, and `outcome_unknown` creates or retains a cleanup obligation and blocks the Bot slot. None is independent destruction observation. |
| Restart          | Never resume. A missing process handle, container replacement, Worker eviction at an uncertain boundary, or missing terminal frame produces `execution_outcome_unknown`.                                                                                                                                                  |

User code controls its disposable VM and may inspect the image or invoke binaries shipped in it. OpenBot does not claim language-level confinement. The image inventory, public-data restriction, lack of credentials and mounts, blocked public internet, resource limits, single execution, and cleanup protocol are the controls.

The 256 MiB filesystem and eight-process values are release targets, not enforced facts. Before enablement, the runtime owner must name an image or platform mechanism that prevents each limit from being exceeded and pass adversarial probes. Polling after a fork or write is not sufficient. If no mechanism exists, the profile must expose the actual platform boundary and the signed contract must change before schema freeze.

Cloudflare receives source, input, output, process metadata, and container metadata. The start confirmation names Cloudflare Sandbox as a destination and shows the possible byte classes. A run denies if any input exceeds the active profile's data ceiling.

The execution profile has two independent state axes. `adoption_status` is `candidate` or `enabled`. Record `lifecycle` is `active` or `disabled`.

- `candidate` accepts only a server-seeded synthetic deployed probe. It never accepts a user run, even if the user claims the prompt is public. The denial is `sandbox_profile_not_enabled`.
- `enabled` requires a reference to a verified `sandbox_execution` gate attestation for the immutable `configuration_digest`. An enabled profile may accept inherited `public`, `synthetic`, or `organization` data. It always denies `restricted` or `unknown` data with `sandbox_data_profile_denied`.
- `disabled` denies probes and user runs. Disabling advances dependency fences, discards dependent confirmations, and cancels dependent active runs. The record's `profile_digest` changes; the immutable `configuration_digest` does not.

The deployed probe writes an untrusted report. A passed check object inside that report cannot enable a profile. An operator process outside the repository and deployed Workers reviews the report and may sign a canonical low-S P-256 attestation. The envelope binds the exact report, probe definition, collector build, configuration, installation, environment, deployment, required check-set version, decision, claims, validity interval, and signer key ID.

Bootstrap supplies the operator public-key registry, trusted clock, installation context, and shared registry-generation reader. Request data and stored profile data cannot replace these inputs. Verification and final authorization read the operator-controlled generation every time. A mismatch, invalid value, or unavailable reader denies, including in a retained isolate after registry rotation. The verifier returns an opaque decision tied to the loaded registry generation. Parsed JSON, a structured clone, or a decision produced under another registry cannot stand in for that result.

A passed Sandbox decision is a runtime approval lease that lasts no more than 24 hours. The profile stores only its exact attestation digest, configuration digest, and expiry. Each code authorization checks the unexpired lease through the same bootstrap verifier and confirms the current installation, environment, deployment, admitted data classes, and stored authority chain. Expiry fails closed with `sandbox_profile_not_enabled`.

Keep the historical signed envelope and untrusted report for audit. Historical bytes do not retain authority after expiry. Renewal requires a new signed envelope and an atomic profile-reference rollout before the old lease expires. A profile cannot become available to user code until a current reference is active.

An organization compute policy may narrow the enabled profile's admitted classes and limits. A compute grant may narrow both again. The compiler and gateway use the intersection of profile, policy, grant, Bot limits, and installation limits. No child may add a class or raise a number.

User prompts and declarative skills remain `organization` by default. Model-generated source inherits the highest class of every contributing prompt, skill, tool result, and model result. Public commands cannot lower that class. This removes the classification dead end without weakening inheritance: ordinary first-release code becomes possible only under an `enabled` profile.

## Jurisdiction rule

Cloudflare documents Container jurisdiction constraints for `eu` and `fedramp`. It does not document a Container `us` jurisdiction. Code execution denies under OpenBot's `us` installation profile. `automatic` makes no residency promise. `eu` and `fedramp` still need deployed placement observations.

## Required probes

- Pin the Node runtime and immutable container image that match the candidate SDK release line.
- Prove the exact argv, fixed runner digest, source path, input path, environment inventory, and absence of interpreter extensions.
- Prove one gateway reservation consumption and one process launch under concurrent duplicate requests.
- Alter every canonical execute field and digest, replay the consumed reservation, expire it, call execute outside the gateway binding, and call the gateway outside the orchestrator path.
- Alter every lifecycle field and digest. Call kill and destroy outside the orchestrator binding; call execute through the lifecycle binding; call lifecycle through the gateway binding. Every cross-entrypoint attempt must fail before an SDK call.
- Verify the sandbox runner bundle and bindings contain no D1, R2, vendor key, model key, generic actor union, or public route.
- Verify public HTTP, HTTPS, direct IP, redirect, and alternate-port denial.
- Run a server-seeded synthetic probe against an operator-controlled authoritative domain. Attempt randomized-token disclosure through each Node DNS API, resolver path, address family, search suffix, encoded label shape, and image binary found by inventory. Correlate authoritative logs over a fixed observation window. Any observed token, missing log coverage, uncertain platform result, or changed image denies enablement.
- Treat a passing sentinel as observed coverage of the reviewed image and enumerated paths, not proof that DNS exfiltration is impossible. Record the image, Node, SDK, probe source, authoritative zone, attempted mechanisms, observation interval, and log digests in the untrusted report. Bind that report to the exact configuration, installation, environment, deployment, and check-set version in the signed attestation. Re-run after any image, runtime, SDK, network, or platform-behavior change.
- Promote the reviewed profile from `candidate` to `enabled` only when the DNS sentinel and every other release-blocking probe pass. A failed DNS sentinel blocks the code-enabled release and requires another executor or network-containment design; it cannot be waived by a confirmation.
- Test classification inheritance and hostile downgrade attempts. `organization` is admitted only by an enabled profile; `restricted` and `unknown` always deny.
- Measure cold start, log backpressure, truncation, CPU, memory, disk, process, file-descriptor, and concurrent-run behavior on `lite`.
- Prove the 256 MiB writable-volume limit, read-only paths outside it, and eight-process OS limit from inside hostile user code. If the image cannot enforce them, update the profile to the actual platform limits before schema freeze.
- Prove the selected OS or container mechanism stops the ninth process and the first byte beyond the filesystem ceiling. Until then both targets remain unverified and absent from enabled authority.
- Kill the Worker before and after process launch. Neither history may repeat uncertain code.
- Trigger the remote process timeout, kill the exact observed process handle when needed, and call destroy under both active-attempt and cleanup-obligation authority. Prove `sdk_acknowledged`, `not_found`, and `outcome_unknown` remain distinct and that ambiguity blocks the Bot.
- Verify a replacement container invalidates the old handle and produces `execution_outcome_unknown` instead of relaunch.
- Verify no file or process sentinel crosses two random run-owned Sandbox IDs.
- Observe `eu` and `fedramp` placement. Keep `us` denied.

No code-execution gate is closed by this ADR. The present profile is a candidate and is usable only for its deployed synthetic probe.
