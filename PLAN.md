# OpenBot build plan

## The first verified slice

OpenBot's first verified slice does one job. An authenticated organization owner starts one short read-only run against one reviewed Metorial connector. The Bot may also execute one bounded model-written JavaScript function in an ephemeral Cloudflare Sandbox owned by that run. The organization may curate more catalog entries, but one Bot revision selects at most four exposed model tools including code, four declarative skills, and one reviewed code-execution profile. The run uses one provider deployment, one auth config, one OpenRouter model, and one OpenRouter provider. Before the run starts, the user sees the prompt, allowed provider tools, selected skills, JavaScript runner, sandbox data classes, compute limits, and every possible disclosure destination. Model-selected arguments, code, and returned data do not exist yet and cannot be shown in advance.

The operator deploys OpenBot into their own Cloudflare account and supplies their own Metorial, OpenRouter, and database accounts. OpenBot has no hosted control service, paid feature gate, or required telemetry. The repository uses the Apache-2.0 license.

We will not use OpenCode. The first release needs bounded computation, not a coding-agent framework with plugins, executable skills, subagents, and another permission system. We do not need the Cloudflare Agents SDK, Code Mode, interpreter extension, or AI SDK either. The Agents MCP manager persists connection configuration for wake and reconnect, while this design forbids the bearer URL in DO storage. A plain SQLite-backed Durable Object owns the manual model loop. A private sandbox runner uses the Sandbox 1.0 process API with one source-constant argument array and one reviewed JavaScript runner.

Each code-enabled run gets a random Sandbox ID. The sandbox has an ephemeral filesystem, no OpenBot, user, storage, or provider credential, no public route, no terminal route, and no package installation performed by OpenBot. Its container sets `enableInternet = false`, has no allowed hosts or outbound handlers, and denies public HTTP, HTTPS, and non-DNS traffic. Cloudflare still sends DNS through its platform resolver. A candidate profile accepts one server-seeded synthetic probe only. The owner-visible profile cannot enable until a deployed authoritative-domain test does not observe the seeded sentinel on the enumerated DNS paths during its fixed window. This is measured evidence, not proof that all DNS exfiltration is impossible. A passing probe permits organization data, records the remaining platform risk, and never permits `restricted` data. The capability gateway authorizes and reserves the code call before the sandbox runner dispatches it. OpenBot kills the process on cancellation or timeout, requests sandbox destruction at terminal state, and treats an ambiguous command or lost container as `outcome_unknown`; it does not resume or repeat that call.

The sandbox runner pins one exact Sandbox SDK 1.0 preview release and matching container image digest after the adoption gate passes. The initial profile exposes one `execute_javascript_v1` model tool. It does not expose argv, direct command execution, preview URLs, ports, interactive terminals, browser automation, persistent disks, a package-install capability, or direct provider-tool calls from code. User code may still inspect its disposable VM and invoke binaries already present in the reviewed image. Sandbox is the isolation and compute boundary, not policy authority. The manifest, current run fences, gateway reservation, and cleanup records remain authoritative outside it.

The production control plane is a Hono Worker with Hono JSX templates, progressive-enhancement forms, and a small browser ESM module for CSRF and run polling. There is no client-side application framework. JSON APIs live under `/api/v1` and share Zod contracts with form handlers. Node.js 22 and a pinned pnpm version run builds, tests, code generation, and admin commands. Production code runs on Cloudflare Workers.

## Product model and navigation

Grok Bot leads with a roster of named Bots, then opens one message workspace for each Bot. The transcript mixes user instructions, work status, connection requests, approvals, and results. Bot details hold the profile and recurring work. Task entry stays primary while access administration remains one link away.

OpenBot adopts that roster-first hierarchy but shows authority before each run. A Grok Bot login or shared computer is available across a user's Bots. An OpenBot connection grants nothing by itself, every run gets a fresh execution object and sandbox, and the runtime cannot browse or use a persistent computer. The UI must make that difference obvious.

| Grok Bot pattern | OpenBot first-release decision |
|---|---|
| Named Bot roster in the sidebar | Show named Bots with a short cosmetic description, fixed-palette mark, and derived status. A Bot owns append-only behavior and permission revisions plus scoped grants. |
| Teammate-style message composer | Label it `Start a task`. Each submission creates an independent run. Do not imply that prior runs become model context. |
| Inline Connect card | Show a control-plane-authored `Connect Jira` or `Connect a source` card when the active Bot revision selects a reviewed connector but lacks authorization. The card is derived from stored configuration, not model output, and links only to the reviewed connector flow. The model cannot name an arbitrary provider, URL, or scope. |
| Tool activity in the transcript | Show a redacted run timeline with queued, model, tool, cancellation, result, and cleanup events. Never render raw MCP arguments or results by default. |
| Inline approval card | Show one start-confirmation card with the prompt, provider tools, JavaScript execution profile, possible data classes, destinations, expiry, and limits. It has `Start run` and `Discard`. It is not an action approval or an `Always allow` rule. |
| Result and file cards | Show the plain-text final answer, safe code summaries, verified structured source references, resolved model and provider, evidence completeness, and a link to the audit record. OpenBot requests Sandbox cleanup at terminal state, never reuses its files, and shows cleanup ambiguity. Retained file attachments and generated artifacts arrive with the artifact workspace. |
| Needs attention, working, and result states | Derive `Outcome unknown`, `Cleanup required`, `Cleaning up`, `Cancelling`, `Running`, `Needs confirmation`, `Needs configuration`, `Needs access`, `Ready`, `Cancelled`, `Completed`, and `Failed` from stored state. Put actionable and active states first, then order the rest by recent activity. |
| Computer, memory, routines, groups, and handoffs | Do not show disabled controls. Add them only with their own authority and storage designs. |

On screens at least 900 pixels wide, use a 20rem sidebar and one main column. The sidebar header has `New Bot` and a search field. Enter submits the GET form. The enhancement waits 200 milliseconds after text composition ends, aborts an older request, preserves focus and selection, and replaces the current URL rather than adding one history entry per keystroke. `q` is at most 128 UTF-8 bytes and matches normalized Bot name and short description only; cross-run content search is deferred.

Each roster row has a color mark, name, last-activity time, and one derived status line. Do not expose prompt or result text there. The selected Bot uses a filled row treatment. `Connections`, `Audit`, and the account menu sit below the roster. Anchor the account menu at the bottom.

On narrower screens the sidebar uses native `<details>` as the no-JavaScript navigation. The enhancement may present it as a modal drawer with an accessible name, Escape close, focus containment and return, background inertness, and `aria-expanded`. Do not build a third inspector column for the first release.

The Bot page uses document scrolling, a sticky header, and a composer after the feed. The composer may become sticky only when it cannot cover the last card, focused control, or validation error. The first-release header shows the Bot's fixed-palette color mark, name, active revision, and an `Access` control instead of a computer-view control. `Tasks`, `Access`, and `Profile` use ordinary links below the header. Cosmetic profile fields are name, short description, and palette color ID. The stored profile reserves a nullable reviewed local-icon reference, but public commands require it to remain null until an icon pack passes its later dependency, license, CSP, and SVG review. Changing the purpose, behavior instructions, selected organization tools or skills, connector revision, model route, code-execution profile, limits, artifact mounts, or data rules creates a new `bot_revision`.

The New Bot page separates identity from authority. `Name`, `Short description`, and appearance affect presentation only. `Purpose` is a short model-visible statement of the Bot's goals. `Behavior instructions` are the longer standing instructions. The permission editor groups reviewed connector operations under `Read`, `Write`, and `Destructive`, but those group controls are only bulk-editing aids. Stored authority is the exact selected tool-policy revision and digest. The initial ceiling permits read tools only, but zero tools start selected. The owner must choose at least one named reviewed read operation before creating the Bot. Write and destructive begin empty and unavailable.

Selecting `Write` never selects a destructive operation. `Destructive` includes deletion, membership or access changes, credential or security changes, irreversible bulk actions, and any connector operation whose reviewed schema can produce one of those effects. A mixed tool is classified at its highest possible effect unless a reviewed connector release splits it into narrower exact tools. Destructive selection only permits the runtime to propose the operation. Item 12 must still show the exact normalized action and target and collect one-use approval before dispatch. There is no `Always allow` path.

The task feed orders independent runs by OpenBot commit time. A user's prompt is right-aligned. Confirmation, activity, tool summaries, code summaries, result, and cleanup cards are left-aligned beneath a header that names the run and its start time. Connector-authored safe summaries may name the tool and count returned records. Code summaries show language, duration, exit state, and truncated output byte counts. They do not show raw code, raw arguments, or provider output by default. Cross-Bot messages and routine-created notices do not appear in the first release.

The composer contains one multiline prompt and `Review task`. It has no attachment, microphone, mention, or schedule control. It stays disabled until one active provider grant passes current connector checks. A code-enabled Bot also requires an enabled active profile, active selected compute-policy revision, and unexpired active compute grant. The composer stays disabled while that Bot has a live confirmation, a nonterminal run, or any incomplete cleanup obligation. The first release permits one live confirmation and one occupied run slot per Bot. Its empty state explains the difference between a connection and a Bot grant.

Submitting a prompt creates a five-minute confirmation, not a run. The confirmation names the reviewed sandbox profile when code execution is enabled, states that model-written JavaScript and selected inputs go to Cloudflare, and lists the runtime, network, filesystem, startup, execution, teardown, and output limits. The page shows changed or expired state plainly and sends the user back to the Bot instead of silently recompiling.

The run page shows the original prompt, current execution state, a cursor-paginated event timeline, final answer, and three separate status rows for execution, vendor cleanup, and evidence completeness. It renders `Cancel run` only when the server supplies `can_cancel`. `Cleanup required` remains visible after a successful answer. Request IDs and stable error codes render as selectable text; enhancement adds a copy control.

Use a neutral page background and one sidebar separated by a one-pixel border. The feed is at most 48rem wide with 16-pixel card gaps and 24-pixel section gaps. Confirmation, activity, and result cards use the same border and radius tokens; elevation is reserved for the mobile drawer. Bot palette colors identify Bots and never encode status. Every status also has text and an icon.

`BotListItemV1` contains `bot_id`, `name`, `short_description`, nullable `icon`, `palette_color_id`, `active_revision_id`, `presentation_status`, `last_activity_at`, and `usable_grant_count`. It contains no prompt or result excerpt.

Status uses this precedence: `Outcome unknown`, `Cleanup required`, `Cleaning up`, `Cancelling`, `Running`, `Needs confirmation`, `Needs configuration`, `Needs access`, then `Cancelled`, `Failed`, or `Completed` from the latest run. `Needs configuration` means a selected tool policy, skill revision, connector revision, model route, code profile, or compute policy is no longer usable. A missing, expired, or revoked compute grant produces `Needs access`. A Bot with no prior run and usable configuration and access has `Ready`. `PresentationStatusV1` maps every run, cleanup, evidence, catalog, grant, and confirmation state. An exhaustive TypeScript switch test fails when a new state has no user-facing mapping.

`BotFeedItemV1` is a tagged union for a draft confirmation or a completed run summary. A confirmation item has `confirmation_id`; after consumption it links to `run_id`. `RunEventItemV1` covers lifecycle, safe tool summary, result, cleanup warning, and stable error within one run. Keep chronological DOM order even when user prompts are visually right-aligned.

Page handlers serialize allowlisted `BotRosterViewV1`, `BotWorkspaceViewV1`, `RunConfirmationViewV1`, `RunDetailViewV1`, `RunPollPageV1`, `BotAccessViewV1`, `ConnectionDetailViewV1`, `CatalogViewV1`, and `AuditEventViewV1` schemas. Each view carries server-derived `available_actions` and stable denial reasons. Exact-key response tests cover every registered serializer. High-entropy sentinels in encrypted and provider-reference fixtures are scanned across response bodies, headers, redirects, captured logs, audit projections, and translated errors.

Roster state and composer enablement are hints. `createRunConfirmation` and `confirmAndCreateRun` reload the catalog, provider grant, compute profile, compute policy, compute grant, authorization, cleanup, and slot authority. They return a dependency-specific deny code, `bot_busy`, `cleanup_blocked`, or `confirmation_stale` before external work. No mutation predicate reads `bot_activity` or `usable_grant_count`.

`listBotsForRoster(accountId, { q, asOfMs, cursor, limit })` derives status and usable grants in one set-based query. It sorts by `(presentation_rank ASC, last_activity_at DESC, bot_id ASC)`. The opaque cursor binds `account_id`, normalized query digest, `as_of_ms`, and the last tuple so time-based expiry cannot reorder later pages. `readBotWorkspace` and `pollRun` return view schemas, not Drizzle records. Database packages run the same roster, search, cursor, workspace, and poll contract fixtures.

Final answers render as plain text with `white-space: pre-wrap`; the first release does not render model Markdown or HTML. Reviewed connector code constructs each `SourceReferenceV1` from typed provider identifiers. It accepts one canonical `https:` host, the default port, a connector-specific path grammar, and an allowlist of safe query keys. It rejects unknown query keys, userinfo, fragments, IP literals, nondefault ports, and any URL whose canonical form changes after parsing. The reference contains provenance, a safe label, and the displayed hostname. Model-authored citations remain unlinked text. External links use `rel="noopener noreferrer"` and `Referrer-Policy: no-referrer`. Browser code writes text with `textContent`, not `innerHTML`.

## Organization catalog and Bot assignment

The database calls the tenant boundary `account`; the product calls it an organization. The initial `owner` is the organization administrator. The contracts reserve `owner`, `admin`, and `user` vocabulary before schema freeze, but the first verified slice seeds and authorizes only its owner. No route may honor `admin` or `user` until Item 5 lands the role-action matrix, membership fences, access-request commands, and role-specific serializers. That later model lets owners manage roles, lets owners and admins curate connectors and approve grants, and lets users request exact permissions and operate Bots they can access. A user never turns a connection or permission request into a grant. Metorial dashboard access remains separately enforced by Metorial SSO or account roles; hiding a link in OpenBot is not a security boundary.

The organization administrator curates two catalogs:

- An organization tool policy selects a pinned Metorial deployment version and named connector tool key. Its create command accepts those identifiers only. Reviewed connector code reloads the pinned vendor schema, nullable Metorial `readOnly` and `destructive` tags, local effect review, data rules, resource-mapping support, and model-disclosure rule, then stores those server-derived bytes and digests. A missing or null `readOnly`, a null `destructive`, contradictory values, or changed metadata is `unclassified`. An omitted `destructive` field is recorded as omitted and normalized to false; known pairs map to `read`, `write`, or `destructive`. Local review may raise severity but cannot lower it. An organization user cannot submit or relabel these claims. A classification or schema change requires a new connector release and policy revision.
- A skill is a versioned instruction module. `SkillRevisionV1` contains a name, purpose, encrypted instruction content ID, bounded input and output schemas, requested organization tool policy IDs, maximum instruction bytes, author, plaintext digest, server-owned data class, and lifecycle state. Its schema has no code, credential, package, URL, MCP, or executable-template fields. Instruction text is untrusted and may still contain a URL, secret, hostile instruction, or sensitive organization data. A secret and URL scanner can warn or deny known patterns but cannot prove the text safe. The confirmation names the exact revision and says its bytes go to the model provider. The compiler places it below immutable system policy and never interpolates it into authorization, a network address, or a vendor credential.

The installation exposes one reviewed `CodeExecutionProfileV1`. Its immutable configuration digest is recomputed from the profile key and revision, Sandbox SDK and package digest, image digest, runner protocol and digest, runner and Node versions, selected `lite` or `basic` instance, JavaScript language, admitted data classes, public-egress and DNS behavior, ephemeral filesystem, disabled package installation and terminal access, and every numeric compute limit. A separate profile-record digest also covers lifecycle and the current attestation reference. A candidate runs one server-seeded synthetic platform probe only. Enabling requires an unexpired operator-signed `sandbox_execution` attestation bound to the exact report, configuration, installation, environment, deployment, and required check set. The verifier recomputes the configuration digest and requires complete schema-valid profile, Bot revision, policy, and grant records before code is authorized. An enabled first-release profile admits at most public, synthetic, and organization data and may later be disabled. The organization owner creates a policy with limits no broader than the enabled profile, selects that exact policy revision and digest for a Bot revision, and issues a separate expiring compute grant with limits no broader than that policy. The compiler takes the componentwise minimum of profile, policy, grant, and Bot-run limits and signs that effective limit set into the confirmation, manifest, reservation, runner request, and result decoder. A Metorial connection or provider capability grant never authorizes code. The owner cannot edit the reviewed profile's security fields.

A Bot revision pins each selected organization tool policy ID, revision, digest, exact tool key, effect class, and execution mode, plus its skill revisions and zero or one organization compute policy. The `Read`, `Write`, and `Destructive` checkboxes are derived summaries over those selections, never stored authority. Selection is intent, not authority. All selected provider-tool policies must resolve to the same reviewed connector deployment, provider authorization, and capability grant. A provider tool is permitted only when its exact key appears in the active organization ceiling, Bot revision, connector contract, provider grant, signed manifest, and current Metorial session filter. The gateway creates sessions with literal `tool_keys`; it rejects an omitted filter, `allow_all`, regex filters, parent-filter overrides, returned-filter drift, and every unclassified or newly discovered tool. Code is permitted only when the installation profile, organization compute policy, Bot revision, current compute grant, disclosure, signed manifest, run capability, capacity reservation, JavaScript runner, and code-call reservation agree. A skill cannot add a provider tool, compute policy, data class, destination, mount, or limit. The signed manifest includes each skill revision ID and plaintext digest plus the compute-policy and profile digests when selected. The encrypted runtime envelope carries the exact instruction bytes. Compilation denies an unresolved, disabled, cross-deployment, cross-authorization, compute-policy, compute-grant, code-profile, or permission dependency. User-authored prompts, purposes, behavior instructions, and skill instructions default to the `organization` data class. A trusted server-side review may raise them to `restricted`; public commands cannot submit or lower the classification. `unknown` denies model or code dispatch.

The connection flow and permission flow are separate. A control-plane-authored setup card may start a short-lived Metorial authorization flow for the active Bot's reviewed connector, but completing OAuth grants no Bot tool access. The owner approves the first-release capability grant. The later team model may also let an admin approve it and a user request it. A grant binds the exact Bot revision, provider authorization, selected policy revisions and digests, resource scope, effect ceiling, limits, purpose, expiry, and approval modes. OAuth scopes describe the provider credential; they do not prove that a Metorial tool filter narrows that credential.

OpenBot's redacted audit record is the product record of who configured, requested, approved, reserved, dispatched, denied, cancelled, and observed an operation. Metorial tool-call logs are supplemental connector evidence. Regular users do not need Metorial access to understand OpenBot's decision. A future role-checked owner/admin view may receive an `Open Metorial dashboard` link whose configured path stays on the fixed `https://app.metorial.com` origin. OpenBot does not synthesize record-specific dashboard URLs because Metorial does not document a stable deep-link contract, and it never puts a session secret, connection URL, auth-config reference, or management identifier into the link.

Organization tool policy and skill revision versions are dependency-specific fences. Disabling one entry advances only that entry and the revocation fence of runs that depend on it. The same transaction invalidates dependent live confirmations, marks affected active runs cancellation-requested, and creates cancellation and cleanup outbox records. Unrelated Bots remain runnable. Existing audit records keep the disabled revision and digest. Creating a skill revision does not change a Bot revision or disable an older revision. One revision is the current catalog default; an older selected revision stays usable until explicitly disabled. Bot creation offers only active catalog entries and creates no connection or grant as a side effect.

The verified slice supports four exposed model tools total, at most four declarative skills, and one organization compute policy per Bot revision. Enabling `execute_javascript_v1` leaves at most three Metorial provider tools. Combined skill instruction text is limited to 32 KiB. Schemas use one pinned JSON Schema subset with limits for bytes, depth, properties, and references. External and recursive `$ref` are denied, and regular-expression features outside the reviewed subset are denied. Encrypted instruction content is retained while any Bot revision or run manifest references it. The initial release has no organization-deletion or configuration-erasure operation, and the UI states that limit. Historical manifests retain revision IDs and digests, not plaintext instruction bytes. This catalog work lands before the policy compiler so later membership and sharing features do not require changing manifest identity.

## Shared artifact workspace

OpenBot will not imitate one persistent computer. The Cloudflare design is an organization-scoped artifact workspace: R2 stores application write-once object bodies, the selected Drizzle control database stores logical paths and versions, and a private `artifact-gateway` Worker enforces Bot and user access. Durable Object SQLite remains private, run-owned coordination storage and never holds shared project bodies.

This is not a POSIX filesystem. A collection contains normalized logical paths. A path points to one append-only artifact version, and a version points to one R2 blob. OpenBot treats a random blob key as write-once, but R2 does not enforce immutability against a bucket administrator. Moving or renaming a path changes database metadata without copying bytes. A project snapshot is an append-only R2 manifest of path and version IDs with a digest and header in the control database. A multi-transaction snapshot intent pins each distinct blob in bounded batches, streams the manifest, verifies its count and digest, then makes the snapshot visible. Incomplete snapshots and pins are swept. Sync uploads changed objects individually.

Every shared collection has a monotonically increasing content version and one current complete snapshot. `artifact_path_history` records each pointer's inclusive start revision and exclusive end revision. A snapshot captures one collection revision, and its indexed members resolve through that history without reading or trusting a mutable current path. The canonical R2 manifest is evidence and a garbage-collection root, not the only read index. Publication, move, restore, or delete advances the content version and schedules a replacement snapshot; the prior snapshot remains readable. Run confirmation resolves each read mount to a current snapshot whose content version matches the collection. If a replacement is still building, confirmation returns `artifact_snapshot_pending`. The signed manifest records collection ID, normalized prefix, snapshot ID, snapshot digest, allowed data classes, and `read`. A run lists and reads version IDs from that snapshot only. Later publication appears on the next confirmed run, never the active run.

R2 keys use random organization-scoped blob IDs, not user paths or public content hashes. Directory listing comes from the control database, not `R2.list()`. Reads use version IDs, conditional ETags, and byte ranges. Every read compares R2's observed version, ETag, and size with the database record and fails closed on a mismatch. Never complete, resume, or overwrite an already observed blob key.

Writes create a database upload intent, reserve quota, and stream one or more parts through the gateway. A backpressure-preserving `TransformStream` awaits each write to Cloudflare `crypto.DigestStream("SHA-256")` before forwarding that chunk to R2; it does not use an unbounded `ReadableStream.tee()` branch. The gateway stores part number, byte length, server-observed SHA-256, and R2 ETag. Completion uses the contiguous database-held part list, then records R2's returned version, ETag, and size. The artifact digest is `sha256-part-tree-v1`, a domain-separated SHA-256 over declared total size and the ordered part records. It is not a whole-object SHA-256 or a multipart ETag. A preview gate pins this algorithm and records peak Worker memory for one and two concurrent parts.

A crash after R2 completion leaves an unreferenced blob for reconciliation and garbage collection. Upload intent may name its reserved random key, but no visible artifact path or version points to a body until the gateway observes completion. Deletion tombstones the path for seven days. Restore changes metadata only. Immutable version metadata remains for provenance, but its body may move to `content_retired` after no live path, snapshot pin, retained publication, backup root, restore, or upload depends on it. Blob garbage collection waits 30 days after that transition.

Garbage collection first retires body content only when no live path, snapshot pin, retained publication, backup root, restore, or upload references it. It then uses a guarded transition from `live` or `gc_candidate` to `deleting` after the retention cutoff. A new root can reference only `live` or atomically return `gc_candidate` to `live`; it fails once deletion is claimed. The maintainer deletes the R2 key, resolves an ambiguous response with `HEAD`, then records `deleted` while preserving the version digest and provenance tombstone. A failed delete remains a cleanup obligation. Periodic reconciliation also compares R2 version, ETag, and size to detect an administrator overwrite.

Each Bot always has a private collection. Bot revision mounts are shared-collection `read` mounts only. At run creation, the compiler adds a separate `PrivateOutputCapabilityV1` bound to the account, Bot, run ID, private collection, exact run-output prefix, object count, byte quota, and expiry. The runtime receives no R2 binding, S3 credential, bucket name, or raw object key. It calls the capability gateway, which checks the signed snapshot mount or private-output capability and forwards one operation to the artifact run service. The artifact service reloads the current organization, Bot, mount, run, and revocation fences before R2 access.

When the workspace is enabled, `RuntimeLimitsV1` adds at most eight snapshot mounts, 32 artifact operations, 500 listed entries, 128 KiB per text read, 512 KiB total read bytes, 128 KiB total model-visible extracted text, eight text draft objects, and 1 MiB of draft bytes per run. Each draft call is limited to 128 KiB. `write-text-draft` is a reviewed built-in model tool in the artifact manifest extension. It counts against the two model-selected tool calls and the 32 artifact operations. Its input schema accepts one normalized relative path, strict UTF-8 text, declared media type fixed to `text/plain; charset=utf-8`, and no caller-supplied data class. The start confirmation names every snapshot, allowed data class, private draft destination, and limit. A runtime draft is append-only under its run output path and cannot overwrite or publish an existing path.

Bots do not invoke one another or transfer a run. A Bot may create append-only draft artifact versions under its private run output path. Sharing is a separate user action that names the source version digest, destination collection and path, and expected path version. Publishing changes metadata only; it does not copy the blob. Another Bot can read the published version on a later run only when its revision mounts that shared prefix. Published versions provide shared project data without shared browser state, shared credentials, or direct handoff authority.

Every artifact version records origin actor, producing run and Bot when present, source tool and result provenance digests, declared media type, byte size, conservative data class, model-disclosure flag, digest algorithm, and digest. The initial ordered lattice is `public < organization < restricted`; `unknown` is incomparable and denies publication or model disclosure. The gateway derives a runtime draft's class as the maximum of the prompt, selected skill revisions, every model-visible tool result and artifact read, and the destination's minimum. The runtime cannot submit or lower it. Unknown provenance or classification denies publication. Collections and path prefixes declare allowed data classes. `publishVersion` verifies the immutable source version, observed digest, provenance, classification, destination policy, expected path version, current owner membership, and idempotency command in one guarded transaction. It pins the live blob before changing the destination pointer.

The run confirmation states that model or tool output may be stored in the named private draft collection. The publication page shows Bot and run origin, type, size, data class, digest algorithm and digest, destination, overwrite result, and that OpenBot has not scanned or previewed the bytes. Publication to a broader data class denies.

Logical paths are case-sensitive UTF-8 NFC, at most 1,024 bytes, with segments of at most 255 bytes. Normalize before applying limits and split into nonempty `/`-delimited segments. Reject `.`, `..`, backslashes, control and bidi characters, leading or trailing whitespace, and duplicate normalized paths. Store the canonical bytes plus `path_key = SHA-256(canonical UTF-8)` and enforce unique account, collection, and binary path key. The impossible digest-collision path compares canonical bytes and denies.

Mount comparison is segment-aware: it matches equality or `prefix + "/"`, never a raw string prefix. Reject encoded slash or backslash, double encoding, and any second representation that normalizes differently. Cross-profile fixtures cover case-only names, composed and decomposed Unicode, Turkish I cases, sibling-prefix collisions, trailing slash, and byte boundaries.

Artifact bodies are untrusted bytes. Browser downloads are attachments. A run may read body content only through the first reviewed extractor: strict UTF-8 `text/plain` with no invalid sequence. The artifact version's data class and model-disclosure flag must be allowed by the snapshot mount and signed manifest before extraction. The gateway reserves operation and byte limits before reading and before adding extracted text to an OpenRouter request. HTML, SVG, Markdown rendering, office-document extraction, archives, and arbitrary binary model input are deferred.

Use multipart uploads through the Worker R2 binding. The initial workspace defaults are 16 MiB parts, two parallel part requests, 10 GiB per object, 10,000 files per snapshot, 100 GiB and 100,000 objects per organization, and 1 GiB of browser reads per organization per UTC hour. Enabling the workspace requires finite byte, object, and read limits within these validated maxima; a missing or unlimited value denies enablement. R2 supports larger objects, but OpenBot does not promise the platform maximum. The browser resumes by upload ID and part ETag. A failed or abandoned multipart upload is aborted by a scheduled sweeper.

`beginUpload` declares exact total bytes, object count, part size, and part count. One guarded control-store write reserves the full amount against organization and user quota using `used + reserved + requested <= limit` before R2 upload creation. A caller may have at most four pending uploads and two parallel part requests. Part rows are unique on upload and part number. The same number and server digest returns the prior ETag; another digest conflicts. Completion first claims `completing`, then accepts only contiguous database-held parts with uniform non-final size and the exact declared total. Completion converts reserved quota to used quota. Abort, expiry, or reconciled absence releases it once.

Browser and API uploads use an opaque OpenBot upload ID. The encrypted R2 multipart ID never leaves the artifact gateway. The scheduled artifact handler leases cleanup work in batches of 50, aborts abandoned uploads by encrypted multipart ID, observes absence or expiry, releases quota, and records manual-required after the configured retry ceiling. An R2 seven-day incomplete-upload lifecycle is a backstop, not the OpenBot cleanup mechanism. Runtime text drafts do not use multipart. Cancellation, mount revocation, or capability expiry advances the artifact fence so no later draft reservation passes; an in-flight R2 write with an uncertain response becomes an artifact cleanup obligation and keeps the Bot slot blocked until complete or manual-required.

Do not issue R2 presigned URLs or temporary S3 credentials in the first workspace build. Both are bearer capabilities without an OpenBot per-object revocation check on each request; revoking a parent credential can disrupt unrelated derived access. The private gateway costs one extra Worker service hop but keeps every part behind current organization and upload-state checks. If preview measurements show that hop is the bottleneck, add a separate gate for exact-object, action-scoped temporary credentials with a short TTL, leak tests, and an explicit revocation limit.

R2 is strongly consistent for object reads, writes, deletes, metadata, and listings, but the control database and R2 do not share a transaction. The intent, observation, reconciliation, and garbage-collection records above are therefore required. Do not put Cloudflare Cache or a public bucket in front of private artifacts.

`InstallationJurisdictionV1` uses `automatic`, `eu`, `us`, or `fedramp`. The workspace gate records a compatibility matrix for D1, Durable Objects, each external database origin, R2, Metorial, and OpenRouter. A location hint is performance input, not residency. Artifact enablement denies when the selected profile has no compatible supported R2 jurisdiction. The UI discloses residual vendor placement, and the R2 jurisdiction cannot change after bucket creation.

Artifact bodies rely on R2 server-side encryption. They are readable by the artifact gateway and an operator with bucket authority; unlike prompts and final answers, they are not application-encrypted. The installation disclosure and threat model state this limit. Application-level chunk encryption is deferred because it changes multipart hashing, range reads, key rotation, and restore.

Build this workspace only after the read-only core ships. The core preserves stable account, Bot, revision, run, and versioned manifest-extension identifiers. Artifact tables, migrations, routes, and manifest fields are added only after the R2 gate passes; no speculative artifact table blocks the D1 core schema.

The artifact gateway exports two private Worker entrypoints. `ArtifactUserService` is bound only by the control plane. `ArtifactRunService` is bound only by the capability gateway. Wrangler names the entrypoint on each service binding; neither caller can reach the other interface.

```ts
interface ArtifactUserService {
  createCollection(delegation: SignedArtifactUserDelegationV1, command: CreateArtifactCollectionV1): Promise<ArtifactCollectionAckV1>
  listEntries(delegation: SignedArtifactUserDelegationV1, query: ListEntriesV1): Promise<ArtifactEntryPageV1>
  readObject(delegation: SignedArtifactUserDelegationV1, query: ReadArtifactV1): Promise<Response>
  getUploadStatus(delegation: SignedArtifactUserDelegationV1, query: GetArtifactUploadV1): Promise<ArtifactUploadStatusV1>
  beginUpload(delegation: SignedArtifactUserDelegationV1, command: BeginArtifactUploadV1): Promise<ArtifactUploadAckV1>
  uploadPart(delegation: SignedArtifactUserDelegationV1, command: UploadArtifactPartV1, body: ReadableStream<Uint8Array>): Promise<ArtifactPartAckV1>
  uploadSmall(delegation: SignedArtifactUserDelegationV1, command: UploadSmallArtifactV1, body: ReadableStream<Uint8Array>): Promise<ArtifactVersionAckV1>
  completeUpload(delegation: SignedArtifactUserDelegationV1, command: CompleteArtifactUploadV1): Promise<ArtifactVersionAckV1>
  abortUpload(delegation: SignedArtifactUserDelegationV1, command: AbortArtifactUploadV1): Promise<ArtifactUploadAckV1>
  publishVersion(delegation: SignedArtifactUserDelegationV1, command: PublishArtifactVersionV1): Promise<ArtifactPublicationAckV1>
  movePath(delegation: SignedArtifactUserDelegationV1, command: MoveArtifactPathV1): Promise<ArtifactPathAckV1>
  deletePath(delegation: SignedArtifactUserDelegationV1, command: DeleteArtifactPathV1): Promise<ArtifactPathAckV1>
  restorePath(delegation: SignedArtifactUserDelegationV1, command: RestoreArtifactPathV1): Promise<ArtifactPathAckV1>
}

interface ArtifactRunService {
  listSnapshot(call: ReservedArtifactCallV1, query: ListSnapshotEntriesV1): Promise<ArtifactEntryPageV1>
  statSnapshotEntry(call: ReservedArtifactCallV1, query: StatSnapshotEntryV1): Promise<ArtifactStatV1>
  readText(call: ReservedArtifactCallV1, query: ReadArtifactTextV1): Promise<ArtifactTextV1>
  writeTextDraft(call: ReservedArtifactCallV1, command: WriteTextDraftV1): Promise<ArtifactVersionAckV1>
}
```

`SignedArtifactUserDelegationV1` contains account, user, browser-session digest, session-revocation fence, one action, target digest, command digest, issue time, 30-second expiry, and signing `kid`. The artifact user service verifies it, then reloads the owner membership and a narrow `artifact_user_authority` projection containing only user, account, session digest, active flag, and revocation fence. The control plane updates that projection in the same transaction as logout, session invalidation, password reset, or membership change. The artifact role cannot read Better Auth tables. `ReservedArtifactCallV1` contains a consumed gateway-call reservation ID and exact request digest. The run service reloads the reservation, run capability, manifest, snapshot, private-output capability, quotas, and every current fence. A stored gateway-token hash is never accepted as caller proof.

Run calls reserve sequence and quota in the capability gateway before the artifact service. User calls reserve idempotency command and quota before R2 I/O. A pending write with an ambiguous R2 outcome is reconciled before retry; it is never blindly repeated. Binding tests call every forbidden method from each caller and require a denial before database or R2 work.

After workspace adoption, the runtime-facing capability gateway adds `POST /v1/artifact/list`, `POST /v1/artifact/stat`, `POST /v1/artifact/read-text`, and `POST /v1/artifact/write-text-draft`. It uses the existing gateway sequence reservation before forwarding to the artifact service. Reads return bounded strict UTF-8 data with observed version and digest metadata. One draft call writes at most 128 KiB of strict UTF-8 to the run's private prefix and returns only an OpenBot version ID and digest. Multipart upload remains a user or API-client operation and is never exposed to the runtime.

## Browser routes

HTML pages use account-scoped UUIDs and return `404` for a resource owned by another account. Sensitive pages set `Cache-Control: no-store`. Raw bootstrap, reset, and run-confirmation tokens never appear in a URL. The OAuth callback carries an opaque, one-time state value because the protocol requires it; the callback does not log it, reflect it, or place it in a redirect.

| Method and path | Page or behavior |
|---|---|
| `GET /` | Send an unbootstrapped install to `/bootstrap`, a signed-out user to `/login`, and an owner to `/bots`. |
| `GET /login` | Email and password form. |
| `GET /bootstrap` | One-time first-owner token and password form. |
| `GET /reset` | One-time password-reset token and new-password form. |
| `GET /bots?q=&cursor=&limit=` | Attention-sorted Bot roster and `New Bot` control. `q` matches Bot name and short description only. |
| `GET /bots/new` | Name, short description, local appearance, purpose, behavior instructions, connector, and exact reviewed tools grouped as Read, Write, and Destructive. |
| `GET /bots/:botId` | Task timeline, status, and `Start a task` composer. |
| `GET /bots/:botId/profile` | Cosmetic profile fields and behavior revision history. |
| `GET /bots/:botId/access` | Connection state, permission requests, active and expired grants, exact tools grouped by effect, resource mapping, destinations, limits, purpose, approval mode, and revocation controls. |
| `GET /bots/:botId/runs/:runId` | Prompt, event timeline, result, cancellation, cleanup, evidence, and audit link. |
| `GET /run-confirmations/:confirmationId` | Five-minute start-confirmation card bound to the authenticated user and browser session. |
| `GET /catalog/tools` | Organization tool policies, review state, dependent Bots, and disable impact. |
| `GET /catalog/tools/:policyId` | Server-derived schema, effect classification, connector version, dependent Bots, and disable-impact form. |
| `GET /catalog/compute` | Reviewed installation profile, DNS gate state, organization compute policies, dependent Bots, and enablement limits. |
| `GET /catalog/compute/:policyId` | Profile digest, admitted data classes, dependent Bots and grants, and disable-impact form. |
| `GET /catalog/skills` | Skills, current default revisions, disabled revisions, and dependent Bots. |
| `GET /catalog/skills/new` | Create a declarative skill revision with no executable code. |
| `GET /catalog/skills/:skillId` | Revision history, requested tools, dependent Bots, and disable impact. |
| `GET /connections` | Reviewed connector, setup state, provider authorization state, and every Bot grant using it. |
| `GET /connections/new` | Explain OAuth scope and OpenBot's lack of authority before starting setup. |
| `GET /connection-setups/:setupId` | Pending, complete, expired, or failed setup with a safe `Reopen provider` action. |
| `GET /connections/:authorizationId` | Provider version, observed revocation state, and dependent grants. Never show the encrypted Metorial reference. |
| `GET /oauth/metorial/callback` | Verify one-time state, finish setup, and redirect to the server-recorded relative return path. |
| `GET /audit` | Cursor-paginated redacted audit events with Bot, run, event type, and time filters. |
| `GET /audit/events/:eventId` | Canonical redacted event, chain position, and verifier result. |
| `GET /cleanup-obligations/:obligationId` | Failed target, attempts, redacted error, next allowed retry, and observed vendor state. |
| `GET /settings` | Read-only account identity, installation profile, fixed data jurisdiction, retention, active key IDs, and software version. |

Browser mutations post form data to `/actions`. They validate the same Zod command as the JSON API, check `Origin` and CSRF, call one use case, and return `303` after success. Sign-in and POST sign-out are the two documented Better Auth form exceptions. Each action has a fixed success route and error renderer; it never accepts an arbitrary `returnTo`. Validation failures return `422`, focus an error summary, preserve non-secret fields, and render password, token, CSRF, idempotency, OAuth state, and session-bound fields empty. Zod schemas mark those fields non-reflectable, and problem responses never include submitted values or raw Zod issues. The browser module may enhance these forms, but the flow must work without JavaScript.

| Form action | Command |
|---|---|
| `POST /actions/bootstrap` | Consume one bootstrap token and create the first owner. |
| `POST /actions/password-reset` | Consume one reset token, change the password, and revoke prior sessions. |
| `POST /actions/bots` | Create a Bot and its first behavior revision. |
| `POST /actions/bots/:botId/profile` | Change cosmetic fields only. |
| `POST /actions/bots/:botId/revisions` | Append a behavior revision. |
| `POST /actions/organization-tool-policies` | Approve one reviewed Metorial tool version for Bot selection. |
| `POST /actions/organization-tool-policies/:policyId/disables` | Disable the policy after the displayed impact digest still matches. |
| `POST /actions/organization-compute-policies` | Create an organization policy that narrows the enabled installation profile. |
| `POST /actions/organization-compute-policies/:policyId/disables` | Disable the compute policy after the displayed impact digest still matches. |
| `POST /actions/skills` | Create a declarative skill and its first revision. |
| `POST /actions/skills/:skillId/revisions` | Append a declarative skill revision. |
| `POST /actions/skills/:skillId/revisions/:revisionId/disables` | Disable one immutable revision after the displayed impact digest still matches. |
| `POST /actions/connection-setups` | Start the reviewed Metorial OAuth flow. |
| `POST /actions/connection-setups/:setupId/reopen` | Redirect to the stored provider setup URL after state and expiry checks. |
| `POST /actions/provider-authorizations/:authorizationId/revocations` | Verify the displayed impact digest, deny local use, cancel affected runs, and request vendor revocation. |
| `POST /actions/capability-grants` | Create a scoped grant for one Bot revision and provider authorization. |
| `POST /actions/capability-grants/:grantId/revocations` | Verify the displayed impact digest, revoke the grant, discard confirmations, and cancel affected runs. |
| `POST /actions/compute-grants` | Create a separate expiring compute grant for one Bot revision and compute policy. |
| `POST /actions/compute-grants/:grantId/revocations` | Revoke compute authority, discard dependent confirmations, and cancel affected runs. |
| `POST /actions/run-confirmations` | Compile and store one disclosure snapshot. |
| `POST /actions/run-confirmations/:confirmationId/discards` | Consume the confirmation without creating a run and schedule prompt erasure. |
| `POST /actions/runs` | Submit `confirmation_id`; consume that session-bound confirmation and create the run. |
| `POST /actions/runs/:runId/cancellations` | Request cancellation once. |
| `POST /actions/runs/:runId/cleanup-retries` | Move a manual cleanup obligation back to pending; never mark it complete. |
| `POST /actions/runs/:runId/content-deletions` | Increment the erasure version, cancel an active run, erase retained prompt and final-answer ciphertext, and keep redacted audit metadata. |

Catalog, grant, skill, mount, and provider-authorization disable pages list affected Bots, grants, live confirmations, and active runs. The form submits the displayed impact digest and expected fence. If either changed, the server returns `impact_changed` and renders the current impact instead of mutating authority. Provider-authorization revocation also requires typing the displayed provider name. Cleanup retry can move `manual_required` to `pending`; no owner route can mark vendor cleanup observed or complete.

Bot creation selects active organization catalog entries but creates no connection, authorization, or grant. A Bot with no usable grant redirects its primary access action to connection setup and stores a server-side return route to that Bot's access page. After OAuth, the access page owns grant creation. Roster times use `<time datetime>` with an absolute accessible label. Copy enhancement starts from selectable plain text and reports success or failure without hiding the original value.

## JSON routes

Better Auth is mounted behind a committed allowlist under `/api/auth/*`. The first release enables email-and-password sign-in, session read, password change, and POST sign-out only. It rejects direct sign-up and every unlisted Better Auth method or path before dispatch. The operator command uses `POST /operator/v1/admin-tokens`, which accepts the separate operator credential and exposes no other administrative operation. The public API uses the browser session in the first release. Personal API keys are deferred.

| Domain | Routes |
|---|---|
| Account | `GET /api/v1/account` |
| Bots | `GET, POST /api/v1/bots`; `GET /api/v1/bots/:botId`; `PATCH /api/v1/bots/:botId/profile`; `POST /api/v1/bots/:botId/revisions`; `GET /api/v1/bots/:botId/runs`. The list accepts `q`, `cursor`, and `limit` up to 50. |
| Organization catalog | `GET, POST /api/v1/organization-tool-policies`; `GET /api/v1/organization-tool-policies/:policyId`; `POST /api/v1/organization-tool-policies/:policyId/disables`; `GET, POST /api/v1/organization-compute-policies`; `GET /api/v1/organization-compute-policies/:policyId`; `POST /api/v1/organization-compute-policies/:policyId/disables`; `GET, POST /api/v1/skills`; `GET /api/v1/skills/:skillId`; `POST /api/v1/skills/:skillId/revisions`; `POST /api/v1/skills/:skillId/revisions/:revisionId/disables` |
| Connector catalog | `GET /api/v1/provider-deployments`; `GET /api/v1/provider-deployments/:deploymentId` |
| Connections | `GET /api/v1/provider-authorizations`; `GET /api/v1/provider-authorizations/:authorizationId`; `POST /api/v1/connection-setups`; `GET /api/v1/connection-setups/:setupId`; `POST /api/v1/provider-authorizations/:authorizationId/revocations` |
| Grants | `GET, POST /api/v1/capability-grants`; `GET /api/v1/capability-grants/:grantId`; `POST /api/v1/capability-grants/:grantId/revocations`; `GET, POST /api/v1/compute-grants`; `GET /api/v1/compute-grants/:grantId`; `POST /api/v1/compute-grants/:grantId/revocations` |
| Runs | `POST /api/v1/run-confirmations`; `GET /api/v1/run-confirmations/:confirmationId`; `POST /api/v1/run-confirmations/:confirmationId/discards`; `POST /api/v1/runs`; `GET /api/v1/runs/:runId`; `GET /api/v1/runs/:runId/events`; `GET /api/v1/runs/:runId/result`; `POST /api/v1/runs/:runId/cancellations`; `POST /api/v1/runs/:runId/cleanup-retries`; `DELETE /api/v1/runs/:runId/content` |
| Audit | `GET /api/v1/audit-events`; `GET /api/v1/audit-events/:eventId` |

Every mutation carries an idempotency key scoped to account, user, action kind, target, and canonical command digest. Server-rendered forms contain a random server-issued key, and JSON clients use `Idempotency-Key`. Reusing a key with the same digest returns the original response reference; another digest returns `409 idempotency_mismatch`. Revision, profile, catalog, skill, grant, revocation, confirmation, run, cleanup, cancellation, and deletion commands include the relevant expected version. Repeated cancellation, revocation, discard, cleanup retry, and content deletion return the stored transition without duplicating an outbox or audit event.

Unsafe `/api/v1` methods require the same session, `Origin`, and synchronizer CSRF checks as forms, accept JSON only, and expose no CORS headers. List responses use `{ items, next_cursor }` with opaque stable cursors. Errors use `application/problem+json` with a stable OpenBot code and request ID. Do not add generic mutation routes for grants, manifests, runs, revocation, or cleanup.

`GET /api/v1/runs/:runId/events?after=&limit=` authorizes the run on every request and caps `limit` at 50. Its cursor binds account, run, sequence, and query version. `RunPollPageV1` returns `run_version`, execution, cleanup, evidence and result states, `items`, and `next_after`. Every user-visible state transition increments `run_version` and appends or accompanies a global event. Poll every two seconds while the tab is visible and any status can still change. Pause in hidden tabs, abort superseded requests, back off on errors or `429`, and stop only when all three state dimensions are settled or manual-required. The page includes an ordinary `Refresh status` link for no-JavaScript use.

JSON responses set `Cache-Control: no-store`, the correct JSON content type, and `nosniff`. A cursor from another run or filter returns a generic invalid-cursor problem without confirming that resource. Polling never changes focus or scroll position; a restrained `aria-live="polite"` region announces meaningful status changes only.

Every potentially unbounded collection uses `cursor` and `limit` with a maximum of 50, a deterministic tie-breaker, and a filter digest in the cursor. HTML pages render ordinary `Previous`, `Next`, or `Load older` links before adding enhancement. `RunDetailViewV1` carries server-derived `can_cancel` and `cancel_reason`; browser code never infers cancellation safety from a status label.

The HTML and JSON handlers contain no business rules. Both call the same typed use case and store operation. The generated OpenAPI document covers only `/api/v1`; it does not publish internal Worker, DO, `/actions`, Better Auth, or operator contracts.

The artifact workspace adds these routes only when its checklist item passes. Before then, do not register them or show artifact controls.

| Route group | Routes added with the artifact workspace |
|---|---|
| HTML | `GET /artifact-collections`; `GET /artifact-collections/new`; `GET /artifact-collections/:collectionId`; `GET /artifact-collections/:collectionId/uploads/new`; `GET /artifact-versions/:artifactVersionId`; `GET /artifact-uploads/:uploadId` |
| Browser actions | `POST /actions/artifact-collections`; `POST /actions/artifact-uploads/small`; `POST /actions/artifact-versions/:artifactVersionId/publications`; `POST /actions/artifact-paths/:artifactPathId/moves`; `POST /actions/artifact-paths/:artifactPathId/deletions`; `POST /actions/artifact-paths/:artifactPathId/restores`; `POST /actions/bots/:botId/artifact-mounts`; `POST /actions/bots/:botId/artifact-mounts/:mountId/revocations` |
| JSON metadata | `GET, POST /api/v1/artifact-collections`; `GET /api/v1/artifact-collections/:collectionId/entries`; `GET /api/v1/artifact-versions/:artifactVersionId`; `GET, HEAD /api/v1/artifact-versions/:artifactVersionId/content`; `POST /api/v1/artifact-versions/:artifactVersionId/publications`; `POST /api/v1/artifact-paths/:artifactPathId/moves`; `DELETE /api/v1/artifact-paths/:artifactPathId`; `POST /api/v1/artifact-paths/:artifactPathId/restores`; `GET, POST /api/v1/bots/:botId/artifact-mounts`; `POST /api/v1/bots/:botId/artifact-mounts/:mountId/revocations` |
| Multipart upload | `POST /api/v1/artifact-uploads`; `GET /api/v1/artifact-uploads/:uploadId`; `PUT /api/v1/artifact-uploads/:uploadId/parts/:partNumber`; `POST /api/v1/artifact-uploads/:uploadId/completions`; `POST /api/v1/artifact-uploads/:uploadId/aborts` |

The content route supports one explicit offset-and-length byte range up to 64 MiB and `If-None-Match`; it rejects multipart and suffix ranges. It emits `application/octet-stream`, a server-encoded RFC 5987 attachment filename, R2's quoted HTTP ETag, `nosniff`, `private, no-store`, and no referrer. It never copies uploaded HTTP metadata into response headers. Browser reads are rate-limited and charge returned bytes to the organization read counter. Multipart part requests are the one non-JSON unsafe API exception: they require `application/octet-stream`, exact `Content-Length`, checksum header, session, Origin, CSRF, and idempotency checks, then stream without body parsing.

Core and artifact metadata forms work without JavaScript. `/actions/artifact-uploads/small` accepts one file up to 8 MiB. Larger multipart transfer requires the browser module or an API client. Upload status returns declared file name, size, part size, part count, and observed part digests and ETags. After a reload, the browser requires the user to reselect the file and verifies size and every re-sent part digest before resuming; a browser path or file handle is never persisted.

## Trust and authority

| Decision or asset | Authority | Enforcer |
|---|---|---|
| Account, membership, bot, connection reference, grant, policy, manifest, run | OpenBot control store | Hono routes and domain-specific store operations |
| Browser identity and session | OpenBot control store | Better Auth with its Drizzle adapter |
| Organization tool and skill catalog | Organization administrator | Catalog fences, append-only revisions, Bot selections, and manifest compiler |
| Organization role and Bot access request | OpenBot control store | Role-action matrix, Bot ownership, admin approval, grant fences, and exact view serializers |
| OAuth credential | Metorial | Metorial stores the credential; OpenBot stores an encrypted auth-config reference |
| Tool meaning | Reviewed connector package | Pinned provider version, tool key, schema digest, effect review, and outbound-data rules |
| Tool availability | Exact organization ceiling, Bot selection, grant, signed manifest, and Metorial filter | Capability gateway intersects every exact tool key, then Metorial applies the literal `tool_keys` allowlist |
| Resource scope | Connector-specific mapping | Unsupported mappings deny the run |
| Model and provider | Signed manifest | Capability gateway builds the OpenRouter request and rejects any broader request |
| Active orchestration sequence | One run-owned Durable Object | Serialized requests and local SQLite state |
| Code execution | Organization compute policy, Bot revision, compute grant, manifest, and current gateway reservation | Capability gateway authorizes one call; private sandbox runner executes the fixed protocol in the run-owned Cloudflare Sandbox |
| Sandbox runtime, image, network, filesystem, and compute limits | Reviewed installation profile and signed manifest | Pinned sandbox-runner deployment, Sandbox container policy, process and byte limits, kill, and explicit destruction |
| Durable run and audit state | OpenBot control store | Orchestrator imports events and writes terminal business state |
| Shared artifact path and version | OpenBot control store and operator R2 bucket | Signed Bot mount, artifact gateway, immutable version record, and R2 object observation |
| Provider read dispatch | Active exact read policy, Bot revision, grant, manifest, and gateway reservation | Capability gateway and exact Metorial `tool_keys` filter |
| Provider write or destructive proposal | Active exact policy, Bot revision, grant, manifest, and later action-broker contract | The first read-only runtime cannot dispatch it; item 12 must bind concrete arguments and one-use human approval before the gateway can call Metorial |
| Audit evidence | OpenBot control store | Append-only application records with a hash chain |

The model, user prompt, skill text, tool output, artifact body, model-written code, code output, sandbox process, MCP server, and downstream model provider are untrusted. The control-plane Worker, orchestrator Worker, capability gateway, sandbox-runner Worker, fixed runner, pinned Sandbox control image, artifact gateway, runtime Worker, deployment configuration, and their secrets are trusted enforcement code.

A Durable Object isolates state and execution from other run objects. It does not provide a destination firewall. Workers code can call public Internet hosts. Import checks, URL validation, and reviewed request wrappers are software controls. OpenBot must not advertise network isolation for this runtime.

Cloudflare runs each Sandbox in a separate VM with its own filesystem, processes, network stack, and resource limits. OpenBot assigns one random Sandbox ID per run and never shares a container between runs or Bots. `enableInternet = false` blocks ordinary public egress, but DNS still uses Cloudflare's platform resolver. The deployed sentinel tests the reviewed image and records residual platform risk. It does not prove universal network isolation. The sandbox receives no reusable credential even if that gate passes.

The audit chain detects ordinary corruption and accidental rewrites. A database administrator can replace the rows and recompute the chain. Do not call it an immutable ledger or non-repudiable evidence.

## Deployment layout

| Worker | Public access | Bindings and secrets | Responsibility |
|---|---|---|---|
| `control-plane` | One custom domain; `workers.dev` disabled in production | `CONTROL_DB_FRESH`, Queue producer, Cron, private orchestrator service, Better Auth secret, content and configuration keyrings, operator credential verifier; private artifact user service and delegation signer only after workspace adoption | Auth, HTML, API, browser polling, outbox sweep |
| `orchestrator` | No public route | `CONTROL_DB_FRESH`, Queue consumer, Metorial and OpenRouter management keys, runtime DO namespace, manifest signing key, auth-config keyring, vendor-capability keyring, sandbox-reference keyring, content and configuration keyrings, runtime-envelope keyring, keyed-digest key | Recompile and sign manifests, create runs, provision and clean up vendor resources, drive run objects, import results |
| `capability-gateway` | Private service binding only | `CONTROL_DB_FRESH`, manifest public keyring, vendor-capability keyring, sandbox-reference keyring, keyed-digest key, outbound Metorial and OpenRouter clients, private sandbox execution service, private artifact run service after workspace adoption | Atomically reserve each call, then issue one constrained model, provider tool, code, or artifact request |
| `sandbox-runner` | Two private service entrypoints, no public route and no `workers.dev` | Private Sandbox namespace and matched container image only; no control database, R2, vendor client, management key, or user credential | Accept execution only from capability gateway; accept kill and destroy only from orchestrator; enforce fixed runner protocol, byte and time caps, egress settings, and platform cleanup |
| `artifact-gateway` | No public route | `CONTROL_DB_FRESH`, private R2 bucket binding with fixed jurisdiction, artifact-user delegation public keyring, artifact-metadata keyring, scheduled trigger | Export separate user and run entrypoints, stream object bytes, reconcile uploads, and garbage-collect unreferenced blobs |
| `runtime` | No public route and no `workers.dev` | Run DO export, private capability-gateway service, manifest public keyring, runtime-envelope keyring | Manual model loop and local execution journal |

Deploy in this order: artifact gateway when enabled, sandbox runner and its matched image, capability gateway, runtime, orchestrator, control plane. The orchestrator binds the runtime DO namespace with `script_name` and the runner lifecycle service. The capability gateway binds the runner execution service. No other Worker receives the Sandbox namespace. The two runner interfaces have different method sets and accept no generic actor union. Every Wrangler environment repeats bindings because non-inheritable bindings do not flow into environment blocks.

The public control plane cannot sign a manifest or decrypt auth-config and vendor-capability records. A private orchestrator RPC reloads current policy inputs, compiles the manifest, and signs only those bytes. The runtime Worker has no global database, vendor key, vendor URL, browser session, management binding, shell, filesystem, Sandbox binding, or public route. It receives a random 256-bit gateway token for one run. The gateway stores only its hash and binds it to the run, DO ID, Sandbox ID, manifest digest, audience, issue time, and expiry. Model-written code reaches the Sandbox only through one reserved private call.

The control plane has one typed service binding to this orchestrator interface:

```ts
createRunConfirmation(command: CreateRunConfirmationCommandV1): Promise<RunConfirmationAckV1>
confirmAndCreateRun(command: ConfirmAndCreateRunCommandV1): Promise<CreateRunAckV1>
requestRunCancellation(command: RequestRunCancellationCommandV1): Promise<RunMutationAckV1>
requestRunContentErasure(command: RequestRunContentErasureCommandV1): Promise<RunMutationAckV1>
requestCleanupRetry(command: RequestCleanupRetryCommandV1): Promise<CleanupMutationAckV1>
createArtifactMountRevision(command: CreateArtifactMountRevisionV1): Promise<BotRevisionAckV1>
revokeArtifactMount(command: RevokeArtifactMountV1): Promise<RunMutationAckV1>
```

Each command carries account, authenticated actor, browser-session digest, idempotency key, expected version or fence, and canonical command digest. The two artifact-mount methods exist only after workspace adoption; mount changes create Bot revisions and therefore remain with the manifest authority, not the R2 service. The orchestrator reloads all authoritative records; it never trusts a route-supplied manifest, grant, catalog entry, mount, model route, or vendor reference. No other Worker binds this service, and no public route reaches it.

## Control-store profiles

The operator chooses one profile during installation. Switching profiles later is a data migration, not a configuration edit. Cross-profile migration is deferred until a tool can preserve IDs, audit links, encrypted references, and terminal run state.

| Profile | Worker driver | Migration path | Release order |
|---|---|---|---|
| `d1` | `drizzle-orm/d1` through a D1 binding | Wrangler applies committed SQLite migrations | First vertical slice |
| `postgres` | `pg` with `drizzle-orm/node-postgres` through Hyperdrive | Admin command uses a direct PostgreSQL migration URL | Added after D1 passes |
| `mysql` | `mysql2` with `drizzle-orm/mysql2` through Hyperdrive | Admin command uses a direct MySQL migration URL | Added after PostgreSQL passes |

A shared Drizzle schema across all three databases is a trap. Each database package owns its Drizzle tables, snapshots, and SQL migrations. Domain types and repository contract tests are shared. SQL is not.

Hyperdrive query caching must be disabled on every control-store configuration. Its cache is on by default and writes do not invalidate cached reads. Bind the database as `CONTROL_DB_FRESH`, keep Better Auth's cookie cache off, and assert the deployed Hyperdrive setting in release checks. Do not add a cached binding until OpenBot has a separate non-authoritative read model.

PostgreSQL and MySQL clients are invocation-scoped. Create a client inside each `fetch`, `queue`, or `scheduled` invocation. Never create a driver pool or module-global client, Drizzle database, repository, or Better Auth instance. A returned byte stream keeps its invocation alive; completion writes run in the stream finalizer, with no database transaction held across a vendor call. Hyperdrive owns pooling and cleans up at invocation end. Pin `pg` at a supported version at or above 8.13 and `mysql2` at a supported version at or above 3.13. MySQL uses `disableEval: true`. Every Drizzle and Better Auth query must pass a deployed Hyperdrive test before the profile is supported.

Migration credentials are separate from runtime credentials. PostgreSQL and MySQL use distinct origin users and Hyperdrive configurations for the control plane, orchestrator, capability gateway, and artifact gateway. Better Auth tables are visible only to the control plane. The sandbox runner has no control-store binding. The artifact role reads the narrow artifact-user authority projection plus current run, mount, and fence projections. It mutates artifact metadata and has only the guarded audit-head and redacted audit-insert operations required by artifact transactions. It cannot read auth tables, prompt content, vendor capabilities, or prior audit payloads. Each role gets the DML required by its named store operations and no DDL or role-management rights. D1 cannot provide equivalent binding-level or table-level separation. That is an accepted limit of the D1 profile.

Migrations are forward-only. Use additive changes and expand-contract changes that work with the previous Worker version. The first release prohibits destructive DDL. `deploy/d1/wrangler.jsonc` names the database, `migrations_dir`, and `migrations_pattern` for the committed Drizzle layout. Migration commands target that database name, apply locally and to preview first, and record a Time Travel bookmark before production. PostgreSQL and MySQL record a backup before deploy. Recovery uses a forward fix or restore drill, not an untested down migration.

## Durable Object storage

The installer selects a Cloudflare data jurisdiction. The orchestrator allocates each run with `RUN_OBJECT.jurisdiction(configuredJurisdiction).newUniqueId()` when that placement is required. It stores the opaque ID and jurisdiction on the global run record. The browser never receives the ID. Only the orchestrator can address the object. The signed command includes the DO ID, and the object rejects a mismatch with `ctx.id.toString()`.

Use Cloudflare's native `ctx.storage.sql`. Do not force prerelease Drizzle into the runtime object. Drizzle owns the global stores; the DO schema is small enough to review as SQL.

The constructor runs ordered migrations inside `blockConcurrencyWhile()`. OpenBot tables use an `openbot_` prefix, and `openbot_schema_migrations` records each applied migration. A failed migration rejects the request without deleting old data. Wrangler's DO class declaration creates the SQLite-backed class. It does not migrate tables inside each object.

DO storage contains the command digest, manifest digest, status, call boundaries, event metadata, counters, final-answer digest, and a terminal tombstone. It never contains the gateway token, vendor URL, vendor key, raw prompt, raw tool arguments, raw tool result, or raw final answer. The prompt travels inside the runtime envelope. Its ciphertext uses additional authenticated data containing the account ID, run ID, DO ID, manifest digest, and command expiry. The signed command contains the ciphertext digest. The object decrypts the prompt into memory, never serializes it, and drops the reference at terminal state.

After global event and result import, `scrubToTombstone` removes non-tombstone data. Keep the terminal tombstone until the command expiry plus the configured 24-hour Queue retention window. It rejects every later start for that DO ID. After that time, a separate signed `deleteAfterRetention` command calls `deleteAll()` once and retires the global DO mapping. It requires the global cleanup state, terminal digest, and `notBefore` value. The global cleanup row, not the empty object, records final deletion.

## Runtime protocol

The orchestrator addresses the DO through its internal `fetch` API. No runtime route is public.

```ts
POST /v1/start                  -> application/x-ndjson bytes
POST /v1/cancel                 -> CancelAckV1 JSON
GET  /v1/events?after=&limit=   -> RunEventPageV1 JSON
POST /v1/acknowledge-import     -> ImportAckV1 JSON
POST /v1/scrub-to-tombstone     -> ScrubAckV1 JSON
POST /v1/delete-after-retention -> DeleteAckV1 JSON
```

Wire streams are `ReadableStream<Uint8Array>`, not object streams. Each NDJSON line is at most 16 KiB. The decoder rejects invalid UTF-8, an invalid Zod frame, a missing or repeated sequence, bytes after a terminal frame, and aggregate bytes above the signed limit. `RunFrameV1` remains the decoded logical type. Abort signals flow from orchestrator to DO and from DO to the gateway.

The orchestrator calls `/v1/start` from a Queue consumer and keeps the byte stream open. The Queue consumer limit is 15 minutes. The 120-second execution clock begins when the DO accepts the signed start command; provisioning and cleanup are separate clocks. Queue batches contain one message, message retention is 24 hours, and exhausted messages enter a configured dead-letter queue.

Before every model or tool request, the DO writes a `started` record. After a complete response, it writes the matching `completed` record. If a new invocation finds a started record without a completed record, it emits `execution_outcome_unknown`, stops, and never repeats the request. Durable storage supports inspection and event replay. It does not provide exactly-once execution.

`/v1/cancel` stores a cancellation fence, aborts active fetches, and checks that fence before the next model or tool request. The control plane first commits cancellation globally, then calls a private orchestrator endpoint. The outbox retries that call. The gateway propagates the abort signal to Metorial or OpenRouter. A call reserved before revocation may still reach the vendor. If OpenBot cannot prove it stopped, the terminal result is `cancelled_with_effect_unknown`.

Queue delivery is at least once and may arrive out of order. Every message carries an outbox ID. The producer calls `claimPendingOutbox(now, owner, leaseUntil)` with a 30-second lease, sends before `markOutboxDispatched(id, fence)`, and reclaims expired leases. The consumer calls `claimRunDelivery(outboxId)` and deduplicates by that ID. A crash after send produces a duplicate, including on DLQ replay. The consumer drains local events first and performs no new vendor create while an earlier provisioning intent is unresolved.

`claimRunAttempt(runId, owner, now)` issues a new fence only after the prior 300-second lease expires. The owner heartbeats every 30 seconds. Every global write includes the attempt fence, so a reclaimed or delayed worker cannot change run state. Three failed Queue deliveries move the message to the DLQ; replay uses the original outbox ID. A scheduled sweep reclaims expired outbox and run-attempt leases and requeues nonterminal runs with no live delivery.

The final answer exists only in the response stream until the orchestrator encrypts it into a stable `content_blob` and links it through `run_content`. The run moves through `result_pending_import` and `result_imported`. After the global commit, the orchestrator calls `/v1/acknowledge-import` with the terminal digest. If a retry finds a completed DO digest but no matching global ciphertext, it records `result_lost_after_execution`; it must not report success or repeat the model call.

`requestRunContentErasure` increments the run's content-erasure version, erases existing prompt and result ciphertext, and cancels a nonterminal run in the same transaction. Every later content write includes the expected prior erasure version. If erasure won the race, result import discards raw bytes and persists redacted terminal metadata only. Result reads return `202` while pending, `200` when content exists, `410 content_deleted` after erasure, and account-scoped `404` for an unknown or foreign run.

The capability gateway also uses an internal byte protocol:

```ts
POST /v1/model -> application/x-ndjson bytes
POST /v1/tool  -> ToolResultV1 JSON
POST /v1/code  -> CodeResultV1 JSON
```

The runtime owns transcript state and loop control. The model endpoint accepts a bounded transcript envelope and the next sequence. The gateway loads the manifest, validates every message and tool schema against it, builds one direct OpenRouter request, and returns one byte stream. No database transaction stays open while that stream is active.

Before network I/O, `authorizeAndReserveGatewayCall()` performs one conditional store operation. It verifies the token hash, audience, run and grant state, authorization expiry, manifest signature and digest, DO ID, cancellation fence, sequence, canonical request digest, and remaining call and cost reservations. It inserts `gateway_call` and consumes the sequence and declared budget atomically. A duplicate with the same digest returns recorded terminal metadata when available. A duplicate with another digest denies. A `pending` call after an ambiguous failure becomes `outcome_unknown` and is never sent again. Failed or ambiguous reservations remain spent in the initial release. The gateway rechecks revocation immediately before dispatch, but no distributed check removes the final race after reservation.

The same reservation compares every selected organization tool policy version and digest, every selected skill revision lifecycle and digest, the capability-grant fence, the run cancellation fence, and, for artifact calls, the mount fence, snapshot digest, or private-output capability. A disable or revoke that linearizes first makes the reservation deny. A reservation that linearizes first may dispatch, while the later disable cancels the run and records any uncertain effect. Tests cover both histories and prove that changing an unrelated catalog entry does not interrupt the run.

The gateway builds every outbound request. The runtime cannot supply a model alias, model array, provider list, plugin, server tool, fallback, or arbitrary URL. A completed duplicate returns recorded terminal metadata, not another vendor call. If raw response delivery was ambiguous, the run becomes `outcome_unknown`.

`execute_javascript_v1` is one built-in model tool and consumes one of the four exposed-tool slots. It is separate from the reviewed Metorial tool catalog and cannot call a provider tool. Its request contains bounded JavaScript source and one bounded JSON input. The runtime supplies the run token and next sequence. The capability gateway reloads the signed compute policy, grant, and runtime profile, reserves the sequence and code budget, binds the request digest to the random run-owned Sandbox ID, then calls the private sandbox runner once. The model cannot select an executable, argument, image, Node version, environment variable, working directory, network rule, timeout above the manifest, or persistent volume.

The sandbox runner pins one exact `@cloudflare/sandbox` 1.0 preview version and matching image digest after the adoption gate passes. It uses one `lite` instance per run unless the memory probe requires `basic`. It writes source and canonical JSON input to fixed run-owned paths and launches one source-constant argv pointing to the reviewed Node runner. It sets `enableInternet = false`, configures no allowed host or outbound handler, exports no tunnel or preview route, disables SSH, and passes no OpenBot, provider, user, or storage secret through the environment or files. Cloudflare platform metadata may still exist inside the container, so sentinel tests cover it. The product exposes no Python or TypeScript executor, direct shell or argv endpoint, terminal, package-install operation, background-service API, listening port, browser automation, or code-originated provider call. JavaScript may use `node:child_process` to invoke binaries already present in the reviewed image. The VM boundary, zero credentials, zero admitted outbound requests, process and time limits, and terminal destruction request contain that subprocess authority. The adoption gate inventories installed binaries and proves the chosen process-limit mechanism before enabling the profile.

One run may execute code once. The fixed runner imports the module's default async `main(input)` function, passes one parsed JSON value, and serializes one strict JSON return value. Another export shape denies. A container sleep, replacement, lost process handle, gateway disconnect after dispatch, or started record without a completed record makes the run `outcome_unknown`; the initial release does not replay the code. The sandbox runner enforces separate startup, process, teardown, and total-age clocks. It caps source, JSON input, stdout, stderr, result, and aggregate output bytes. Private NDJSON frames carry protocol version, call sequence, frame sequence, and request digest. The decoder requires strict UTF-8, contiguous frames, one terminal frame, canonical `application/json` result bytes with a matching digest, and no later bytes. It accepts no HTML, Markdown, or rich-output content type. A JSON string containing markup remains inert text and is escaped if displayed. Audit records keep keyed digests, duration, exit state, and byte counts, not raw code or intermediate output.

OpenBot preallocates the random Sandbox ID and capacity lease in the run transaction before any platform call. Cancellation advances the global fence, aborts the gateway wait, sends a fixed numeric signal to the exact process handle through the sandbox runner, and requests destruction. An AbortSignal alone is not process cancellation. Terminalization always requests `destroy()`. The matching cleanup obligation reaches `complete` only after Cloudflare acknowledges that call; OpenBot does not present that acknowledgment as independent deletion proof. A lost destroy response is retried only after the adoption gate proves repeat destroy safe. Otherwise it becomes `manual_required` and keeps the Bot run slot and capacity lease blocked. Sandbox files are not results and are never relied on after terminal state.

Each tool call is one complete MCP operation: connect, initialize, list and verify tools, call one tool, close, and discard protocol state. The adapter implements only initialization, `tools/list`, `tools/call`, and required notifications. It rejects sampling, elicitation, roots, resources, prompts, and server-originated requests. It accepts HTTPS only, forbids user info, fragments, alternate ports, and redirects, validates the signed host and path prefix, caps response sizes, and maps all errors to redacted codes. If a deployed two-call probe shows that Metorial requires reusable protocol state, store that state as an encrypted `vendor_capability` outside the DO or do not ship that API version.

## Initial limits

Every enforceable value below appears in `RuntimeLimitsV1`, the signed manifest, the gateway checks, and the tests. Estimated values are checked conservatively before dispatch and reconciled with provider observations afterward.

| Limit | Value |
|---|---:|
| Prompt UTF-8 bytes | 16 KiB |
| Serialized model-request bytes | 256 KiB |
| Exposed tools | 4 |
| Selected declarative skills | 4 |
| Combined skill instruction bytes | 32 KiB |
| Combined tool-schema bytes | 128 KiB |
| Tool argument bytes per call | 16 KiB |
| Tool result bytes per call | 128 KiB |
| Safe summary bytes per call | 4 KiB |
| Model turns | 5 |
| External provider tool calls | 2 |
| Code executions | 1 |
| Code source UTF-8 bytes per call | 32 KiB |
| Code JSON input bytes per call | 128 KiB |
| Code stdout bytes per call | 48 KiB |
| Code stderr bytes per call | 16 KiB |
| Code result bytes per call | 64 KiB |
| Aggregate code output bytes per run | 128 KiB |
| Sandbox filesystem bytes per run | 256 MiB |
| Sandbox processes per run | 8 |
| Sandbox outbound requests per run | 0; DNS remains a separately tested platform path |
| Sandbox NDJSON frames per run | 64 |
| Sandbox startup time | 60 seconds |
| Code execution time per call | 15 seconds |
| Sandbox teardown time | 30 seconds |
| Sandbox active lifetime | 120 seconds |
| Sandbox instance | `lite`: 1/16 vCPU, 256 MiB memory, 2 GB ephemeral disk; the gate may require `basic` before schema freeze |
| Concurrent active sandboxes per installation | 4 |
| Estimated model input tokens per request | 32,000 |
| Model output tokens per request | 2,048 |
| Model-stream bytes per request | 128 KiB |
| Runtime wall time | 240 seconds |
| Durable metadata events | 64 |
| NDJSON bytes per frame | 16 KiB |
| Durable event bytes per run | 256 KiB |
| Raw final-answer bytes | 64 KiB |
| OpenBot estimated run cost | USD 0.25 |
| Queue delivery attempts before DLQ | 3 |
| Queue and DLQ message retention | 24 hours |
| Outbox dispatch lease | 30 seconds |
| Run-attempt lease and heartbeat | 300 seconds and 30 seconds |
| Automatic cleanup attempts | 10 over 24 hours |
| Raw prompt and final-answer retention | 7 days |
| OpenRouter price-snapshot age | 24 hours |
| Redacted audit retention | Indefinite in the first release |

The serialized request size is the preflight authority. Input tokens and USD cost are estimates because provider tokenization and pricing are external. The gateway denies a request if its dated model/provider price snapshot is missing or older than 24 hours and always sets `max_tokens`. The OpenRouter key spending limit is a secondary guard, not an exact cap on an in-flight request. OpenBot records observed usage and overshoot.

The container instance type is a platform resource boundary, not a promise that code will use less memory or disk before it fails. The adoption gate must prove that the pinned image makes every path outside the 256 MiB run workspace read-only and applies an eight-process OS limit. An application counter or post-run measurement does not satisfy either requirement. If the image cannot enforce those limits, change the reviewed profile to Cloudflare's actual instance limits before schema freeze and show them on the confirmation page. Guarded installation and account capacity rows allow four active Sandboxes across the installation and reject the fifth run before platform work. The sandbox runner truncates and stops importing output at the signed byte limits. On timeout, memory failure, output overflow, cancellation, or terminal state, the orchestrator calls the runner's lifecycle service to kill the process when needed and destroy the Sandbox. Until the deployed DNS gate passes, no code profile is enabled for user runs.

## Metorial rules

Metorial supplies provider deployments, OAuth setup sessions, auth configs, runtime sessions, tool filters, MCP transport, provider execution, and activity records. OpenBot decides whether an account may use any of them.

| Metorial object | OpenBot record | Rule |
|---|---|---|
| Provider and version | `provider_version_snapshot` | Catalog data only; pin the reviewed version and schema digests |
| Provider deployment | `provider_deployment_ref` | Read back the deployed version before a grant can refer to it |
| Setup session | `connection_setup` | Bind to account, user, deployment, one-time state hash, and expiry |
| Auth config | `provider_authorization_ref` | Encrypt the reference; never send it to the runtime |
| Runtime session | `tool_session` | One run, one auth config, one deployment, one tool allowlist |
| MCP URL | `vendor_capability` | Encrypt it; only the private gateway may decrypt it |
| Messages and events | `provider_observation` | Import allowlisted metadata only, never provider input or output by default |

A connection is not authority. A grant binds the account, append-only bot revision, provider authorization, deployment version, tool keys, resource rule, outbound data class, destinations, purpose, limits, expiry, and start-confirmation requirement.

Resource rules are connector-specific. The blocked first probe candidate is Metorial Search with no operator-supplied provider auth config, a `global_public_read_only` rule, and public or synthetic probe input only. The stored auth-absence field is descriptive, not proof. Before a tool policy can use this branch, a verified `first_connector` decision must bind the exact deployment, provider version, tool descriptor, schemas, global-public rule, and observed absence of an operator-supplied provider auth config. It cannot claim organization-resource isolation or serve the normal owner-prompt path. Another connector must use a dedicated test account and a provider-side scope that a reviewed argument mapper and sibling-target test prove. Connection-wide private-data access does not ship in the first release. Unsupported mappings deny the run.

Every connector defines input fields that may leave OpenBot, maximum lengths, result classification, and whether tool output may return to the model. The gateway validates proposed arguments against those rules. The run confirmation page names Metorial, OpenRouter, the downstream model provider, and the connector provider as disclosure destinations.

Send a pinned `Metorial-Version` header on management requests. Session creation names the provider deployment, auth config, and allowlist. Tool discovery must match the reviewed provider version, tool descriptor, and canonical schema digest.

Do not describe a Metorial session as revoked until a probe observes that a second client can no longer use its URL. Record `cancellation_requested_at`, `vendor_revocation_requested_at`, and `vendor_revocation_observed_at` separately. Auth-config revocation also has requested, observed, and unverified states. Local grant revocation denies OpenBot use immediately, but only Metorial readback proves that the reusable auth config stopped working. Closing the local MCP client is not revocation.

The `tool_session` is run-owned and OpenBot refuses to use it after the signed command expires. That is an OpenBot lifetime, not a claim that Metorial's bearer URL has a hard TTL. Cleanup and the second-client probe determine what can be said about vendor-side revocation.

## OpenRouter rules

The orchestrator creates an expiring key for each run. It records a provisioning intent before the API call and stores the returned key ID before starting the runtime. The raw key is encrypted for the gateway and never reaches the DO.

The gateway sends one literal model ID and `provider.order` with one provider slug. It sets `allow_fallbacks: false`, `require_parameters: true`, `data_collection: "deny"`, `zdr: true`, and explicit token limits. The selected candidate endpoint does not advertise `parallel_tool_calls`, so the gateway omits that field and rejects a response turn containing more than one tool call before dispatching any tool. If the selected model and provider cannot satisfy ZDR, the run is denied. Do not use model aliases, model arrays, auto routing, plugins, or provider fallback.

Set `X-OpenRouter-Metadata: enabled`. Persist the requested model/provider, resolved model/provider, routing strategy, attempt count, generation ID, usage, and cost, then reconcile cost through generation metadata. A mismatch or attempt count above one is a policy violation detected after disclosure. The fixed request and gateway checks prevent broader routing before the call; response metadata verifies what happened.

## Identity and browser security

The first release uses Better Auth email and password login with database sessions. Public registration is closed. The control plane exposes one audited operator endpoint for issuing bootstrap and password-reset tokens. It accepts a separately provisioned operator credential, applies a request limit, and returns a raw token once. The Node admin command reads the operator credential from an interactive secret input, calls that endpoint, and never mutates a production database directly. Bootstrap and reset tokens are stored as hashes, expire after 15 minutes, and are consumed by one guarded write. The bootstrap redemption path creates the first owner without opening Better Auth signup.

`account_membership(account_id, user_id, role)` is the only route from identity to account authority. The schema reserves `owner`, `admin`, and `user`; only `owner` is usable until Item 5 implements and tests the team role matrix. Removing or downgrading a member, revoking a capability grant, expiring a grant, or revoking a provider authorization atomically advances a revocation fence, marks affected active runs cancellation-requested, and creates cancellation and cleanup outbox records. The gateway checks both the run and that fence.

Construct Better Auth inside each request with `createAuth(env)` and that invocation's Drizzle adapter. Keep its cookie cache off. Pin Better Auth's scrypt password hashing and test a stored vector. Set password length to 12 through 128 characters. Enable Better Auth rate limiting in every environment, use database storage, trust only `cf-connecting-ip`, and allow five email sign-in attempts per IP per minute. `consumeAuthIdentifierAttempt` allows five attempts per keyed normalized identifier per 15 minutes. Bootstrap and reset allow five attempts per IP and token per 15 minutes. Failures use the same status, body shape, and response timing bucket. Rotate the session after login, password reset, and privilege change.

The production cookie is `__Host-openbot_session`, `Secure`, `HttpOnly`, `SameSite=Lax`, `Path=/`, and has no `Domain` attribute. Every browser mutation checks `Origin` and a synchronizer CSRF token. Pin Better Auth's `baseURL` and `trustedOrigins` to the configured HTTPS origin; never derive them from `Host` or forwarded host headers. OAuth callbacks use one-time state tied to the user, account, initiating browser session, deployment, callback origin, stored relative return path, and expiry. They never trust an account ID from the query string.

The callback atomically claims `pending` setup state with a fence before vendor work. A duplicate reads the stored status and never repeats finalization. A network-ambiguous result enters reconciliation. `Reopen provider` works only for a pending, unexpired setup; every failed, ambiguous, consumed, or expired setup requires a new setup, state, and provider URL. After processing, the callback uses `303` to the stored allowlisted path so the state value leaves the address bar.

HTML escapes model and tool text. Responses set a strict CSP, `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, and `Cache-Control: no-store` on authenticated, login, bootstrap, reset, and OAuth callback pages.

## Keys and sensitive data

Define key formats before database tables freeze.

| Key | Owner | Use |
|---|---|---|
| Better Auth secret | Control plane | Authenticate browser sessions and Better Auth state |
| Operator credential verifier | Control plane | Authenticate the two narrow admin-token issuance operations |
| Metorial and OpenRouter management keys | Orchestrator | Create, inspect, revoke, and reconcile run-owned vendor resources |
| Manifest ECDSA P-256 private key | Orchestrator | Recompile and sign policy manifests behind a private RPC |
| Manifest public keyring | Orchestrator, gateway, runtime | Verify current and recently retired manifest keys |
| Artifact-user delegation ECDSA P-256 private key | Control plane | Sign one short-lived user artifact action after browser authentication |
| Artifact-user delegation public keyring | Artifact gateway | Verify current and recently retired user delegation keys |
| AES-256-GCM content keyring | Control plane and orchestrator | Encrypt prompts and final answers |
| AES-256-GCM configuration keyring | Control plane and orchestrator | Encrypt declarative skill instruction bytes while referenced |
| AES-256-GCM auth-config keyring | Orchestrator | Encrypt reusable Metorial auth-config references |
| AES-256-GCM vendor-capability keyring | Orchestrator and gateway | Encrypt per-run Metorial URLs, protocol state, and OpenRouter keys |
| AES-256-GCM sandbox-reference keyring | Orchestrator and gateway | Encrypt the random platform Sandbox ID stored in the control database |
| AES-256-GCM runtime-envelope keyring | Orchestrator and runtime | Seal the prompt, gateway token, event key, and command-bound values |
| AES-256-GCM artifact-metadata keyring | Artifact gateway | Encrypt R2 multipart IDs and any future storage-side bearer metadata |
| HMAC-SHA-256 record-digest key | Orchestrator and gateway | Compare sensitive request and result bytes without an unkeyed low-entropy hash |
| HMAC-SHA-256 event key | One orchestrator and one run object | Detect mixed, missing, or altered event frames |
| Random 256-bit gateway token | One run object in memory; hash in control store | Authenticate one run's private gateway calls until expiry or revocation |

Every ciphertext includes `kid`, encryption domain, format version, random 96-bit nonce, and additional authenticated data with account ID, record ID, field type, and schema version. Cross-domain decryption must fail. Tests prove that the control plane cannot decrypt vendor capabilities, Sandbox references, or artifact metadata. The capability gateway cannot decrypt prompts, configuration content, auth-config refs, or artifact metadata. The artifact gateway cannot decrypt prompts, configuration content, Sandbox references, or vendor capabilities. The runtime cannot decrypt stored content. Rotation keeps old decrypt or verify keys during a documented overlap, rewraps stored records, then retires the old key. Losing an active key is a recovery event, not a silent reset.

The event HMAC proves that the holder of the run event key emitted the bytes. It does not prove that the model, MCP server, or runtime behaved correctly. Use domain-separated keyed digests for low-entropy tool arguments, results, and final answers when equality evidence is needed.

Safe structured logging, exception translation, and secret-sentinel tests land before real vendor calls. Runtime Workers Logs stay disabled until those tests pass. Logs allow only IDs, status codes, byte counts, durations, and stable error codes.

## Logical schema

The table below is the logical inventory, not one migration. Core rows through `provider_observation` and the audit rows ship with the read-only release. Rows whose names begin with `artifact_` are additive migrations owned by checklist item 11 and do not appear in a core installation.

| Tables | Ownership and constraints | Lifecycle |
|---|---|---|
| `auth_user`, `auth_session`, `auth_provider_account`, `auth_verification` | Better Auth IDs; sessions stored in the selected control DB | Sessions expire and can be invalidated |
| `auth_rate_bucket`, `admin_token` | Hashed identifier or token; purpose, expiry, attempt count, consumed time | Buckets expire; raw admin tokens are never stored |
| `account`, `account_membership` | Account is the organization boundary; unique membership on account and user; role is owner, admin, or user; the first verified slice seeds one owner | Role downgrade or removal advances the account revocation fence, removes admin-only actions, and cancels work that depended on the prior role |
| `organization_tool_policy` | Server-derived pinned deployment version, exact connector tool key, schema digest, Metorial tag snapshot, reviewed read/write/destructive class, execution mode, data rules, reviewer, version, dependency revocation fence | Active or disabled; unclassified tools cannot activate; disabling invalidates confirmations and cancels dependent runs only |
| `sandbox_runtime_profile` | Operator-reviewed SDK version, image digest, runner and Node versions, instance type, JavaScript-only protocol, numeric limits, admitted data classes, DNS probe result, profile digest | Candidate or enabled; a candidate cannot authorize a user run; disabling cancels dependent runs |
| `organization_compute_policy` | Account, reviewed runtime-profile revision and digest, admitted data classes, narrowed limits, version, dependency revocation fence, policy digest | Active or disabled; public commands may narrow the reviewed profile but cannot alter its security fields |
| `skill`, `skill_revision`, `configuration_blob` | Append-only declarative metadata, encrypted instruction content ID, requested organization tool policies, bounded schemas, author, plaintext digest, server-owned instruction data class, current-default pointer, dependency revocation fence | A revision is active or disabled; referenced encrypted content remains; creating a revision does not alter existing Bot revisions |
| `bot` | Account, creating or owning user, name, short description, fixed palette ID, reserved nullable reviewed local-icon reference, generated initials, NFKC-lowercase search fields, current revision, cosmetic version | Public commands require the icon reference to remain null until an icon pack is adopted; cosmetic changes update the Bot, executable changes do not |
| `bot_revision`, `bot_tool_selection`, `bot_skill_selection`, `bot_compute_selection` | Append-only `BotRevisionV1`: purpose and behavior-instruction data classes, prompt-template version, exact selected policy revisions, digests, tool keys, effects and execution modes, selected skills, optional compute policy, connector revision, model route, limits, outbound-data rules, digest | A bot points to one current revision; any behavior or permission change creates a revision; new connector tools are never inherited |
| `bot_access_request` | Bot revision, requesting user, exact requested policies, resource scope, purpose, expiry, request digest, review state, reviewer and decision time | Users request; owners or admins approve a subset into a capability grant; a connection alone never satisfies the request |
| `bot_run_slot` | Primary key on account and bot; nullable live confirmation and active run; unique active run; monotonically increasing version | Bot creation creates the slot; discard, consume, or expiry clears confirmation; completed cleanup clears run; stale delivery cannot clear another run |
| `bot_activity` | One row per bot with last run, monotonic OpenBot commit time, and projection version | Read hint only; status and usable grants are derived at query `as_of_ms` and never authorize a mutation |
| `provider_version_snapshot`, `provider_deployment_ref` | Account-scoped deployment; canonical tool-schema digests | Drift blocks new runs |
| `connection_setup`, `provider_authorization_ref` | One-time state hash, browser-session binding, processing fence, stored return path; encrypted auth-config ref | Setup is pending, processing, completed, failed, ambiguous, or expired; authorization is active, revocation_requested, revocation_observed, or revocation_unverified |
| `capability_grant`, `capability_grant_revision`, `policy_revision` | Account, Bot revision, provider authorization, exact policy revisions and digests, resource rules, effect ceiling, execution modes, data rules, limits, purpose, expiry, revocation fence | Revisions append; grants move from active to revoked or expired; write or destructive selection remains proposal-only until item 12 passes |
| `compute_grant` | Account, Bot revision, organization compute policy revision and digest, narrowed admitted data classes and limits, purpose, expiry, revocation fence, grant digest | Active, revoked, or expired; it has no provider-authorization foreign key |
| `run_confirmation` | Random ID, preallocated candidate run ID, account, user, initiating browser-session digest, prompt digest, prompt content ID, disclosure-format version, manifest-preview bytes and digest, version, issue, expiry, discard, and consumed time | One live confirmation per Bot; discard, consume, expiry, or authority change makes it unusable; an unused candidate run ID is harmless |
| `content_blob` | Stable content ID, encrypted prompt or result, content digest, key ID, create, expiry, erasure request, and deletion time | Ciphertext AAD binds the stable content ID; unreferenced confirmation content is erased within 24 hours |
| `execution_manifest` | Canonical signed bytes, signer `kid`, input revision IDs | Never updated after signing |
| `run` | Unique account-scoped idempotency key; accepted disclosure digest; manifest digest; opaque DO ID and jurisdiction; encrypted random Sandbox ID, keyed digest, and code-profile digest when enabled; content-erasure version | Requested, queued, provisioning, running, result_pending_import, result_imported, succeeded, failed, cancellation_requested, cancelled, cancelled_with_effect_unknown, outcome_unknown, result_lost_after_execution |
| `run_content` | Run, prompt or final-answer role, stable content ID, expected content-erasure version | Retention or owner erasure removes blob ciphertext and keeps the run reference and deletion marker |
| `run_attempt` | Run, attempt, 300-second lease, 30-second heartbeat, owner, monotonically increasing fence | Active, completed, abandoned, outcome_unknown |
| `run_event` | Unique run and sequence; keyed payload digest | Append-only |
| `outbox` | Unique event ID, lease owner, fence, attempts, next attempt | Pending, leased, dispatched, dead |
| `run_capability` | Token hash, run, DO ID, Sandbox ID, manifest digest, audience, expiry, next sequence, reserved model, provider-tool, code, byte, time, and cost counters; revocation fence | Active, revoked, expired |
| `gateway_call` | Unique run and sequence; model, provider-tool, code, or artifact kind; selected key or language; request digest, declared reservation, fence, timestamps | Pending, completed, outcome_unknown, denied |
| `sandbox_capacity` | One installation row; maximum and currently reserved active Sandboxes; version | Guarded reserve before a run becomes executable; one-time release after observed destruction |
| `sandbox_execution` | Account and run; random platform ID; jurisdiction; SDK, image, profile, and policy digests; lease and fence; startup, cancel, destroy, and observation times | Requested, starting, ready, executing, destroy_requested, destroyed, destroy_unverified, manual_required |
| `sandbox_command` | Unique run and code sequence; language; source, JSON-input, and request digests; byte and time reservations; start and completion times; exit state; output digests and observed byte counts | Reserved, dispatched, completed, outcome_unknown, denied |
| `provisioning_intent`, `tool_session`, `vendor_capability` | Unique run, vendor, attempt; deployment and filter digest; encrypted vendor ID or bearer | Pending, created, ambiguous, failed, revocation_requested, revocation_observed, revocation_unverified |
| `cleanup_obligation` | Vendor or `sandbox_destroy` target, encrypted platform reference when required, lease, attempts, last error | Pending, running, complete, manual_required |
| `provider_observation` | Allowlisted metadata and completeness flag | Complete, partial, unavailable |
| `artifact_collection`, `artifact_mount` | Organization collection; Bot revision, normalized path prefix, read action, revocation fence | Shared mounts are read-only; revoked mounts deny new calls and cancel affected runs |
| `artifact_quota` | Organization plus optional user or run scope; limit, used bytes and objects, reserved bytes and objects, version | Guarded reservation, conversion, and one-time release |
| `artifact_blob`, `artifact_version`, `artifact_path`, `artifact_path_history` | Random R2 key; observed R2 version, size and ETag; digest algorithm and digest; provenance and data class; append-only metadata; current pointer and revision-bounded pointer history | Version content is available or content_retired; blob is live, gc_candidate, deleting, or deleted; path pointers use expected version and seven-day deletion tombstones |
| `artifact_upload`, `artifact_upload_part` | Actor, collection, target path, random R2 key, encrypted multipart ID, declaration, quota reservation, expiry; unique part number, length, server digest, R2 ETag, idempotency key | Pending, uploading, completing, completed_unpublished, published, abort_requested, aborted, expired, ambiguous |
| `artifact_snapshot`, `artifact_snapshot_member`, `artifact_snapshot_pin`, `artifact_publication` | Immutable R2 path/version manifest up to 16 MiB and 10,000 entries, indexed members, observed digest and count, distinct blob pins; approved source digest and destination path | Snapshot is building, complete, failed, or expired; publication is idempotent and audit linked |
| `artifact_backup`, `artifact_backup_root`, `artifact_restore` | Backup manifest, protected blob/version roots, expiry, observed object metadata, restore target | Backup is building, complete, expired, or failed; restore is checking, ready, complete, or incomplete |
| `artifact_user_authority`, `artifact_read_rate_bucket` | Narrow session and membership revocation projection; account or user window, byte cap, used bytes, reset time | Projection follows identity changes; a fixed-window read counter expires and resets |
| `audit_stream_head`, `audit_event` | Unique stream and sequence; previous hash and event hash | Append-only application records |

All account-owned foreign keys include `account_id`. UUIDv7 IDs come from application code. Timestamps are UTC epoch milliseconds. Canonical signed or hashed JSON is stored as text. The first schema avoids database enums, arrays, generated columns, advisory locks, and JSON queries.

Bot search applies a pinned NFKC plus Unicode lowercase transform in application code and stores `search_name` and `search_short_description`. Queries escape SQL wildcard characters and perform a literal substring match over at most 50 account Bots per page. Cross-dialect fixtures must return the same IDs and order. `last_activity_at` uses OpenBot commit time and updates with `MAX(existing, committed_at)` in the same transaction as confirmation, run, cancellation, cleanup, or terminal events. Provider timestamps and cosmetic edits do not reorder the roster.

`POST /actions/run-confirmations` and `POST /api/v1/run-confirmations` send the chosen Bot, grant, and prompt to the private orchestrator. The orchestrator reloads current revisions, organization catalog entries, slot, and cleanup state. It preallocates a candidate run ID, uses that ID in any disclosed private-output prefix, compiles the unsigned manifest preview, encrypts the prompt into a stable `content_blob`, creates a random confirmation ID bound to the account, user, and initiating browser session, and claims the Bot's live-confirmation slot. The browser action returns a `303` to that ID. The confirmation ID is a scoped resource identifier, not a bearer token.

`createRunConfirmation` first expires a matching stale confirmation and clears its slot with a guarded write, then performs a cheap slot and cleanup precheck before compilation. It rechecks and claims the live-confirmation field in the same transaction that stores the confirmation, content, audit event, and idempotency result. Two tabs can create at most one live confirmation for a Bot. The loser receives `confirmation_exists` with the current confirmation reference when it belongs to the same user and session. Expiry clears only the matching slot and erases ciphertext within 24 hours.

`POST /actions/runs` and `POST /api/v1/runs` send `confirmation_id` to `confirmAndCreateRun`. The orchestrator reloads authority, verifies the current session binding, allocates the DO ID and a random Sandbox ID when code execution is enabled, recompiles, and denies if the prompt, revision, skill, provider tool, code profile, destination, mount, limit, model, or canonical bytes changed. The guarded batch consumes the confirmation, clears its confirmation slot, links the stable prompt content ID through `run_content`, claims the run and Sandbox-capacity slots, and binds the disclosure digest to the signed manifest and run. A concurrent repeat returns the recorded run for the same idempotency command or `confirmation_consumed` for another command; it never creates a second run. Discard and expiry release only a matching confirmation ID and erase its blob ciphertext when no run references it.

D1 run creation uses one guarded batch. A conditional `INSERT ... SELECT` claims the confirmation's preallocated candidate run ID and creates that run only if the five-minute confirmation is live and session-bound, its preview digest matches byte-for-byte equivalent manifest content, every expected revision and dependency fence is current, the grant is active, the slot's active-run field is empty, the matching confirmation occupies its live-confirmation field, no incomplete cleanup blocks the Bot, and the expiry is in the future. A later dependent insert with a required foreign key deliberately fails when that guarded insert returns zero rows, causing D1 to roll back the batch. The same batch claims the active-run field, clears the live-confirmation field, consumes the confirmation, links its prompt content ID through `run_content`, and stores the signed manifest, run, audit event, and outbox row. Post-batch row counts verify invariants; they do not cause rollback. A competing start returns `bot_busy`; it never queues behind the active run.

`discardRunConfirmation`, `expireRunConfirmation`, `terminalizeRunAndMaybeReleaseBotSlot`, and `completeCleanupAndMaybeReleaseBotSlot` use the account, Bot, matching confirmation or run ID, and expected slot version. A stale operation is a no-op when the slot points elsewhere. Terminalization releases a slot only when the run created no vendor or Sandbox resource and has no cleanup obligation. Otherwise only observed cleanup completion releases the Bot slot. Observed Sandbox destruction releases the matching installation-capacity reservation once. Bot creation creates its slot in the same transaction.

The create and revoke race has two legal histories. If revoke linearizes first, create returns `grant_not_active`. If create linearizes first, create commits, then revoke commits and atomically marks the run cancellation-requested with an outbox event. A run must never become executable from a grant that was already revoked at the create linearization point. The audit trigger rejects a stale sequence or previous hash and advances `audit_stream_head` after a valid insert. Deployed D1 tests must prove both histories before schema work continues.

Revocation uses named store operations: `revokeGrantAndCancelRuns`, `revokeComputeGrantAndCancelRuns`, `removeMembershipAndCancelRuns`, `revokeAuthorizationAndCancelRuns`, `disableCatalogEntryAndCancelRuns`, and `disableComputePolicyAndCancelRuns`. Expiry uses the same cancellation path. These operations update the authority fence, discard dependent live confirmations, and enqueue cancellation and cleanup in one transaction.

Provisioning never treats an external create as part of a database transaction. Persist intent first. Send a vendor idempotency key when supported. Store the returned vendor ID immediately. An ambiguous response enters reconciliation and is never retried as a blind create. If a vendor offers neither idempotency nor a way to find the created object by deterministic metadata, OpenBot does not ship that real vendor path for the tested API version. A manually shared session is not a fallback.

Execution outcome, cleanup status, and provider-evidence completeness are separate state machines. A successful answer stays successful if later cleanup needs manual work. The UI still shows the unresolved capability and never labels it revoked before observation.

Redacted audit metadata is retained indefinitely in the first release so verification always starts at the stream genesis. Raw prompts and final answers follow their seven-day content retention. Designing verifiable chain checkpoints before audit pruning is deferred.

## TypeScript workspace

```text
apps/
  control-plane/entry.d1.ts, entry.postgres.ts, entry.mysql.ts
  orchestrator/entry.d1.ts, entry.postgres.ts, entry.mysql.ts
  capability-gateway/entry.d1.ts, entry.postgres.ts, entry.mysql.ts
  d1-probe-sink/entry.ts
  d1-probe-writer/entry.ts
  sandbox-runner/entry.ts
  artifact-gateway/entry.d1.ts, entry.postgres.ts, entry.mysql.ts
  runtime/
packages/
  contracts/
  domain/
  crypto/
  policy/
  auth/
  db-d1/
  d1-probes/
  d1-probe-driver/
  d1-probe-operator/
  d1-probe-rpc/
  db-postgres/
  db-mysql/
  audit/
  metorial/
  openrouter/
  gate-attestation/
  gate-evidence/
  gate-signer/
  sandbox-protocol/
  artifacts/
  capability-protocol/
  runtime-protocol/
  testkit/
connectors/
  first-connector/
deploy/
  d1/
  postgres/
  mysql/
docs/adr/
docs/product-ui.md
docs/threat-model.md
docs/vendor-capabilities.md
api/
```

Use strict ESM TypeScript, pnpm workspaces, project references, Zod at every trust boundary, Hono, `@hono/zod-openapi`, Better Auth, Drizzle, Prettier, Vitest, fast-check, `@cloudflare/vitest-plugin`, Testcontainers, and Playwright. Generate and commit the `/api/v1` OpenAPI document. Do not add Turborepo until task timing shows a need.

Each database package exports OpenBot repositories and an opaque `createAuthStorage()` result for the Better Auth composition root. No route receives a Drizzle handle. Only database packages import Drizzle drivers. Only the orchestrator imports vendor management clients. Only the capability gateway imports vendor data-plane clients. Only the sandbox runner imports `@cloudflare/sandbox`, exports the Sandbox container class, or receives its namespace. Only the artifact gateway receives an R2 binding or imports artifact body storage. Only the runtime defines the run Durable Object class or imports its storage APIs; the orchestrator imports the typed namespace client.

The profile entry files are composition roots. A bundle contains one database driver only. Item 1 adds `dev`, `build`, `typecheck`, `test`, `test:integration`, `format`, `format:check`, `cf-typegen`, the D1 database scripts, D1 deployment scripts, `verify`, `verify:integration`, and `verify:preview`. Add `test:e2e` with its real local server in item 5. Add PostgreSQL and MySQL script variants with their adapters in item 9. Do not add a placeholder script that reports success without running its named work. `cf-typegen` runs pinned `wrangler types` for every config and CI fails on a dirty generated-type diff.

Use three verification commands. `pnpm verify` is hermetic and needs no Docker or vendor credentials. `pnpm verify:integration` uses Miniflare and Testcontainers. `pnpm verify:preview` uses disposable Cloudflare, Metorial, OpenRouter, PostgreSQL, and MySQL resources. CI reports a missing preview secret as skipped only on forks; protected branches fail.

The testkit has fake clocks and named fault points before and after every database commit, Queue send, vendor create, vendor ID save, gateway reservation, vendor dispatch, external response, result import, import acknowledgement, cleanup call, and cleanup observation. Local tests use deterministic faults. Preview tests cover platform restarts, DLQ replay, and connection loss.

The public repository starts with `README.md`, `LICENSE`, `SECURITY.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `.gitignore`, `.editorconfig`, a support policy, and release/versioning notes.

## Decisions and gates

A gate is a test whose failure blocks the named implementation. Record pinned versions, verification date, redacted requests, observed responses, and the decision in `docs/vendor-capabilities.md`. Probe reports are untrusted input. `packages/gate-evidence` validates report shape, content integrity, and the recorded blocker registry. Gate-specific pure assessments recheck every mandatory observation against trusted expected context and may return only `eligible_for_operator_review`. They cannot attest a report, promote a fixture, or mark a gate passed. The offline signer refuses a report without that assessment. Item 2 adds the minimum gate-attestation verifier and operator public-key registry. The signing key stays outside the repository and Workers. A signed attestation is a short-lived approval lease, not permanent authority. The initial lease lasts at most 24 hours. Schema freeze consumes the relevant leases once. Runtime Sandbox authorization checks an unexpired current lease on every use. Renewal and atomic profile-reference rollout must exist before user code is enabled; expiry denies code execution. Canonical signed bytes remain durable historical evidence under `docs/attestations/` before the trusted store exists, and the later store imports those bytes without rewriting them. No passing attestation is committed until its live gate closes.

The verifier is created only at a reviewed bootstrap boundary. That boundary loads the operator registry, trusted clock, and installation, environment, and deployment digests. Request data cannot replace them. The registry carries a positive generation, and operator-controlled shared state holds the current generation. Verification and final authorization read that shared value every time and deny on a mismatch, invalid value, or read failure. This makes a retained old Worker isolate fail closed after the operator advances the generation. Item 2 provides the D1-only offline `pnpm gate:attest:d1` operator command. It reads one canonical reviewed report request from standard input and the unpadded PKCS#8 P-256 key from file descriptor 3. The command reruns the pure D1 assessment, derives the claims, signs canonical low-S P-256 bytes, verifies the result against the supplied published registry, and emits a secret-free canonical operator bundle. It never accepts a private key through arguments, environment variables, or the review JSON and never emits one. The signer package has no application export and cannot enter a Worker bundle. Registry publication precedes use of a new key. Key IDs are never reused. Revocation publishes the replacement registry and then advances the shared generation before new work is admitted. The signer and reviewer are recorded separately in operator evidence.

| Gate | Required proof | Closes before | Failure result |
|---|---|---|---|
| First connector | Deployment version, auth scope, tool keys, incidental effects, schemas, data rules, two independent MCP calls, and result limits | D1 schema freeze | Choose another connector |
| D1 guarded create | Both legal create-versus-revoke histories, four-of-five Sandbox-capacity contention with destroy-bound release, and same-head audit contention under two deployed writers | D1 schema freeze | Change the storage design |
| Gateway reservation | Model, provider-tool, and code duplicate sequences each produce one outbound request and one spent reservation; changed-digest and ambiguous-response histories do not redispatch | D1 schema freeze | Change the store protocol |
| Metorial provisioning | Create is idempotent or reconcilable after an ambiguous response | D1 schema freeze | Do not ship the real session path for that API version |
| Metorial revocation | A second client fails after cleanup, or the measured vendor limit is recorded | D1 schema freeze | Claim only immediate OpenBot gateway denial |
| OpenRouter routing | One model/provider, no fallback, ZDR, generation metadata, key expiry, fresh price data, and observed budget behavior | D1 schema freeze | Deny the route |
| Runtime wire protocol | Private DO byte stream, cancel, replay, import acknowledgement, restart-to-unknown, and no public access | D1 schema freeze | Stop the runtime build |
| Sandbox code execution | Exact SDK and matched image, fixed JavaScript runner and argument array, random per-run isolation, no public route, capacity reservation, image-enforced writable-path and process limits, separate startup, execution, teardown, and age limits, process kill, destruction, restart-to-unknown, log redaction, blocked public HTTP and non-DNS egress, and an authoritative-domain DNS sentinel | D1 schema freeze | Change the executor design; the first release does not ship without bounded code execution |
| D1 Better Auth | Bootstrap, reset, closed registration, request-scoped construction, session rotation, and D1 storage | D1 identity work | Stop identity work |
| R2 artifact workspace | User multipart through control plane and one private artifact service; runtime text operations through capability gateway and one private artifact service; backpressure, range reads, jurisdiction, reconciliation, orphan collection, and mount denial | Artifact workspace support | Keep artifact routes unregistered |
| PostgreSQL profile | Better Auth, repositories, disabled Hyperdrive cache, invocation-scoped driver, Worker smoke test, backup and restore | PostgreSQL support | Keep PostgreSQL unsupported |
| MySQL profile | PostgreSQL checks plus `disableEval` and every prepared-query path | MySQL support | Keep MySQL unsupported |

Item 2 is not done until the repository contains the following seven literal values for the first connector and route:

| Required value | Recorded artifact |
|---|---|
| Metorial provider deployment and pinned version | HMAC identity commitments, provider readback, and version header |
| Auth setup or dedicated probe input | Connector review and test-account rule |
| Allowed tool keys and canonical schema digests | Signed connector fixture |
| Resource rule and incidental effects | Connector contract |
| OpenRouter model ID, provider slug, ZDR support, and price | Dated route fixture |
| Sandbox profile key, exact SDK version, matching image digest, instance type, JavaScript runner, DNS result, admitted data classes, and jurisdiction | Dated code-execution fixture and deployed probe |
| Cloudflare and database data jurisdiction | Installation record and disclosure text |

## Dependency-ordered build checklist

### 1. Pin the repository and toolchain

Create the public-repository files, pnpm workspace, TypeScript configs, D1 core entrypoints and composition contracts, Prettier config, Vitest projects, Worker test pool, Wrangler environment templates, generated binding types, dependency rules, secret scanner, and CI jobs. Add `docs/product-ui.md` with original OpenBot desktop and mobile wireframes, route inventory, view contracts, and content rules. Its dated research matrix records each observed competitor behavior, primary source and section, confidence, OpenBot decision, and whether that decision is an inference. State that OpenBot is unaffiliated. Do not copy third-party screenshots or artwork into the repository. Pin every direct dependency, the pnpm version, and the Cloudflare compatibility date. Scripts must never use `@latest`.

Check a clean install, formatting, types, unit tests, Worker dry-runs, forbidden imports, a seeded secret, an intentionally unpinned dependency, and the core route fixture. `core-routes.json` is the planned HTML, form-action, JSON, operator, auth, and internal route inventory. Handlers stay unregistered until item 5 supplies their middleware and use cases. A separate artifact-prefix deny fixture asserts that no artifact route is registered. Item 11 creates the authoritative `artifact-routes.json` only after its command matrix passes. `pnpm verify` must reproduce the hermetic CI job.

Done when the D1 control-plane shell, fake orchestrator, fake capability gateway, fake sandbox runner, and fake runtime compile with no vendor credential. Bundle inspection must show only the D1 driver. PostgreSQL, MySQL, and artifact entrypoints do not exist yet.

### 2. Settle D1 contracts and blocking gates

Create the ADRs, `docs/threat-model.md`, logical Zod contracts, state transitions, error codes, and disposable vendor and platform probes first. Add a command matrix that names every core mutation's route, actor, idempotency scope, expected version, success response, repeat response, stale response, audit event, and outbox effect. Define the organization catalog, declarative skills, Bot selection, reviewed code-execution profile, live-confirmation slot, run and Sandbox-capacity slots, and a versioned optional manifest-extension envelope before freezing D1 tables. Add a domain-separated P-256 gate-attestation envelope, an operator public-key registry, a trusted shared registry-generation fence, strict signature and revocation checks, an opaque bootstrap verifier generation, an opaque verified-decision type, and the offline D1 signer described in ADR 0010. Raw JSON, a parsed probe report, an `adoption_status` field, or a request-supplied registry cannot construct that decision. Keep the private signing key outside the repository and Workers. Specify the offline signing, review, registry publication, shared-generation advance, renewal, and revocation workflow before a passing attestation is accepted. Do not add artifact tables yet. Use disposable, non-migration D1 SQL fixtures to prove guarded create, gateway reservation, Sandbox capacity, and audit-head contention before schema freeze. These probe tables are test evidence, not product schema. Run the other core gates and fix the literal connector, model route, Sandbox profile, and jurisdiction values. After every schema-freeze gate passes, promote the reviewed operations into the D1 Drizzle schema, committed migrations, native DO migrations, guarded stores, and typed destroy cleanup. The threat model names each asset, attacker, entry point, control, residual risk, test, and operator-visible failure state. Implement only D1. PostgreSQL and MySQL remain contract targets, not code yet.

Before schema freeze, run both deployed D1 create/revoke histories, two-writer model, provider-tool, and code reservations, Sandbox-capacity contention, and audit-head contention against disposable probe tables. `packages/d1-probes` exercises the guarded D1 statement patterns under local workerd to catch syntax, rollback, and error-mapping defects. Its observations are always `hermetic_test_only`, set `eligible_for_attestation` to `false`, and cannot enter application packages. `packages/d1-probe-operator` is a private Node-only preflight boundary. `pnpm d1-probe:plan` reads one canonical request from standard input and an HMAC key from file descriptor 3, emits only a non-authoritative plan, and performs no network or deployment action. The request supplies distinct suffixes generated by the operator with a cryptographically secure random source; the compiler validates their shape and uniqueness but does not claim to prove their entropy. The plan commits real account and zone identifiers, each operator-denied production database ID, and every generated resource name. Its lifecycle journal advances only in the fixed create and cleanup order, binds returned IDs and names, rejects a denied database before provisioning, and makes ambiguous state terminal for manual review. `packages/d1-probe-rpc` defines the private writer-to-sink receipt request, the digest-bound gateway reservation, and the one-use gateway trial request. The sink inserts a fresh receipt for every valid request and has no deduplication key. Writer A and Writer B expose separate role-pinned entrypoints. Their local-only trial operation records one assigned child and GO receipt, polls an exact two-child ready set through fresh primary sessions, then enters the guarded gateway reservation. It validates every returned row and metadata field and calls the sink once only after commit. Exact replay and changed-digest denial require fresh primary readback. Missing assignments and closed trials deny separately. Missing bookmarks, ambiguous D1 state, barrier read failure, and missing private-RPC responses become `outcome_unknown`; no such path retries the sink. A barrier timeout makes no sink call. Checked-in Wrangler files are local-only, have no route, and exist for dry-run binding checks. The deployed driver must generate the real names, database binding, routes, Access resources, operator child processes, collector, and cleanup from the preflight plan. Operator and probe packages cannot enter product code. ADR 0009 and `docs/fixtures/d1-concurrency-probe.json` define the deployed test. That test uses two distinct writer deployments, a private non-deduplicating sink, fresh `first-primary` readback, and no automatic application retry after ambiguity. Its untrusted report must pass the pure gate-specific assessment against operator-supplied expected context before offline review and signing. The assessment is not an attestation and cannot promote either D1 gate. After promotion, check the empty migration, fixture upgrade, cross-account foreign keys, duplicate idempotency keys, DO migration and tombstone replay, Queue send-before-mark crash, DLQ replay, and every numeric limit. Add direct contracts for one live confirmation, concurrent slot claim, run-bound slot release, Sandbox destroy-bound capacity release, status projection at a fixed `as_of_ms`, normalized search, cursor stability, poll views, dependency-specific catalog fences, skill dependency denial, code-profile denial, cross-deployment denial, and an unrelated Bot that remains runnable after another catalog entry is disabled.

The deployed D1 Writer trigger must use the unwired HTTP adapter. It binds one canonical HTTPS route, an exact Worker Access audience and service-token identity, the writer role, canonical JSON, and a 16,384-byte body limit. It must receive Cloudflare's verified Access context on the direct request. It does not parse Access headers, and the checked-in local Workers keep their default 404 fetch handler.

`packages/d1-probe-driver` owns the operator-side Writer transport. It sends one canonical request with the standard Access Client ID and Client Secret headers, follows no redirects, retries nothing, keeps the timeout active through the last response byte, and caps the response at 65,536 bytes. It requires the exact HTTP status, request digest, writer role, canonical JSON, and no-store response headers. Network loss, timeout, an oversized body, or any mismatch stays `outcome_unknown`. The package is private and cannot enter product, authority, or Worker code.

The same package contains a parent-only child command, not a root operator command. The child requires Node IPC and reads one canonical assignment of at most 32,768 bytes from standard input. It installs its IPC listener before sending one `READY` message, then waits at most 10 seconds for one exact `GO` binding the child-process ID, writer role, request digest, and GO-receipt digest. Only after valid `GO` does it read the Access Client Secret from file descriptor 4. It accepts at most 512 secret bytes plus one optional trailing newline, closes the descriptor before reporting, invokes the one-request transport once, and emits one canonical result. Invalid assignment, missing IPC, substituted `GO`, missing credentials, or malformed results fail locally without a network request or retry. This slice adds no root command, public route, deployment, stored credential, or gate-promotion path.

The gateway parent coordinator accepts one fixed Writer A and Writer B pair. It requires the same probe run, trial, call kind, logical call, attempt, sequence, reservation, Access service-token identity, Writer origin, and request timeout. It requires distinct child IDs, trial requests and digests, GO receipts, gateway request IDs, and Writer routes. Its Node adapter starts two operating-system children with dedicated IPC and credential pipes. The coordinator waits at most 5 seconds for both exact `READY` messages before attempting either `GO`, then waits at most 20 seconds for bounded canonical child results. A partial spawn, failed READY, failed GO send, timeout, early exit, stderr byte, output overflow, or substituted result terminates both children and returns a non-authoritative `inconclusive` result. Termination gets 1 second before `SIGKILL`. `completed` means both child protocols completed; it is not a gate decision. This slice adds no parent command or deployment driver.

Done when every D1 schema-freeze gate closes, the seven literal connector and route values are committed, and the later database and R2 gates have a named owner and deny result. The D1 Better Auth gate stays assigned to identity work because it does not block the control-store schema. Item 3 cannot start while a shared-contract assumption remains implicit.

### 3. Build policy, cryptography, audit, and safe logs

Create `OrganizationToolPolicyV1`, `SkillRevisionV1`, `CodeExecutionProfileV1`, `BotRevisionV1`, `DisclosureSnapshotV1`, the versioned manifest-extension envelope, the pure policy compiler, connector and code-profile review formats, private manifest signing RPC, manifest and content keyrings, envelope formats, redaction library, keyed digests, audit append and verifier, `policy explain`, and `manifest verify`. Import the canonical Item 2 gate attestations into the trusted store without changing their signed bytes. Add the session-bound preview and one-use confirmation contracts without a browser UI.

Check that narrower inputs never broaden a manifest. Mutating any signed field must fail. Expired grants, disabled catalog dependencies, disabled skills, provider tools absent from the Bot selection, disabled code execution, an unlisted language, changed image or SDK, cross-deployment or cross-authorization policies, write-capable provider tools, unsupported scopes, disallowed outbound fields, and unavailable ZDR must return stable deny codes. Test confirmation expiry, discard, session mismatch, tab replay, two concurrent submissions, changed prompt, skill, provider, connector schema, code profile, destination, and limit. Run canonical JSON and crypto vectors in Node and Workers. Negative key tests must fail across every encryption domain.

Done when the reviewed fixture compiles to identical bytes in Node and Workers. Fixtures that add one tool, scope, destination, model, or limit must deny before any vendor call.

### 4. Run the complete path against local fakes

Use a fixed test identity and seeded organization owner only in local and test builds. Seed one organization tool policy, one declarative skill, and one reviewed code profile selected by one Bot. Add the shared two-column shell, `GET /bots`, `GET /bots/:botId`, `GET /run-confirmations/:confirmationId`, and `GET /bots/:botId/runs/:runId`. Add the browser and JSON confirmation-create routes, confirmation discard, the browser and JSON run-create routes, guarded run creation, outbox dispatch, fake provisioning, fake model, provider-tool and code reservations, a fake sandbox runner, fake runtime byte frames, terminal import, acknowledgement, cleanup retry, and the result view. Skip general CRUD, OAuth, artifact bodies, and polished progress UI here.

Check the happy path with one fake JavaScript call, no grant, code disabled, language substitution, missing or changed confirmation, one-live-confirmation enforcement, two starts for one Bot, starts for two Bots, stale slot release, both stale-grant histories, duplicate Queue delivery, concurrent gateway calls, Sandbox-capacity contention, code timeout and output overflow, ambiguous code dispatch, destroy cleanup, crash at each fault point, disconnect and commit failure around final-result import, final-result encryption, and cleanup status separate from execution status. Seed every presentation status and 51 Bots for pagination, search, and stable-cursor tests. At 1440 by 900 pixels, assert the roster, task feed, confirmation, code summary, and result are visible in the intended hierarchy. At 390 by 844 pixels, assert the roster becomes a drawer and the task form remains usable.

Done when one Playwright test starts a run, observes a bounded fake code call, and reads the result, while the deny cases make zero fake external calls.

### 5. Add real identity and the control-plane UI

Add the audited operator-token endpoint and admin commands, Better Auth D1 storage, database rate buckets, closed registration, owner membership, and the initial browser and JSON route tables in this plan. Build the organization tool and skill catalogs, reviewed code-profile selection, bot roster and workspace, profile and revision history, connection setup, access and revocation, run confirmation, run detail, cleanup obligation, audit, and read-only settings pages. Add two-second cursor-based run polling, security headers, CSRF, confirmation-content sweeping, and retention deletion. Each poll reads imported global events; SSE is deferred. Every HTML and JSON route calls one shared use case.

Check first-user races, operator credential denial, bootstrap and reset rate limits, token replay and expiry, uniform login failure, password vector, two-invocation auth construction, session fixation, privilege changes, removed owner, abandoned, expired, discarded and consumed confirmation content, sweep crashes, content-erasure races, escaped model text, CSP, duplicate forms, cancellation at each local state, cleanup retry, and polling through cleanup-only and evidence-only changes. Route contract tests compare the registered Hono routes, `core-routes.json`, generated OpenAPI paths, Better Auth allowlist, internal binding direction, and the artifact-prefix deny fixture. They assert each mutation reaches its named use case, each account-owned cross-account lookup returns `404`, unsafe methods fail, hostile origins and CORS preflights fail, submitted secrets never reflect, `returnTo` stays on an allowlisted relative path, and successful browser mutations use `303` post-redirect-get.

Run Playwright at 1440 by 900, 390 by 844, and 320 CSS pixels wide. Test no-JavaScript forms and refresh, keyboard-only navigation, skip link, landmarks, one `h1`, `aria-current`, focus order and return, error summary, drawer behavior, expired confirmation recovery, OAuth callback replay and ambiguity, status text without color, reduced motion, high contrast, and long escaped model text without horizontal page scroll. Feed fixtures include HTML, `javascript:`, `data:`, bidi, CSS breakout, malformed URL, and long unbroken strings. Assert that final text stays plain, external links pass the connector host allowlist, browser code uses `textContent`, and the roster and page metadata contain no prompt, result, provider bearer, or encrypted reference. Use automated accessibility checks as a floor and keep the manual keyboard checks.

Done when an operator can install the D1 profile, create the first owner, create a Bot, connect the reviewed source, grant it, review and start the all-fake run, cancel it, and inspect its result and audit record without leaving the Bot workspace.

### 6. Replace the Metorial fake

Add the versioned management client, OAuth setup flow, catalog importer, provider-version readback, provisioning intents, session allowlist, encrypted capability storage, one-connect-per-call MCP adapter, reconciliation, cleanup obligations, and allowlisted observation import.

Check setup expiry and callback binding, requested and observed auth-config revocation, version and schema drift, exact tool filtering, two sequential tool calls with Worker eviction between them, changed tool list on the second call, a second MCP client, ambiguous create, crash before and after saving the vendor ID, cancellation, reconnect after cleanup, activity pagination, and raw-message exclusion.

Done when the gateway can list and call only the reviewed read tools in a real session. The model and runtime remain fake.

### 7. Replace the OpenRouter fake in the gateway

Add per-run key provisioning and reconciliation, the direct fixed model request builder, byte streaming, route metadata, fresh price snapshots, usage and cost reconciliation, key cleanup, and orphan-key inspection.

Check key expiry and delete, one literal model and provider, fallback rejection, ZDR denial, data-collection denial, model arrays and aliases, stale price denial, estimator undercount, malformed and oversized streams, calculated cost stop, observed overshoot, cancel before dispatch, cancel after dispatch, lost provider response, ambiguous key creation, and route mismatch.

Done when a fake runtime gets one real model response through the private gateway without receiving an OpenRouter key.

### 8. Replace the runtime and code fakes with Cloudflare execution

Add the private run DO export, jurisdiction-aware `newUniqueId()` allocation, native migrations, signed start and cancel commands, in-memory prompt decryption, manual model loop, NDJSON byte stream, call-boundary journal, result-import acknowledgement, restart-to-unknown behavior, separate scrub and delete commands, and public-route denial. Add the private sandbox runner, exact Sandbox SDK and matched image selected by the gate, `lite` instance configuration unless its memory probe requires `basic`, random per-run Sandbox allocation, one fixed JavaScript runner and argument array, bounded `execute_javascript_v1`, capacity reservation, process kill, destruction, reconciliation, and public-route denial.

Check the wrong DO or Sandbox ID, bad signature, wrong audience, expiry, nonce replay, altered prompt ciphertext, extra provider tool, disabled code call, changed schema, image, SDK, language, network policy, or limit, prompt injection asking for fetch or package installation, invalid NDJSON, bytes after terminal, all size and count limits, four-run Sandbox capacity, disconnect, cancellation during every external call, code timeout, stdout and stderr overflow, container loss, started-without-completed code, hostile HTTP, non-HTTP and DNS egress, public Sandbox access, local event replay, Queue redelivery at the retention boundary, result loss before acknowledgement, secret-sentinel scans of commands, RPC errors, Sandbox files, SQL, logs, event frames, and DLQ bodies, sensitive scrub, destroy acknowledgement, ambiguous destroy, and final deletion.

Done when one real read-only run calls the reviewed connector, executes bounded code in its isolated Sandbox, and completes through the gateways and OpenRouter. Restart never repeats an uncertain model, provider-tool, or code request. The Bot slot and installation capacity release only after observed Sandbox destruction.

### 9. Add PostgreSQL, then MySQL

Implement the PostgreSQL core schema, Better Auth schema, migrations, repositories, request-scoped auth factory, invocation-scoped Hyperdrive adapter, distinct control, orchestration, capability, and code roles, profile entry roots, and backup guide. Run the unchanged core repository, policy, auth, gateway-reservation, sandbox-capacity and cleanup, organization catalog, roster, concurrency, audit, Queue, and Playwright suites. Repeat for MySQL only after PostgreSQL passes. Artifact entrypoints and roles still do not exist.

Check direct Testcontainer contracts, local workerd with profile-specific `localConnectionString`, disposable managed origins in deployed preview, disabled caching, two-invocation login, one-driver bundles, connection loss, stream-finalizer writes, MySQL prepared-query behavior, migration failure, previous-app-version compatibility, and restore. CI owns tagged disposable origins and a cleanup job removes them after failed runs.

Done when the same read-only scenario produces equivalent domain and audit results on all three profiles. A profile that misses one gate remains unsupported.

### 10. Prepare the operator-owned read-only release

Add preview and production deploy scripts, explicit environment confirmation, binding assertions, DLQ replay, core database backup and restore commands, key rotation and rewrap, cleanup dashboards, accessible UI checks, redacted metrics, the published threat-model update, and the operations guide.

Check a clean install in a fresh paid Cloudflare account, deployment order, matched Sandbox package and image, absent public runtime and code routes, Sandbox quota and cold start, vendor and container outages, Queue backlog, DLQ recovery, manual cleanup, D1 Time Travel restore, external database restore, key rotation, retention deletion, dependency licenses, preview promotion, container-image rollback, and previous-code rollback against the expanded schema.

Done when an operator can deploy, run, inspect, cancel, clean up, back up, restore, rotate keys, and verify the read-only slice with bounded code execution, without an OpenBot-operated service or an R2 bucket.

### 11. Add the R2 artifact workspace

First close the R2 gate and add the artifact threat-model section and command matrix. After every planned route maps to one typed service method and guarded audit effect, commit `artifact-routes.json`, schemas, migrations, repositories, and service bindings for D1, PostgreSQL, and MySQL together. Create the private artifact-gateway Worker, jurisdiction binding, distinct external-database role, Bot private collections, shared collections, revision-bounded path history, snapshot member index, user upload intents, multipart operations, immutable versions, publication approval, reconciliation, garbage collection, and deferred routes. Artifact transactions append their redacted audit event through the role's narrow audit operation in the same database transaction. Snapshots are created by the service during collection changes and confirmation; there is no public snapshot CRUD in this release. Extend the manifest and capability gateway with snapshot `list`, `stat`, bounded `read-text`, and the reviewed one-call `write-text-draft` tool. A Bot cannot call `publish`; an authenticated owner publishes an observed classified source version to a selected shared path.

Check path normalization and sibling-prefix rejection, cross-organization and cross-Bot access, session revocation after delegation issuance, mount escape, stale mount, snapshot, and path versions, catalog and mount reservation races, exact range and ETag behavior, missing and exceeded storage or read quota, quota reservation, data-class downgrade denial, built-in draft call accounting, duplicate and out-of-order user parts, abort, completion, crash before and after R2 completion, database commit failure, orphan reconciliation, snapshot build and sweep, body retirement, backup-root and garbage-collection races, jurisdiction mismatch, audit atomicity, and secret-sentinel responses. Hermetic contracts cover the state machines. Preview sends a small multipart object larger than one Worker request and records peak memory with one and two concurrent parts. A tagged scale test builds a 10,000-entry, at-most-16-MiB snapshot and records memory and latency. One Playwright flow covers owner upload, publication, and later Bot read. Bundle and binding tests assert that the runtime has no R2 binding, key, bucket, or raw object key.

Artifact backup creates a manifest that becomes a garbage-collection root before export. Restore verifies every referenced R2 version, ETag, size, and digest record before making metadata visible. A missing or replaced blob produces an explicit `artifact_restore_incomplete` state; it is not reported as a successful restore. The workspace release check exercises backup-root retention, restore, cleanup, and key rotation on every supported database profile.

Done when Bot A writes one bounded UTF-8 private draft, the owner publishes its classified version by changing metadata only, and Bot B reads that exact snapshot version on a later authorized run. Revoking the mount denies the next reservation and cancels an active dependent run. The registered route set then equals core plus `artifact-routes.json`. A failed workspace gate leaves the released core unchanged and every artifact route unregistered.

### 12. Broker provider business-data writes only after the read-only release passes

Extend the capability gateway so the model can propose an operation already present in the exact Bot permission selection and active grant. OpenBot must canonicalize connector arguments and targets, compute a digest, store the proposal, collect explicit human approval, and rebuild the provider call from the approved bytes. The runtime never receives a directly executable write or destructive tool. A `write` operation creates or updates provider business data without deletion or access-control change. `destructive` covers deletion, membership, permission, credential, security, irreversible bulk, and connector-reviewed high-impact operations. Both are proposal-only in the first broker version, and destructive has no standing or `Always allow` approval.

Check effect misclassification, a comment-write permission attempting board deletion, mixed-operation tools, argument, resource and schema substitution, approval replay and expiry, revoke while waiting, concurrent dispatch, provider idempotency, crash uncertainty, and evidence that the provider received the approved bytes. The selected tool key, reviewed effect, target, arguments, Bot revision, grant revision, provider authorization, actor, expiry, and one-use nonce are all digest-bound.

Do not claim brokered writes, digest-bound approval, or once-only external effects until these checks pass for the named connector, tool, and schema.

OpenBot-owned artifact writes are a separate, owner-disclosed storage class. They do not authorize a connector to mutate provider business data.

## Deferred work

- OpenCode, Agents SDK, Code Mode, Cloudflare Browser Rendering, interactive or user-facing shell, direct command or argv UI and API endpoints, package installation as an OpenBot capability, persistent Sandbox disks, preview URLs, executable skill packages, subagents, and arbitrary MCP servers
- Persistent conversation context, replies, reactions, group chats, direct Bot-to-Bot messages, task handoffs, learned memory, schedules, unattended runs, teams, shared provider authorizations, and a marketplace
- Inline artifact previews, model-visible document extraction, microphone input, voice output, computer view, browser takeover, and teach-by-demonstration
- Bot pinning, hiding, custom sidebar sections, duplication, command palette, cross-run content search, desktop notifications, and native mobile applications
- Executable provider-write approval cards, `Always allow`, and any UI that implies provider business data can change before the broker in item 12 passes. The permission editor may show proposal-only write and destructive selections as unavailable or approval-required.
- Connection-wide access to private provider data
- Automatic retry or resume of an uncertain model or tool call
- D1 read replication until bookmark propagation passes tests
- Hyperdrive query caching for any authoritative read
- Cross-profile database migration
- Bot deletion or archive, provider-authorization deletion beyond revocation, organization deletion or export, personal API keys, SSE, audit pruning, and changing jurisdiction after installation
- A Node-hosted production control plane or Cloudflare-independent runtime

## Sources checked

Source snapshot checked on 2026-08-22. Product behavior is treated as research input, not as an API or compatibility contract.

- [Grok Bot product page](https://x.ai/bot)
- [Introducing Grok Bot](https://x.ai/news/introducing-grok-bot)
- [Grok Bot overview](https://docs.x.ai/grok-bot/overview)
- [Grok Bot setup and first task](https://docs.x.ai/grok-bot/get-started)
- [Grok Bot bot management](https://docs.x.ai/grok-bot/bots)
- [Grok Bot chat and collaboration](https://docs.x.ai/grok-bot/chat-and-collaboration)
- [Grok Bot approvals, security, and privacy](https://docs.x.ai/grok-bot/approvals-security-and-privacy)
- [Grok Bot files and results](https://docs.x.ai/grok-bot/files-and-results)
- [Grok Bot skills, routines, and automations](https://docs.x.ai/grok-bot/skills-routines-and-automations)
- [Grok Bot settings and notifications](https://docs.x.ai/grok-bot/settings-and-notifications)
- [Grok Bot mobile behavior](https://docs.x.ai/grok-bot/mobile)
- [Grok Bot FAQ](https://docs.x.ai/grok-bot/faq)
- [Grok Bot plugin connection flow](https://cursor.com/help/grok-bot/connect-plugins)
- [Metorial sessions and tool filters](https://metorial.com/docs/concepts-sessions)
- [Metorial OAuth and auth configs](https://metorial.com/docs/sdk-oauth)
- [Metorial API versioning](https://metorial.com/api)
- [Cloudflare Durable Object namespace IDs](https://developers.cloudflare.com/durable-objects/api/namespace/)
- [Cloudflare Durable Object data location](https://developers.cloudflare.com/durable-objects/reference/data-location/)
- [Cloudflare Durable Object SQLite](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Cloudflare Durable Object design rules](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/)
- [Cloudflare Agents MCP client persistence](https://developers.cloudflare.com/agents/tools/mcp/)
- [Cloudflare Workers RPC and byte streams](https://developers.cloudflare.com/workers/runtime-apis/rpc/)
- [Cloudflare Workers Vitest plugin](https://developers.cloudflare.com/workers/testing/vitest-integration/)
- [Cloudflare Workers security model](https://developers.cloudflare.com/workers/reference/security-model/)
- [Cloudflare Sandbox SDK overview](https://developers.cloudflare.com/sandbox/)
- [Cloudflare Sandbox 1.0 preview](https://developers.cloudflare.com/sandbox/1-0-preview/)
- [Cloudflare Sandbox 1.0 process handles](https://developers.cloudflare.com/sandbox/1-0-preview/processes/)
- [Cloudflare Sandbox 1.0 lifecycle](https://developers.cloudflare.com/sandbox/1-0-preview/lifecycle/)
- [Cloudflare Sandbox security model](https://developers.cloudflare.com/sandbox/concepts/security/)
- [Cloudflare Sandbox lifecycle](https://developers.cloudflare.com/sandbox/api/lifecycle/)
- [Cloudflare Sandbox interpreter](https://developers.cloudflare.com/sandbox/api/interpreter/)
- [Cloudflare Sandbox outbound traffic](https://developers.cloudflare.com/sandbox/guides/outbound-traffic/)
- [Cloudflare Agents Code Mode](https://developers.cloudflare.com/agents/tools/codemode/)
- [Cloudflare Sandbox limits](https://developers.cloudflare.com/sandbox/platform/limits/)
- [Cloudflare Containers pricing and instance types](https://developers.cloudflare.com/containers/pricing/)
- [Cloudflare Queue delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/)
- [Cloudflare Queue limits](https://developers.cloudflare.com/queues/platform/limits/)
- [Cloudflare Hyperdrive caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/)
- [Cloudflare Hyperdrive connection lifecycle](https://developers.cloudflare.com/hyperdrive/concepts/connection-lifecycle/)
- [Cloudflare R2 consistency](https://developers.cloudflare.com/r2/reference/consistency/)
- [Cloudflare R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)
- [Cloudflare R2 multipart uploads from Workers](https://developers.cloudflare.com/r2/api/workers/workers-multipart-usage/)
- [Cloudflare R2 upload and multipart ETag behavior](https://developers.cloudflare.com/r2/objects/upload-objects/)
- [Cloudflare R2 limits](https://developers.cloudflare.com/r2/platform/limits/)
- [Cloudflare R2 data location](https://developers.cloudflare.com/r2/reference/data-location/)
- [Cloudflare R2 temporary credentials](https://developers.cloudflare.com/r2/api/s3/temporary-credentials/)
- [Cloudflare Web Crypto and DigestStream](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/)
- [Cloudflare D1 batch and sessions](https://developers.cloudflare.com/d1/worker-api/d1-database/)
- [Cloudflare D1 foreign keys](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)
- [Drizzle with Cloudflare D1](https://orm.drizzle.team/docs/sqlite/connect-cloudflare-d1)
- [Better Auth with Drizzle](https://better-auth.com/docs/adapters/drizzle)
- [Better Auth rate limiting](https://better-auth.com/docs/concepts/rate-limit)
- [Better Auth security](https://better-auth.com/docs/reference/security)
- [OpenRouter routing controls](https://openrouter.ai/docs/guides/routing/provider-selection)
- [OpenRouter routing metadata](https://openrouter.ai/docs/guides/features/router-metadata)
- [OpenRouter generation metadata](https://openrouter.ai/docs/api/api-reference/generations/get-generation)
- [OpenRouter guardrails](https://openrouter.ai/docs/guides/features/guardrails/overview)
- [OpenRouter key management](https://openrouter.ai/docs/api/api-reference/api-keys/create-keys)
