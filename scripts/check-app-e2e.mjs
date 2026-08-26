import { readFile } from "node:fs/promises";

const paths = Object.freeze({
    app: "apps/control-plane/src/app.ts",
    product: "apps/control-plane/src/product-proof.ts",
    client: "apps/control-plane/client/main.tsx",
    clientTypes: "apps/control-plane/src/product-client-page.ts",
    viteConfig: "apps/control-plane/vite.config.ts",
    productTest: "apps/control-plane/src/product-proof.test.ts",
    spec: "tests/e2e/product-flow.spec.ts",
    server: "tests/e2e/server.ts",
    config: "playwright.config.ts",
    fixture: "docs/fixtures/product-flow-e2e.json",
    manifest: "package.json",
    controlManifest: "apps/control-plane/package.json",
    metorialCatalogGenerator: "scripts/generate-metorial-provider-catalog.mjs",
});

const files = Object.fromEntries(
    await Promise.all(Object.entries(paths).map(async ([key, path]) => [key, await readFile(path, "utf8")]))
);

const fixture = JSON.parse(files.fixture);
const manifest = JSON.parse(files.manifest);
const controlManifest = JSON.parse(files.controlManifest);

const checkSources = input => {
    const errors = [];
    const requireAll = (source, markers, message) => {
        if (markers.some(marker => !source.includes(marker))) errors.push(message);
    };
    const requirePattern = (source, pattern, message) => {
        if (!pattern.test(source)) errors.push(message);
    };

    requireAll(
        input.app,
        [
            "registerProductProofRoutesV1(app, productProofDependencies)",
            "Content-Security-Policy",
            'Referrer-Policy", "same-origin',
            "X-Frame-Options",
        ],
        "the browser proof must enter through the production control-plane app"
    );
    requireAll(
        input.product,
        [
            'app.get("/bots/new"',
            'app.post("/actions/bots"',
            'app.post("/actions/run-confirmations"',
            'app.get("/run-confirmations/:confirmationId"',
            'app.post("/actions/runs"',
            'app.post("/actions/routine-proposals"',
            'app.get("/routine-proposals/:proposalId"',
            'app.post("/actions/routines"',
            'app.get("/bots/:botId/routines/:routineId"',
            'app.post("/actions/routines/:routineId"',
            'app.get("/organization/settings"',
            'app.post("/actions/organization-permissions"',
            'app.get("/bots/:botId/runs/:runId"',
            "validOrigin(context.req.raw)",
            "validCsrf(form, actor)",
            "formIntegrationSelections(form, integrations)",
            "dependencies.listMetorialIntegrations(actor.account_id, actor.user_id)",
            "selectedIntegrationBindings(bot, integrations)",
            "compileMetorialSessionIntent(dependencies, bindings)",
            'intent_version: "openbot_metorial_session_intent_v1" as const',
            "dependencies.metorial_api_version",
            "dependencies.metorial_session_serialization_identity",
            "validMetorialAuthBinding",
            "permission_pins",
            "provider_version_id",
            "provider_specification_id",
            "metorial_authority_snapshot",
            'actor.role !== "owner"',
            "sameMetorialSessionIntent(snapshot.metorial_session_intent, metorialSessionIntent)",
            'integration.connection_state !== "connected"',
            "dependencies.repository.claimConfirmation",
            "dependencies.taskExecutor.execute",
            "dependencies.repository.completeRun",
            "serializeClientPage",
            '.replaceAll("<", "\\\\u003c")',
            'page_version: "openbot_react_page_v1" as const',
            "view: input.view",
            "safeIntegrationIconDataUri",
            "clientBotDetail(",
            "--canvas: #222221",
            "--signature: #d95f91",
            'from "@dicebear/styles/moods.json"',
            'animationVariant: input.animated ? "slowest" : "none"',
            "BOT_COLOR_CATALOG_V1",
            "BOT_SHAPE_CATALOG_V1",
            "BOT_FACE_CATALOG_V1",
        ],
        "the product flow must keep its forms, CSRF, permission, execution, and result boundaries"
    );
    requireAll(
        input.product,
        ["--font-sans:", "--font-mono:", "font-synthesis: none"],
        "the product proof must keep its explicit system-font families and disable synthesized faces"
    );
    requirePattern(
        input.product,
        /body\s*\{[^}]*font-size:\s*15px;[^}]*font-weight:\s*400;[^}]*line-height:\s*1\.5;/u,
        "the product proof must keep its explicit 15px regular-weight body typography"
    );
    requirePattern(
        input.product,
        /input\[type='text'\],\s*input\[type='search'\],\s*textarea,\s*select\s*\{[^}]*font:\s*400\s+15px\/1\.5\s+var\(--font-sans\);/u,
        "text inputs must reset inherited label weight with explicit regular typography"
    );
    requirePattern(
        input.product,
        /button,\s*\.button\s*\{[^}]*font:\s*600\s+14px\/1\s+var\(--font-sans\);/u,
        "buttons must keep their explicit compact system-font typography"
    );
    requirePattern(
        input.product,
        /\.message-copy\s*\{[^}]*font-size:\s*1rem;[^}]*line-height:\s*1\.6;[^}]*font-weight:\s*400;/u,
        "chat messages must keep their explicit 16px regular-weight reading typography"
    );
    requireAll(
        input.client,
        [
            'from "react-dom/client"',
            "createRoot(root).render",
            'case "bots"',
            'case "new_bot"',
            'case "bot_chat"',
            'case "confirmation"',
            'case "routine_proposal"',
            'case "routine_edit"',
            'case "run_result"',
            'action="/actions/bots"',
            'action="/actions/run-confirmations"',
            'action="/actions/runs"',
            'formAction="/actions/routine-proposals"',
            'action="/actions/routines"',
            'action="/actions/organization-permissions"',
            'className="chat-composer"',
            'aria-label="Selected permissions"',
            'aria-label="Routines"',
            "page.view.bot",
            "page.view.integrations",
            "const defaultPermissionIds",
            ": defaultPermissionIds(integration),",
            'name="integration"',
            "Available apps",
            "Added to this Bot",
            "Configure ${integration.display_name}",
            "Choose the exact Metorial tools this Bot can use.",
        ],
        "React must render every authenticated product page and submit only to app-owned Hono actions"
    );
    requireAll(
        input.clientTypes,
        [
            'page_version: "openbot_react_page_v1"',
            'readonly kind: "new_bot"',
            'readonly kind: "bot_chat"',
            'readonly kind: "confirmation"',
            'readonly kind: "routine_proposal"',
            'readonly kind: "routine_edit"',
            'readonly kind: "run_result"',
            "OpenBotClientPermissionV1",
            "OpenBotClientIntegrationV1",
        ],
        "the Hono-to-React page contract must stay explicit and versioned"
    );
    requireAll(
        input.viteConfig,
        ['fileName: () => "openbot-client.js"', 'outDir: "../../.build/client/control-plane"'],
        "Vite must produce the fixed same-origin client asset expected by the Worker"
    );
    if (/dangerouslySetInnerHTML|innerHTML\s*=/u.test(`${input.product}\n${input.client}`)) {
        errors.push("the React product proof may not inject server-authored HTML");
    }
    if (
        /connection_grant_id|provider_deployment_id|provider_specification_id|magic_link_token|session_token/u.test(
            input.clientTypes
        )
    ) {
        errors.push(
            "the browser page contract may not contain provider credentials, deployment authority, or auth tokens"
        );
    }
    if (
        input.product.indexOf("dependencies.repository.claimConfirmation") >
        input.product.indexOf("dependencies.taskExecutor.execute")
    ) {
        errors.push("the confirmation must be claimed before task execution");
    }
    requireAll(
        input.server,
        [
            "createControlPlane({",
            'account_id: "account_e2e_owner"',
            "repository: createMemoryRepository()",
            "taskExecutor:",
            "listMetorialIntegrations:",
            'metorial_api_version: "2025-01-01"',
            'metorial_session_serialization_identity: "openbot-e2e-serializer@1"',
            'provider_deployment_id: "pdp_linear_e2e"',
            'provider_deployment_id: "pdp_slack_e2e"',
            'provider_version_id: "pver_linear_e2e"',
            'provider_version_id: "pver_slack_e2e"',
            'provider_specification_id: "pspec_linear_e2e"',
            'provider_specification_id: "pspec_slack_e2e"',
            'auth: { mode: "user_grant", connection_grant_id: "grant_linear_e2e_primary" }',
            'auth: { mode: "user_grant", connection_grant_id: "grant_slack_e2e_primary" }',
            'allowed_tool_keys: ["list_issues"]',
            'allowed_tool_keys: ["list_channels"]',
            "JSON.stringify(input.metorial_session_intent)",
            "JSON.stringify(actualPermissionPins)",
            "input.account_id !== actor.account_id",
            "input.user_id !== actor.user_id",
            'input.run_id !== "run_e2e_0001"',
            "input.prompt !== expectedPrompt",
            'server.listen(port, "127.0.0.1")',
            "currentOrganizationIntegrations",
            "setOrganizationPermissionEnabled",
            "createRoutineProposal",
            "saveRoutineProposal",
            "updateRoutine",
        ],
        "the local server must run the real app with bounded deterministic dependencies"
    );
    if (/https:\/\/(?!internal\.invalid)|(?<!\.)\bfetch\s*\(/u.test(input.server)) {
        errors.push("the local browser server may not make remote requests");
    }
    requireAll(
        input.spec,
        [
            'page.goto("/")',
            'getByRole("link", { name: "New Bot" })',
            'getByRole("button", { name: "Add Linear" }).click()',
            'getByRole("checkbox", { name: /List issues/u })).toBeChecked()',
            'getByRole("button", { name: "Add Slack" }).click()',
            'getByRole("checkbox", { name: /List channels/u })).toBeChecked()',
            'getByRole("region", { name: "Added to this Bot" })',
            'getByRole("button", { name: "Configure Linear" }).click()',
            'getByRole("radio", { name: "Sky", exact: true }).check()',
            'getByRole("radio", { name: "Hexagon", exact: true }).check()',
            'getByRole("radio", { name: "Cheerful", exact: true }).check()',
            'getByRole("button", { name: "Create Bot" }).click()',
            'getByRole("button", { name: "Review task" }).click()',
            'getByRole("button", { name: "Start run" }).click()',
            'page.locator("pre.result")',
            'getByRole("button", { name: "Review routine" }).click()',
            'getByRole("button", { name: "Save routine" }).click()',
            'getByRole("button", { name: "Save changes" }).click()',
            'getByRole("button", { name: "Enable Create issue" }).click()',
            'reviewCard.getByText("Slack", { exact: true })',
            'reviewCard.getByText("list_channels", { exact: true })',
            "await rm(walkthroughDirectory, { recursive: true, force: true })",
            "test.afterEach",
            'resolve(walkthroughDirectory, "failure.png")',
            "if (!page.isClosed()) await page.close()",
            "page.screenshot({ path, fullPage: true",
            "video.saveAs(videoPath)",
        ],
        "the Playwright test must drive every required user-visible step"
    );
    if (
        /page\.(?:setContent|route|evaluate)|route\.fulfill|request\.(?:get|post|put|patch|delete)|waitForTimeout|test\.(?:only|skip)/u.test(
            input.spec
        )
    ) {
        errors.push("the Playwright proof may not bypass the rendered user flow");
    }
    if (/provider_auth_config_id|pac_(?:linear|slack)_e2e_private/u.test(`${input.server}\n${input.spec}`)) {
        errors.push("raw Metorial auth-config IDs may not enter the server or browser proof");
    }
    if (input.spec.indexOf("await page.close()") > input.spec.indexOf("video.saveAs(videoPath)")) {
        errors.push("the browser page must close before its stable video is saved");
    }
    requireAll(
        input.productTest,
        [
            'it("renders task results as escaped plain text"',
            'expect(html).toContain("\\\\u003cstrong>This stays plain text.\\\\u003c/strong>")',
            'expect(html).not.toContain("<strong>This stays plain text.</strong>")',
            'it("does not create a confirmation when Metorial serialization identity is missing"',
            'metorial_session_serialization_identity: ""',
            'expect(await response.text()).toBe("Metorial configuration unavailable")',
            "expect(createConfirmation).not.toHaveBeenCalled()",
            'it.each(["deployment", "authless"] as const)',
            "expect(createBot.mock.calls[0]?.[0].integrations[0]?.auth).toEqual({ mode })",
        ],
        "plain-text escaping and invalid Metorial serialization configuration must remain covered outside the polished walkthrough"
    );
    requireAll(
        input.config,
        [
            'testDir: "./tests/e2e"',
            'outputDir: "./test-results/app-e2e"',
            "fullyParallel: false",
            "workers: 1",
            'command: "corepack pnpm --filter @openbot/control-plane build:client && node --import tsx tests/e2e/server.ts"',
            "reuseExistingServer: false",
            'trace: "retain-on-failure"',
            'screenshot: "on"',
            'video: "on"',
            'outputFolder: "playwright-report"',
            "chromium.executablePath()",
            "launchOptions: { executablePath }",
        ],
        "the Playwright configuration must run one isolated local app server"
    );
    if (
        input.manifest.scripts?.["test:app:e2e"] !== "playwright test --config playwright.config.ts" ||
        !input.manifest.scripts?.["verify:integration"]?.includes("corepack pnpm test:app:e2e") ||
        input.manifest.devDependencies?.["@playwright/test"] !== "catalog:" ||
        input.manifest.devDependencies?.tsx !== "catalog:"
    ) {
        errors.push("the root manifest must pin and verify the app browser proof");
    }
    requireAll(
        input.metorialCatalogGenerator,
        [
            'METORIAL_BASE_URL = "https://api.metorial.com"',
            'METORIAL_API_VERSION = "2026-01-01-magnetar"',
            '"@metorial/core"',
            "createMetorialCoreSDK({",
            "metorial.providers.list(query)",
            "metorial.providers.tools.list",
            "metorial-provider-catalog.json",
            'THESVG_REPOSITORY = "GLINCKER/thesvg"',
            "THESVG_REVISION",
            "safeSvg",
            "effect_tags:",
            "input_schema_sha256",
            "output_schema_sha256",
        ],
        "the dev-time Metorial SDK catalog generator must pin official provider, tool, effect-tag, and local icon metadata"
    );
    if (
        controlManifest.dependencies?.["@dicebear/core"] !== "catalog:" ||
        controlManifest.dependencies?.["@dicebear/styles"] !== "catalog:"
    ) {
        errors.push("the control plane must pin the local DiceBear renderer and style definition");
    }
    return errors;
};

const positiveErrors = checkSources({ ...files, manifest });
if (positiveErrors.length > 0) {
    console.error(positiveErrors.join("\n"));
    process.exitCode = 1;
} else {
    const weakeningCases = [
        {
            name: "missing browser entry",
            value: { ...files, manifest, spec: files.spec.replace('page.goto("/")', 'page.goto("/login")') },
        },
        {
            name: "browser route bypass",
            value: { ...files, manifest, spec: `${files.spec}\npage.setContent("<h1>fake</h1>");` },
        },
        {
            name: "React HTML injection bridge",
            value: { ...files, manifest, client: `${files.client}\nconst bypass = { dangerouslySetInnerHTML: {} };` },
        },
        {
            name: "provider authority in browser contract",
            value: {
                ...files,
                manifest,
                clientTypes: `${files.clientTypes}\ninterface LeakedAuthority { connection_grant_id: string }`,
            },
        },
        {
            name: "unversioned React page contract",
            value: {
                ...files,
                manifest,
                clientTypes: files.clientTypes.replaceAll("openbot_react_page_v1", "unversioned_page"),
            },
        },
        {
            name: "fake app server",
            value: { ...files, manifest, server: files.server.replace("createControlPlane({", "createFakeSite({") },
        },
        {
            name: "missing same-origin check",
            value: { ...files, manifest, product: files.product.replaceAll("validOrigin(context.req.raw)", "true") },
        },
        {
            name: "missing CSRF check",
            value: { ...files, manifest, product: files.product.replaceAll("validCsrf(form, actor)", "true") },
        },
        {
            name: "execution before confirmation claim",
            value: {
                ...files,
                manifest,
                product: files.product.replace(
                    "dependencies.repository.claimConfirmation",
                    "dependencies.repository.zClaimConfirmation"
                ),
            },
        },
        {
            name: "unversioned Metorial session intent",
            value: {
                ...files,
                manifest,
                product: files.product.replace(
                    'intent_version: "openbot_metorial_session_intent_v1" as const',
                    'intent_version: "unversioned" as const'
                ),
            },
        },
        {
            name: "inherited form typography",
            value: {
                ...files,
                manifest,
                product: files.product.replace("font: 400 15px/1.5 var(--font-sans);", "font: inherit;"),
            },
        },
        {
            name: "missing app picker defaults",
            value: {
                ...files,
                manifest,
                client: files.client.replace("defaultPermissionIds(integration)", "[]"),
            },
        },
        {
            name: "compressed chat typography",
            value: {
                ...files,
                manifest,
                product: files.product.replace(
                    "font-size: 1rem; line-height: 1.6; font-weight: 400;",
                    "font-size: .875rem; line-height: 1.3; font-weight: 400;"
                ),
            },
        },
        {
            name: "missing Metorial serializer identity",
            value: {
                ...files,
                manifest,
                product: files.product.replaceAll(
                    "dependencies.metorial_session_serialization_identity",
                    '"unconfigured-serializer"'
                ),
            },
        },
        {
            name: "missing stale media cleanup",
            value: {
                ...files,
                manifest,
                spec: files.spec.replace("await rm(walkthroughDirectory, { recursive: true, force: true })", ""),
            },
        },
        {
            name: "missing failure capture",
            value: {
                ...files,
                manifest,
                spec: files.spec.replace(
                    'resolve(walkthroughDirectory, "failure.png")',
                    'resolve(walkthroughDirectory, "ignored.png")'
                ),
            },
        },
        {
            name: "unregistered command",
            value: {
                ...files,
                manifest: { ...manifest, scripts: { ...manifest.scripts, "test:app:e2e": "echo disabled" } },
            },
        },
    ];
    for (const test of weakeningCases) {
        if (checkSources(test.value).length === 0) {
            console.error(`app E2E checker self-test accepted ${test.name}`);
            process.exitCode = 1;
        }
    }
}

const expectedSteps = [
    "open_openbot",
    "open_new_bot",
    "enter_bot_identity_and_behavior",
    "choose_metorial_integrations",
    "choose_passthrough_tool_permissions",
    "create_bot",
    "open_bot_chat",
    "submit_task_for_review",
    "review_disclosure",
    "start_run",
    "read_plain_text_result",
    "propose_routine_in_chat",
    "review_and_save_routine",
    "edit_routine_in_sidebar",
    "change_organization_permission_ceiling",
];
if (
    fixture.schema_version !== 1 ||
    fixture.kind !== "openbot_product_flow_browser_proof" ||
    fixture.status !== "local_synthetic_result_only" ||
    fixture.entrypoint !== "createControlPlane" ||
    fixture.browser_driver !== "playwright" ||
    fixture.captured_media?.full_page_screenshots !== 9 ||
    fixture.captured_media?.walkthrough_video !== true ||
    fixture.captured_media?.html_report !== true ||
    fixture.captured_media?.stale_media_cleanup !== true ||
    fixture.captured_media?.failure_capture !== true ||
    fixture.captured_media?.output_directory !== "test-results/app-e2e/walkthrough" ||
    fixture.captured_media?.html_report_path !== "playwright-report/index.html" ||
    JSON.stringify(fixture.browser_steps) !== JSON.stringify(expectedSteps) ||
    Object.values(fixture.production_code_exercised ?? {}).some(value => value !== true) ||
    Object.values(fixture.browser_shortcuts ?? {}).some(value => value !== false) ||
    Object.values(fixture.authority ?? {}).some(value => value !== false)
) {
    console.error("the product-flow browser fixture drifted");
    process.exitCode = 1;
}

if (process.exitCode === undefined) console.log("real-app browser E2E boundary passed");
