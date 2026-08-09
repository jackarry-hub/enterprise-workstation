import path from "node:path";

import { expect, test } from "@playwright/test";

const artifactsDirectory = path.resolve(process.cwd(), "artifacts/settings");

test("settings supports the V0.9 configuration flow", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

  await page.setViewportSize({ width: 1672, height: 941 });
  await page.goto("/settings", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "系统设置" })).toBeVisible();
  await expect(page.getByRole("img", { name: "量子星河企业 Logo" })).toBeVisible();
  await page.screenshot({ path: path.join(artifactsDirectory, "settings-desktop-1672x941.png"), fullPage: true });

  await page.getByRole("tab", { name: "通知设置" }).click();
  await page.getByRole("button", { name: "邮件通知" }).click();
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.getByText("设置已保存")).toBeVisible();
  await expect(page.getByRole("tab", { name: "权限设置" })).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test("settings accepts an enterprise logo and preserves saved profile preferences", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/settings", { waitUntil: "networkidle" });
  await page.getByLabel("选择企业 Logo").setInputFiles({ name: "quantxy-demo.png", mimeType: "image/png", buffer: Buffer.from("89504e470d0a1a0a", "hex") });
  await page.getByRole("button", { name: "保存设置" }).click();
  await expect(page.getByText("设置已保存")).toBeVisible();

  await page.goto("/settings?tab=personal", { waitUntil: "networkidle" });
  await expect(page.getByRole("tab", { name: "个人设置" })).toHaveAttribute("data-state", "active");
});

test("settings is responsive without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/settings", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "系统设置" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: path.join(artifactsDirectory, "settings-mobile-430.png"), fullPage: true });
});
