import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3010";
const outputDir = process.env.DEMO_EVIDENCE_DIR
  ?? path.join(tmpdir(), "quantnexus-dual-workstream-evidence");

const actors = {
  "actor-executive": { name: "林远", route: "/execution" },
  "actor-manager": { name: "张伟", route: "/department" },
  "actor-employee": { name: "陈晨", route: "/execution" },
  "actor-qa": { name: "郭敏", route: "/execution" },
  "actor-market": { name: "王芳", route: "/department" },
  "actor-designer": { name: "刘洋", route: "/department" },
  "actor-sales": { name: "赵敏", route: "/department" },
  "actor-operations": { name: "孙悦", route: "/execution" },
  "actor-finance": { name: "周倩", route: "/finance" },
  "actor-hr": { name: "李琪", route: "/hr" },
};

function check(value, message) {
  if (!value) throw new Error(message);
}

async function readState(page) {
  return page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((candidate) => (
      candidate.startsWith("enterprise-workspace.operations.v1:")
    ));
    if (!key) throw new Error("Runtime Demo Repository 尚未创建");
    return JSON.parse(window.localStorage.getItem(key));
  });
}

async function chooseIdentity(page, actorId) {
  const actor = actors[actorId];
  check(actor, `未配置演示身份：${actorId}`);
  await page.getByRole("button", { name: "打开用户菜单" }).click();
  await page.getByRole("menuitem", { name: new RegExp(`切换为 ${actor.name}`) }).click();
  await page.getByRole("menu").waitFor({ state: "hidden" });
}

async function dispatchWithDeepSeek(page) {
  await chooseIdentity(page, "actor-executive");
  await page.goto(`${baseURL}/dashboard`, { waitUntil: "domcontentloaded" });
  const responsePromise = page.waitForResponse((response) => (
    response.url().endsWith("/api/ai/dispatch") && response.request().method() === "POST"
  ));
  await page.getByPlaceholder("告诉AI企业大脑，你今天想推进什么……")
    .fill("3天内完成移动端V1并安排团队执行");
  await page.getByRole("button", { name: "AI分析并生成调度方案" }).click();
  const response = await responsePromise;
  const payload = await response.json().catch(() => null);
  check(response.ok(), `DeepSeek 调度接口失败：${response.status()} ${payload?.error?.message ?? "unknown"}`);
  check(payload?.mode === "demo" && payload?.model && payload?.plan?.tasks?.length > 0, "DeepSeek 未返回有效结构化方案");
  await page.getByRole("heading", { name: "AI调度方案" }).waitFor({ timeout: 45_000 });
  await page.getByRole("button", { name: "确认并下发" }).click();
  await page.getByText(/已下发 \d+ 项任务至 \d+ 人/).waitFor();
  return { model: payload.model, taskCount: payload.plan.tasks.length };
}

async function waitForTask(page, taskId, status) {
  await page.waitForFunction(({ id, expected }) => {
    const key = Object.keys(window.localStorage).find((candidate) => (
      candidate.startsWith("enterprise-workspace.operations.v1:")
    ));
    const state = key ? JSON.parse(window.localStorage.getItem(key)) : null;
    return state?.tasks?.find((task) => task.id === id)?.status === expected;
  }, { id: taskId, expected: status });
}

async function completeTask(page, task) {
  const assignee = actors[task.assigneeId];
  const reviewerId = task.responsiblePersonId ?? task.departmentOwnerId;
  const reviewer = actors[reviewerId];
  check(assignee && reviewer, `任务身份映射缺失：${task.title}`);

  await chooseIdentity(page, task.assigneeId);
  await page.goto(`${baseURL}${assignee.route}#task-${task.id}`, { waitUntil: "domcontentloaded" });
  let card = page.locator(`#task-${task.id}`);
  await card.waitFor();
  await card.getByRole("button", { name: `领取任务：${task.title}` }).click();
  await waitForTask(page, task.id, "accepted");
  card = page.locator(`#task-${task.id}`);
  await card.getByRole("button", { name: `开始执行：${task.title}` }).click();
  await waitForTask(page, task.id, "in_progress");
  card = page.locator(`#task-${task.id}`);
  await card.getByRole("button", { name: "更新进度 50%" }).click();
  await card.getByLabel("成果说明").fill(`${task.title}已完成，可按验收标准检查。`);
  await card.getByLabel("模拟附件名").fill(`${task.id}-evidence.pdf`);
  await card.getByRole("button", { name: "提交成果并验收" }).click();
  await waitForTask(page, task.id, "review");

  if (reviewerId !== task.assigneeId) await chooseIdentity(page, reviewerId);
  await page.goto(`${baseURL}${reviewer.route}#review-${task.id}`, { waitUntil: "domcontentloaded" });
  const review = page.locator(`#review-${task.id}`);
  await review.waitFor();
  const reviewInput = review.getByLabel("进度、阻塞或验收意见");
  await reviewInput.fill("成果符合验收标准，同意通过。");
  await review.getByRole("button", { name: "通过验收" }).click();
  await waitForTask(page, task.id, "done");
}

async function assertNoOverflow(page, label) {
  const overflow = await page.evaluate(() => (
    document.documentElement.scrollWidth > document.documentElement.clientWidth
  ));
  check(!overflow, `${label} 存在横向溢出`);
}

await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
const consoleErrors = [];
page.on("console", (message) => {
  if (message.type() === "error") consoleErrors.push(message.text());
});

try {
  await page.goto(`${baseURL}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "打开用户菜单" }).waitFor();

  const initial = await readState(page);
  const departmentTasks = initial.tasks.filter(({ runtimeSource }) => runtimeSource === "department_mock");
  check(departmentTasks.length === 10, `初始部门任务应为 10 项，实际 ${departmentTasks.length}`);
  check(new Set(departmentTasks.map(({ assigneeId }) => assigneeId)).size === 10, "十名演示身份未各自获得个人任务");
  check(initial.workstreams.filter(({ source }) => source === "department_mock").length === 3, "初始部门工作流应为 3 条");
  console.log("VERIFY 1/6: ten identities and department seed are complete");

  const deepSeek = await dispatchWithDeepSeek(page);
  const dispatched = await readState(page);
  const aiTasks = dispatched.tasks.filter(({ runtimeSource }) => runtimeSource === "ai_dispatch");
  check(aiTasks.length === deepSeek.taskCount, "AI 方案与落库任务数不一致");
  check(dispatched.tasks.filter(({ runtimeSource }) => runtimeSource === "department_mock").length === 10, "AI 下发覆盖了部门任务");
  check(dispatched.workstreams.some(({ id }) => id === dispatched.activeAiWorkstreamId), "活动 AI 工作流未落库");
  console.log(`VERIFY 2/6: real DeepSeek structured plan dispatched (${deepSeek.taskCount} tasks, model=${deepSeek.model})`);

  const departmentTask = dispatched.tasks.find(({ id }) => id === "dept-task-engineer")
    ?? departmentTasks[0];
  await completeTask(page, departmentTask);
  await completeTask(page, aiTasks[0]);
  const completed = await readState(page);
  check(completed.tasks.find(({ id }) => id === departmentTask.id)?.status === "done", "部门任务未完成闭环");
  check(completed.tasks.find(({ id }) => id === aiTasks[0].id)?.status === "done", "AI 任务未完成闭环");
  console.log("VERIFY 3/6: department and AI task lifecycles both completed through the UI");

  await chooseIdentity(page, "actor-executive");
  await page.goto(`${baseURL}/projects`, { waitUntil: "domcontentloaded" });
  for (const workstream of completed.workstreams) {
    const link = page.locator(`a[href="/projects/${workstream.projectId}"]`).first();
    await link.waitFor();
  }
  const projectId = completed.workstreams[0].projectId;
  await page.locator(`a[href="/projects/${projectId}"]`).first().click();
  await page.waitForURL((url) => url.pathname === `/projects/${projectId}`);
  await page.getByRole("tab", { name: "任务" }).click();
  check(await page.locator("main").getByRole("heading").count() > 0, "工作流项目详情为空");
  await assertNoOverflow(page, "desktop project detail");
  await page.screenshot({ path: path.join(outputDir, "desktop-project-detail.png"), fullPage: true });
  console.log("VERIFY 4/6: every workstream has a clickable project and non-empty detail");

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 393, height: 852 },
    { width: 430, height: 932 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto(`${baseURL}/dashboard`, { waitUntil: "domcontentloaded" });
    await page.getByRole("navigation", { name: "移动端主导航" }).waitFor();
    await page.getByTestId("mobile-task-row").first().waitFor();
    await assertNoOverflow(page, `mobile dashboard ${viewport.width}x${viewport.height}`);
    await page.goto(`${baseURL}/projects`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("mobile-project-card").first().waitFor();
    await assertNoOverflow(page, `mobile projects ${viewport.width}x${viewport.height}`);
    await page.screenshot({ path: path.join(outputDir, `mobile-${viewport.width}x${viewport.height}.png`), fullPage: true });
  }
  console.log("VERIFY 5/6: all three mobile viewports share state and have no horizontal overflow");

  await page.setViewportSize({ width: 1440, height: 960 });
  await page.goto(`${baseURL}/dashboard`, { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "历史指令" }).click();
  await page.getByRole("heading", { name: "AI 调度历史" }).waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "重置本次 AI 调度" }).waitFor();
  await assertNoOverflow(page, "desktop dashboard");
  check(consoleErrors.length === 0, `浏览器控制台错误：${consoleErrors.join(" | ")}`);
  await page.screenshot({ path: path.join(outputDir, "desktop-dashboard.png"), fullPage: true });
  console.log("VERIFY 6/6: core controls respond and browser console is clean");
  console.log(`EVIDENCE_DIR=${outputDir}`);
} finally {
  await browser.close();
}
