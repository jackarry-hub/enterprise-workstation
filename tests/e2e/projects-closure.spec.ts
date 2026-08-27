import { expect, test } from "@playwright/test";

const projectName = `E2E 商用项目 ${Date.now()}`;

test("authorized user creates a real project that survives refresh", async ({ page }) => {
  await page.goto("/projects", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "项目管理中心" })).toBeVisible();
  await expect(page.getByRole("button", { name: "新建项目" })).toBeEnabled();
  await page.getByRole("button", { name: "新建项目" }).click();

  const dialog = page.getByRole("dialog", { name: "新建项目" });
  await dialog.getByLabel("项目名称").fill(projectName);
  await dialog.getByLabel("项目描述").fill("验证项目事务写入、重新加载和移动端布局");
  await dialog.getByLabel("开始日期").fill("2026-08-27");
  await dialog.getByLabel("截止日期").fill("2026-10-30");
  await dialog.getByRole("button", { name: "创建项目" }).click();

  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: projectName })).toBeVisible();
  await page.reload({ waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: projectName })).toBeVisible();
});

test("project center and missing detail fail closed on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/projects", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "项目管理中心" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  await page.goto("/projects/40000000-0000-4000-8000-000000000001", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "未找到项目" })).toBeVisible();
  await expect(page.getByRole("button", { name: /编辑项目|新建任务|添加任务/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});
