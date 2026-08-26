import { readFile } from "node:fs/promises";

const paths = Object.freeze({
    app: "apps/control-plane/src/app.ts",
    product: "apps/control-plane/src/product-proof.ts",
    spec: "tests/e2e/product-flow.spec.ts",
    server: "tests/e2e/server.ts",
    config: "playwright.config.ts",
    fixture: "docs/fixtures/product-flow-e2e.json",
    manifest: "package.json",
});

const files = Object.fromEntries(
    await Promise.all(Object.entries(paths).map(async ([key, path]) => [key, await readFile(path, "utf8")]))
);

const fixture = JSON.parse(files.fixture);
const manifest = JSON.parse(files.manifest);

const checkSources = input => {
    const errors = [];
    const requireAll = (source, markers, message) => {
        if (markers.some(marker => !source.includes(marker))) errors.push(message);
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
            'app.get("/bots/:botId/runs/:runId"',
            "validOrigin(context.req.raw)",
            "validCsrf(form, actor)",
            "permissionById.get(id)?.enabled === true",
            "dependencies.repository.claimConfirmation",
            "dependencies.taskExecutor.execute",
            "dependencies.repository.completeRun",
            'escapeHtml(run.result_text ?? "")',
        ],
        "the product flow must keep its forms, CSRF, permission, execution, and result boundaries"
    );
    if (input.product.includes("<script") || /dangerouslySetInnerHTML|innerHTML\s*=/u.test(input.product)) {
        errors.push("the server-rendered proof may not add an executable browser shortcut");
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
            'selected[0] !== "support.list_cases"',
            'server.listen(port, "127.0.0.1")',
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
            'getByRole("checkbox", { name: /List support cases/u }).check()',
            'getByRole("button", { name: "Create Bot" }).click()',
            'getByRole("button", { name: "Review task" }).click()',
            'getByRole("button", { name: "Start run" }).click()',
            'page.locator("pre.result")',
            'page.locator("pre.result strong")',
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
    requireAll(
        input.config,
        [
            'testDir: "./tests/e2e"',
            "fullyParallel: false",
            "workers: 1",
            'command: "node --import tsx tests/e2e/server.ts"',
            "reuseExistingServer: false",
            'trace: "retain-on-failure"',
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
    "select_reviewed_read_permission",
    "create_bot",
    "submit_task_for_review",
    "review_disclosure",
    "start_run",
    "read_plain_text_result",
];
if (
    fixture.schema_version !== 1 ||
    fixture.kind !== "openbot_product_flow_browser_proof" ||
    fixture.status !== "local_synthetic_result_only" ||
    fixture.entrypoint !== "createControlPlane" ||
    fixture.browser_driver !== "playwright" ||
    JSON.stringify(fixture.browser_steps) !== JSON.stringify(expectedSteps) ||
    Object.values(fixture.production_code_exercised ?? {}).some(value => value !== true) ||
    Object.values(fixture.browser_shortcuts ?? {}).some(value => value !== false) ||
    Object.values(fixture.authority ?? {}).some(value => value !== false)
) {
    console.error("the product-flow browser fixture drifted");
    process.exitCode = 1;
}

if (process.exitCode === undefined) console.log("real-app browser E2E boundary passed");
