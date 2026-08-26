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
    await expect(page.getByRole("heading", { name: "Bots", exact: true })).toBeVisible();
    await capture("01-bots.png", "01 Bots");

    await page.getByRole("link", { name: "New Bot" }).first().click();
    await expect(page.getByRole("heading", { name: "New Bot" })).toBeVisible();
    await expect(page.getByLabel("Purpose")).toBeHidden();

    await page.getByLabel("Name", { exact: true }).fill("Support reader");
    await page.getByLabel("Short description").fill("Summarizes open support cases.");
    await page.getByRole("button", { name: "Continue to behavior" }).click();
    await page.getByLabel("Purpose").fill("Review open support cases for the selected account.");
    await page.getByLabel("Behavior instructions").fill("Name case IDs and do not guess missing status.");
    await page.getByRole("button", { name: "Continue to appearance" }).click();
    await page.getByRole("radio", { name: "Sky", exact: true }).check();
    await page.getByRole("radio", { name: "Hexagon", exact: true }).check();
    await page.getByRole("radio", { name: "Cheerful", exact: true }).check();
    await page.getByRole("button", { name: "Continue to apps" }).click();
    await expect(page.getByText(/20 common picks/u)).toBeVisible();
    const appSearch = page.getByLabel("Find an app");
    await appSearch.fill("1password");
    await expect(page.getByRole("button", { name: "Connect 1password" })).toBeVisible();
    await appSearch.fill("");
    await expect(page.getByRole("button", { name: "Add Linear" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add Slack" })).toBeVisible();
    await page.getByRole("button", { name: "Add Linear" }).click();
    await expect(page.getByRole("checkbox", { name: /List issues/u })).toBeChecked();
    await page.getByRole("button", { name: "Add Slack" }).click();
    await expect(page.getByRole("checkbox", { name: /List channels/u })).toBeChecked();
    const addedApps = page.getByRole("region", { name: "Added to this Bot" });
    await expect(addedApps.getByRole("button", { name: "Configure Linear" })).toBeVisible();
    await expect(addedApps.getByRole("button", { name: "Configure Slack" })).toBeVisible();
    await addedApps.getByRole("button", { name: "Configure Linear" }).click();
    await expect(page.getByRole("checkbox", { name: /Create issue/u })).toBeDisabled();
    await expect(page.getByRole("checkbox", { name: /Delete issue/u })).toBeDisabled();
    await appSearch.fill("");
    await capture("02-new-bot.png", "02 New Bot");
    await page.getByRole("button", { name: "Create Bot" }).click();

    await expect(page).toHaveURL(/\/bots\/bot_e2e_0001$/u);
    await expect(page.getByRole("heading", { name: "Support reader", level: 1 })).toBeVisible();
    const metorialAccess = page.getByRole("region", { name: "Metorial access" });
    await expect(metorialAccess.getByText("Linear", { exact: true })).toBeVisible();
    await expect(metorialAccess.getByText("Linear · OpenBot workspace", { exact: true })).toBeVisible();
    await expect(metorialAccess.getByText("List issues", { exact: true })).toBeVisible();
    await expect(metorialAccess.getByText("list_issues", { exact: true })).toBeVisible();
    await expect(metorialAccess.getByText("Slack", { exact: true })).toBeVisible();
    await expect(metorialAccess.getByText("Slack · OpenBot workspace", { exact: true })).toBeVisible();
    await expect(metorialAccess.getByText("list_channels", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "Routines" })).toContainText("No routines yet");
    await capture("03-bot.png", "03 Bot workspace");

    const prompt = "Summarize urgent Linear issues and list the Slack channels where I should post the update.";
    await page.getByLabel("Message Support reader", { exact: true }).fill(prompt);
    await page.getByRole("button", { name: "Review task" }).click();

    await expect(page).toHaveURL(/\/run-confirmations\/confirmation_e2e_0001$/u);
    await expect(page.getByRole("heading", { name: "Review task" })).toBeVisible();
    await expect(page.getByText(prompt, { exact: true })).toBeVisible();
    const reviewCard = page.locator(".review-card");
    await expect(reviewCard.getByText("Linear", { exact: true })).toBeVisible();
    await expect(reviewCard.getByText("Linear · OpenBot workspace", { exact: true })).toBeVisible();
    await expect(reviewCard.getByText("list_issues", { exact: true }).first()).toBeVisible();
    await expect(reviewCard.getByText("Slack", { exact: true })).toBeVisible();
    await expect(reviewCard.getByText("Slack · OpenBot workspace", { exact: true })).toBeVisible();
    await expect(reviewCard.getByText("list_channels", { exact: true }).first()).toBeVisible();
    await capture("04-review-task.png", "04 Review task");
    await page.getByRole("button", { name: "Start run" }).click();

    await expect(page).toHaveURL(/\/bots\/bot_e2e_0001\/runs\/run_e2e_0001$/u);
    await expect(page.getByRole("heading", { name: "Task result" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Result", exact: true })).toBeVisible();
    await expect(page.locator("pre.result")).toContainText(
        "Reviewed 3 urgent Linear issues and found 2 Slack channels"
    );
    await expect(page.locator("pre.result")).toContainText("Nothing was changed or sent.");
    await expect(page.getByText("Completed", { exact: true })).toBeVisible();
    await expect(page.getByText("Synthetic test only", { exact: true })).toBeVisible();
    await capture("05-result.png", "05 Task result");

    await page.getByRole("link", { name: "New task" }).click();
    const routinePrompt = "Summarize urgent support cases for the weekday standup.";
    await page.getByLabel("Message Support reader", { exact: true }).fill(routinePrompt);
    await page.getByText("Create a routine from this message", { exact: true }).click();
    await page.getByLabel("Routine name", { exact: true }).fill("Weekday support brief");
    await page.getByLabel("Schedule", { exact: true }).fill("Every weekday at 9:00 AM Pacific");
    await page.getByRole("button", { name: "Review routine" }).click();

    await expect(page).toHaveURL(/\/routine-proposals\/routine_proposal_e2e_0001$/u);
    await expect(page.getByRole("heading", { name: "Weekday support brief" })).toBeVisible();
    await expect(page.getByText("Every weekday at 9:00 AM Pacific", { exact: true })).toBeVisible();
    await expect(page.getByText("list_issues", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("list_channels", { exact: true }).first()).toBeVisible();
    await capture("06-review-routine.png", "06 Review routine");
    await page.getByRole("button", { name: "Save routine" }).click();

    await expect(page).toHaveURL(/\/bots\/bot_e2e_0001$/u);
    const routines = page.getByRole("region", { name: "Routines" });
    await expect(routines.getByRole("link", { name: /Weekday support brief/u })).toBeVisible();
    await expect(routines.getByText("Active", { exact: true })).toBeVisible();
    await capture("07-saved-routine.png", "07 Saved routine");

    await routines.getByRole("link", { name: /Weekday support brief/u }).click();
    await expect(page.getByRole("heading", { name: "Edit Weekday support brief" })).toBeVisible();
    await page.getByLabel("Schedule", { exact: true }).fill("Every weekday at 8:30 AM Pacific");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("region", { name: "Routines" })).toContainText("Every weekday at 8:30 AM Pacific");
    await capture("08-edited-routine.png", "08 Edited routine");

    await page.getByRole("link", { name: /E2E Organization/u }).click();
    await expect(page.getByRole("heading", { name: "E2E Organization" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Enable Create issue" })).toBeVisible();
    await page.getByRole("button", { name: "Enable Create issue" }).click();
    await expect(page.getByRole("button", { name: "Disable Create issue" })).toBeVisible();
    await capture("09-organization-permissions.png", "09 Organization permissions");
});
