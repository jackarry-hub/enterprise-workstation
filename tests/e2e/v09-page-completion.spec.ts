import { expect, test } from "@playwright/test";

const pages = [
  { route: "/tasks", heading: "任务管理" },
  { route: "/dashboard", heading: "经营数据分析" },
  { route: "/customers", heading: "客户管理" },
  { route: "/settings", heading: "系统设置" },
] as const;

for (const target of pages) {
  test(`${target.heading} is reachable for the executive role`, async ({ page }) => {
    await page.goto(target.route, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: target.heading, level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  });
}

test("knowledge route follows the current denied-route matrix", async ({ page }) => {
  await page.goto("/knowledge", { waitUntil: "networkidle" });

  await expect(page).toHaveURL(/\/dashboard\?notice=no_access$/);
  await expect(page.getByRole("status")).toHaveText(
    "你没有权限查看刚才的页面，已返回可访问的工作台。",
  );
});

test("task management is safely empty for an unbound mobile session", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/tasks", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "任务管理", level: 1 })).toBeVisible();
  await expect(page.getByText("没有找到匹配的任务")).toBeVisible();
  await expect(page.getByRole("button", { name: /查看任务详情/ })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});
