import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";

const htmlPath = path.join(process.cwd(), "quantxy-ai-workbench-fused.html");

async function openWorkbench(seedStorage) {
  const html = await readFile(htmlPath, "utf8");
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:3011/quantxy-ai-workbench-fused.html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      if (seedStorage) {
        for (const [key, value] of Object.entries(seedStorage)) {
          window.localStorage.setItem(key, value);
        }
      }
      window.fetch = async (url) => {
        if (String(url) === "/api/demo-auth/session") {
          return response(true, { authenticated: true });
        }
        if (String(url) === "/api/ai/config") {
          return response(true, {
            provider: "deepseek",
            apiBaseUrl: "https://api.deepseek.com",
            model: "deepseek-v4-flash",
            keyConfigured: false,
            keyHint: null,
            updatedAt: null,
            canManage: true,
          });
        }
        return response(false, { error: "unexpected_request" }, 404);
      };
    },
  });
  await waitFor(() => dom.window.Q?.gateway && dom.window.Q.S.aiConfig.loaded);
  return dom;
}

function response(ok, body, status = ok ? 200 : 400) {
  const text = JSON.stringify(body);
  return { ok, status, json: async () => body, text: async () => text };
}

async function waitFor(read) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const value = read();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for workbench state");
}

test("migrates legacy tasks to the execution schema without losing records", async () => {
  const legacy = {
    tasks: [{ id: "legacy-1", n: "旧任务", p: "p1", own: "m1", st: "待审核", e: "2026-08-20" }],
  };
  const dom = await openWorkbench({ qxy: JSON.stringify(legacy) });
  const task = dom.window.Q.S.tasks.find((item) => item.id === "legacy-1");
  assert.equal(task.st, "待验收");
  assert.equal(task.createdBy, "m14");
  assert.equal(task.reviewer, "m14");
  assert.deepEqual(Array.from(task.resultFiles), []);
  assert.ok(Array.isArray(task.timeline));
  assert.equal(dom.window.Q.S.tasks.length, 1);
  dom.window.close();
});

test("seeds identity-scoped payroll with internally consistent totals", async () => {
  const dom = await openWorkbench();
  const rows = dom.window.Q.gateway.loadPayroll("m1");
  assert.ok(rows.length >= 3);
  for (const row of rows) {
    assert.equal(row.gross, row.base + row.performance + row.projectBonus + row.otherBonus);
    assert.equal(row.deductions, row.social + row.tax + row.otherDeduction);
    assert.equal(row.net, row.gross - row.deductions);
  }
  assert.notDeepEqual(
    dom.window.Q.gateway.loadPayroll("m1"),
    dom.window.Q.gateway.loadPayroll("m2"),
  );
  dom.window.close();
});

test("migrates legacy data to a secret-free snapshot and retires the legacy key", async () => {
  const legacy = {
    tasks: [{ id: "legacy-secret", n: "旧数据", p: "p1", own: "m1", st: "待处理" }],
    cfg: {
      apiKey: "sk-legacy-secret-should-not-survive",
      proxy: "https://legacy-proxy.invalid",
      keyCleared: false,
      workday: 6,
    },
  };
  const dom = await openWorkbench({ qxy: JSON.stringify(legacy) });
  try {
    const snapshotText = dom.window.localStorage.getItem("qxy.workstation.demo.v2");
    assert.ok(snapshotText);
    const snapshot = JSON.parse(snapshotText);
    assert.equal(snapshot.cfg.workday, 6);
    assert.equal(Object.hasOwn(snapshot.cfg, "apiKey"), false);
    assert.equal(Object.hasOwn(snapshot.cfg, "proxy"), false);
    assert.equal(snapshotText.includes("sk-legacy-secret-should-not-survive"), false);
    assert.equal(dom.window.localStorage.getItem("qxy"), null);
  } finally {
    dom.window.close();
  }
});

test("falls back to valid legacy data when the v2 snapshot is corrupt", async () => {
  const legacy = {
    tasks: [{ id: "legacy-fallback", n: "回退任务", p: "p1", own: "m1", st: "待审核" }],
  };
  const dom = await openWorkbench({
    "qxy.workstation.demo.v2": "{not-valid-json",
    qxy: JSON.stringify(legacy),
  });
  try {
    assert.ok(dom.window.Q.S.tasks.some((task) => task.id === "legacy-fallback"));
    assert.doesNotThrow(() => JSON.parse(dom.window.localStorage.getItem("qxy.workstation.demo.v2")));
    assert.equal(dom.window.localStorage.getItem("qxy"), null);
  } finally {
    dom.window.close();
  }
});

test("retires a secret-bearing legacy key when a valid v2 snapshot already exists", async () => {
  const current = {
    tasks: [{ id: "v2-current", n: "当前任务", p: "p1", own: "m1", st: "待处理" }],
    cfg: { workday: 5, parallel: 3, riskLine: 20 },
  };
  const legacy = {
    tasks: [{ id: "legacy-stale", n: "遗留任务", p: "p2", own: "m2", st: "待审核" }],
    cfg: {
      apiKey: "sk-stale-legacy-secret",
      proxy: "https://stale-proxy.invalid",
      keyCleared: false,
    },
  };
  const dom = await openWorkbench({
    "qxy.workstation.demo.v2": JSON.stringify(current),
    qxy: JSON.stringify(legacy),
  });
  try {
    assert.ok(dom.window.Q.S.tasks.some((task) => task.id === "v2-current"));
    assert.equal(dom.window.Q.S.tasks.some((task) => task.id === "legacy-stale"), false);
    const snapshotText = dom.window.localStorage.getItem("qxy.workstation.demo.v2");
    assert.equal(snapshotText.includes("sk-stale-legacy-secret"), false);
    assert.equal(snapshotText.includes("stale-proxy.invalid"), false);
    assert.equal(dom.window.localStorage.getItem("qxy"), null);
  } finally {
    dom.window.close();
  }
});

test("returns defensive copies from every read-only gateway method", async () => {
  const dom = await openWorkbench();
  try {
    const { gateway, S } = dom.window.Q;
    const memberId = "m1";
    const sourceTask = S.tasks.find((task) => task.own === memberId);
    const sourceProject = gateway.listMyProjects(memberId)[0];
    const original = {
      taskName: sourceTask.n,
      timelineLength: sourceTask.timeline.length,
      projectName: sourceProject.n,
      memberName: gateway.loadBootstrap().members[0].n,
      payrollNet: S.payroll[memberId][0].net,
    };

    const listedTasks = gateway.listMyTasks(memberId, "todo", "all");
    listedTasks[0].n = "外部篡改任务";
    listedTasks[0].timeline.push({ action: "外部篡改" });

    const task = gateway.loadMyTask(memberId, sourceTask.id);
    task.n = "外部篡改单任务";
    task.timeline.push({ action: "外部篡改" });

    const projects = gateway.listMyProjects(memberId);
    projects[0].n = "外部篡改项目";

    const dashboard = gateway.loadMyDashboard(memberId);
    dashboard.tasks[0].n = "外部篡改工作台";
    dashboard.payroll.net = -1;

    const bootstrap = gateway.loadBootstrap();
    bootstrap.members[0].n = "外部篡改成员";
    bootstrap.tasks[0].n = "外部篡改启动任务";
    bootstrap.projects[0].n = "外部篡改启动项目";
    bootstrap.payroll[memberId][0].net = -2;

    const payroll = gateway.loadPayroll(memberId);
    payroll[0].net = -3;

    assert.equal(sourceTask.n, original.taskName);
    assert.equal(sourceTask.timeline.length, original.timelineLength);
    assert.equal(gateway.listMyProjects(memberId)[0].n, original.projectName);
    assert.equal(gateway.loadBootstrap().members[0].n, original.memberName);
    assert.equal(S.payroll[memberId][0].net, original.payrollNet);
  } finally {
    dom.window.close();
  }
});

test("runs claim, execution, submission, rejection, and acceptance in order", async () => {
  const dom = await openWorkbench();
  const gateway = dom.window.Q.gateway;
  const task = dom.window.Q.S.tasks.find((item) => item.st === "待处理" && item.own !== item.reviewer);
  assert.ok(task);
  assert.throws(() => gateway.claimTask(task.id, "m14"), /forbidden/);
  gateway.claimTask(task.id, task.own);
  gateway.updateTaskExecution(task.id, task.own, { progress: 60, blocker: "等待接口", nextStep: "完成联调" });
  gateway.submitTaskResult(task.id, task.own, { resultText: "已完成第一版", resultLink: "https://example.test/result", resultFiles: [] });
  assert.equal(task.st, "待验收");
  gateway.reviewTaskResult(task.id, task.reviewer, { decision: "reject", note: "补充验证记录" });
  assert.equal(task.st, "进行中");
  gateway.submitTaskResult(task.id, task.own, { resultText: "已补充验证记录", resultLink: "", resultFiles: ["验证记录.pdf"] });
  gateway.reviewTaskResult(task.id, task.reviewer, { decision: "pass", note: "验收通过" });
  assert.equal(task.st, "已完成");
  assert.equal(task.pr, 100);
  assert.deepEqual(Array.from(task.timeline).map((row) => row.action), ["领取任务", "更新执行", "提交验收", "驳回修改", "提交验收", "验收通过"]);
  assert.throws(() => gateway.reopenTask(task.id, task.own, "越权重开"), /forbidden/);
  gateway.reopenTask(task.id, task.reviewer, "补充回归验证");
  assert.equal(task.st, "进行中");
  assert.equal(task.pr, 95);
  assert.equal(task.timeline.at(-1).action, "重新打开");
  const persisted = JSON.parse(dom.window.localStorage.getItem("qxy.workstation.demo.v2"));
  const persistedTask = persisted.tasks.find((item) => item.id === task.id);
  assert.equal(persistedTask.st, "进行中");
  assert.equal(persistedTask.timeline.at(-1).note, "补充回归验证");
  dom.window.close();
});

test("validates task result and review input", async () => {
  const dom = await openWorkbench();
  const gateway = dom.window.Q.gateway;
  const task = dom.window.Q.S.tasks.find((item) => item.st === "待处理" && item.own !== item.reviewer);
  gateway.claimTask(task.id, task.own);
  assert.throws(() => gateway.claimTask(task.id, task.own), /invalid_status/);
  assert.throws(() => gateway.updateTaskExecution(task.id, "m14", { progress: 50 }), /forbidden/);
  assert.throws(() => gateway.submitTaskResult(task.id, "m14", { resultText: "成果", resultLink: "https://example.test" }), /forbidden/);
  assert.throws(() => gateway.updateTaskExecution(task.id, task.own, { progress: 101, blocker: "", nextStep: "" }), /invalid_progress/);
  assert.throws(() => gateway.submitTaskResult(task.id, task.own, { resultText: "", resultLink: "", resultFiles: [] }), /result_required/);
  gateway.submitTaskResult(task.id, task.own, { resultText: "成果", resultLink: "https://example.test", resultFiles: [] });
  assert.throws(() => gateway.reviewTaskResult(task.id, task.own, { decision: "pass", note: "" }), /forbidden/);
  assert.throws(() => gateway.reviewTaskResult(task.id, task.reviewer, { decision: "later", note: "" }), /invalid_decision/);
  assert.throws(() => gateway.reviewTaskResult(task.id, task.reviewer, { decision: "reject", note: "" }), /review_note_required/);
  dom.window.close();
});

test("does not expose or honor legacy task mutation bypasses", async () => {
  const dom = await openWorkbench();
  try {
    const { gateway, S } = dom.window.Q;
    assert.equal(gateway.saveTask, undefined);

    const task = S.tasks.find((item) => item.st === "待处理");
    const before = {
      status: task.st,
      progress: task.pr,
      timeline: task.timeline.length,
      snapshot: dom.window.localStorage.getItem("qxy.workstation.demo.v2"),
    };

    S.page = "task";
    S.sel.task = task.id;
    dom.window.Q.render();
    assert.equal(dom.window.document.querySelector('[data-act="advance"], [data-act="done"], [data-act="reject"], [data-act="reopen"]'), null);

    S.page = "me";
    S.me = task.own;
    dom.window.Q.render();
    assert.equal(dom.window.document.querySelector('[data-act="advance"], [data-act="done"], [data-act="reject"], [data-act="reopen"]'), null);

    const forgedButton = dom.window.document.createElement("button");
    forgedButton.dataset.act = "done";
    forgedButton.dataset.id = task.id;
    dom.window.document.body.append(forgedButton);
    forgedButton.click();

    assert.equal(task.st, before.status);
    assert.equal(task.pr, before.progress);
    assert.equal(task.timeline.length, before.timeline);
    assert.equal(dom.window.localStorage.getItem("qxy.workstation.demo.v2"), before.snapshot);
  } finally {
    dom.window.close();
  }
});

test("renders the normalized pending acceptance status on task surfaces", async () => {
  const dom = await openWorkbench();
  try {
    const { S } = dom.window.Q;
    const task = S.tasks.find((item) => item.st === "待验收");
    assert.ok(task);

    S.page = "task";
    S.sel.task = task.id;
    dom.window.Q.render();
    const taskView = dom.window.document.getElementById("view").textContent;
    assert.match(taskView, /待验收/);
    assert.match(taskView, new RegExp(task.n));
    assert.doesNotMatch(taskView, /待审核/);

    S.page = "me";
    S.me = task.reviewer;
    dom.window.Q.render();
    const personalView = dom.window.document.getElementById("view").textContent;
    assert.match(personalView, /待验收/);
    assert.match(personalView, new RegExp(task.n));
    assert.doesNotMatch(personalView, /待审核/);
  } finally {
    dom.window.close();
  }
});

test("changes all personal workbench collections with the selected identity", async () => {
  const dom = await openWorkbench();
  try {
    dom.window.Q.S.me = "m1";
    dom.window.Q.S.page = "me";
    dom.window.Q.render();
    const firstTasks = dom.window.Q.gateway.listMyTasks("m1", "todo", "all");
    const firstProjects = dom.window.Q.gateway.listMyProjects("m1");
    const firstPayroll = dom.window.Q.gateway.loadPayroll("m1");
    assert.ok(firstTasks.every((task) => task.own === "m1"));

    dom.window.Q.S.me = "m2";
    dom.window.Q.render();
    const secondTasks = dom.window.Q.gateway.listMyTasks("m2", "todo", "all");
    const secondProjects = dom.window.Q.gateway.listMyProjects("m2");
    const secondPayroll = dom.window.Q.gateway.loadPayroll("m2");
    assert.ok(secondTasks.every((task) => task.own === "m2"));
    assert.notDeepEqual(firstTasks.map((task) => task.id), secondTasks.map((task) => task.id));
    assert.notDeepEqual(firstProjects.map((project) => project.id), secondProjects.map((project) => project.id));
    assert.notDeepEqual(firstPayroll, secondPayroll);
  } finally {
    dom.window.close();
  }
});

test("routes clickable workbench records to their exact destination", async () => {
  const dom = await openWorkbench();
  try {
    dom.window.Q.S.me = "m1";
    dom.window.Q.S.page = "me";
    dom.window.Q.render();
    const taskButton = dom.window.document.querySelector('[data-act="open-execution"]');
    assert.ok(taskButton);
    const taskId = taskButton.getAttribute("data-id");
    taskButton.click();
    assert.equal(dom.window.Q.S.page, "execution");
    assert.equal(dom.window.Q.S.sel.task, taskId);
    assert.match(dom.window.document.getElementById("top").textContent, /任务执行详情/);

    dom.window.Q.S.page = "me";
    dom.window.Q.render();
    const projectButton = dom.window.document.querySelector('[data-act="open-my-project"]');
    assert.ok(projectButton);
    const projectId = projectButton.getAttribute("data-id");
    projectButton.click();
    assert.equal(dom.window.Q.S.page, "project");
    assert.equal(dom.window.Q.S.curProj, projectId);

    dom.window.Q.S.page = "me";
    dom.window.Q.render();
    const incomeButton = dom.window.document.querySelector('[data-act="open-income"]');
    assert.ok(incomeButton);
    const month = incomeButton.getAttribute("data-month");
    incomeButton.click();
    assert.equal(dom.window.Q.S.page, "fin");
    assert.equal(dom.window.Q.S.f.payMonth, month);
  } finally {
    dom.window.close();
  }
});

test("resets personal filters and stale record selections when identity changes", async () => {
  const dom = await openWorkbench();
  try {
    const { S } = dom.window.Q;
    S.me = "m1";
    S.page = "me";
    S.f.meScope = "created";
    S.f.meTab = "已完成";
    S.f.payMonth = "2026-07";
    S.sel.task = "t1";
    S.curProj = "p1";
    dom.window.Q.render();

    S.menu = true;
    dom.window.Q.render();
    const switchButton = dom.window.document.querySelector('[data-act="setme"][data-id="m2"]');
    assert.ok(switchButton);
    switchButton.click();

    assert.equal(S.me, "m2");
    assert.equal(S.page, "me");
    assert.equal(S.f.meScope, "todo");
    assert.equal(S.f.meTab, "all");
    assert.equal(S.f.payMonth, "");
    assert.equal(S.sel.task, null);
    assert.equal(S.curProj, null);
  } finally {
    dom.window.close();
  }
});

test("renders explicit empty personal states without borrowing another identity's data", async () => {
  const dom = await openWorkbench();
  try {
    const { S } = dom.window.Q;
    S.me = "m1";
    S.page = "me";
    S.tasks = S.tasks.filter((task) => task.own !== "m1" && task.createdBy !== "m1");
    S.proj.length = 0;
    S.payroll.m1 = [];
    dom.window.Q.render();

    const personalView = dom.window.document.getElementById("view").textContent;
    assert.match(personalView, /今日没有必须处理的事项/);
    assert.match(personalView, /当前身份暂无任务/);
    assert.match(personalView, /当前身份暂无项目/);
    assert.match(personalView, /当前身份暂无工资记录/);
    assert.match(personalView, /当前身份暂无执行提醒/);
    assert.equal(dom.window.document.querySelector('[data-act="open-execution"]'), null);
  } finally {
    dom.window.close();
  }
});
