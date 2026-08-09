import path from "node:path";

import { expect, test } from "@playwright/test";

const artifactsDirectory = path.resolve(process.cwd(), "artifacts/people");
const employeeId = "61000000-0000-4000-8000-000000000002";

test("employee directory supports the core lookup flow", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  await page.setViewportSize({ width: 1672, height: 941 });
  await page.goto("/people", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "组织人事" })).toBeVisible();
  await expect(page.getByText("当前显示 10 名员工")).toBeVisible();
  await page.screenshot({
    path: path.join(artifactsDirectory, "people-desktop-1672x941.png"),
  });

  await page.getByRole("searchbox", { name: "搜索员工" }).fill("QXY-1002");
  await expect(page.getByText("当前显示 1 名员工")).toBeVisible();
  await expect(page.getByRole("link", { name: "查看王芳的员工档案" })).toBeVisible();

  await page.getByRole("button", { name: "重置筛选" }).click();
  await page.getByRole("combobox", { name: "筛选部门" }).click();
  await page.getByRole("option", { name: "产品研发部" }).click();
  await page.getByRole("combobox", { name: "筛选员工状态" }).click();
  await page.getByRole("option", { name: "试用期" }).click();
  await expect(page.getByRole("link", { name: "查看周宁的员工档案" })).toBeVisible();
  await expect(page.getByRole("link", { name: "查看刘洋的员工档案" })).toHaveCount(0);
  expect(consoleErrors).toEqual([]);
});

test("employee directory is responsive without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/people", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "组织人事" })).toBeVisible();
  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
  await page.screenshot({
    path: path.join(artifactsDirectory, "people-mobile-430.png"),
    fullPage: true,
  });
});

test("employee detail presents the approved profile information", async ({ page }) => {
  await page.setViewportSize({ width: 1672, height: 941 });
  await page.goto(`/people/${employeeId}`, { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "王芳" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "基本信息" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "组织关系" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "账号与权限" })).toBeVisible();
  await page.screenshot({
    path: path.join(artifactsDirectory, "employee-detail-desktop-1672x941.png"),
  });
});
