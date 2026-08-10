import { expect, test } from "@playwright/test";

test("unbound real identity sees a safe empty project center", async ({ page }) => {
  await page.goto("/projects", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "项目管理中心" })).toBeVisible();
  await expect(page.getByRole("button", { name: "新建项目" })).toBeDisabled();
  await expect(page.getByText("没有匹配的项目")).toBeVisible();
  await expect(page.getByRole("link", { name: /查看.*详情/ })).toHaveCount(0);
});

test("unbound real identity cannot open or mutate a fixture project", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/projects/40000000-0000-4000-8000-000000000001", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "未找到项目" })).toBeVisible();
  await expect(page.getByRole("link", { name: "返回项目中心" })).toBeVisible();
  await expect(page.getByRole("button", { name: /编辑项目|新建任务|添加任务/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});
