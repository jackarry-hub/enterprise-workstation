import path from "node:path";

import { expect, test } from "@playwright/test";

const artifactsDirectory = path.resolve(process.cwd(), "artifacts/attendance");

test("attendance management supports the core review flow", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.setViewportSize({ width: 1672, height: 941 });
  await page.goto("/attendance", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "考勤管理" })).toBeVisible();
  await expect(page.getByRole("region", { name: "月度出勤趋势" })).toBeVisible();
  await expect(page.getByRole("region", { name: "异常提醒" })).toBeVisible();
  await page.screenshot({
    path: path.join(artifactsDirectory, "attendance-desktop-1672x941.png"),
    fullPage: true,
  });

  await page.getByRole("searchbox", { name: "搜索考勤员工" }).fill("王芳");
  await page.getByRole("combobox", { name: "筛选考勤状态" }).click();
  await page.getByRole("option", { name: "迟到" }).click();
  await expect(page.getByText("当前显示 1 条考勤记录")).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test("attendance management is responsive without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/attendance", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "考勤管理" })).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
  await page.screenshot({
    path: path.join(artifactsDirectory, "attendance-mobile-430.png"),
    fullPage: true,
  });
});
