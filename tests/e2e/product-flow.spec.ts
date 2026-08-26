import { expect, test } from "@playwright/test";

test("an owner creates a Bot, selects permission, runs a task, and reads the result", async ({ page }) => {
    const opened = await page.goto("/");
    expect(opened?.headers()["content-security-policy"]).toContain("default-src 'none'");
    await expect(page).toHaveURL(/\/bots$/u);
    await expect(page.getByRole("heading", { name: "Bots", exact: true })).toBeVisible();

    await page.getByRole("link", { name: "New Bot" }).first().click();
    await expect(page.getByRole("heading", { name: "New Bot" })).toBeVisible();
    await expect(page.getByRole("checkbox", { name: /Update support case/u })).toBeDisabled();
    await expect(page.getByRole("checkbox", { name: /Delete support case/u })).toBeDisabled();

    await page.getByLabel("Name", { exact: true }).fill("Support reader");
    await page.getByLabel("Short description").fill("Summarizes open support cases.");
    await page.getByLabel("Purpose").fill("Review open support cases for the selected account.");
    await page.getByLabel("Behavior instructions").fill("Name case IDs and do not guess missing status.");
    await page.getByRole("checkbox", { name: /List support cases/u }).check();
    await page.getByRole("button", { name: "Create Bot" }).click();

    await expect(page).toHaveURL(/\/bots\/bot_e2e_0001$/u);
    await expect(page.getByRole("heading", { name: "Support reader" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Selected permissions" })).toContainText("List support cases · read");

    const prompt = "Summarize cases tagged <urgent> and include their IDs.";
    await page.getByLabel("Task", { exact: true }).fill(prompt);
    await page.getByRole("button", { name: "Review task" }).click();

    await expect(page).toHaveURL(/\/run-confirmations\/confirmation_e2e_0001$/u);
    await expect(page.getByRole("heading", { name: "Review task" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Prompt" })).toBeVisible();
    await expect(page.getByText(prompt, { exact: true })).toBeVisible();
    await expect(page.getByText("Reviewed connector and selected model provider", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Start run" }).click();

    await expect(page).toHaveURL(/\/bots\/bot_e2e_0001\/runs\/run_e2e_0001$/u);
    await expect(page.getByRole("heading", { name: "Task result" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Result", exact: true })).toBeVisible();
    await expect(page.locator("pre.result")).toContainText("Found 3 open support cases");
    await expect(page.locator("pre.result")).toContainText("<strong>This stays plain text.</strong>");
    await expect(page.locator("pre.result strong")).toHaveCount(0);
    await expect(page.getByText("Completed", { exact: true })).toBeVisible();
    await expect(page.getByText("Synthetic test only", { exact: true })).toBeVisible();
});
