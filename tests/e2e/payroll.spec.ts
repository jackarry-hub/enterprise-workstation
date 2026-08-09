import path from "node:path";

import { expect, test } from "@playwright/test";

const artifactsDirectory = path.resolve(process.cwd(), "artifacts/payroll");
const salaryId = "91000000-0000-4000-8000-000000000001";

test("payroll supports list review and payslip detail", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });

  await page.setViewportSize({ width: 1672, height: 941 });
  await page.goto("/payroll", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "薪资管理" })).toBeVisible();
  await page.screenshot({ path: path.join(artifactsDirectory, "payroll-desktop-1672x941.png"), fullPage: true });

  await page.goto(`/payroll/${salaryId}`, { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "林远的工资单" })).toBeVisible();
  await expect(page.getByRole("region", { name: "工资组成" })).toBeVisible();
  await expect(page.getByRole("region", { name: "历史记录" })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("payroll is responsive without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/payroll", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "薪资管理" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: path.join(artifactsDirectory, "payroll-mobile-430.png"), fullPage: true });
});

test("payroll total card contains its full amount at medium desktop width", async ({ page }) => {
  await page.setViewportSize({ width: 936, height: 930 });
  await page.goto("/payroll", { waitUntil: "networkidle" });

  const totalLabel = page.getByText("本月工资总额", { exact: true });
  const totalCard = totalLabel.locator("xpath=ancestor::*[@data-slot='glass-card'][1]");
  const totalAmount = totalCard.getByText("¥2,568,420.00", { exact: true });
  const [cardBox, amountBox] = await Promise.all([
    totalCard.boundingBox(),
    totalAmount.boundingBox(),
  ]);

  expect(cardBox).not.toBeNull();
  expect(amountBox).not.toBeNull();
  expect(cardBox!.width).toBeGreaterThanOrEqual(400);
  expect(amountBox!.x + amountBox!.width).toBeLessThanOrEqual(
    cardBox!.x + cardBox!.width - 16,
  );
  await page.screenshot({ path: path.join(artifactsDirectory, "payroll-medium-936x930.png"), fullPage: true });
});
