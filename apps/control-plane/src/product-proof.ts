import type { Hono } from "hono";

import type { ControlPlaneBindings } from "./app.js";

const MAX_NAME_BYTES = 128;
const MAX_DESCRIPTION_BYTES = 512;
const MAX_PURPOSE_BYTES = 512;
const MAX_INSTRUCTIONS_BYTES = 32 * 1024;
const MAX_PROMPT_BYTES = 16 * 1024;
const CONFIRMATION_LIFETIME_MS = 5 * 60 * 1_000;
const unsafeDisplayCharacters = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const unsafeContentCharacters = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;

export interface ControlPlaneActorV1 {
    readonly account_id: string;
    readonly user_id: string;
    readonly display_name: string;
    readonly csrf_token: string;
}

export interface ProductProofPermissionV1 {
    readonly policy_id: string;
    readonly display_name: string;
    readonly tool_key: string;
    readonly effect: "read" | "write" | "destructive";
    readonly consequence_summary: string;
    readonly resource_scope_summary: string;
    readonly enabled: boolean;
}

export interface ProductProofBotV1 {
    readonly bot_id: string;
    readonly account_id: string;
    readonly owner_user_id: string;
    readonly name: string;
    readonly short_description: string;
    readonly palette_color_id: string;
    readonly purpose: string;
    readonly standing_instructions: string;
    readonly permission_policy_ids: readonly string[];
    readonly created_at_ms: number;
}

export interface ProductProofConfirmationV1 {
    readonly confirmation_id: string;
    readonly account_id: string;
    readonly bot_id: string;
    readonly prompt: string;
    readonly created_at_ms: number;
    readonly expires_at_ms: number;
    readonly state: "pending" | "started";
}

export interface ProductProofRunV1 {
    readonly run_id: string;
    readonly account_id: string;
    readonly bot_id: string;
    readonly confirmation_id: string;
    readonly prompt: string;
    readonly result_text: string | null;
    readonly execution_state: "running" | "completed";
    readonly cleanup_state: "not_required";
    readonly evidence_state: "synthetic_test_only";
    readonly created_at_ms: number;
    readonly completed_at_ms: number | null;
}

export interface ProductProofRepositoryV1 {
    listBots(accountId: string): Promise<readonly ProductProofBotV1[]>;
    createBot(input: {
        readonly account_id: string;
        readonly owner_user_id: string;
        readonly name: string;
        readonly short_description: string;
        readonly palette_color_id: string;
        readonly purpose: string;
        readonly standing_instructions: string;
        readonly permission_policy_ids: readonly string[];
        readonly created_at_ms: number;
    }): Promise<ProductProofBotV1>;
    getBot(accountId: string, botId: string): Promise<ProductProofBotV1 | null>;
    createConfirmation(input: {
        readonly account_id: string;
        readonly bot_id: string;
        readonly prompt: string;
        readonly created_at_ms: number;
        readonly expires_at_ms: number;
    }): Promise<ProductProofConfirmationV1>;
    getConfirmation(accountId: string, confirmationId: string): Promise<ProductProofConfirmationV1 | null>;
    claimConfirmation(input: {
        readonly account_id: string;
        readonly confirmation_id: string;
        readonly claimed_at_ms: number;
    }): Promise<ProductProofRunV1 | null>;
    completeRun(input: {
        readonly account_id: string;
        readonly run_id: string;
        readonly result_text: string;
        readonly completed_at_ms: number;
    }): Promise<ProductProofRunV1 | null>;
    getRun(accountId: string, botId: string, runId: string): Promise<ProductProofRunV1 | null>;
}

export interface ProductProofTaskExecutorV1 {
    execute(input: {
        readonly account_id: string;
        readonly user_id: string;
        readonly bot: ProductProofBotV1;
        readonly prompt: string;
        readonly permissions: readonly ProductProofPermissionV1[];
    }): Promise<{ readonly result_text: string }>;
}

export interface ControlPlaneProductProofDependenciesV1 {
    readonly resolveActor: (request: Request) => Promise<ControlPlaneActorV1 | null>;
    readonly repository: ProductProofRepositoryV1;
    readonly taskExecutor: ProductProofTaskExecutorV1;
    readonly now?: (() => number) | undefined;
}

export const PRODUCT_PROOF_PERMISSION_CATALOG_V1: readonly ProductProofPermissionV1[] = Object.freeze([
    Object.freeze({
        policy_id: "policy_support_cases_read_v1",
        display_name: "List support cases",
        tool_key: "support.list_cases",
        effect: "read",
        consequence_summary: "Reads case titles, status, and assigned team.",
        resource_scope_summary: "The selected support account only.",
        enabled: true,
    }),
    Object.freeze({
        policy_id: "policy_support_case_update_v1",
        display_name: "Update support case",
        tool_key: "support.update_case",
        effect: "write",
        consequence_summary: "Changes provider business data.",
        resource_scope_summary: "Unavailable in the read-only release.",
        enabled: false,
    }),
    Object.freeze({
        policy_id: "policy_support_case_delete_v1",
        display_name: "Delete support case",
        tool_key: "support.delete_case",
        effect: "destructive",
        consequence_summary: "Deletes provider business data.",
        resource_scope_summary: "Unavailable in the read-only release.",
        enabled: false,
    }),
]);

const escapeHtml = (value: string): string =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

const safeText = (value: FormDataEntryValue | null, maximumBytes: number, multiline = false): string | null => {
    if (typeof value !== "string" || value.length === 0 || value !== value.trim()) return null;
    if (
        (multiline ? unsafeContentCharacters : unsafeDisplayCharacters).test(value) ||
        new TextEncoder().encode(value).byteLength > maximumBytes
    ) {
        return null;
    }
    return value;
};

const safeId = (value: string): boolean => /^[a-z0-9][a-z0-9_-]{0,127}$/u.test(value);

const permissionById = new Map(
    PRODUCT_PROOF_PERMISSION_CATALOG_V1.map(permission => [permission.policy_id, permission])
);

const selectedPermissions = (bot: ProductProofBotV1): readonly ProductProofPermissionV1[] =>
    bot.permission_policy_ids.flatMap(policyId => {
        const permission = permissionById.get(policyId);
        return permission?.enabled === true ? [permission] : [];
    });

const styles = `
:root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; background: #f6f7f9; color: #18202a; }
* { box-sizing: border-box; }
body { margin: 0; }
a { color: #244f86; }
.shell { min-height: 100vh; display: grid; grid-template-columns: minmax(15rem, 20rem) 1fr; }
.sidebar { padding: 1.25rem; border-right: 1px solid #d8dde4; background: #fff; }
.sidebar-head, .page-head, .actions { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
.brand { color: #18202a; font-weight: 750; text-decoration: none; }
.bot-list { list-style: none; padding: 0; margin: 1.5rem 0; display: grid; gap: .5rem; }
.bot-list a { display: grid; gap: .15rem; padding: .75rem; border-radius: .65rem; text-decoration: none; }
.bot-list a[aria-current='page'] { background: #edf3fb; }
.bot-list small, .muted { color: #5d6875; }
.account { margin-top: 2rem; padding-top: 1rem; border-top: 1px solid #e3e6ea; }
main { padding: 2rem clamp(1rem, 5vw, 4rem); }
.content { max-width: 48rem; margin: 0 auto; }
.card, fieldset { background: #fff; border: 1px solid #d8dde4; border-radius: .8rem; padding: 1.25rem; margin: 1rem 0; }
fieldset { display: grid; gap: .75rem; }
legend { font-weight: 700; padding: 0 .25rem; }
label { display: grid; gap: .35rem; font-weight: 650; }
label.choice { grid-template-columns: auto 1fr; align-items: start; font-weight: 600; }
input[type='text'], textarea, select { width: 100%; font: inherit; padding: .7rem .75rem; border: 1px solid #aab4c0; border-radius: .45rem; background: #fff; }
textarea { min-height: 7rem; resize: vertical; }
button, .button { display: inline-block; border: 0; border-radius: .45rem; padding: .7rem 1rem; background: #244f86; color: #fff; font: inherit; font-weight: 700; text-decoration: none; cursor: pointer; }
.button.secondary { background: #e8edf3; color: #18202a; }
.error-summary { border: 2px solid #a32b2b; background: #fff3f3; padding: 1rem; border-radius: .6rem; }
.permission-meta { display: grid; gap: .2rem; color: #5d6875; font-size: .9rem; }
.status-grid { display: grid; grid-template-columns: max-content 1fr; gap: .5rem 1rem; }
pre.result { white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
@media (max-width: 760px) { .shell { grid-template-columns: 1fr; } .sidebar { border-right: 0; border-bottom: 1px solid #d8dde4; } main { padding: 1.25rem; } }
`;

const document = (input: {
    readonly title: string;
    readonly actor: ControlPlaneActorV1;
    readonly bots: readonly ProductProofBotV1[];
    readonly selectedBotId?: string | undefined;
    readonly body: string;
}): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(input.title)} · OpenBot</title>
<style>${styles}</style>
</head>
<body>
<div class="shell">
<aside class="sidebar" aria-label="Bot navigation">
<div class="sidebar-head"><a class="brand" href="/bots">OpenBot</a><a href="/bots/new">New Bot</a></div>
<ul class="bot-list">${input.bots
    .map(
        bot =>
            `<li><a href="/bots/${encodeURIComponent(bot.bot_id)}"${
                bot.bot_id === input.selectedBotId ? ' aria-current="page"' : ""
            }><span>${escapeHtml(bot.name)}</span><small>${escapeHtml(bot.short_description)}</small></a></li>`
    )
    .join("")}</ul>
<div class="account"><small>Organization owner</small><div>${escapeHtml(input.actor.display_name)}</div></div>
</aside>
<main><div class="content">${input.body}</div></main>
</div>
</body>
</html>`;

const loginDocument = (): string =>
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sign in · OpenBot</title><style>${styles}</style></head><body><main><div class="content"><h1>Sign in</h1><p>Authentication is not configured for this installation.</p></div></main></body></html>`;

const errorSummary = (message: string): string =>
    `<div class="error-summary" role="alert"><h2>Check the form</h2><p>${escapeHtml(message)}</p></div>`;

const permissionChoices = (selectedIds: readonly string[] = []): string =>
    PRODUCT_PROOF_PERMISSION_CATALOG_V1.map(permission => {
        const checked = selectedIds.includes(permission.policy_id) ? " checked" : "";
        const disabled = permission.enabled ? "" : " disabled";
        return `<label class="choice"><input type="checkbox" name="permission" value="${escapeHtml(
            permission.policy_id
        )}"${checked}${disabled}><span>${escapeHtml(permission.display_name)}<span class="permission-meta"><span>${escapeHtml(
            permission.consequence_summary
        )}</span><span>${escapeHtml(permission.resource_scope_summary)}</span><span>Technical details: ${escapeHtml(
            permission.tool_key
        )}</span></span></span></label>`;
    }).join("");

const renderNewBot = async (
    actor: ControlPlaneActorV1,
    repository: ProductProofRepositoryV1,
    error: string | null = null,
    selectedIds: readonly string[] = []
): Promise<string> =>
    document({
        title: "New Bot",
        actor,
        bots: await repository.listBots(actor.account_id),
        body: `<div class="page-head"><div><h1>New Bot</h1><p class="muted">Choose the job and the exact read permissions this Bot may request.</p></div></div>
${error === null ? "" : errorSummary(error)}
<form method="post" action="/actions/bots">
<input type="hidden" name="_csrf" value="${escapeHtml(actor.csrf_token)}">
<fieldset><legend>Identity</legend>
<label for="name">Name<input id="name" name="name" type="text" required maxlength="128" autocomplete="off"></label>
<label for="short-description">Short description<input id="short-description" name="short_description" type="text" required maxlength="512" autocomplete="off"></label>
<label for="palette">Color<select id="palette" name="palette_color_id"><option value="blue">Blue</option><option value="teal">Teal</option><option value="violet">Violet</option></select></label>
</fieldset>
<fieldset><legend>Behavior</legend>
<label for="purpose">Purpose<textarea id="purpose" name="purpose" required></textarea></label>
<label for="instructions">Behavior instructions<textarea id="instructions" name="standing_instructions" required></textarea></label>
</fieldset>
<fieldset><legend>Permissions</legend>${permissionChoices(selectedIds)}</fieldset>
<div class="actions"><a href="/bots">Cancel</a><button type="submit">Create Bot</button></div>
</form>`,
    });

const requireActor = async (
    request: Request,
    dependencies: ControlPlaneProductProofDependenciesV1
): Promise<ControlPlaneActorV1 | null> => {
    try {
        return await dependencies.resolveActor(request);
    } catch {
        return null;
    }
};

const validCsrf = (form: FormData, actor: ControlPlaneActorV1): boolean => form.get("_csrf") === actor.csrf_token;

const validOrigin = (request: Request): boolean => request.headers.get("Origin") === new URL(request.url).origin;

const formPermissionIds = (form: FormData): readonly string[] | null => {
    const ids = form.getAll("permission");
    if (ids.length < 1 || ids.length > 4 || ids.some(value => typeof value !== "string")) return null;
    const strings = ids as string[];
    if (new Set(strings).size !== strings.length) return null;
    return strings.every(id => permissionById.get(id)?.enabled === true) ? Object.freeze([...strings]) : null;
};

const unavailable = (context: { text(value: string, status: 503): Response }): Response =>
    context.text("Product flow unavailable", 503);

export const registerProductProofRoutesV1 = (
    app: Hono<{ Bindings: ControlPlaneBindings }>,
    dependencies: ControlPlaneProductProofDependenciesV1 | undefined
): void => {
    app.get("/login", context => context.html(loginDocument()));

    app.get("/", async context => {
        if (dependencies === undefined) return context.redirect("/login", 302);
        const actor = await requireActor(context.req.raw, dependencies);
        return actor === null ? context.redirect("/login", 302) : context.redirect("/bots", 302);
    });

    app.get("/bots", async context => {
        if (dependencies === undefined) return context.redirect("/login", 302);
        const actor = await requireActor(context.req.raw, dependencies);
        if (actor === null) return context.redirect("/login", 302);
        const bots = await dependencies.repository.listBots(actor.account_id);
        return context.html(
            document({
                title: "Bots",
                actor,
                bots,
                body: `<div class="page-head"><div><h1>Bots</h1><p class="muted">Each task starts a separate run.</p></div><a class="button" href="/bots/new">New Bot</a></div>${
                    bots.length === 0
                        ? '<div class="card"><h2>No Bots yet</h2><p>Create one to choose its purpose and permissions.</p></div>'
                        : '<div class="card"><h2>Your Bots</h2><p>Select a Bot from the list.</p></div>'
                }`,
            })
        );
    });

    app.get("/bots/new", async context => {
        if (dependencies === undefined) return context.redirect("/login", 302);
        const actor = await requireActor(context.req.raw, dependencies);
        return actor === null
            ? context.redirect("/login", 302)
            : context.html(await renderNewBot(actor, dependencies.repository));
    });

    app.post("/actions/bots", async context => {
        if (dependencies === undefined) return unavailable(context);
        const actor = await requireActor(context.req.raw, dependencies);
        if (actor === null) return context.text("Unauthorized", 401);
        if (!validOrigin(context.req.raw)) return context.text("Invalid origin", 403);
        const form = await context.req.formData();
        if (!validCsrf(form, actor)) return context.text("Invalid CSRF token", 403);
        const name = safeText(form.get("name"), MAX_NAME_BYTES);
        const shortDescription = safeText(form.get("short_description"), MAX_DESCRIPTION_BYTES);
        const purpose = safeText(form.get("purpose"), MAX_PURPOSE_BYTES, true);
        const standingInstructions = safeText(form.get("standing_instructions"), MAX_INSTRUCTIONS_BYTES, true);
        const palette = form.get("palette_color_id");
        const permissionIds = formPermissionIds(form);
        if (
            name === null ||
            shortDescription === null ||
            purpose === null ||
            standingInstructions === null ||
            typeof palette !== "string" ||
            !["blue", "teal", "violet"].includes(palette) ||
            permissionIds === null
        ) {
            return context.html(
                await renderNewBot(
                    actor,
                    dependencies.repository,
                    "Enter every field and select at least one available read permission.",
                    permissionIds ?? []
                ),
                422
            );
        }
        const bot = await dependencies.repository.createBot({
            account_id: actor.account_id,
            owner_user_id: actor.user_id,
            name,
            short_description: shortDescription,
            palette_color_id: palette,
            purpose,
            standing_instructions: standingInstructions,
            permission_policy_ids: permissionIds,
            created_at_ms: (dependencies.now ?? Date.now)(),
        });
        return context.redirect(`/bots/${encodeURIComponent(bot.bot_id)}`, 303);
    });

    app.get("/bots/:botId", async context => {
        if (dependencies === undefined) return context.redirect("/login", 302);
        const actor = await requireActor(context.req.raw, dependencies);
        if (actor === null) return context.redirect("/login", 302);
        const botId = context.req.param("botId");
        if (!safeId(botId)) return context.notFound();
        const [bot, bots] = await Promise.all([
            dependencies.repository.getBot(actor.account_id, botId),
            dependencies.repository.listBots(actor.account_id),
        ]);
        if (bot === null) return context.notFound();
        const permissions = selectedPermissions(bot);
        return context.html(
            document({
                title: bot.name,
                actor,
                bots,
                selectedBotId: bot.bot_id,
                body: `<div class="page-head"><div><h1>${escapeHtml(bot.name)}</h1><p>${escapeHtml(
                    bot.short_description
                )}</p></div><a href="/bots/${encodeURIComponent(bot.bot_id)}/access">Access</a></div>
<section class="card" aria-labelledby="permissions-heading"><h2 id="permissions-heading">Selected permissions</h2><ul>${permissions
                    .map(
                        permission =>
                            `<li>${escapeHtml(permission.display_name)} · ${escapeHtml(permission.effect)}</li>`
                    )
                    .join("")}</ul></section>
<section class="card" aria-labelledby="task-heading"><h2 id="task-heading">Start a task</h2><p>Each task is independent. Review its disclosure before starting the run.</p>
<form method="post" action="/actions/run-confirmations"><input type="hidden" name="_csrf" value="${escapeHtml(
                    actor.csrf_token
                )}"><input type="hidden" name="bot_id" value="${escapeHtml(bot.bot_id)}"><label for="prompt">Task<textarea id="prompt" name="prompt" required></textarea></label><div class="actions"><span></span><button type="submit">Review task</button></div></form></section>`,
            })
        );
    });

    app.post("/actions/run-confirmations", async context => {
        if (dependencies === undefined) return unavailable(context);
        const actor = await requireActor(context.req.raw, dependencies);
        if (actor === null) return context.text("Unauthorized", 401);
        if (!validOrigin(context.req.raw)) return context.text("Invalid origin", 403);
        const form = await context.req.formData();
        if (!validCsrf(form, actor)) return context.text("Invalid CSRF token", 403);
        const botId = form.get("bot_id");
        const prompt = safeText(form.get("prompt"), MAX_PROMPT_BYTES, true);
        if (typeof botId !== "string" || !safeId(botId) || prompt === null) {
            return context.text("Invalid task", 422);
        }
        const bot = await dependencies.repository.getBot(actor.account_id, botId);
        if (bot === null || selectedPermissions(bot).length === 0) return context.text("Bot unavailable", 409);
        const now = (dependencies.now ?? Date.now)();
        const confirmation = await dependencies.repository.createConfirmation({
            account_id: actor.account_id,
            bot_id: bot.bot_id,
            prompt,
            created_at_ms: now,
            expires_at_ms: now + CONFIRMATION_LIFETIME_MS,
        });
        return context.redirect(`/run-confirmations/${encodeURIComponent(confirmation.confirmation_id)}`, 303);
    });

    app.get("/run-confirmations/:confirmationId", async context => {
        if (dependencies === undefined) return context.redirect("/login", 302);
        const actor = await requireActor(context.req.raw, dependencies);
        if (actor === null) return context.redirect("/login", 302);
        const confirmationId = context.req.param("confirmationId");
        if (!safeId(confirmationId)) return context.notFound();
        const confirmation = await dependencies.repository.getConfirmation(actor.account_id, confirmationId);
        if (confirmation === null) return context.notFound();
        const [bot, bots] = await Promise.all([
            dependencies.repository.getBot(actor.account_id, confirmation.bot_id),
            dependencies.repository.listBots(actor.account_id),
        ]);
        if (bot === null) return context.notFound();
        const permissions = selectedPermissions(bot);
        const expired = confirmation.expires_at_ms <= (dependencies.now ?? Date.now)();
        const available = confirmation.state === "pending" && !expired;
        return context.html(
            document({
                title: "Review task",
                actor,
                bots,
                selectedBotId: bot.bot_id,
                body: `<h1>Review task</h1><div class="card"><h2>Prompt</h2><p>${escapeHtml(
                    confirmation.prompt
                )}</p><h2>This run may disclose</h2><dl>${permissions
                    .map(
                        permission =>
                            `<dt>Tool</dt><dd>${escapeHtml(permission.display_name)}</dd><dt>Data</dt><dd>${escapeHtml(
                                permission.consequence_summary
                            )}</dd><dt>To</dt><dd>Reviewed connector and selected model provider</dd>`
                    )
                    .join(
                        ""
                    )}</dl><p>Model-selected arguments and returned records do not exist yet and cannot be previewed.</p></div>${
                    !available
                        ? `<div class="error-summary" role="alert"><h2>Confirmation unavailable</h2><p>${
                              expired ? "This confirmation expired." : "This confirmation already started a run."
                          }</p></div>`
                        : `<form method="post" action="/actions/runs"><input type="hidden" name="_csrf" value="${escapeHtml(
                              actor.csrf_token
                          )}"><input type="hidden" name="confirmation_id" value="${escapeHtml(
                              confirmation.confirmation_id
                          )}"><div class="actions"><a href="/bots/${encodeURIComponent(
                              bot.bot_id
                          )}">Back</a><button type="submit">Start run</button></div></form>`
                }`,
            })
        );
    });

    app.post("/actions/runs", async context => {
        if (dependencies === undefined) return unavailable(context);
        const actor = await requireActor(context.req.raw, dependencies);
        if (actor === null) return context.text("Unauthorized", 401);
        if (!validOrigin(context.req.raw)) return context.text("Invalid origin", 403);
        const form = await context.req.formData();
        if (!validCsrf(form, actor)) return context.text("Invalid CSRF token", 403);
        const confirmationId = form.get("confirmation_id");
        if (typeof confirmationId !== "string" || !safeId(confirmationId)) return context.text("Invalid run", 422);
        const now = (dependencies.now ?? Date.now)();
        const confirmation = await dependencies.repository.getConfirmation(actor.account_id, confirmationId);
        if (confirmation === null || confirmation.state !== "pending" || confirmation.expires_at_ms <= now) {
            return context.text("Confirmation unavailable", 409);
        }
        const bot = await dependencies.repository.getBot(actor.account_id, confirmation.bot_id);
        if (bot === null) return context.text("Bot unavailable", 409);
        const permissions = selectedPermissions(bot);
        const run = await dependencies.repository.claimConfirmation({
            account_id: actor.account_id,
            confirmation_id: confirmation.confirmation_id,
            claimed_at_ms: now,
        });
        if (run === null) return context.text("Run conflict", 409);
        const execution = await dependencies.taskExecutor.execute({
            account_id: actor.account_id,
            user_id: actor.user_id,
            bot,
            prompt: confirmation.prompt,
            permissions,
        });
        const resultText = safeText(execution.result_text, 128 * 1024, true);
        if (resultText === null) return context.text("Task result unavailable", 502);
        const completedRun = await dependencies.repository.completeRun({
            account_id: actor.account_id,
            run_id: run.run_id,
            result_text: resultText,
            completed_at_ms: (dependencies.now ?? Date.now)(),
        });
        if (completedRun === null) return context.text("Run conflict", 409);
        return context.redirect(
            `/bots/${encodeURIComponent(completedRun.bot_id)}/runs/${encodeURIComponent(completedRun.run_id)}`,
            303
        );
    });

    app.get("/bots/:botId/runs/:runId", async context => {
        if (dependencies === undefined) return context.redirect("/login", 302);
        const actor = await requireActor(context.req.raw, dependencies);
        if (actor === null) return context.redirect("/login", 302);
        const botId = context.req.param("botId");
        const runId = context.req.param("runId");
        if (!safeId(botId) || !safeId(runId)) return context.notFound();
        const [bot, run, bots] = await Promise.all([
            dependencies.repository.getBot(actor.account_id, botId),
            dependencies.repository.getRun(actor.account_id, botId, runId),
            dependencies.repository.listBots(actor.account_id),
        ]);
        if (bot === null || run === null) return context.notFound();
        const completed = run.execution_state === "completed" && run.result_text !== null;
        return context.html(
            document({
                title: "Task result",
                actor,
                bots,
                selectedBotId: bot.bot_id,
                body: `<div class="page-head"><div><h1>Task result</h1><p>${escapeHtml(bot.name)}</p></div><a href="/bots/${encodeURIComponent(
                    bot.bot_id
                )}">New task</a></div><section class="card"><h2>Prompt</h2><p>${escapeHtml(run.prompt)}</p></section>${
                    completed
                        ? `<section class="card"><h2>Result</h2><pre class="result">${escapeHtml(run.result_text ?? "")}</pre></section>`
                        : '<section class="card"><h2>Result</h2><p>The task is still running.</p></section>'
                }<section class="card"><h2>Status</h2><dl class="status-grid"><dt>Execution</dt><dd>${
                    completed ? "Completed" : "Running"
                }</dd><dt>Cleanup</dt><dd>Not required</dd><dt>Evidence</dt><dd>Synthetic test only</dd></dl></section>`,
            })
        );
    });
};
