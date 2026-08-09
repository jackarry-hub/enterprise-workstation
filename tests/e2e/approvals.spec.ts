import path from "node:path";

import { expect, test } from "@playwright/test";

const artifactsDirectory = path.resolve(process.cwd(), "artifacts/approvals");
const approvalId = "81000000-0000-4000-8000-000000000002";

test("approval center supports queue review and decision confirmation", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

  await page.setViewportSize({ width: 1672, height: 941 });
  await page.goto("/approvals", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "审批中心" })).toBeVisible();
  await page.screenshot({ path: path.join(artifactsDirectory, "approvals-desktop-1672x941.png"), fullPage: true });

  await page.goto(`/approvals/${approvalId}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "报销申请" })).toBeVisible();
  await page.getByRole("button", { name: "同意申请" }).click();
  await page.getByRole("button", { name: "确认同意" }).click();
  await expect(page.getByText("审批已通过")).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("approval center is responsive without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/approvals", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "审批中心" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: path.join(artifactsDirectory, "approvals-mobile-430.png"), fullPage: true });
});
