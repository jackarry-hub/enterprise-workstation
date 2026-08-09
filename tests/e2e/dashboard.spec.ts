import { expect, test } from "@playwright/test";

test("desktop dashboard renders the executive overview without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1672, height: 941 });
  await page.goto("/dashboard");

  await expect(page).toHaveTitle("企业工作站");
  await expect(page.getByRole("heading", { name: "早上好，李总" })).toBeVisible();
  await expect(page.getByText("企业员工", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "项目健康度" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "任务趋势" })).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});

test("mobile dashboard opens the navigation drawer without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/dashboard");

  await page.getByRole("button", { name: "打开主导航" }).click();
  const navigationDrawer = page.getByRole("dialog", { name: "企业工作站导航" });
  await expect(navigationDrawer).toBeVisible();
  await expect(navigationDrawer.getByRole("navigation", { name: "主导航" })).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  expect(hasHorizontalOverflow).toBe(false);
});
