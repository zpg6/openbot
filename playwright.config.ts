import { existsSync } from "node:fs";

import { defineConfig } from "@playwright/test";

const port = Number.parseInt(process.env["OPENBOT_APP_E2E_PORT"] ?? "4173", 10);
const macChromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const executablePath =
    process.env["OPENBOT_E2E_CHROME_PATH"] ??
    (process.platform === "darwin" && existsSync(macChromePath) ? macChromePath : undefined);

export default defineConfig({
    testDir: "./tests/e2e",
    fullyParallel: false,
    workers: 1,
    retries: 0,
    timeout: 30_000,
    expect: { timeout: 5_000 },
    reporter: [["line"]],
    use: {
        baseURL: `http://127.0.0.1:${port}`,
        headless: true,
        viewport: { width: 1440, height: 900 },
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "off",
        ...(executablePath === undefined ? {} : { launchOptions: { executablePath } }),
    },
    webServer: {
        command: "node --import tsx tests/e2e/server.ts",
        url: `http://127.0.0.1:${port}/login`,
        reuseExistingServer: false,
        timeout: 30_000,
    },
});
