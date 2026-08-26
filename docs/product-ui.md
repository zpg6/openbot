# Product UI contract

This document defines the first OpenBot browser interface. The bounded create-Bot and synthetic task-result proof is implemented; the remaining routes, stores, and provider behavior are still a design contract.

The implemented proof uses a near-black three-column workspace: a compact Bot roster, the active Bot's chat, and a persistent settings rail. Pink appears only in the brand mark, focus, and checked controls. Bot identity comes from one of ten user-selected colors, three shapes, and six faces rendered locally with the open-source DiceBear Moods style. Green communicates connected/read/success state rather than brand. The interface uses the local system font stack and contains no OpenAI logos, fonts, icons, or copied assets.

Typography takes its cue from Metorial's restrained product UI without copying its assets. The proof uses a 15-pixel body, 16-pixel chat text, compact 13-pixel utility text, and 12-pixel metadata and technical identifiers. It limits the system font stack to 400, 500, 600, and 700 weights, disables synthesized faces, and gives form controls explicit typography instead of inheriting label weight.

OpenBot is unaffiliated with xAI and Grok Bot. Product research informed the hierarchy and interaction study below. The wireframes and content rules are original to OpenBot. Do not add third-party screenshots, logos, character art, or copied interface assets to this repository.

## Product promise shown in the interface

A connection is not authority. Better Auth supplies the verified user, current organization membership and role, and active organization. The organization-scoped server adapter then supplies available Metorial integrations, an opaque connection-grant identity and safe account label for each connection, pinned provider version/specification identity, and exact reviewed tool policies. An owner sets the organization's exact maximum tool set. A Bot may select several organization integrations and only a subset of that maximum. OpenBot re-resolves membership, the complete organization catalog, the Bot revision, and revocation fences on confirmation and execution; browser-submitted organization, integration, or permission identifiers cannot create authority. Each task gets a fresh authority snapshot and an independent run. The browser never receives a Better Auth token, Metorial auth-config ID, or raw connection-grant ID.

The first release does one useful job. One owner reviews and starts a short read-only task that uses one reviewed Metorial connector, one fixed OpenRouter model route, and an optional reviewed Cloudflare Sandbox profile. The interface must not imply that OpenBot can write provider business data, browse websites, expose an interactive shell, install packages, share a persistent computer, remember prior conversations, or work unattended.

Use these product terms consistently:

| Term                     | Meaning                                                                                                                       |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Organization             | The Better Auth tenancy boundary. Membership and role come from Better Auth; provider authority does not.                     |
| Bot                      | A named configuration with immutable behavior revisions and scoped grants.                                                    |
| Connection               | A provider authorization reference managed through Metorial. It grants nothing by itself.                                     |
| Organization tool policy | An owner-reviewed, pinned connector tool that Bots may select.                                                                |
| Declarative skill        | Versioned instruction text and bounded schemas. It cannot add authority.                                                      |
| Code profile             | The operator-reviewed JavaScript runner, image, network, filesystem, and numeric limits.                                      |
| Compute policy           | An organization policy that narrows an enabled code profile. A Bot revision selects it, but it grants no authority by itself. |
| Compute grant            | Separate, expiring authority for one Bot revision to use its selected compute policy. A provider connection is unrelated.     |
| Grant                    | The Bot-specific tool, resource, purpose, limit, and expiry authority.                                                        |
| Task confirmation        | A five-minute disclosure snapshot. It is not a run and not permission for provider writes.                                    |
| Run                      | One independent execution object with one occupied Bot run slot and, when enabled, one random Sandbox.                        |
| Cleanup                  | Revocation and deletion work for run-owned vendor and Sandbox resources. It may outlive execution.                            |

## Identity and organization entry

The signed-out page asks only for an email address and sends a Better Auth magic link. It returns the same result whether the email belongs to a member, has a pending invitation, or is new. The browser never receives the token from an application JSON response.

After the link is redeemed:

1. If the verified email has a pending invitation, show the organization name and inviter and let the user accept or decline. Acceptance happens through Better Auth and requires the signed-in verified email.
2. If the user has one accepted membership, set it as the active organization and enter the Bot roster.
3. If the user has several memberships and no valid active organization, require an organization choice.
4. If the user has no accepted membership or invitation, require organization creation. The creator becomes owner and the new organization becomes active.

The organization switcher sits with the account menu, not in every Bot header. Switching organizations replaces the entire Bot roster, integrations, policies, routines, confirmations, and audit scope. OpenBot never accepts an organization ID from a Bot form as proof of access.

The owner-only organization settings page has `Members`, `Integrations`, and `Permissions`. `Integrations` manages the organization's Metorial provider deployments and safe connection labels. `Permissions` is the exact organization ceiling over reviewed tool-policy revisions. A newly discovered provider tool starts disabled. Lowering the ceiling immediately stales dependent confirmations and denies future dispatches. The UI may explain affected Bots and routines, but it cannot delay revocation until the user visits them.

## Desktop layout

At 900 CSS pixels and wider, render a compact Bot roster, one central chat, and a persistent settings rail. A Bot is a chat, not a dashboard page. The right rail owns Bot settings, exact Metorial access, and routines.

```text
+----------------------+-----------------------------------------+------------------------+
| OpenBot              | [Bot] Research helper                   | Research helper        |
| + New Bot            +-----------------------------------------+------------------------+
|                      |                                         | Settings               |
| [Bot] Research       |             Chat transcript             | Purpose                |
|       open cases     |                                         | Appearance             |
| [Bot] Customer notes|                         [user message]  | Instructions           |
| [Bot] Weekly review | [Bot result]                            +------------------------+
|                      |                                         | Metorial access        |
|                      |                                         | Integration + tools    |
|                      | [Message Research helper.............] +------------------------+
| Organization owner  | [Review task]                           | Routines               |
+----------------------+-----------------------------------------+------------------------+
```

The center page uses document scrolling. The Bot header is sticky. The composer follows the feed in DOM order. It may become sticky only if it cannot cover the final card, focused control, or validation error. A routine starts as a normal chat request containing a repeating job and schedule. The Bot proposes a structured routine draft in chat; the user reviews schedule, prompt, current Bot revision, and exact permission subset before saving. The saved routine appears in the right rail and can be edited there. It never broadens the Bot or organization ceiling, and a later permission change leaves it visibly blocked until re-reviewed.

The sidebar has a one-pixel divider. The main feed is at most 48rem wide. Cards use 16-pixel gaps, while sections use 24-pixel gaps. Confirmation, activity, result, and cleanup cards share border and radius tokens. Reserve elevation for the mobile drawer.

The fixed Bot palette identifies Bots. Color never communicates status by itself. Every status needs visible text and an icon with an accessible name.

### Bot builder

`GET /bots/new` uses one server-rendered form in the main column. It separates cosmetic identity from executable behavior:

```text
+------------------------------------------------------------------+
| New Bot                                                          |
|                                                                  |
| Identity                                                         |
| [palette mark]  Name              [Research helper............]  |
|                 Short description [Summarizes support cases...]  |
|                 Shown in the Bot list. It does not change work.  |
|                                                                  |
| Purpose                                                          |
| [Review open support cases for the selected account...........]  |
|                                                                  |
| Behavior instructions                                            |
| [Name blockers, cite case IDs, and do not guess status.........] |
|                                                                  |
| Tools                                                            |
| Support connector                                      Add       |
|   [ ] Read tools                 Select exact tools               |
|   [ ] Write tools                Unavailable in this release      |
|   [ ] Destructive tools          Unavailable in this release      |
|                                                                  |
| Exact Metorial tools                           0 selected       |
| Code execution [ ] Reviewed JavaScript sandbox                  |
|                Uses one slot; requires an enabled code policy.  |
|                                                                  |
| [Cancel]                                           [Create Bot]  |
+------------------------------------------------------------------+
```

`Name`, `Short description`, and the fixed appearance choices are cosmetic Bot fields. The short description appears in the roster and does not change behavior or authority. `Purpose` maps to the immutable Bot job. `Behavior instructions` maps to immutable standing instructions. Changing purpose, behavior instructions, selected tool policies, skills, model route, or compute policy appends a Bot revision. It never passes through the cosmetic profile action.

The Bot purpose explains its intended job. It grants nothing. The access form separately asks why this Bot revision may use the selected provider tools and binds that narrower purpose into the expiring grant.

The implemented proof requires at least one enabled tool permission under every selected Metorial integration. The catalog can contain any integration supplied by the account adapter and preserves each explicit auth mode, opaque user grant when required, provider deployment/version/specification, policy revision and digest, exact tool key and schema digests, effect, consequence, and scope. Disabled write or destructive entries stay visible but cannot be posted into authority. OpenBot's semantic session intent pins its own schema version, the configured Metorial API version, serializer identity, providers, auth modes, and exact allowed tool keys. It is not a vendor wire body. The private capability gateway must resolve a `user_grant` to one auth config and serialize the pinned Metorial version; `deployment` and `authless` intentionally omit user auth. Ambient auth selection is never allowed. Auth-config IDs never enter the control-plane confirmation or browser markup. The proof creates no connection, provider authorization, or grant.

The builder displays `selected_permission_count of max_selected_permissions tool slots`. Code execution consumes one of the four model-tool slots, so selecting an enabled reviewed compute policy leaves at most three provider tools. If no code profile and policy have passed their gates, the code control is unavailable with that reason; the page never invents a profile. The enhancement announces slot-count changes in a polite live region. The server recomputes the limit on submit.

The proof pins DiceBear core and its Moods style at `10.5.0`. DiceBear core is MIT-licensed and Moods is CC0 1.0. The server generates each soft-shape SVG locally from the opaque Bot ID, one of ten reviewed colors, one of three clipping shapes, and one of six reviewed face recipes. The browser makes no avatar request and accepts no raw SVG or upload from a user. Roster avatars stay static. Only the large Bot view uses Moods' built-in slow CSS animation, with a static replacement under `prefers-reduced-motion: reduce`.

### Tool permission groups

The builder and Bot access page group connector tools under `Read`, `Write`, and `Destructive`. These groups explain effect and help navigation. They are not grants and never replace exact reviewed organization tool policies.

- `Read` observes provider business data. Disclose incidental provider access logs, timestamps, and quota use.
- `Write` creates or changes provider business data without deleting it or changing access control.
- `Destructive` includes deletion, membership or permission changes, security changes, irreversible bulk actions, and any operation the connector review classifies as high impact.

The server owns each classification. A tool with an unknown or argument-dependent effect is unavailable until connector review either restricts its arguments or assigns the highest possible effect. A user cannot lower a tool's classification.

Each category checkbox is a tri-state summary of its exact reviewed children: unchecked means none, indeterminate means some, and checked means all tools in the displayed pinned catalog revision. The category is not separate authority. A bulk change previews the named fixed set before submission, and a later connector release never inherits access. If the group is larger than the remaining tool slots, bulk selection is unavailable and the page directs the owner to exact children. Do not offer a bulk-select shortcut for destructive tools.

The first release begins with no tool selected and permits only reviewed read children. Creating a Bot requires at least one selected read tool. The server-rendered submit remains usable without JavaScript; an invalid POST returns `422` with an error summary and field error. Enhancement may disable and re-enable it while showing the same reason. Write and destructive are unchecked and disabled with `Unavailable in the read-only release`. The page does not draw fake child tools from an unreviewed vendor catalog.

Every selectable child shows its safe display name, effect, incidental effects, enforceable resource scope, outbound fields and destinations, call limit, and grant expiry. Put the pinned connector tool key and schema revision under `Technical details`. If a connector cannot enforce the selected resource scope, disable submission and use the existing `resource_scope_unsupported` copy.

The access page distinguishes selection intent from effective authority. A selected tool can be `Needs connection`, `Needs grant`, `Available`, `Expired`, `Revoked`, `Connector changed`, or `Blocked by organization policy`. The checkbox controls the next immutable Bot revision. The status comes from the current server-side authority chain.

### Sidebar behavior

The sidebar header contains `New Bot` and a search form. Enter submits `GET /bots`. The optional browser controller waits 200 milliseconds after text composition ends, aborts an older request, keeps focus and selection, and replaces the current history entry. Search text is limited to 128 UTF-8 bytes and matches normalized Bot name and short description only.

Each Bot row shows:

- fixed-palette color mark
- name
- short description
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

A Bot with no earlier run and usable configuration and access is `Ready`. `Needs configuration` means a selected tool policy, skill revision, connector revision, model route, code profile, or compute policy cannot be used. A missing, expired, or revoked compute grant produces `Needs access`. Roster state is a navigation hint, never an authorization decision.

### Bot workspace

The header shows the Bot mark, name, active revision, and an `Access` control. Under it, ordinary links switch between `Tasks`, `Access`, and `Profile`.

The task feed contains independent confirmations and run summaries in OpenBot commit order. Put a user prompt on the right visually, but keep chronological DOM order. Put confirmation, activity, safe provider-tool and code summaries, result, evidence, and cleanup cards on the left under a run heading.

When a Bot selects a connector but lacks a usable provider authorization, put a server-authored setup card in the feed before the disabled composer:

```text
+------------------------------------------------------------------+
| OpenBot setup                                                    |
|                                                                  |
| This Bot is configured to use Support connector, but no account  |
| is connected. Connecting an account does not give this Bot       |
| permission to use it.                                            |
|                                                                  |
|                                                     [Connect]    |
+------------------------------------------------------------------+
```

Label the card `OpenBot setup`, not with the Bot's name. It is control-plane state, never a model response. The action uses the existing connection-setup flow and returns through its stored server-selected path to the Bot access page. Creating the card, opening connection setup, and completing OAuth perform no model or provider-tool call and create no Bot grant.

The server chooses reason-specific copy. `authorization_missing` says no account is connected and offers `Connect`. `authorization_expired` says the authorization expired; `authorization_revoked` says it was revoked; both offer `Reconnect`. `authorization_unusable` says OpenBot cannot use the saved authorization and offers `Reconnect` only after reconciliation proves that a new setup is safe. An uncertain external outcome is not a connection-setup card and never offers a blind retry.

The composer has one multiline field and a `Review task` button. It has no attachment, microphone, mention, schedule, browser, or computer control. Disable it when the Bot lacks a currently usable provider grant. A code-enabled Bot also requires an enabled active profile, active selected compute-policy revision, and unexpired active compute grant. A live confirmation, nonterminal run, or incomplete cleanup also disables the composer. Explain the exact reason beside the control. Do not rely on color or a disabled tooltip.

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
| Code       JavaScript, ephemeral files, public net blocked         |
| Limits     2 provider calls, 1 code call, 240 seconds              |
| Skills     Triage summary, revision 3                             |
|                                                                  |
| [Discard]                                             [Start run] |
+------------------------------------------------------------------+
```

The server authors every field except the already-entered prompt. Show the exact prompt, named provider-tool policies, selected skill revisions, compute policy and grant, JavaScript profile, network and filesystem rules, possible data classes, destinations, expiry, and numeric limits. State that model-selected arguments, code, and returned records do not exist yet and cannot be previewed. When code is enabled, say that model-written code and selected inputs go to Cloudflare. OpenBot requests Sandbox cleanup after the run, does not reuse its files, and shows `Cleaning up` or `Cleanup required` until Cloudflare acknowledges the request.

Use `Start run`, not `Approve`. The confirmation authorizes this disclosed read-only run. It does not approve a provider business-data write and never offers `Always allow`.

If catalog, provider grant, compute profile, compute policy, compute grant, connection, model route, cleanup, or Bot revision state changes, mark the confirmation stale. Show the reason and link back to the Bot. Never recompile and start silently.

### Run detail

Show the original prompt, a cursor-paginated timeline, the plain-text final answer, safe source references, resolved model and provider, audit link, and three separate status rows:

- execution
- vendor cleanup
- evidence completeness

A successful answer does not hide `Cleanup required`. Render `Cancel run` only when the server supplies `can_cancel`. Show a stable error code and request ID as selectable text. Browser code may add copy controls, but it must not replace the original text.

Connector code may produce a safe summary that names an allowed provider tool and a record count. A code summary may show language, duration, exit state, and truncated stdout and stderr byte counts. Do not render raw MCP arguments, MCP results, model-written code, model reasoning, vendor bearer references, or decrypted configuration by default.

Final answers are plain text with preserved whitespace. Do not render model Markdown or HTML. A source becomes a link only when reviewed connector code constructs a `SourceReferenceV1` from typed provider identifiers. The connector accepts one canonical HTTPS host, the default port, a defined path grammar, and an allowlist of safe query keys. It rejects unknown query keys, userinfo, fragments, IP literals, nondefault ports, and any normalization change. Model-written citations remain unlinked text.

### Audit and vendor logs

OpenBot's redacted audit view is the normal activity record. A safe tool event may show Bot, run, actor, reviewed tool display name, effect, outcome, duration, request ID, and time. It does not show raw arguments, results, bearer references, provider authorization references, or vendor object IDs. Link run summaries to the existing OpenBot audit event view.

Metorial logs are supplemental vendor observations, not proof that OpenBot authorized a call correctly. A future role-checked organization-owner view may show `Open Metorial dashboard` on the Audit page. The link uses a configured path on the fixed `https://app.metorial.com` origin, includes no vendor object or return-path parameter, displays the hostname, and uses the external-link protections defined below. Metorial must enforce dashboard access with its own account role and session. Do not add a shared credential, an OpenBot proxy, or a deep link until that privileged use case exists.

Better Auth supplies the current `owner`, `admin`, or `member` organization role, but OpenBot maps that role to its own action matrix after a fresh membership read. Members may create and operate Bots only within organization-approved policies and may view safe events for Bots they can access. Owners manage organization tool ceilings, shared provider authorizations, invitations, member roles, and all organization audit events. Administrators receive only the explicitly implemented subset of those actions. Hiding a control is never the authorization check, and hiding a Metorial dashboard link is not a substitute for Metorial-side access control.

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
- Permission groups use `fieldset` and `legend`. Each group names how many exact tools are selected, and an indeterminate state is never the only explanation.
- Destructive status uses text and an icon as well as color. Effect definitions, tool details, and denial reasons remain visible without hover.
- A mark beside a visible Bot name has empty alternative text. A mark picker uses native named radio controls.
- Roster marks remain static. Later animated marks honor `prefers-reduced-motion` and retain a static rendering.

## Content rules

Say what OpenBot knows and what it does not know.

| Situation                          | Required copy direction                                                                                         |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Connection exists but no Bot grant | `Connected, but this Bot has no access.` Link to the Bot access page.                                           |
| Connection is missing              | `This Bot is configured to use [connector], but no account is connected.` State that connecting grants nothing. |
| Resource mapping is unsupported    | `This connector cannot enforce the selected resource scope. The run was not created.`                           |
| Bot is busy                        | Name the live confirmation, run, or cleanup obligation. Do not say only `Unavailable`.                          |
| Confirmation expired or changed    | State that no run started and ask the user to review again.                                                     |
| Cancellation requested             | Say that OpenBot denied new calls. Do not claim a vendor call already in flight was undone.                     |
| Outcome is uncertain               | Use `Outcome unknown`. Do not relabel it `Failed`.                                                              |
| Cleanup is incomplete              | Keep the cleanup warning visible even if an answer exists.                                                      |
| Audit chain verifies               | Say the application chain verifies from its stored start. Do not call it immutable or non-repudiable.           |
| Provider write requested           | State that provider business-data writes are not supported in the read-only release.                            |
| Code execution enabled             | Name JavaScript, the Cloudflare destination, ephemeral filesystem, network and DNS limits, and compute cap.     |
| Sandbox cleanup incomplete         | State that files may still exist in an isolated container and keep the Bot slot blocked.                        |
| Artifact feature absent            | Do not render disabled upload, file, mount, or shared-workspace controls.                                       |

Do not use teammate copy that implies memory or a continuing conversation. `Start a task` is the primary verb. Each task is independent. Do not say `I'll remember`, `hand this to another Bot`, `run every week`, or `always allow`.

## Browser route index

All resource IDs are account-scoped UUIDs. Raw bootstrap, reset, and confirmation tokens never appear in a URL.

| Method and path                          | View or behavior                                                                                                                                                                                                               |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /`                                  | Route an unbootstrapped install to `/bootstrap`, a signed-out user to `/login`, and an owner to `/bots`.                                                                                                                       |
| `GET /login`                             | Email and password form.                                                                                                                                                                                                       |
| `GET /bootstrap`                         | One-time first-owner token and password form.                                                                                                                                                                                  |
| `GET /reset`                             | One-time password-reset token and new-password form.                                                                                                                                                                           |
| `GET /bots`                              | Searchable, cursor-paginated Bot roster. Accept `q`, `cursor`, and `limit`.                                                                                                                                                    |
| `GET /bots/new`                          | Cosmetic name, short description and palette mark; immutable purpose and behavior instructions; exact reviewed read-only tools; declarative skills; optional enabled reviewed compute policy and visible tool-slot accounting. |
| `GET /bots/:botId`                       | Task feed, status, and task composer.                                                                                                                                                                                          |
| `GET /bots/:botId/profile`               | Cosmetic profile and immutable behavior revision history.                                                                                                                                                                      |
| `GET /bots/:botId/access`                | Connections, grants, allowlist, resource mapping, destinations, limits, purpose, expiry, and revocation.                                                                                                                       |
| `GET /bots/:botId/runs/:runId`           | Prompt, timeline, result, cancellation, cleanup, evidence, and audit link.                                                                                                                                                     |
| `GET /run-confirmations/:confirmationId` | Session-bound five-minute task confirmation.                                                                                                                                                                                   |
| `GET /catalog/tools`                     | Organization tool policies and dependency impact.                                                                                                                                                                              |
| `GET /catalog/tools/:policyId`           | Server-derived connector contract and disable impact.                                                                                                                                                                          |
| `GET /catalog/compute`                   | Installation profile, DNS gate state, compute policies, and dependent Bots.                                                                                                                                                    |
| `GET /catalog/compute/:policyId`         | Profile digest, admitted data classes, grants, dependent Bots, and disable impact.                                                                                                                                             |
| `GET /catalog/skills`                    | Skills, current defaults, disabled revisions, and dependent Bots.                                                                                                                                                              |
| `GET /catalog/skills/new`                | Declarative skill form.                                                                                                                                                                                                        |
| `GET /catalog/skills/:skillId`           | Skill revisions, requested tools, and disable impact.                                                                                                                                                                          |
| `GET /connections`                       | Reviewed connector, setup state, provider authorization, and dependent grants.                                                                                                                                                 |
| `GET /connections/new`                   | OAuth scope and connection-versus-authority explanation.                                                                                                                                                                       |
| `GET /connection-setups/:setupId`        | Pending, complete, expired, or failed setup.                                                                                                                                                                                   |
| `GET /connections/:authorizationId`      | Provider version, observed revocation, and dependent grants.                                                                                                                                                                   |
| `GET /oauth/metorial/callback`           | Verify one-time OAuth state and finish setup.                                                                                                                                                                                  |
| `GET /audit`                             | Filtered, cursor-paginated redacted audit events.                                                                                                                                                                              |
| `GET /audit/events/:eventId`             | Canonical redacted event, chain position, and verifier result.                                                                                                                                                                 |
| `GET /cleanup-obligations/:obligationId` | Attempts, safe error, retry timing, and observed vendor state.                                                                                                                                                                 |
| `GET /settings`                          | Read-only installation profile, jurisdiction, retention, active key IDs, and version.                                                                                                                                          |

### Browser action index

All actions below use `POST`. Magic-link verification and session read are the documented Better Auth GET exceptions. Every app-owned mutation checks the session when required, origin, CSRF token, idempotency key, and expected version or fence that its command requires.

| Path                                                            | Mutation                                                                                 |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `/actions/auth/magic-link`                                      | Request the same magic-link response for existing, invited, and new email addresses.     |
| `/actions/organizations`                                        | Create the required first organization for a user with no membership.                    |
| `/actions/organizations/active`                                 | Set an active organization after a fresh membership read.                                |
| `/actions/organization-invitations`                             | Invite a verified email from an owner-authorized organization.                           |
| `/actions/organization-invitations/:flowId/accept`              | Accept an invitation bound to the signed-in verified email.                              |
| `/actions/bots`                                                 | Create a Bot and first revision.                                                         |
| `/actions/bots/:botId/profile`                                  | Change cosmetic fields.                                                                  |
| `/actions/bots/:botId/revisions`                                | Append a behavior revision.                                                              |
| `/actions/organization-tool-policies`                           | Approve one reviewed tool version for selection.                                         |
| `/actions/organization-tool-policies/:policyId/disables`        | Disable after the impact digest and fence still match.                                   |
| `/actions/organization-permissions`                             | Change one exact organization tool ceiling entry after current-catalog revalidation.     |
| `/actions/organization-compute-policies`                        | Create a policy that narrows the enabled installation profile.                           |
| `/actions/organization-compute-policies/:policyId/disables`     | Disable after the impact digest and fence still match.                                   |
| `/actions/skills`                                               | Create a skill and first revision.                                                       |
| `/actions/skills/:skillId/revisions`                            | Append a skill revision.                                                                 |
| `/actions/skills/:skillId/revisions/:revisionId/disables`       | Disable one revision after impact revalidation.                                          |
| `/actions/connection-setups`                                    | Start reviewed Metorial OAuth setup.                                                     |
| `/actions/connection-setups/:setupId/reopen`                    | Reopen a live provider setup URL.                                                        |
| `/actions/provider-authorizations/:authorizationId/revocations` | Deny local use, cancel affected runs, and request vendor revocation.                     |
| `/actions/capability-grants`                                    | Create one Bot-scoped grant.                                                             |
| `/actions/capability-grants/:grantId/revocations`               | Revoke, discard dependent confirmations, and cancel dependent runs.                      |
| `/actions/compute-grants`                                       | Create separate expiring compute authority for one Bot revision.                         |
| `/actions/compute-grants/:grantId/revocations`                  | Revoke compute authority and cancel dependent work.                                      |
| `/actions/run-confirmations`                                    | Compile and store a disclosure snapshot.                                                 |
| `/actions/run-confirmations/:confirmationId/discards`           | Consume without a run and schedule prompt erasure.                                       |
| `/actions/routine-proposals`                                    | Compile a five-minute routine draft from the Bot chat and current exact authority.       |
| `/actions/routines`                                             | Save one still-current routine draft atomically.                                         |
| `/actions/routines/:routineId`                                  | Edit a routine with expected revision and rebind it to current Bot authority.            |
| `/actions/runs`                                                 | Consume a session-bound confirmation and create a run.                                   |
| `/actions/runs/:runId/cancellations`                            | Request cancellation once.                                                               |
| `/actions/runs/:runId/cleanup-retries`                          | Return a manual cleanup obligation to pending.                                           |
| `/actions/runs/:runId/content-deletions`                        | Erase retained prompt and final-answer ciphertext while keeping redacted audit metadata. |

## JSON route index

The first public API uses the browser session. Unsafe methods also require origin and synchronizer CSRF checks, accept JSON only, and expose no CORS headers. Every list returns `{ items, next_cursor }`. The generated OpenAPI document covers `/api/v1` only.

| Domain               | Routes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Account              | `GET /api/v1/account`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Bots                 | `GET, POST /api/v1/bots`; `GET /api/v1/bots/:botId`; `PATCH /api/v1/bots/:botId/profile`; `POST /api/v1/bots/:botId/revisions`; `GET /api/v1/bots/:botId/runs`                                                                                                                                                                                                                                                                                                                                                  |
| Organization catalog | `GET, POST /api/v1/organization-tool-policies`; `GET /api/v1/organization-tool-policies/:policyId`; `POST /api/v1/organization-tool-policies/:policyId/disables`; `GET, POST /api/v1/organization-compute-policies`; `GET /api/v1/organization-compute-policies/:policyId`; `POST /api/v1/organization-compute-policies/:policyId/disables`; `GET, POST /api/v1/skills`; `GET /api/v1/skills/:skillId`; `POST /api/v1/skills/:skillId/revisions`; `POST /api/v1/skills/:skillId/revisions/:revisionId/disables` |
| Connector catalog    | `GET /api/v1/provider-deployments`; `GET /api/v1/provider-deployments/:deploymentId`                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Connections          | `GET /api/v1/provider-authorizations`; `GET /api/v1/provider-authorizations/:authorizationId`; `POST /api/v1/connection-setups`; `GET /api/v1/connection-setups/:setupId`; `POST /api/v1/provider-authorizations/:authorizationId/revocations`                                                                                                                                                                                                                                                                  |
| Grants               | `GET, POST /api/v1/capability-grants`; `GET /api/v1/capability-grants/:grantId`; `POST /api/v1/capability-grants/:grantId/revocations`; `GET, POST /api/v1/compute-grants`; `GET /api/v1/compute-grants/:grantId`; `POST /api/v1/compute-grants/:grantId/revocations`                                                                                                                                                                                                                                           |
| Runs                 | `POST /api/v1/run-confirmations`; `GET /api/v1/run-confirmations/:confirmationId`; `POST /api/v1/run-confirmations/:confirmationId/discards`; `POST /api/v1/runs`; `GET /api/v1/runs/:runId`; `GET /api/v1/runs/:runId/events`; `GET /api/v1/runs/:runId/result`; `POST /api/v1/runs/:runId/cancellations`; `POST /api/v1/runs/:runId/cleanup-retries`; `DELETE /api/v1/runs/:runId/content`                                                                                                                    |
| Audit                | `GET /api/v1/audit-events`; `GET /api/v1/audit-events/:eventId`                                                                                                                                                                                                                                                                                                                                                                                                                                                 |

`GET /api/v1/runs/:runId/events` accepts `after` and a limit of at most 50. It returns `RunPollPageV1`. Cursors bind account, resource, filters, and query version. A cursor from another account, run, or filter produces a generic invalid-cursor problem.

Better Auth lives behind a committed allowlist under `/api/auth/*`. The raw handler exposes only session read, one-use magic-link verification, and POST sign-out. App-owned actions request magic links and perform organization, membership, and invitation mutations after their own origin, CSRF, role, and expected-state checks. Every unlisted method or path fails before Better Auth dispatch.

`POST /operator/v1/admin-tokens` is the only operator HTTP command in the first release. It uses a separate operator credential. Internal Worker and Durable Object protocols are never published in OpenAPI.

## View contract index

Page handlers serialize allowlisted view objects. They never send database rows to templates.

| Contract                 | Used by                      | Required content                                                                                                                                                                                                            |
| ------------------------ | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BotRosterViewV1`        | Bot list and shared sidebar  | Query state, cursor links, `BotListItemV1` rows, and allowed top-level actions.                                                                                                                                             |
| `BotWorkspaceViewV1`     | Bot task page                | Bot identity, active revision, server-authored setup or run feed items, composer availability, denial reason, and navigation.                                                                                               |
| `RunConfirmationViewV1`  | Confirmation page            | Exact disclosure snapshot, expiry, stale state, and server-derived actions.                                                                                                                                                 |
| `RunDetailViewV1`        | Run detail                   | Prompt, three status dimensions, timeline page, plain-text result, evidence, cleanup, `can_cancel`, and `cancel_reason`.                                                                                                    |
| `RunPollPageV1`          | Two-second polling           | Run version, execution, cleanup, evidence and result state, new items, and next cursor.                                                                                                                                     |
| `BotAccessViewV1`        | Bot access page              | Exact tool selections grouped by server-owned effect, effective authority status, connections, provider grants, separate compute grant, resource mapping, destinations, limits, purpose, expiry, and impact-safe mutations. |
| `ConnectionDetailViewV1` | Connection detail            | Provider version, safe authorization state, dependent grants, and revocation impact.                                                                                                                                        |
| `CatalogViewV1`          | Tool and skill catalog pages | Immutable revision identity, lifecycle, dependency counts, and server-derived actions.                                                                                                                                      |
| `ComputeCatalogViewV1`   | Compute catalog pages        | Signed approval-lease status and expiry, profile and policy lifecycle, limits, admitted classes, dependent Bots, and server-derived actions.                                                                                |
| `AuditEventViewV1`       | Audit event page             | Redacted canonical event, stream position, stored digests, and verifier result.                                                                                                                                             |

Every view includes `available_actions` and stable denial reasons from the server. No ordinary-user view may contain an encrypted content field, credential, MCP URL, Metorial reference, bearer capability, password material, raw tool argument, or raw tool result. A future owner/admin provider-activity use case may return only a fixed configured Metorial Logs root after a fresh role check; the view schema alone is not authorization.

`BotListItemV1` contains only `bot_id`, `name`, `short_description`, nullable `icon`, `palette_color_id`, `active_revision_id`, `presentation_status`, `last_activity_at`, and `usable_grant_count`.

`BotFeedItemV1` is a tagged union for a live confirmation or completed run summary. `RunEventItemV1` covers lifecycle, safe tool summary, result, cleanup warning, and stable error. `SourceReferenceV1` contains connector provenance, a safe label, the displayed hostname, and the canonical URL produced by the connector's typed identifier mapping.

Exact-key tests cover every registered serializer. High-entropy sentinels in sensitive database columns are scanned across HTML, JSON, response headers, redirect locations, captured logs, audit projections, and translated errors.

## Artifact workspace routes

These routes do not belong to the read-only core. Keep them unregistered and hide every artifact control until the R2 workspace gate passes.

| Route group      | Routes added after the gate                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
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
| A user's Bots share one cloud computer and can hand work across it.         | [Grok Bot FAQ](https://docs.x.ai/grok-bot/faq), computer and Bot isolation                                           | Medium     | Give each code-enabled run a fresh Sandbox. Later add snapshot-bound R2 artifact collections.         | No                                            |
| Connections are initiated from a product-level plugin flow.                 | [Plugin connection flow](https://cursor.com/help/grok-bot/connect-plugins), connecting plugins                       | Medium     | Keep connection setup separate from Bot-specific grants.                                              | Yes, the authority split is OpenBot's design. |

The matrix records what inspired a design choice. It does not permit copied wording, trade dress, art, icons, layout assets, or source code.

## Deferred interface work

Do not draw disabled placeholders for deferred work. Omit it until its authority and storage design exists.

- persistent conversation context, replies, reactions, group chats, and direct Bot messages
- routines, schedules, unattended runs, desktop notifications, and native mobile applications
- interactive terminal, arbitrary command endpoint, package installation, browser, computer view, microphone, voice, and teach-by-demonstration
- provider business-data write approvals and `Always allow`
- attachments and artifact controls before the R2 gate
- Bot pinning, hiding, custom sidebar sections, duplication, and command palette
- team roles, shared provider authorizations, organization deletion, export, and personal API keys
- model-rendered Markdown, inline HTML, and inline artifact previews
