import { expect, test } from "@playwright/test";

test("assistant persists a real conversation and message across refresh", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/assistant", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "新会话" }).click();
  await page.getByLabel("输入消息").fill(`E2E 会话持久化 ${Date.now()}`);
  await page.getByRole("button", { name: "发送消息" }).click();
  await expect(page.getByText("已保存到会话记录。")).toBeVisible({ timeout: 60_000 });
  const userMessage = page.locator("article").filter({ hasText: "E2E 会话持久化" }).first();
  await expect(userMessage).toBeVisible();
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.locator("article").filter({ hasText: "E2E 会话持久化" }).first()).toBeVisible();
});

test("assistant mobile uses a focused full-screen thread with safe back navigation", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/assistant", { waitUntil: "networkidle" });
  const existing = page.getByRole("button", { name: /新会话 \d/ }).first();
  if (await existing.count()) await existing.click(); else await page.getByRole("button", { name: "新会话", exact: true }).click();
  const back = page.getByRole("button", { name: "返回会话列表" });
  await expect(back).toBeVisible();
  await expect(back.locator("xpath=../..")).toHaveClass(/max-md:fixed/);
  await back.click();
  await expect(page.getByText("最近会话")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});
