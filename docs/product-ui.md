# Product UI contract

This document defines the first OpenBot browser interface. It is a design contract, not a statement that the routes or views are implemented.

OpenBot is unaffiliated with xAI and Grok Bot. Product research informed the hierarchy and interaction study below. The wireframes and content rules are original to OpenBot. Do not add third-party screenshots, logos, character art, or copied interface assets to this repository.

## Product promise shown in the interface

A connection is not authority. The organization owner chooses reviewed tools and declarative skills for a Bot, then grants the Bot a narrow purpose, scope, limit, and expiry. Each task gets a fresh confirmation and an independent run.

The first release does one useful job. One owner reviews and starts a short read-only task that uses one reviewed Metorial connector and one fixed OpenRouter model route. The interface must not imply that OpenBot can write provider business data, browse websites, run shell commands, share a computer, remember prior conversations, or work unattended.

Use these product terms consistently:

| Term                     | Meaning                                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Organization             | The account boundary. The first release has one owner role.                                                 |
| Bot                      | A named configuration with immutable behavior revisions and scoped grants.                                  |
| Connection               | A provider authorization reference managed through Metorial. It grants nothing by itself.                   |
| Organization tool policy | An owner-reviewed, pinned connector tool that Bots may select.                                              |
| Declarative skill        | Versioned instruction text and bounded schemas. It cannot add authority.                                    |
| Grant                    | The Bot-specific tool, resource, purpose, limit, and expiry authority.                                      |
| Task confirmation        | A five-minute disclosure snapshot. It is not a run and not permission for provider writes.                  |
| Run                      | One independent execution object with one occupied Bot run slot.                                            |
| Cleanup                  | Revocation and deletion work for run-owned vendor resources. It can remain incomplete after execution ends. |

## Desktop layout

At 900 CSS pixels and wider, render one 20rem sidebar and one main column. Do not add a third inspector column.

```text
+------------------------------+------------------------------------------------+
| OpenBot             New Bot  | [Bot mark] Research helper            Access   |
| [Search Bots...............] | Tasks   Access   Profile                        |
|                              +------------------------------------------------+
| [mark] Research helper       |                                                |
|        Needs confirmation    |             Task feed, max 48rem               |
|                              |                                                |
| [mark] Customer notes        |                         [user task prompt]      |
|        Needs access          |                                                |
|                              | [confirmation or run activity card]            |
| [mark] Weekly review         | [safe tool summary]                            |
|        Completed             | [plain-text result and evidence]               |
|                              |                                                |
| ---------------------------  | [Start a task...............................]   |
| Connections                  | [Review task]                                  |
| Audit                        |                                                |
| Organization owner          |                                                |
+------------------------------+------------------------------------------------+
```

The page uses document scrolling. The Bot header is sticky. The composer follows the feed in DOM order. It may become sticky only if it cannot cover the final card, focused control, or validation error.

The sidebar has a one-pixel divider. The main feed is at most 48rem wide. Cards use 16-pixel gaps, while sections use 24-pixel gaps. Confirmation, activity, result, and cleanup cards share border and radius tokens. Reserve elevation for the mobile drawer.

The fixed Bot palette identifies Bots. Color never communicates status by itself. Every status needs visible text and an icon with an accessible name.

### Sidebar behavior

The sidebar header contains `New Bot` and a search form. Enter submits `GET /bots`. The optional browser controller waits 200 milliseconds after text composition ends, aborts an older request, keeps focus and selection, and replaces the current history entry. Search text is limited to 128 UTF-8 bytes and matches normalized Bot name and title only.

Each Bot row shows:

- fixed-palette color mark
- name
- last activity time
- one derived status line

Never show a prompt or result excerpt in the roster. The selected Bot gets a filled row treatment. Put `Connections`, `Audit`, and the account menu after the roster. Anchor the account menu at the bottom when space permits.

Order Bots by presentation priority, then recent activity, then Bot ID. Presentation priority is:

1. `Outcome unknown`
2. `Cleanup required`
3. `Cleaning up`
4. `Cancelling`
5. `Running`
6. `Needs confirmation`
7. `Needs configuration`
8. `Needs access`
9. `Cancelled`, `Failed`, or `Completed`

A Bot with no earlier run and usable configuration and access is `Ready`. `Needs configuration` means a selected tool policy, skill revision, connector revision, or model route cannot be used. Roster state is a navigation hint, never an authorization decision.

### Bot workspace

The header shows the Bot mark, name, active revision, and an `Access` control. Under it, ordinary links switch between `Tasks`, `Access`, and `Profile`.

The task feed contains independent confirmations and run summaries in OpenBot commit order. Put a user prompt on the right visually, but keep chronological DOM order. Put confirmation, activity, safe tool summaries, result, evidence, and cleanup cards on the left under a run heading.

The composer has one multiline field and a `Review task` button. It has no attachment, microphone, mention, schedule, browser, or computer control. Disable it when the Bot lacks a currently usable grant, has a live confirmation, has a nonterminal run, or has incomplete cleanup. Explain the exact reason beside the disabled control. Do not rely on color or a disabled tooltip.

The first release permits one live confirmation and one occupied run slot per Bot. Submitting the composer creates a five-minute confirmation. It does not create a run.

### Task confirmation

```text
+------------------------------------------------------------------+
| Review task                                          Expires 4:32 |
|                                                                  |
| Prompt                                                           |
| Summarize the open support cases for this account.                |
|                                                                  |
| This run may disclose                                             |
| Tool       list_support_cases                                     |
| Data       case titles, status, assigned team                     |
| To         selected model provider and reviewed connector         |
| Limits     2 tool calls, 120 seconds, 128 KiB per tool result      |
| Skills     Triage summary, revision 3                             |
|                                                                  |
| [Discard]                                             [Start run] |
+------------------------------------------------------------------+
```

The server authors every field except the already-entered prompt. Show the exact prompt, named tool policies, selected skill revisions, possible data classes, destinations, expiry, and numeric limits. State that model-selected arguments and returned records do not exist yet and cannot be previewed.

Use `Start run`, not `Approve`. The confirmation authorizes this disclosed read-only run. It does not approve a provider business-data write and never offers `Always allow`.

If catalog, grant, connection, model route, cleanup, or Bot revision state changes, mark the confirmation stale. Show the reason and link back to the Bot. Never recompile and start silently.

### Run detail

Show the original prompt, a cursor-paginated timeline, the plain-text final answer, safe source references, resolved model and provider, audit link, and three separate status rows:

- execution
- vendor cleanup
- evidence completeness

A successful answer does not hide `Cleanup required`. Render `Cancel run` only when the server supplies `can_cancel`. Show a stable error code and request ID as selectable text. Browser code may add copy controls, but it must not replace the original text.

Connector code may produce a safe summary that names an allowed tool and a record count. Do not render raw MCP arguments, MCP results, model reasoning, vendor bearer references, or decrypted configuration.

Final answers are plain text with preserved whitespace. Do not render model Markdown or HTML. A source becomes a link only when reviewed connector code constructs a `SourceReferenceV1` from typed provider identifiers. The connector accepts one canonical HTTPS host, the default port, a defined path grammar, and an allowlist of safe query keys. It rejects unknown query keys, userinfo, fragments, IP literals, nondefault ports, and any normalization change. Model-written citations remain unlinked text.

## Mobile layout

Below 900 CSS pixels, keep one main column. Native `<details>` provides no-JavaScript navigation. The browser module may render it as a modal drawer.

```text
+--------------------------------------+
| [Menu]  Research helper      Access  |
| Tasks   Access   Profile             |
+--------------------------------------+
|                                      |
|            [user task prompt]        |
|                                      |
| [confirmation or activity card]      |
| [result card]                        |
| [cleanup state]                      |
|                                      |
| [Start a task.....................]  |
| [Review task]                        |
+--------------------------------------+

Drawer open
+----------------------------+---------+
| OpenBot            New Bot | dimmed  |
| [Search Bots.............] | page    |
|                            |         |
| Research helper            |         |
| Customer notes             |         |
| Weekly review              |         |
|                            |         |
| Connections                |         |
| Audit                      |         |
| Organization owner         |         |
+----------------------------+---------+
```

The scripted drawer needs an accessible name, Escape close, focus containment, focus return, inert background, and accurate `aria-expanded`. Opening it must not move or discard the current composer text. Closing it must not change the selected Bot.

Use the same routes and content on desktop and mobile. Do not build a native mobile application or mobile-only authority flow in the first release.

## Interaction and accessibility rules

- Core navigation and metadata forms work without JavaScript.
- Browser actions use post-redirect-get. Successful actions return `303` to a fixed server-selected route.
- Validation errors return `422`, focus an error summary, preserve non-secret fields, and clear every secret or session-bound field.
- Every potentially unbounded list has ordinary pagination links before browser scripting.
- Poll run state every two seconds only while the tab is visible and state may change. Pause hidden tabs, abort replaced requests, and back off after errors or `429`.
- Polling never moves focus or scroll position. A restrained polite live region announces meaningful state changes.
- Times use `<time datetime>` and an absolute accessible label.
- External links use no opener, no referrer, and a visible hostname.
- Browser code inserts untrusted text with `textContent`, never `innerHTML`.
- Sensitive HTML and every JSON response use `Cache-Control: no-store`.
- Account-owned resources return `404` across account boundaries.
- The browser never infers authority from button state, roster status, or cached view data.

## Content rules

Say what OpenBot knows and what it does not know.

| Situation                          | Required copy direction                                                                               |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Connection exists but no Bot grant | `Connected, but this Bot has no access.` Link to the Bot access page.                                 |
| Resource mapping is unsupported    | `This connector cannot enforce the selected resource scope. The run was not created.`                 |
| Bot is busy                        | Name the live confirmation, run, or cleanup obligation. Do not say only `Unavailable`.                |
| Confirmation expired or changed    | State that no run started and ask the user to review again.                                           |
| Cancellation requested             | Say that OpenBot denied new calls. Do not claim a vendor call already in flight was undone.           |
| Outcome is uncertain               | Use `Outcome unknown`. Do not relabel it `Failed`.                                                    |
| Cleanup is incomplete              | Keep the cleanup warning visible even if an answer exists.                                            |
| Audit chain verifies               | Say the application chain verifies from its stored start. Do not call it immutable or non-repudiable. |
| Provider write requested           | State that provider business-data writes are not supported in the read-only release.                  |
| Artifact feature absent            | Do not render disabled upload, file, mount, or shared-workspace controls.                             |

Do not use teammate copy that implies memory or a continuing conversation. `Start a task` is the primary verb. Each task is independent. Do not say `I'll remember`, `hand this to another Bot`, `run every week`, or `always allow`.

## Browser route index

All resource IDs are account-scoped UUIDs. Raw bootstrap, reset, and confirmation tokens never appear in a URL.

| Method and path                          | View or behavior                                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `GET /`                                  | Route an unbootstrapped install to `/bootstrap`, a signed-out user to `/login`, and an owner to `/bots`. |
| `GET /login`                             | Email and password form.                                                                                 |
| `GET /bootstrap`                         | One-time first-owner token and password form.                                                            |
| `GET /reset`                             | One-time password-reset token and new-password form.                                                     |
| `GET /bots`                              | Searchable, cursor-paginated Bot roster. Accept `q`, `cursor`, and `limit`.                              |
| `GET /bots/new`                          | Bot identity, behavior, organization tools, and declarative skills.                                      |
| `GET /bots/:botId`                       | Task feed, status, and task composer.                                                                    |
| `GET /bots/:botId/profile`               | Cosmetic profile and immutable behavior revision history.                                                |
| `GET /bots/:botId/access`                | Connections, grants, allowlist, resource mapping, destinations, limits, purpose, expiry, and revocation. |
| `GET /bots/:botId/runs/:runId`           | Prompt, timeline, result, cancellation, cleanup, evidence, and audit link.                               |
| `GET /run-confirmations/:confirmationId` | Session-bound five-minute task confirmation.                                                             |
| `GET /catalog/tools`                     | Organization tool policies and dependency impact.                                                        |
| `GET /catalog/tools/:policyId`           | Server-derived connector contract and disable impact.                                                    |
| `GET /catalog/skills`                    | Skills, current defaults, disabled revisions, and dependent Bots.                                        |
| `GET /catalog/skills/new`                | Declarative skill form.                                                                                  |
| `GET /catalog/skills/:skillId`           | Skill revisions, requested tools, and disable impact.                                                    |
| `GET /connections`                       | Reviewed connector, setup state, provider authorization, and dependent grants.                           |
| `GET /connections/new`                   | OAuth scope and connection-versus-authority explanation.                                                 |
| `GET /connection-setups/:setupId`        | Pending, complete, expired, or failed setup.                                                             |
| `GET /connections/:authorizationId`      | Provider version, observed revocation, and dependent grants.                                             |
| `GET /oauth/metorial/callback`           | Verify one-time OAuth state and finish setup.                                                            |
| `GET /audit`                             | Filtered, cursor-paginated redacted audit events.                                                        |
| `GET /audit/events/:eventId`             | Canonical redacted event, chain position, and verifier result.                                           |
| `GET /cleanup-obligations/:obligationId` | Attempts, safe error, retry timing, and observed vendor state.                                           |
| `GET /settings`                          | Read-only installation profile, jurisdiction, retention, active key IDs, and version.                    |

### Browser action index

All actions below use `POST`. Sign-in and sign-out are the documented Better Auth form exceptions. Every other action checks the session, origin, CSRF token, idempotency key, and expected version or fence that its command requires.

| Path                                                            | Mutation                                                                                 |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `/actions/bootstrap`                                            | Consume the bootstrap token and create the first owner.                                  |
| `/actions/password-reset`                                       | Change the password and revoke prior sessions.                                           |
| `/actions/bots`                                                 | Create a Bot and first revision.                                                         |
| `/actions/bots/:botId/profile`                                  | Change cosmetic fields.                                                                  |
| `/actions/bots/:botId/revisions`                                | Append a behavior revision.                                                              |
| `/actions/organization-tool-policies`                           | Approve one reviewed tool version for selection.                                         |
| `/actions/organization-tool-policies/:policyId/disables`        | Disable after the impact digest and fence still match.                                   |
| `/actions/skills`                                               | Create a skill and first revision.                                                       |
| `/actions/skills/:skillId/revisions`                            | Append a skill revision.                                                                 |
| `/actions/skills/:skillId/revisions/:revisionId/disables`       | Disable one revision after impact revalidation.                                          |
| `/actions/connection-setups`                                    | Start reviewed Metorial OAuth setup.                                                     |
| `/actions/connection-setups/:setupId/reopen`                    | Reopen a live provider setup URL.                                                        |
| `/actions/provider-authorizations/:authorizationId/revocations` | Deny local use, cancel affected runs, and request vendor revocation.                     |
| `/actions/capability-grants`                                    | Create one Bot-scoped grant.                                                             |
| `/actions/capability-grants/:grantId/revocations`               | Revoke, discard dependent confirmations, and cancel dependent runs.                      |
| `/actions/run-confirmations`                                    | Compile and store a disclosure snapshot.                                                 |
| `/actions/run-confirmations/:confirmationId/discards`           | Consume without a run and schedule prompt erasure.                                       |
| `/actions/runs`                                                 | Consume a session-bound confirmation and create a run.                                   |
| `/actions/runs/:runId/cancellations`                            | Request cancellation once.                                                               |
| `/actions/runs/:runId/cleanup-retries`                          | Return a manual cleanup obligation to pending.                                           |
| `/actions/runs/:runId/content-deletions`                        | Erase retained prompt and final-answer ciphertext while keeping redacted audit metadata. |

## JSON route index

The first public API uses the browser session. Unsafe methods also require origin and synchronizer CSRF checks, accept JSON only, and expose no CORS headers. Every list returns `{ items, next_cursor }`. The generated OpenAPI document covers `/api/v1` only.

| Domain               | Routes                                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account              | `GET /api/v1/account`                                                                                                                                                                                                                                                                                                                                                                        |
| Bots                 | `GET, POST /api/v1/bots`; `GET /api/v1/bots/:botId`; `PATCH /api/v1/bots/:botId/profile`; `POST /api/v1/bots/:botId/revisions`; `GET /api/v1/bots/:botId/runs`                                                                                                                                                                                                                               |
| Organization catalog | `GET, POST /api/v1/organization-tool-policies`; `GET /api/v1/organization-tool-policies/:policyId`; `POST /api/v1/organization-tool-policies/:policyId/disables`; `GET, POST /api/v1/skills`; `GET /api/v1/skills/:skillId`; `POST /api/v1/skills/:skillId/revisions`; `POST /api/v1/skills/:skillId/revisions/:revisionId/disables`                                                         |
| Connector catalog    | `GET /api/v1/provider-deployments`; `GET /api/v1/provider-deployments/:deploymentId`                                                                                                                                                                                                                                                                                                         |
| Connections          | `GET /api/v1/provider-authorizations`; `GET /api/v1/provider-authorizations/:authorizationId`; `POST /api/v1/connection-setups`; `GET /api/v1/connection-setups/:setupId`; `POST /api/v1/provider-authorizations/:authorizationId/revocations`                                                                                                                                               |
| Grants               | `GET, POST /api/v1/capability-grants`; `GET /api/v1/capability-grants/:grantId`; `POST /api/v1/capability-grants/:grantId/revocations`                                                                                                                                                                                                                                                       |
| Runs                 | `POST /api/v1/run-confirmations`; `GET /api/v1/run-confirmations/:confirmationId`; `POST /api/v1/run-confirmations/:confirmationId/discards`; `POST /api/v1/runs`; `GET /api/v1/runs/:runId`; `GET /api/v1/runs/:runId/events`; `GET /api/v1/runs/:runId/result`; `POST /api/v1/runs/:runId/cancellations`; `POST /api/v1/runs/:runId/cleanup-retries`; `DELETE /api/v1/runs/:runId/content` |
| Audit                | `GET /api/v1/audit-events`; `GET /api/v1/audit-events/:eventId`                                                                                                                                                                                                                                                                                                                              |

`GET /api/v1/runs/:runId/events` accepts `after` and a limit of at most 50. It returns `RunPollPageV1`. Cursors bind account, resource, filters, and query version. A cursor from another account, run, or filter produces a generic invalid-cursor problem.

Better Auth lives behind a committed allowlist under `/api/auth/*`. The initial allowlist has email-and-password sign-in, session read, password change, and POST sign-out. Direct sign-up and every unlisted method or path fail before Better Auth dispatch.

`POST /operator/v1/admin-tokens` is the only operator HTTP command in the first release. It uses a separate operator credential. Internal Worker and Durable Object protocols are never published in OpenAPI.

## View contract index

Page handlers serialize allowlisted view objects. They never send database rows to templates.

| Contract                 | Used by                      | Required content                                                                                                         |
| ------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `BotRosterViewV1`        | Bot list and shared sidebar  | Query state, cursor links, `BotListItemV1` rows, and allowed top-level actions.                                          |
| `BotWorkspaceViewV1`     | Bot task page                | Bot identity, active revision, feed items, composer availability, denial reason, and navigation.                         |
| `RunConfirmationViewV1`  | Confirmation page            | Exact disclosure snapshot, expiry, stale state, and server-derived actions.                                              |
| `RunDetailViewV1`        | Run detail                   | Prompt, three status dimensions, timeline page, plain-text result, evidence, cleanup, `can_cancel`, and `cancel_reason`. |
| `RunPollPageV1`          | Two-second polling           | Run version, execution, cleanup, evidence and result state, new items, and next cursor.                                  |
| `BotAccessViewV1`        | Bot access page              | Connections, grants, resource mapping, destinations, limits, purpose, expiry, and impact-safe mutations.                 |
| `ConnectionDetailViewV1` | Connection detail            | Provider version, safe authorization state, dependent grants, and revocation impact.                                     |
| `CatalogViewV1`          | Tool and skill catalog pages | Immutable revision identity, lifecycle, dependency counts, and server-derived actions.                                   |
| `AuditEventViewV1`       | Audit event page             | Redacted canonical event, stream position, stored digests, and verifier result.                                          |

Every view includes `available_actions` and stable denial reasons from the server. No view may contain an encrypted content field, credential, MCP URL, Metorial reference, bearer capability, password material, raw tool argument, or raw tool result.

`BotListItemV1` contains only `bot_id`, `name`, `title`, `palette_color_id`, `active_revision_id`, `presentation_status`, `last_activity_at`, and `usable_grant_count`.

`BotFeedItemV1` is a tagged union for a live confirmation or completed run summary. `RunEventItemV1` covers lifecycle, safe tool summary, result, cleanup warning, and stable error. `SourceReferenceV1` contains connector provenance, a safe label, the displayed hostname, and the canonical URL produced by the connector's typed identifier mapping.

Exact-key tests cover every registered serializer. High-entropy sentinels in sensitive database columns are scanned across HTML, JSON, response headers, redirect locations, captured logs, audit projections, and translated errors.

## Artifact workspace routes

These routes do not belong to the read-only core. Keep them unregistered and hide every artifact control until the R2 workspace gate passes.

| Surface          | Routes added after the gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTML             | `GET /artifact-collections`; `GET /artifact-collections/new`; `GET /artifact-collections/:collectionId`; `GET /artifact-collections/:collectionId/uploads/new`; `GET /artifact-versions/:artifactVersionId`; `GET /artifact-uploads/:uploadId`                                                                                                                                                                                                                                                                                                                             |
| Actions          | `POST /actions/artifact-collections`; `POST /actions/artifact-uploads/small`; `POST /actions/artifact-versions/:artifactVersionId/publications`; `POST /actions/artifact-paths/:artifactPathId/moves`; `POST /actions/artifact-paths/:artifactPathId/deletions`; `POST /actions/artifact-paths/:artifactPathId/restores`; `POST /actions/bots/:botId/artifact-mounts`; `POST /actions/bots/:botId/artifact-mounts/:mountId/revocations`                                                                                                                                    |
| JSON metadata    | `GET, POST /api/v1/artifact-collections`; `GET /api/v1/artifact-collections/:collectionId/entries`; `GET /api/v1/artifact-versions/:artifactVersionId`; `GET, HEAD /api/v1/artifact-versions/:artifactVersionId/content`; `POST /api/v1/artifact-versions/:artifactVersionId/publications`; `POST /api/v1/artifact-paths/:artifactPathId/moves`; `DELETE /api/v1/artifact-paths/:artifactPathId`; `POST /api/v1/artifact-paths/:artifactPathId/restores`; `GET, POST /api/v1/bots/:botId/artifact-mounts`; `POST /api/v1/bots/:botId/artifact-mounts/:mountId/revocations` |
| Multipart upload | `POST /api/v1/artifact-uploads`; `GET /api/v1/artifact-uploads/:uploadId`; `PUT /api/v1/artifact-uploads/:uploadId/parts/:partNumber`; `POST /api/v1/artifact-uploads/:uploadId/completions`; `POST /api/v1/artifact-uploads/:uploadId/aborts`                                                                                                                                                                                                                                                                                                                             |

The no-JavaScript small-upload action accepts one file up to 8 MiB. Larger multipart transfer needs the browser module or an API client. Files download as attachments. Inline previews and model-visible document extraction remain deferred.

## Research matrix

Research snapshot: 2026-08-21. Observations describe the cited pages on that date. They are product research, not an API or compatibility promise.

| Observed behavior                                                           | Primary source and section                                                                                           | Confidence | OpenBot decision                                                                                      | Inference                                     |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| The product presents Bots as named workers and opens a chat-like task view. | [Grok Bot overview](https://docs.x.ai/grok-bot/overview), overview                                                   | High       | Use a named Bot roster and one task workspace per Bot.                                                | No                                            |
| Setup leads from Bot creation into a first task.                            | [Setup and first task](https://docs.x.ai/grok-bot/get-started), first task                                           | High       | Keep task entry primary, but require an authority disclosure before run creation.                     | No                                            |
| Bot management holds identity and instructions outside the transcript.      | [Bot management](https://docs.x.ai/grok-bot/bots), managing Bots                                                     | High       | Put cosmetic profile and immutable behavior revisions on a separate Profile page.                     | No                                            |
| Chat can show work activity and collaboration between Bots.                 | [Chat and collaboration](https://docs.x.ai/grok-bot/chat-and-collaboration), collaboration                           | High       | Show redacted run activity. Defer cross-Bot messages and direct handoffs.                             | No                                            |
| The product uses approval controls for consequential actions.               | [Approvals, security, and privacy](https://docs.x.ai/grok-bot/approvals-security-and-privacy), approvals             | High       | Use a start confirmation for the read-only run. Do not label it a provider-write approval.            | No                                            |
| Files and results appear in task context.                                   | [Files and results](https://docs.x.ai/grok-bot/files-and-results), results                                           | High       | Show plain-text results first. Add versioned R2 artifacts only after a separate gate.                 | No                                            |
| Skills and routines extend Bot behavior.                                    | [Skills, routines, and automations](https://docs.x.ai/grok-bot/skills-routines-and-automations), skills and routines | High       | Support bounded declarative skill revisions. Defer executable skills, schedules, and unattended runs. | No                                            |
| Mobile keeps access to Bot work in a narrow layout.                         | [Mobile behavior](https://docs.x.ai/grok-bot/mobile), mobile                                                         | Medium     | Use one responsive server-rendered interface and an accessible navigation drawer.                     | Yes, the exact layout is OpenBot's design.    |
| A user's Bots share one cloud computer and can hand work across it.         | [Grok Bot FAQ](https://docs.x.ai/grok-bot/faq), computer and Bot isolation                                           | Medium     | Do not share a machine. Use independent runs and later add snapshot-bound R2 artifact collections.    | No                                            |
| Connections are initiated from a product-level plugin flow.                 | [Plugin connection flow](https://cursor.com/help/grok-bot/connect-plugins), connecting plugins                       | Medium     | Keep connection setup separate from Bot-specific grants.                                              | Yes, the authority split is OpenBot's design. |

The matrix records what inspired a design choice. It does not permit copied wording, trade dress, art, icons, layout assets, or source code.

## Deferred interface work

Do not draw disabled placeholders for deferred work. Omit it until its authority and storage design exists.

- persistent conversation context, replies, reactions, group chats, and direct Bot messages
- routines, schedules, unattended runs, desktop notifications, and native mobile applications
- shell, browser, computer view, microphone, voice, and teach-by-demonstration
- provider business-data write approvals and `Always allow`
- attachments and artifact controls before the R2 gate
- Bot pinning, hiding, custom sidebar sections, duplication, and command palette
- team roles, shared provider authorizations, organization deletion, export, and personal API keys
- model-rendered Markdown, inline HTML, and inline artifact previews
