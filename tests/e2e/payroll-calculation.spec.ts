import { expect, test } from "@playwright/test";

const calculatedPayslip = {
  month: "2026-08",
  base: 20000,
  performance: 1000,
  projectBonus: 2000,
  otherBonus: 1500,
  otherIncome: 500,
  pensionEmployee: 1600,
  medicalEmployee: 400,
  unemploymentEmployee: 100,
  housingFundEmployee: 1400,
  social: 3500,
  cumulativeTaxableIncome: 120000,
  tax: 620,
  otherDeduction: 80,
  manualAdjustmentReason: "补扣上月餐费",
  calculationVersion: "cn-cumulative-withholding-v1",
  status: "已发放",
  payDate: "2026-09-10",
};

test("employee can expand only their calculated payslip on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 430, height: 932 });
  await page.route("**/api/workstation/bootstrap", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        mode: "server",
        session: {
          authenticated: true,
          authMode: "feishu",
          dataMode: "server",
          memberId: "m7",
          permissions: ["task.execute", "payroll.read.self"],
        },
        members: [
          { id: "m7", n: "张云帆", r: "产品经理", sk: "需求分析", dept: "产品中心", rate: 0, cap: 0.8, lv: 3 },
          { id: "m8", n: "其他员工", r: "工程师", sk: "研发", dept: "研发中心", rate: 0, cap: 0.8, lv: 2 },
        ],
        projects: [],
        tasks: [],
        payroll: {
          m7: [calculatedPayslip],
          m8: [{ ...calculatedPayslip, base: 999999 }],
        },
        kb: [],
        depts: ["产品中心", "研发中心"],
        customers: [],
        activities: [],
        decisions: [],
        agents: [],
        runs: [],
        reqs: [],
        appr: [],
        features: { identitySwitch: false, demoReset: false },
      }),
    });
  });

  await page.goto("/quantxy-ai-workbench-fused.html?formal=1", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "我的薪酬" }).click();

  await expect(page.getByText("实发工资", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("应发工资", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("扣款合计", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("999,999")).toHaveCount(0);

  const toggle = page.getByRole("button", { name: /查看核算明细/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(page.locator("[data-payroll-details]")).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("养老保险", { exact: true })).toBeVisible();
  await expect(page.getByText("本期个人所得税", { exact: true })).toBeVisible();
  await expect(page.getByText("补扣上月餐费", { exact: true })).toBeVisible();

  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  await expect(page.locator("[data-member-id]")).toHaveCount(0);
});
