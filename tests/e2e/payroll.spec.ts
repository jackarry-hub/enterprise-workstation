import { expect, test } from "@playwright/test";

const salaryId = "91000000-0000-4000-8000-000000000001";

test("unbound real identity sees no fixture payroll records", async ({ page }) => {
  await page.goto("/payroll", { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "薪资管理" })).toBeVisible();
  await expect(page.getByText("当前账号没有可显示的真实薪资数据。" )).toBeVisible();
  await expect(page.getByText("当前显示 0 条工资记录")).toBeVisible();
  await expect(page.getByRole("link", { name: /查看.*工资详情/ })).toHaveCount(0);
});

test("fixture payslip detail is unavailable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto(`/payroll/${salaryId}`, { waitUntil: "networkidle" });

  await expect(page.getByRole("heading", { name: "薪资数据暂不可用" })).toBeVisible();
  await expect(page.getByRole("region", { name: "工资组成" })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});
