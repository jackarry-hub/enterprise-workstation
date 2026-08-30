import { expect, test } from "@playwright/test";

test("Agent Center quick create contains Agent commands only", async ({ page }) => {
  await page.goto("/agents", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "快速创建" }).click();
  await expect(page.getByText("新建 Agent", { exact: true })).toBeVisible();
  await expect(page.getByText("新建任务", { exact: true })).toHaveCount(0);
  await page.getByText("新建 Agent", { exact: true }).click();
  await expect(page.getByRole("dialog", { name: "新建 Agent" })).toBeVisible();
});

test("analytics has no unrelated create action", async ({ page }) => {
  await page.goto("/analytics", { waitUntil: "networkidle" });
  await expect(page.getByRole("button", { name: "快速创建" })).toHaveCount(0);
});
