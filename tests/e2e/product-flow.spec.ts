import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

const walkthroughDirectory = resolve(process.cwd(), "test-results/app-e2e/walkthrough");

test.beforeEach(async () => {
    await rm(walkthroughDirectory, { recursive: true, force: true });
    await mkdir(walkthroughDirectory, { recursive: true });
});

test.afterEach(async ({ page }, testInfo) => {
    const video = page.video();
    if (testInfo.status !== testInfo.expectedStatus && !page.isClosed()) {
        const failurePath = resolve(walkthroughDirectory, "failure.png");
        await page.screenshot({ path: failurePath, fullPage: true, animations: "disabled" });
        await testInfo.attach("Failure screenshot", { path: failurePath, contentType: "image/png" });
    }
    if (!page.isClosed()) await page.close();
    if (video !== null) {
        const videoPath = resolve(walkthroughDirectory, "openbot-product-flow.webm");
        await video.saveAs(videoPath);
        await testInfo.attach("Product flow video", { path: videoPath, contentType: "video/webm" });
    }
});

test("an owner creates a Bot, selects permission, runs a task, and reads the result", async ({ page }, testInfo) => {
    test.setTimeout(90_000);
    const capture = async (filename: string, title: string): Promise<void> => {
        const path = resolve(walkthroughDirectory, filename);
        await page.locator("main h1").first().scrollIntoViewIfNeeded();
        await page.screenshot({ path, fullPage: true, animations: "disabled" });
        await testInfo.attach(title, { path, contentType: "image/png" });
    };

    const opened = await page.goto("/");
    expect(opened?.headers()["content-security-policy"]).toContain("default-src 'none'");
    await expect(page).toHaveURL(/\/bots$/u);
    await expect(page.getByRole("heading", { name: "Create your first bot", exact: true })).toBeVisible();
    await capture("01-bots.png", "01 Empty workspace");

    await page.getByRole("link", { name: "New bot" }).first().click();
    await expect(page.getByRole("heading", { name: "New bot" })).toBeVisible();

    await page.getByLabel("Name", { exact: true }).fill("Support reader");
    await page.getByLabel("Short description").fill("Summarizes open support cases.");
    await page.getByLabel("Purpose").fill("Review open support cases for the selected account.");
    await page.getByLabel("Behavior instructions").fill("Name case IDs and do not guess missing status.");
    await page.getByRole("button", { name: "Continue to appearance" }).click();
    await page.getByRole("radio", { name: "Sky", exact: true }).check();
    await page.getByRole("radio", { name: "Hexagon", exact: true }).check();
    await page.getByRole("radio", { name: "Cheerful", exact: true }).check();
    await page.getByRole("button", { name: "Continue to apps" }).click();
    await expect(page.getByRole("heading", { name: "Popular apps" })).toBeVisible();
    const appSearch = page.getByLabel("Find an app");
    await appSearch.fill("1password");
    await expect(page.getByRole("button", { name: "Connect 1 Password" })).toBeVisible();
    await appSearch.fill("");
    await expect(page.getByRole("button", { name: "Add Linear" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add Slack" })).toBeVisible();
    await page.getByRole("button", { name: "Add Linear" }).click();
    await page.getByRole("button", { name: "Add Slack" }).click();
    const addedApps = page.getByRole("region", { name: "Added to this Bot" });
    await expect(addedApps.getByRole("button", { name: "Configure Linear" })).toBeVisible();
    await expect(addedApps.getByRole("button", { name: "Configure Slack" })).toBeVisible();
    await expect(page.getByRole("checkbox")).toHaveCount(0);
    await addedApps.getByRole("button", { name: "Configure Linear" }).click();
    await expect(page.getByRole("checkbox", { name: /List issues/u })).toBeChecked();
    await expect(page.getByRole("checkbox")).toHaveCount(1);
    await expect(page.getByRole("checkbox", { name: /Create issue/u })).toHaveCount(0);
    await expect(page.getByRole("checkbox", { name: /Delete issue/u })).toHaveCount(0);
    await page.getByRole("button", { name: "+ Write" }).click();
    await expect(page.getByRole("checkbox")).toHaveCount(2);
    await expect(page.getByRole("checkbox", { name: /Create issue/u })).toBeDisabled();
    await expect(page.getByRole("checkbox", { name: /Delete issue/u })).toHaveCount(0);
    await page.getByRole("button", { name: "+ Destructive" }).click();
    await expect(page.getByRole("checkbox")).toHaveCount(3);
    await expect(page.getByRole("checkbox", { name: /Delete issue/u })).toBeDisabled();
    await page.getByRole("button", { name: "Read only" }).click();
    await appSearch.fill("");
    await capture("02-new-bot.png", "02 New Bot");
    await page.getByRole("button", { name: "Create bot" }).click();

    await expect(page).toHaveURL(/\/bots\/bot_e2e_0001$/u);
    await expect(page.getByRole("heading", { name: "Support reader", level: 1 })).toBeVisible();
    const appAccess = page.getByRole("region", { name: "App access" });
    await expect(appAccess.getByText("Linear", { exact: true })).toBeVisible();
    await expect(appAccess.getByText("List issues", { exact: true })).toBeVisible();
    await expect(appAccess.getByText("Slack", { exact: true })).toBeVisible();
    await expect(appAccess).not.toContainText("OpenBot workspace");
    await expect(appAccess).not.toContainText("list_issues");
    await expect(appAccess).not.toContainText("list_channels");
    await expect(page.getByRole("region", { name: "Routines" })).toContainText("No routines yet");
    await capture("03-bot.png", "03 Bot workspace");

    const prompt = "Summarize urgent Linear issues and list the Slack channels where I should post the update.";
    await page.getByLabel("Message Support reader", { exact: true }).fill(prompt);
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page).toHaveURL(/\/bots\/bot_e2e_0001\/runs\/run_e2e_0001$/u);
    await expect(page.getByRole("heading", { name: "Result", exact: true })).toBeVisible();
    await expect(page.locator("pre.result")).toContainText(
        "Reviewed 3 urgent Linear issues and found 2 Slack channels"
    );
    await expect(page.locator("pre.result")).toContainText("Nothing was changed or sent.");
    await expect(page.getByText("Completed", { exact: true })).toBeVisible();
    await expect(page.getByText("Synthetic test only", { exact: true })).toBeVisible();
    await capture("04-result.png", "04 Task result");

    const routinePrompt = "Summarize urgent support cases for the weekday standup every weekday at 9:00 AM Pacific.";
    await page.getByLabel("Message Support reader", { exact: true }).fill(routinePrompt);
    await page.getByRole("button", { name: "Send message" }).click();

    await expect(page).toHaveURL(/\/bots\/bot_e2e_0001\?routine_created=routine_e2e_0001$/u);
    await expect(page.getByText("Routine created", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Weekday support brief" })).toBeVisible();
    const routines = page.getByRole("region", { name: "Routines" });
    await expect(routines.getByRole("link", { name: /Weekday support brief/u })).toBeVisible();
    await expect(routines.getByText("Active", { exact: true })).toBeVisible();
    await capture("05-created-routine.png", "05 Routine created in chat");

    await routines.getByRole("link", { name: /Weekday support brief/u }).click();
    await expect(page.getByRole("heading", { name: "Edit Weekday support brief" })).toBeVisible();
    await page.getByLabel("Schedule", { exact: true }).fill("Every weekday at 8:30 AM Pacific");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("region", { name: "Routines" })).toContainText("Every weekday at 8:30 AM Pacific");
    await capture("06-edited-routine.png", "06 Edited routine");

    await page.getByRole("link", { name: /E2E Organization/u }).click();
    await expect(page.getByRole("heading", { name: "E2E Organization" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Enable Create issue" })).toBeVisible();
    await page.getByRole("button", { name: "Enable Create issue" }).click();
    await expect(page.getByRole("button", { name: "Disable Create issue" })).toBeVisible();
    await capture("07-organization-permissions.png", "07 Organization permissions");
});
