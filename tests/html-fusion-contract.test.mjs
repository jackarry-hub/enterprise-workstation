import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const outputPath = path.join(root, "quantxy-ai-workbench-fused.html");
const deployedPath = path.join(root, "public", "quantxy-ai-workbench-fused.html");
const sourcePath = "E:/xwechat_files/wxid_dlkzyugmv5rz22_ab99/msg/file/2026-08/quantxy-ai-workbench_10(1).html";
const sourceHash = "7E2437FDC2D6E9688076D582AA683F12E9FAFB40994E2936DAB34A0A4CD44607";

export async function readFusionHtml() {
  return readFile(outputPath, "utf8");
}

test("keeps the supplied HTML source unchanged", async () => {
  const source = await readFile(sourcePath);
  const hash = createHash("sha256").update(source).digest("hex").toUpperCase();
  assert.equal(hash, sourceHash);
});

test("creates a standalone fusion HTML from the supplied baseline", async () => {
  const html = await readFusionHtml();
  assert.match(html, /<title>量子星河 QuantXY · AI 企业工作台<\/title>/);
  assert.match(html, /AI 调度中心/);
  assert.match(html, /Agent 中心/);
  assert.match(html, /组织与权限/);
});

test("registers fused navigation, routes, and persistent collections", async () => {
  const html = await readFusionHtml();
  for (const label of ["客户与交付", "活动推进", "业务决策中心"]) {
    assert.match(html, new RegExp(label));
  }
  for (const fn of ["seedCustomers", "seedActivities", "seedDecisions"]) {
    assert.match(html, new RegExp(`function ${fn}\\(`));
  }
  assert.match(html, /customers:S\.customers/);
  assert.match(html, /activities:S\.activities/);
  assert.match(html, /decisions:S\.decisions/);
  assert.match(html, /customers:viewCustomers/);
  assert.match(html, /activities:viewActivities/);
  assert.match(html, /decisions:viewDecisions/);
});

test("does not add traditional HR workflows", async () => {
  const html = await readFusionHtml();
  for (const label of ["考勤中心", "请假管理", "薪资管理", "工资单"]) {
    assert.doesNotMatch(html, new RegExp(label));
  }
});

test("implements customer delivery list, filters, detail, and creation", async () => {
  const html = await readFusionHtml();
  for (const fn of ["viewCustomers", "viewNewCustomer", "createCustomer"]) {
    assert.match(html, new RegExp(`function ${fn}\\(`));
  }
  assert.match(html, /data-q="customerQ"/);
  assert.match(html, /data-q="customerSt"/);
  assert.match(html, /data-act="open-customer"/);
  assert.match(html, /data-act="f-customer"/);
  assert.match(html, /关联项目/);
  assert.match(html, /下次跟进/);
});

test("implements activity stages, related tasks, and creation", async () => {
  const html = await readFusionHtml();
  for (const fn of ["viewActivities", "viewNewActivity", "createActivity", "activityPhases"]) {
    assert.match(html, new RegExp(`function ${fn}\\(`));
  }
  for (const stage of ["策划", "执行", "推广", "复盘"]) {
    assert.match(html, new RegExp(stage));
  }
  assert.match(html, /data-act="open-activity"/);
  assert.match(html, /data-act="f-activity"/);
  assert.match(html, /阶段任务/);
  assert.match(html, /关键节点/);
});

test("implements business decisions without leave or payroll", async () => {
  const html = await readFusionHtml();
  assert.match(html, /function viewDecisions\(/);
  assert.match(html, /function decisionRef\(/);
  assert.match(html, /待我决策/);
  assert.match(html, /我发起的/);
  assert.match(html, /已完成/);
  assert.match(html, /data-act="decision-pass"/);
  assert.match(html, /data-act="decision-reject"/);
  assert.doesNotMatch(html, /请假申请/);
});

test("surfaces fused records on the dashboard and global search", async () => {
  const html = await readFusionHtml();
  for (const label of ["重点客户机会", "重点活动进度", "待我决策"]) {
    assert.match(html, new RegExp(label));
  }
  assert.match(html, /S\.customers\.forEach/);
  assert.match(html, /S\.activities\.forEach/);
  assert.match(html, /搜索项目、任务、客户、活动、成员、文档、Agent/);
});

test("renders a standalone demo login gate before the workstation", async () => {
  const html = await readFusionHtml();
  for (const token of [
    'id="loginGate"',
    'data-login="user"',
    'data-login="pass"',
    'data-login="remember"',
    'data-act="login-toggle"',
    'data-act="login-submit"',
    "演示环境",
  ]) {
    assert.match(html, new RegExp(token));
  }
  for (const fn of ["authState", "renderLogin", "submitLogin"]) {
    assert.match(html, new RegExp(`function ${fn}\\(`));
  }
  assert.match(html, /if\(!authState\(\)\)/);
});

test("keeps authentication separate from identity and business data", async () => {
  const html = await readFusionHtml();
  assert.match(html, /var QXY_AUTH_KEY='qxy_demo_auth'/);
  assert.match(html, /sessionStorage\.setItem\(QXY_AUTH_KEY/);
  assert.match(html, /localStorage\.setItem\(QXY_AUTH_KEY/);
  assert.match(html, /sessionStorage\.removeItem\(QXY_AUTH_KEY/);
  assert.match(html, /localStorage\.removeItem\(QXY_AUTH_KEY/);
  assert.match(html, /function logoutDemo\(/);
  assert.match(html, /data-act="logout"/);
  assert.match(html, /data-act="setme"/);
  assert.match(html, /切换身份查看工作台/);
  assert.match(html, /localStorage\.setItem\(QXY_DEMO_DATA_KEY/);
  assert.doesNotMatch(html, /localStorage\.removeItem\('qxy'\)/);
});

test("keeps model credentials on the server and makes key updates write only", async () => {
  const html = await readFusionHtml();

  assert.doesNotMatch(html, /sk-[A-Za-z0-9_-]{16,}/);
  assert.doesNotMatch(html, /S\.cfg\.apiKey/);
  assert.doesNotMatch(html, /id="cfgKey"/);
  assert.doesNotMatch(html, /h\['Authorization'\]|h\['x-api-key'\]/);
  assert.match(html, /\['apiKey','proxy','keyCleared'\][\s\S]*?delete saved\.cfg/);
  assert.match(html, /fetch\('\/api\/ai\/chat'/);
  assert.match(html, /fetch\('\/api\/ai\/config'/);
  assert.match(html, /data-act="update-ai-key"/);
  assert.match(html, /data-act="save-ai-model"/);
  assert.match(html, /输入新 Key 进行更新/);
  assert.match(html, /更新密钥/);
  assert.match(html, /更新时间/);
});

test("deploys the exact fused workstation HTML through the Next public directory", async () => {
  const [source, deployed] = await Promise.all([
    readFile(outputPath),
    readFile(deployedPath),
  ]);
  assert.deepEqual(deployed, source);
});

test("offers an active secure-server entry instead of a dead file-mode form", async () => {
  const html = await readFusionHtml();

  assert.match(html, /location\.protocol==='file:'/);
  assert.match(html, /data-act="open-secure-ai"/);
  assert.match(html, /打开安全服务版/);
  assert.match(html, /http:\/\/127\.0\.0\.1:3011\/quantxy-ai-workbench-fused\.html/);
});

test("uses the original demo login UI with a server session on HTTP", async () => {
  const html = await readFusionHtml();

  assert.match(html, /fetch\('\/api\/demo-auth\/session'/);
  assert.match(html, /fetch\('\/api\/demo-auth\/login'/);
  assert.match(html, /fetch\('\/api\/demo-auth\/logout'/);
  assert.match(html, /credentials:'same-origin'/);
  assert.match(html, /LOGIN\.authenticated/);
  assert.match(html, /location\.protocol==='file:'/);
  assert.match(html, /data-act="login-submit"/);
  assert.match(html, /data-act="setme"/);
});

test("defines a replaceable personal workbench data gateway", async () => {
  const html = await readFusionHtml();
  for (const token of [
    "WORKSTATION_RUNTIME",
    "authMode:'demo'",
    "dataMode:'demo'",
    "function createDemoGateway(",
    "loadMyDashboard",
    "listMyTasks",
    "loadMyTask",
    "listMyProjects",
    "loadPayroll",
    "gateway:WORKSTATION_GATEWAY",
  ]) {
    assert.match(html, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(html, /var QXY_DEMO_DATA_KEY='qxy\.workstation\.demo\.v2'/);
  assert.doesNotMatch(html, /createServerGateway\(\)/);
});

test("renders the complete clickable personal workbench", async () => {
  const html = await readFusionHtml();
  for (const label of ["今日必须处理", "我的待办", "我发起的", "我的项目", "个人收入", "执行提醒"]) {
    assert.match(html, new RegExp(label));
  }
  for (const action of ["my-task-filter", "open-execution", "open-my-project", "open-income"]) {
    assert.match(html, new RegExp(`data-act="${action}"`));
  }
});

test("defines a complete desktop layout and a focused mobile employee shell", async () => {
  const html = await readFusionHtml();
  for (const token of [
    "personal-workbench",
    "me-identity",
    "me-summary",
    "me-focus-grid",
    "me-must",
    "me-reminders",
    "me-task-list",
    "me-secondary-grid",
    "execution-layout",
    "execution-actions",
  ]) {
    assert.match(html, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(html, /data-act="mobile-nav-more"/);
  assert.match(html, /mobile-more-panel/);
  assert.match(html, /mobile-core/);
  assert.match(html, /mobile-extra/);
  assert.match(html, /\.nav\.expanded/);
  assert.match(html, /\.execution-actions\s*\{[^}]*order:\s*-1/s);
  assert.match(html, /\.me-must\s*\{[^}]*order:\s*1/s);
  assert.match(html, /min-height:\s*44px/);
});

test("keeps the mobile personal workbench intentionally minimal", async () => {
  const html = await readFusionHtml();
  assert.match(html, /mobile-task-focus/);
  assert.match(html, /mobile-nav-label/);
  assert.match(html, /@media \(max-width:820px\)[\s\S]*?\.side\s*\{[^}]*position:\s*fixed[^}]*bottom:\s*0/s);
  assert.match(html, /@media \(max-width:820px\)[\s\S]*?\.brand\s*\{[^}]*display:\s*none/s);
  assert.match(html, /\.personal-workbench:not\(\.mobile-task-focus\) \.me-task-list\s*\{[^}]*display:\s*none/s);
  assert.match(html, /\.personal-workbench:not\(\.mobile-task-focus\) \.me-secondary-grid\s*\{[^}]*display:\s*none/s);
  assert.match(html, /\.personal-workbench\.mobile-task-focus \.me-task-list\s*\{[^}]*display:\s*block/s);
  assert.match(html, /\.task-priority\s*\{[^}]*display:\s*none/s);
  assert.match(html, /\.me-task-list \.hd h3\s*\{[^}]*display:\s*none/s);
  assert.match(html, /\.me-reminders button>\.tag\s*\{[^}]*display:\s*none/s);
  assert.match(html, /\.top \.search,\.top \.quick-create\s*\{[^}]*display:\s*none/s);
});

test("uses clear scoped employee copy and accessible shell controls", async () => {
  const html = await readFusionHtml();
  assert.match(html, /我的逾期/);
  assert.match(html, /reviewScope\?'待我验收':'我的任务'/);
  assert.match(html, /领取任务并开始执行/);
  assert.match(html, /领取后开始处理，完成后提交负责人验收。/);
  assert.match(html, /data-act="notifications"/);
  assert.match(html, /aria-label="通知，',notices\.length,' 条待处理"/);
  assert.match(html, /data-page-heading/);
});

test("registers the personal execution detail and closed-loop controls", async () => {
  const html = await readFusionHtml();
  assert.match(html, /execution:\s*viewExecution/);
  for (const fn of ["viewExecution", "readExecutionInput", "readResultInput"]) {
    assert.match(html, new RegExp(`function ${fn}\\(`));
  }
  for (const action of ["task-claim", "task-save-progress", "task-submit", "task-pass", "task-reject", "task-reopen"]) {
    assert.match(html, new RegExp(`data-act="${action}"`));
  }
  for (const label of ["任务说明", "验收标准", "阻塞原因", "成果说明", "成果链接", "执行记录"]) {
    assert.match(html, new RegExp(label));
  }
});

test("replaces corporate finance with personal salary and bonus detail", async () => {
  const html = await readFusionHtml();
  const start = html.indexOf("function viewFin()");
  const end = html.indexOf("/* ---------------- 页面：知识中心", start);
  const source = html.slice(start, end);
  for (const label of [
    "我的薪酬",
    "基本工资",
    "绩效奖金",
    "项目奖金",
    "其他奖励",
    "社保公积金",
    "个人所得税",
    "应发工资",
    "实发工资",
    "最近月份工资记录",
  ]) {
    assert.match(source, new RegExp(label));
  }
  for (const forbidden of ["营业收入", "净利润", "经营现金流", "预算执行", "收入 / 支出结构"]) {
    assert.doesNotMatch(source, new RegExp(forbidden));
  }
  assert.match(source, /data-act="payroll-month"/);
  assert.match(source, /data-act="payroll-focus"/);
  assert.match(source, /<button[^>]*data-act="payroll-month"/);
  assert.doesNotMatch(source, /<tr[^>]*data-act="payroll-month"/);
});

test("reserves Feishu cutover without activating a fake server adapter", async () => {
  const html = await readFusionHtml();
  assert.match(html, /features:\{identitySwitch:true,demoReset:true\}/);
  assert.match(html, /workstationFeatures\(\)\.identitySwitch/);
  for (const method of [
    "getSession",
    "loadBootstrap",
    "loadMyDashboard",
    "listMyTasks",
    "loadMyTask",
    "listMyProjects",
    "loadPayroll",
    "saveTask",
    "clearDemoData",
    "resetDemoData",
    "submitTaskResult",
    "reviewTaskResult",
  ]) {
    assert.match(html, new RegExp(`${method}:`));
  }
  assert.doesNotMatch(html, /createServerGateway\(\)/);
  assert.doesNotMatch(
    html,
    /NEXT_PUBLIC_FEISHU|FEISHU_APP_SECRET|user_access_token|authorization_code/,
  );
  assert.match(html, /window\.QUANTXY_WORKSTATION_RUNTIME/);
  assert.match(html, /window\.QUANTXY_WORKSTATION_SERVER_ADAPTER/);
  assert.match(html, /if\(isDemoRuntime\(\)\) return createDemoGateway\(\)/);
  assert.doesNotMatch(html, /var WORKSTATION_GATEWAY=createDemoGateway\(\)/);
});
