import { expect, test } from "@playwright/test";

const approvalId = "81000000-0000-4000-8000-000000000002";

test("real approval center never exposes bundled fixture records", async ({ page }) => {
  await page.goto("/approvals", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "审批中心" })).toBeVisible();
  await expect(page.getByText(/真实审批模式/)).toBeVisible();
  await expect(page.getByText("EXP-20260804-002")).toHaveCount(0);
  await expect(page.getByText("王芳的报销等待财务复核")).toHaveCount(0);
});

test("fixture approval detail is unavailable and has no decision actions", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto(`/approvals/${approvalId}`, { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "审批数据暂不可用" })).toBeVisible();
  await expect(page.getByRole("button", { name: /同意申请|拒绝申请/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});
