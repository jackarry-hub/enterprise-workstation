import { mkdirSync } from "node:fs";
import path from "node:path";

import { expect, test } from "@playwright/test";

const evidenceDir = path.resolve("artifacts/v09-page-completion");

test.beforeAll(() => mkdirSync(evidenceDir, { recursive: true }));

const pages = [
  { route: "/tasks", heading: "任务管理", screenshot: "tasks-desktop.png" },
  { route: "/analytics", heading: "数据分析", screenshot: "analytics-desktop.png" },
  { route: "/knowledge", heading: "知识库", screenshot: "knowledge-desktop.png" },
  { route: "/customers", heading: "客户管理", screenshot: "customers-desktop.png" },
  { route: "/settings", heading: "系统设置", screenshot: "settings-desktop.png" },
] as const;

for (const target of pages) {
  test(`${target.heading} is reachable and visually stable`, async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.setViewportSize({ width: 1672, height: 941 });
    await page.goto(target.route, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: target.heading, level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
    await page.screenshot({ path: path.join(evidenceDir, target.screenshot), fullPage: true });
    expect(errors).toEqual([]);
  });
}

test("task management keeps its filters and detail action usable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/tasks", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "任务管理", level: 1 })).toBeVisible();
  await page.getByRole("searchbox", { name: "搜索任务或项目" }).fill("官网");
  await expect(page.getByRole("button", { name: "查看任务详情：搭建官网前端工程与组件基线" })).toBeVisible();
  await page.getByRole("button", { name: /查看任务详情/ }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await page.screenshot({ path: path.join(evidenceDir, "tasks-mobile.png"), fullPage: true });
});
