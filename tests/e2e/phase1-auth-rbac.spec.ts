import { expect, test } from "@playwright/test";

import { authStatePath, roleFixtures } from "./auth-state";

const emptyStorageState = { cookies: [], origins: [] };

const roleScenarios = [
  ["executive", "/dashboard", "/hr"],
  ["department_head", "/department", "/finance"],
  ["employee", "/execution", "/people"],
  ["finance", "/finance", "/dashboard"],
  ["hr", "/hr", "/analytics"],
] as const;

test("未登录员工只能看到统一飞书登录入口", async ({ browser }) => {
  const context = await browser.newContext({ storageState: emptyStorageState });
  const page = await context.newPage();

  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login(?:\?next=%2Fdashboard)?$/);
  await expect(
    page.getByRole("button", { name: "使用飞书登录" }),
  ).toBeVisible();
  await expect(page.getByRole("button")).toHaveCount(1);

  await context.close();
});

for (const [role, landingPath, forbiddenPath] of roleScenarios) {
  test(`${role} 进入岗位首页、任务中心并被安全拒绝越权`, async ({ browser }) => {
    const context = await browser.newContext({
      storageState: authStatePath(role),
    });
    const page = await context.newPage();

    await page.goto(landingPath);
    await expect(page).toHaveURL(new RegExp(`${landingPath}$`));
    await expect(
      page.getByRole("img", { name: roleFixtures[role].displayName }),
    ).toBeVisible();

    await page.goto("/tasks");
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(
      page.getByRole("heading", { name: "任务管理", level: 1 }),
    ).toBeVisible();

    await page.goto(forbiddenPath);
    await expect(page).toHaveURL(
      new RegExp(`${landingPath.replace("/", "\\/")}\\?notice=no_access$`),
    );
    await expect(
      page.getByRole("img", { name: roleFixtures[role].displayName }),
    ).toBeVisible();
    await expect(page.getByRole("status")).toHaveText(
      "你没有权限查看刚才的页面，已返回可访问的工作台。",
    );

    await context.close();
  });
}

test("退出登录后不能继续进入工作区", async ({ browser }) => {
  const context = await browser.newContext({
    storageState: authStatePath("employee"),
  });
  const page = await context.newPage();

  await page.goto("/tasks");
  await page.getByRole("button", { name: "打开用户菜单" }).click();
  await page.getByRole("button", { name: "退出登录" }).click();
  await expect(page).toHaveURL(/\/login\?status=signed_out$/);

  await page.goto("/tasks");
  await expect(page).toHaveURL(/\/login(?:\?next=%2Ftasks)?$/);

  await context.close();
});

for (const [blockedState, reason, message] of [
  ["unknown", "not_provisioned", "你的飞书账号尚未开通企业工作站，请联系管理员。"],
  ["suspended", "suspended", "你的工作站账号已暂停，请联系人事或管理员。"],
  ["departed", "departed", "该员工账号已停用，无法进入工作站。"],
] as const) {
  test(`${blockedState} 身份显示对应的拒绝原因`, async ({ browser }) => {
    const context = await browser.newContext({
      storageState: authStatePath(blockedState),
    });
    const page = await context.newPage();

    await page.goto("/tasks");
    await expect(page).toHaveURL(
      new RegExp(`/access-pending\\?reason=${reason}$`),
    );
    await expect(
      page.getByRole("heading", { name: "暂时无法进入" }),
    ).toBeVisible();
    await expect(page.getByText(message)).toBeVisible();

    await context.close();
  });
}

test("第二租户的第二 Provider 产生相同员工工作会话", async ({ browser }) => {
  const context = await browser.newContext({
    storageState: authStatePath("second-provider"),
  });
  const page = await context.newPage();

  await page.goto("/execution");
  await expect(page).toHaveURL(/\/execution$/);
  await expect(
    page.getByRole("img", { name: "E2E 第二 Provider 员工" }),
  ).toBeVisible();
  await page.goto("/tasks");
  await expect(page).toHaveURL(/\/tasks$/);

  await context.close();
});
