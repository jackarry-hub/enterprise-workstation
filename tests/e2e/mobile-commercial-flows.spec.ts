import { expect, test } from "@playwright/test";

test("mobile navigation reaches real notifications and profile settings", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1280) >= 768, "mobile/tablet phone flow");
  await page.goto("/assistant", { waitUntil: "networkidle" });
  const nav = page.getByTestId("mobile-primary-nav"); await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: "通知" }).click(); await expect(page.getByRole("heading", { name: "通知中心" })).toBeVisible();
  await page.getByTestId("mobile-primary-nav").getByRole("link", { name: "我的" }).click(); await expect(page.getByRole("heading", { name: "系统设置" })).toBeVisible();
});

test("mobile AI quick create opens the durable conversation command", async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 1280) >= 768, "mobile/tablet phone flow");
  await page.goto("/assistant", { waitUntil: "networkidle" }); await page.getByRole("button", { name: "快速创建" }).click();
  await expect(page.getByRole("button", { name: "新建 AI 会话" })).toBeVisible();
});
