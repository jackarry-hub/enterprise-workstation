import { expect, test } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const suffix = Date.now();
const projectName = `E2E 执行闭环 ${suffix}`;
const taskName = `E2E 真实任务 ${suffix}`;
const reportSummary = `E2E 完成交付 ${suffix}`;
let projectPath = "";

test("creates the project and task through transaction-backed commands", async ({ page }) => {
  await page.goto("/projects", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "新建项目" }).click();
  const projectDialog = page.getByRole("dialog", { name: "新建项目" });
  await projectDialog.getByLabel("项目名称").fill(projectName);
  await projectDialog.getByLabel("项目描述").fill("覆盖项目、任务、日报和刷新持久化闭环");
  await projectDialog.getByLabel("开始日期").fill("2026-08-27");
  await projectDialog.getByLabel("截止日期").fill("2026-10-30");
  await projectDialog.getByRole("button", { name: "创建项目" }).click();
  await expect(page).toHaveURL(/\/projects\/[0-9a-f-]{36}$/);
  projectPath = new URL(page.url()).pathname;

  await page.getByRole("button", { name: "添加任务" }).click();
  const taskDialog = page.getByRole("dialog", { name: "新建任务" });
  await taskDialog.getByLabel("任务名称").fill(taskName);
  await taskDialog.getByLabel("任务描述").fill("验证服务端创建和刷新恢复");
  await taskDialog.getByLabel("验收标准").fill("刷新后项目详情和任务中心均可查询");
  await taskDialog.getByRole("button", { name: "创建任务" }).click();
  await expect(taskDialog).toBeHidden();

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "任务" }).click();
  await expect(page.getByText(taskName).first()).toBeVisible();
});

test("submits a real daily report and restores it after refresh", async ({ page }) => {
  expect(projectPath).not.toBe("");
  await page.goto(projectPath, { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "日报" }).click();
  await page.getByLabel("今日完成").fill(reportSummary);
  await page.getByLabel("下一步计划").fill("进入跨角色验收");
  await page.getByRole("button", { name: "提交日报" }).click();
  await expect(page.getByRole("status")).toHaveText("日报已提交并写入项目动态");

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "日报" }).click();
  await expect(page.getByText(reportSummary)).toBeVisible();
});

test("opens the persisted task in a mobile full-screen detail", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tasks", { waitUntil: "networkidle" });
  await page.getByRole("searchbox", { name: "搜索任务或项目" }).fill(taskName);
  await page.getByRole("button", { name: `查看任务详情：${taskName}` }).click();

  const detail = page.getByRole("dialog");
  await expect(detail.getByText(taskName)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
});
