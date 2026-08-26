import { expect, test } from "@playwright/test";

import { authStatePath, roleFixtures } from "./auth-state";

test("ordinary employee reads the server directory and keeps it after refresh", async ({ browser }) => {
  const context = await browser.newContext({ storageState: authStatePath("employee") });
  const page = await context.newPage();
  const employee = roleFixtures.employee;

  await page.goto("/people", { waitUntil: "networkidle" });
  await expect(page.getByRole("heading", { name: "组织人事" })).toBeVisible();
  await expect(page.getByRole("link", { name: `查看${employee.displayName}的员工档案` })).toBeVisible();
  await expect(page.getByRole("button", { name: "同步通讯录" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "新建部门" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "分配系统角色" })).toHaveCount(0);

  await page.reload({ waitUntil: "networkidle" });

  await expect(page.getByRole("link", { name: `查看${employee.displayName}的员工档案` })).toBeVisible();
  await context.close();
});

test("ordinary employee sees only a safe peer detail on mobile", async ({ browser }) => {
  const context = await browser.newContext({ storageState: authStatePath("employee") });
  const page = await context.newPage();
  const executive = roleFixtures.executive;

  await page.setViewportSize({ width: 430, height: 932 });
  await page.goto("/people", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: `查看${executive.displayName}的员工档案` }).click();

  await expect(page.getByRole("heading", { name: executive.displayName })).toBeVisible();
  await expect(page.getByRole("heading", { name: "私密人事资料" })).toHaveCount(0);
  await expect(page.getByText(executive.email)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await context.close();
});
