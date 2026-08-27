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

test("department head protected scope includes only the exact active department", async ({ browser }) => {
  const context = await browser.newContext({ storageState: authStatePath("department_head") });
  const page = await context.newPage();

  await page.goto("/people", { waitUntil: "networkidle" });
  const employeeHref = await page.getByRole("link", {
    name: `查看${roleFixtures.employee.displayName}的员工档案`,
  }).first().getAttribute("href");
  const financeHref = await page.getByRole("link", {
    name: `查看${roleFixtures.finance.displayName}的员工档案`,
  }).first().getAttribute("href");
  expect(employeeHref).toMatch(/^\/people\/[0-9a-f-]{36}$/i);
  expect(financeHref).toMatch(/^\/people\/[0-9a-f-]{36}$/i);

  const employeeId = employeeHref!.split("/").at(-1)!;
  const financeId = financeHref!.split("/").at(-1)!;
  const directDepartment = await page.request.get(
    `/api/workstation/organization/members/${employeeId}/manager`,
  );
  const otherDepartment = await page.request.get(
    `/api/workstation/organization/members/${financeId}/manager`,
  );

  expect(directDepartment.status()).toBe(200);
  expect(otherDepartment.status()).toBe(404);
  await context.close();
});

test("organization manager assigns a real responsive manager relationship and refreshes", async ({ browser }) => {
  const context = await browser.newContext({ storageState: authStatePath("executive") });
  const page = await context.newPage();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/people", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "分配直属主管" }).click();
  const employeeOption = page.getByRole("combobox", { name: "选择员工" })
    .locator("option")
    .filter({ hasText: roleFixtures.employee.displayName });
  await page.getByRole("combobox", { name: "选择员工" }).selectOption(
    (await employeeOption.getAttribute("value"))!,
  );
  const managerSelect = page.getByRole("combobox", { name: "选择主管" });
  const currentManagerEmployeeId = await managerSelect.inputValue();
  const eligibleManagers = await managerSelect.locator("option").evaluateAll((options) => options.map((option) => ({
    value: (option as HTMLOptionElement).value,
    label: (option as HTMLOptionElement).textContent?.trim() ?? "",
    disabled: (option as HTMLOptionElement).disabled,
  })));
  const changedManager = eligibleManagers.find((option) => (
    !option.disabled && option.value.length > 0 && option.value !== currentManagerEmployeeId
  ));
  expect(changedManager, "fixture needs a second eligible same-department manager").toBeDefined();
  expect(changedManager!.value).not.toBe(currentManagerEmployeeId);
  await managerSelect.selectOption(changedManager!.value);
  await expect(managerSelect).toHaveValue(changedManager!.value);
  await page.getByRole("textbox", { name: "主管调整理由" }).fill("E2E 验证直属汇报关系");
  await page.getByRole("button", { name: "提交主管变更" }).click();

  await expect(page.getByText("直属主管已更新，正在刷新服务器数据。")).toBeVisible();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "分配直属主管" }).click();
  const reloadedEmployeeOption = page.getByRole("combobox", { name: "选择员工" })
    .locator("option")
    .filter({ hasText: roleFixtures.employee.displayName });
  await page.getByRole("combobox", { name: "选择员工" }).selectOption(
    (await reloadedEmployeeOption.getAttribute("value"))!,
  );
  await expect(page.getByRole("combobox", { name: "选择主管" })).toHaveValue(changedManager!.value);
  await expect(page.getByRole("combobox", { name: "选择主管" }).locator("option:checked"))
    .toContainText(changedManager!.label);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await context.close();
});
