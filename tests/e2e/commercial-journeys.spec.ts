import { expect, test } from "@playwright/test";

import { additionalRoleFixtures, authStatePath } from "./auth-state";

test.describe.configure({ mode: "serial" });

const REQUIRED_DESKTOP_JOURNEY = [
  ["/people", "员工目录"],
  ["/projects", "项目管理中心"],
  ["/tasks", "任务管理"],
  ["/customers", "客户管理"],
  ["/approvals", "审批中心"],
  ["/payroll", "薪资管理"],
  ["/knowledge", "企业知识库"],
  ["/assistant", "AI 助手"],
  ["/agents", "Agent 中心"],
  ["/dashboard", "经营数据分析"],
  ["/settings", "系统设置"],
] as const;

test("owner can traverse the complete real-data commercial journey without fallback data", async ({ page }, testInfo) => {
  test.setTimeout(240_000);
  const serverFailures: string[] = [];
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === new URL(testInfo.project.use.baseURL as string).origin && response.status() >= 500) {
      serverFailures.push(`${response.request().method()} ${url.pathname} ${response.status()}`);
    }
  });

  for (const [route, heading] of REQUIRED_DESKTOP_JOURNEY) {
    await page.goto(route, { waitUntil: "networkidle" });
    await expect(page).toHaveURL(new RegExp(`${route.replaceAll("/", "\\/")}(?:\\?|$)`));
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expect(page.getByText(/真实数据服务不可用|演示数据|Mock 数据/i)).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath(`${route.slice(1)}-desktop.png`), fullPage: true });
  }
  expect(serverFailures).toEqual([]);
});

test("admin and supervisor are distinct real identities with direct-manager scope", async ({ browser }) => {
  const adminContext = await browser.newContext({ storageState: authStatePath("admin") });
  const adminPage = await adminContext.newPage();
  await adminPage.goto("/settings", { waitUntil: "networkidle" });
  await expect(adminPage.getByRole("img", { name: additionalRoleFixtures.admin.displayName })).toBeVisible();

  const supervisorContext = await browser.newContext({ storageState: authStatePath("supervisor") });
  const supervisorPage = await supervisorContext.newPage();
  await supervisorPage.goto("/people", { waitUntil: "networkidle" });
  await expect(supervisorPage.getByRole("img", { name: additionalRoleFixtures.supervisor.displayName })).toBeVisible();
  await expect(supervisorPage.getByText("E2E 普通员工").first()).toBeVisible();
  await adminContext.close();
  await supervisorContext.close();
});

test("mobile commercial journey behaves as an app and never overflows", async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 390, height: 844 });
  for (const [route, heading] of REQUIRED_DESKTOP_JOURNEY) {
    await page.goto(route, { waitUntil: "networkidle" });
    await expect(page).toHaveURL(new RegExp(`${route.replaceAll("/", "\\/")}(?:\\?|$)`));
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.getByTestId("mobile-primary-nav")).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${route.slice(1)}-mobile.png`), fullPage: true });
  }
});
