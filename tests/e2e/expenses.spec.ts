import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { authStatePath, getAuthHarnessEnvironment } from "./auth-state";

test.describe.configure({ mode: "serial" });

const amount = "173.28";
const expenseDate = "2026-08-28";
const description = `E2E 客户现场费用 ${Date.now()}`;

type ProfileFixture = {
  public_id: string;
  employee_no: string;
};

test.beforeAll(async ({ browser }) => {
  const environment = getAuthHarnessEnvironment();
  const admin = createClient(environment.supabaseUrl, environment.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const profiles = await admin
    .from("employee_profiles")
    .select("public_id, employee_no")
    .in("employee_no", ["E2E-EMPLOYEE", "E2E-MANAGER"])
    .is("deleted_at", null);
  if (profiles.error) throw profiles.error;
  const rows = (profiles.data ?? []) as ProfileFixture[];
  const employee = rows.find((profile) => profile.employee_no === "E2E-EMPLOYEE");
  const manager = rows.find((profile) => profile.employee_no === "E2E-MANAGER");
  if (!employee || !manager) throw new Error("E2E 审批人员未完成真实身份预开通");

  const context = await browser.newContext({
    storageState: authStatePath("executive"),
    baseURL: environment.appBaseUrl,
  });
  const page = await context.newPage();
  await page.goto("/approvals", { waitUntil: "networkidle" });
  const projectionResponse = await page.request.get(
    `/api/workstation/organization/members/${employee.public_id}/manager`,
  );
  if (!projectionResponse.ok()) {
    throw new Error(`读取 E2E 汇报关系失败：${projectionResponse.status()}`);
  }
  const projection = await projectionResponse.json() as {
    managerEmployeeId: string | null;
    managerVersion: number;
    managerSource: string;
  };
  if (projection.managerEmployeeId !== manager.public_id) {
    if (projection.managerSource === "directory") {
      throw new Error("E2E 员工汇报关系由目录托管，无法切换到测试负责人");
    }
    const assignment = await page.request.post(
      `/api/workstation/organization/members/${employee.public_id}/manager`,
      {
        headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
        data: {
          managerEmployeeId: manager.public_id,
          expectedVersion: projection.managerVersion,
          reason: "本地 E2E 费用审批闭环",
        },
      },
    );
    if (!assignment.ok()) {
      throw new Error(`配置 E2E 直属主管失败：${assignment.status()} ${await assignment.text()}`);
    }
  }
  await context.close();
});

test("expense submit, manager approval, finance approval and payment survive refresh", async ({ browser }) => {
  test.setTimeout(120_000);
  const environment = getAuthHarnessEnvironment();
  const employeeContext = await browser.newContext({
    storageState: authStatePath("employee"),
    baseURL: environment.appBaseUrl,
  });
  const employeePage = await employeeContext.newPage();
  await employeePage.setViewportSize({ width: 390, height: 844 });
  await employeePage.goto("/approvals", { waitUntil: "networkidle" });
  await employeePage.getByRole("button", { name: "发起费用报销" }).click();

  const expenseDialog = employeePage.getByRole("dialog", { name: "发起费用报销" });
  await expect(expenseDialog).toBeVisible();
  const dialogBox = await expenseDialog.boundingBox();
  expect(dialogBox?.height).toBe(844);
  expect(await employeePage.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);

  await expenseDialog.getByLabel("费用类型").selectOption("transport");
  await expenseDialog.getByLabel("报销金额").fill(amount);
  await expenseDialog.getByLabel("费用日期").fill(expenseDate);
  await expenseDialog.getByLabel("费用说明").fill(description);
  const submittedResponsePromise = employeePage.waitForResponse((response) => (
    /\/api\/workstation\/expenses\/[0-9a-f-]+\/submit$/.test(new URL(response.url()).pathname)
    && response.request().method() === "POST"
  ));
  await expenseDialog.getByRole("button", { name: "提交报销" }).click();
  const submittedResponse = await submittedResponsePromise;
  expect(submittedResponse.status()).toBe(200);
  const submitted = await submittedResponse.json() as {
    expense: { approvalId: string | null; status: string };
  };
  expect(submitted.expense.status).toBe("submitted");
  expect(submitted.expense.approvalId).toMatch(/^[0-9a-f-]{36}$/);
  const approvalId = submitted.expense.approvalId!;

  await employeePage.goto(`/approvals/${approvalId}`, { waitUntil: "networkidle" });
  await expect(employeePage.getByRole("heading", { name: "费用报销审批" })).toBeVisible();
  await expect(employeePage.getByRole("button", { name: "同意申请" })).toHaveCount(0);
  await employeePage.reload({ waitUntil: "networkidle" });
  await expect(employeePage.getByText("审批中")).toBeVisible();

  const managerContext = await browser.newContext({
    storageState: authStatePath("department_head"),
    baseURL: environment.appBaseUrl,
  });
  const managerPage = await managerContext.newPage();
  await managerPage.goto(`/approvals/${approvalId}`, { waitUntil: "networkidle" });
  await managerPage.getByRole("button", { name: "同意申请" }).click();
  const managerActionPromise = managerPage.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/workstation/approvals/${approvalId}/actions`
    && response.request().method() === "POST"
  ));
  await managerPage.getByRole("button", { name: "确认同意" }).click();
  expect((await managerActionPromise).status()).toBe(200);
  await managerPage.reload({ waitUntil: "networkidle" });
  await expect(managerPage.getByText("财务复核").first()).toBeVisible();
  await managerContext.close();

  const financeContext = await browser.newContext({
    storageState: authStatePath("finance"),
    baseURL: environment.appBaseUrl,
  });
  const financePage = await financeContext.newPage();
  await financePage.goto(`/approvals/${approvalId}`, { waitUntil: "networkidle" });
  await financePage.getByRole("button", { name: "同意申请" }).click();
  const financeActionPromise = financePage.waitForResponse((response) => (
    new URL(response.url()).pathname === `/api/workstation/approvals/${approvalId}/actions`
    && response.request().method() === "POST"
  ));
  await financePage.getByRole("button", { name: "确认同意" }).click();
  expect((await financeActionPromise).status()).toBe(200);
  await financePage.reload({ waitUntil: "networkidle" });
  await expect(financePage.getByText("已通过").first()).toBeVisible();

  await financePage.getByRole("button", { name: "登记付款" }).click();
  await financePage.getByLabel("付款凭证号").fill(`BANK-E2E-${Date.now()}`);
  const paymentPromise = financePage.waitForResponse((response) => (
    /\/api\/workstation\/expenses\/[0-9a-f-]+\/payment$/.test(new URL(response.url()).pathname)
    && response.request().method() === "POST"
  ));
  await financePage.getByRole("button", { name: "确认付款" }).click();
  expect((await paymentPromise).status()).toBe(200);
  await financePage.reload({ waitUntil: "networkidle" });
  await expect(financePage.getByText("已支付")).toBeVisible();
  await expect(financePage.getByRole("button", { name: "登记付款" })).toHaveCount(0);

  await employeePage.reload({ waitUntil: "networkidle" });
  await expect(employeePage.getByText("已支付")).toBeVisible();

  const unrelatedContext = await browser.newContext({
    storageState: authStatePath("hr"),
    baseURL: environment.appBaseUrl,
  });
  const unrelatedPage = await unrelatedContext.newPage();
  const unrelatedResponse = await unrelatedPage.goto(`/approvals/${approvalId}`, { waitUntil: "networkidle" });
  expect(unrelatedResponse?.status()).toBe(404);
  await expect(unrelatedPage.getByRole("button", { name: /同意申请|登记付款/ })).toHaveCount(0);

  await unrelatedContext.close();
  await financeContext.close();
  await employeeContext.close();
});
