import { chromium, defineConfig } from "@playwright/test";

const port = Number.parseInt(process.env["OPENBOT_APP_E2E_PORT"] ?? "4173", 10);
const executablePath = process.env["OPENBOT_E2E_CHROME_PATH"] ?? chromium.executablePath();

export default defineConfig({
    testDir: "./tests/e2e",
    outputDir: "./test-results/app-e2e",
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 30_000,
    expect: { timeout: 5_000 },
    reporter: [["line"], ["html", { outputFolder: "playwright-report", open: "never" }]],
    use: {
        baseURL: `http://127.0.0.1:${port}`,
        headless: true,
        viewport: { width: 1440, height: 900 },
        trace: "retain-on-failure",
        screenshot: "on",
        video: "on",
        launchOptions: { executablePath },
    },
    webServer: {
        command: "corepack pnpm --filter @openbot/control-plane build:client && node --import tsx tests/e2e/server.ts",
        url: `http://127.0.0.1:${port}/login`,
        reuseExistingServer: false,
        timeout: 30_000,
    },
});
