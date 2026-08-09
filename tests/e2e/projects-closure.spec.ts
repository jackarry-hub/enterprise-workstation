import { mkdirSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

const evidenceDir = path.resolve("artifacts/projects-v1");

test.beforeAll(() => {
  mkdirSync(evidenceDir, { recursive: true });
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const initializationKey = "enterprise-workspace.e2e-initialized";
    if (!window.sessionStorage.getItem(initializationKey)) {
      window.localStorage.removeItem("enterprise-workspace.projects.v1");
      window.sessionStorage.setItem(initializationKey, "true");
    }
  });
});

test("creates a project, assigns a task, completes it, and survives refresh", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.setViewportSize({ width: 1672, height: 941 });
  await page.goto("/projects", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "新建项目" }).click();
  const projectDialog = page.getByRole("dialog", { name: "新建项目" });
  await projectDialog.getByLabel("项目名称").fill("客户门户二期");
  await projectDialog.getByLabel("项目描述").fill("完善客户自助服务与交付进度查询");
  await projectDialog.getByLabel("开始日期").fill("2026-08-10");
  await projectDialog.getByLabel("截止日期", { exact: true }).fill("2026-10-30");
  await projectDialog.getByRole("button", { name: "创建项目" }).click();

  await expect(page.getByRole("heading", { name: "客户门户二期", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "添加任务" }).click();
  await page.getByLabel("任务名称").fill("完成客户门户原型");
  await page.getByLabel("任务描述").fill("覆盖登录后首页与项目进度页");
  await page.getByRole("button", { name: "创建任务" }).click();
  await expect(page.getByText("完成客户门户原型")).toBeVisible();

  await page.getByRole("combobox", { name: "完成客户门户原型状态" }).click();
  await page.getByRole("option", { name: "已完成" }).click();
  await expect(page.getByRole("progressbar", { name: "项目当前进度" })).toHaveAttribute("aria-valuenow", "100");

  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "客户门户二期", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "任务" }).click();
  await expect(page.getByText("完成客户门户原型")).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "项目当前进度" })).toHaveAttribute("aria-valuenow", "100");
  await page.screenshot({
    path: path.join(evidenceDir, "project-closure-desktop-1672x941.png"),
    fullPage: false,
  });

  expect(consoleErrors).toEqual([]);
});

test("keeps the project task flow usable on a 430px mobile viewport", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/projects/40000000-0000-4000-8000-000000000001", { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "任务" }).click();
  await expect(page.getByRole("heading", { name: "项目任务" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.getByRole("button", { name: "新建任务" }).click();
  await expect(page.getByRole("dialog", { name: "新建任务" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "关闭" }).click();
  await expect(page.locator('[data-slot="dialog-overlay"]')).toHaveCount(0);
  await page.screenshot({
    path: path.join(evidenceDir, "project-tasks-mobile-430x932.png"),
    fullPage: false,
  });

  expect(consoleErrors).toEqual([]);
});
