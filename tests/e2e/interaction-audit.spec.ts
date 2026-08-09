import { expect, test } from "@playwright/test";

test("project overview submenu opens the existing project overview section", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/projects", { waitUntil: "networkidle" });

  const overviewLink = page.getByRole("link", { name: "项目总览" });
  await overviewLink.click();

  await expect(page).toHaveURL(/\/projects\?view=overview#project-overview$/);
  await expect(overviewLink).toHaveAttribute("aria-current", "location");
  await expect(page.locator("#project-overview")).toBeInViewport();
});

test("shell search, dashboard, and activity actions provide real state changes", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "全局搜索" }).click();
  await page.getByLabel("输入全局搜索关键词").fill("数据分析");
  await expect(page.getByRole("link", { name: /数据分析/ })).toHaveAttribute("href", "/analytics");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "完成待办：审批《市场推广预算方案》" }).click();
  await expect(page.getByRole("button", { name: "恢复待办：审批《市场推广预算方案》" })).toHaveAttribute("aria-pressed", "true");

  await page.goto("/activities", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "活动日历" }).click();
  await expect(page.getByRole("dialog", { name: "活动日历" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "创建活动" }).click();
  const dialog = page.getByRole("dialog", { name: "创建活动" });
  await dialog.getByLabel("活动名称").fill("客户开放日");
  await dialog.getByLabel("开始日期").fill("2026-09-01");
  await dialog.getByLabel("截止日期").fill("2026-09-30");
  await dialog.getByRole("button", { name: "创建活动" }).click();
  await expect(page.getByRole("heading", { name: "客户开放日", level: 2 })).toBeVisible();
});

test("project editing, task feedback, and file upload form a complete mock workflow", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/projects/40000000-0000-4000-8000-000000000001", { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.removeItem("enterprise-workspace.projects.v1"));
  await page.reload({ waitUntil: "networkidle" });

  await page.getByRole("button", { name: "编辑项目" }).click();
  const edit = page.getByRole("dialog", { name: "编辑项目" });
  await edit.getByLabel("项目名称").fill("企业官网升级二期");
  await edit.getByRole("button", { name: "保存项目" }).click();
  await expect(page.getByRole("heading", { name: "企业官网升级二期" })).toBeVisible();

  await page.getByRole("tab", { name: "任务" }).click();
  await page.getByRole("button", { name: /查看任务详情/ }).first().click();
  await page.getByLabel("任务评论内容").fill("联调完成，等待验收。");
  await page.getByRole("button", { name: "添加评论" }).click();
  await expect(page.getByText("联调完成，等待验收。" )).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("tab", { name: "文件" }).click();
  await page.getByLabel("选择项目文件").setInputFiles({ name: "验收清单.txt", mimeType: "text/plain", buffer: Buffer.from("demo") });
  await expect(page.getByText("验收清单.txt", { exact: true })).toBeVisible();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "文件" }).click();
  await expect(page.getByText("验收清单.txt", { exact: true })).toBeVisible();
});
