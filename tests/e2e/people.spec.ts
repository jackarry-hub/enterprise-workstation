import { expect, test } from "@playwright/test";

const employeeId = "61000000-0000-4000-8000-000000000002";

test("unbound real identity sees no fixture employee records", async ({ page }) => {
  await page.goto("/people", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "组织人事" })).toBeVisible();
  await expect(page.getByText("当前账号没有可显示的真实员工数据。" )).toBeVisible();
  await expect(page.getByText("当前显示 0 名员工")).toBeVisible();
  await expect(page.getByRole("link", { name: /查看.*员工档案/ })).toHaveCount(0);
});

test("fixture employee detail is unavailable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto(`/people/${employeeId}`, { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "员工数据暂不可用" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "基本信息" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});
