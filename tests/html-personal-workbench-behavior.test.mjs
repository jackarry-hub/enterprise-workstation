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

async function readRealModeHtml() {
  return readFile(htmlPath, "utf8");
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
  assert.equal(task.revision, 0);
  const initialRevision = task.revision;
  dom.window.Q.S.me = task.own;
  assert.throws(() => gateway.claimTask(task.id, "m14"), /forbidden/);
  gateway.claimTask(task.id, task.own);
  gateway.updateTaskExecution(task.id, task.own, { progress: 60, blocker: "等待接口", nextStep: "完成联调" });
  gateway.submitTaskResult(task.id, task.own, { resultText: "已完成第一版", resultLink: "https://example.test/result", resultFiles: [] });
  assert.equal(task.st, "待验收");
  dom.window.Q.S.me = task.reviewer;
  gateway.reviewTaskResult(task.id, task.reviewer, { decision: "reject", note: "补充验证记录" });
  assert.equal(task.st, "进行中");
  dom.window.Q.S.me = task.own;
  gateway.submitTaskResult(task.id, task.own, { resultText: "已补充验证记录", resultLink: "", resultFiles: ["验证记录.pdf"] });
  dom.window.Q.S.me = task.reviewer;
  gateway.reviewTaskResult(task.id, task.reviewer, { decision: "pass", note: "验收通过" });
  assert.equal(task.st, "已完成");
  assert.equal(task.pr, 100);
  assert.deepEqual(Array.from(task.timeline).map((row) => row.action), ["领取任务", "更新执行", "提交验收", "驳回修改", "提交验收", "验收通过"]);
  assert.throws(() => gateway.reopenTask(task.id, task.own, "越权重开"), /forbidden/);
  gateway.reopenTask(task.id, task.reviewer, "补充回归验证");
  assert.equal(task.st, "进行中");
  assert.equal(task.pr, 95);
  assert.equal(task.timeline.at(-1).action, "重新打开");
  assert.equal(task.revision, initialRevision + 7);
  const persisted = JSON.parse(dom.window.localStorage.getItem("qxy.workstation.demo.v2"));
  const persistedTask = persisted.tasks.find((item) => item.id === task.id);
  assert.equal(persistedTask.st, "进行中");
  assert.equal(persistedTask.timeline.at(-1).note, "补充回归验证");
  assert.equal(persistedTask.revision, initialRevision + 7);
  dom.window.close();
});

test("validates task result and review input", async () => {
  const dom = await openWorkbench();
  const gateway = dom.window.Q.gateway;
  const task = dom.window.Q.S.tasks.find((item) => item.st === "待处理" && item.own !== item.reviewer);
  dom.window.Q.S.me = task.own;
  gateway.claimTask(task.id, task.own);
  assert.throws(() => gateway.claimTask(task.id, task.own), /invalid_status/);
  assert.throws(() => gateway.updateTaskExecution(task.id, "m14", { progress: 50 }), /forbidden/);
  assert.throws(() => gateway.submitTaskResult(task.id, "m14", { resultText: "成果", resultLink: "https://example.test" }), /forbidden/);
  assert.throws(() => gateway.updateTaskExecution(task.id, task.own, { progress: 101, blocker: "", nextStep: "" }), /invalid_progress/);
  assert.throws(() => gateway.submitTaskResult(task.id, task.own, { resultText: "", resultLink: "", resultFiles: [] }), /result_required/);
  gateway.submitTaskResult(task.id, task.own, { resultText: "成果", resultLink: "https://example.test", resultFiles: [] });
  assert.throws(() => gateway.reviewTaskResult(task.id, task.own, { decision: "pass", note: "" }), /forbidden/);
  dom.window.Q.S.me = task.reviewer;
  assert.throws(() => gateway.reviewTaskResult(task.id, task.reviewer, { decision: "later", note: "" }), /invalid_decision/);
  assert.throws(() => gateway.reviewTaskResult(task.id, task.reviewer, { decision: "reject", note: "" }), /review_note_required/);
  dom.window.close();
});

test("saves only whitelisted task fields with actor authorization and optimistic revision locking", async () => {
  const dom = await openWorkbench();
  try {
    const { gateway, S } = dom.window.Q;
    assert.equal(typeof gateway.saveTask, "function");
    const task = S.tasks.find((item) => item.st === "待处理" && item.createdBy !== item.own);
    S.me = task.createdBy;
    const before = {
      status: task.st,
      owner: task.own,
      reviewer: task.reviewer,
      createdBy: task.createdBy,
      progress: task.pr,
      timeline: JSON.stringify(task.timeline),
      revision: task.revision,
    };

    const saved = gateway.saveTask(
      { id: task.id, n: "安全更新后的任务", description: "更新任务说明", ac: "更新验收标准", pri: "P2" },
      before.revision,
    );
    assert.equal(saved.revision, before.revision + 1);
    assert.equal(task.revision, before.revision + 1);
    assert.equal(task.n, "安全更新后的任务");
    assert.equal(task.description, "更新任务说明");
    assert.equal(task.ac, "更新验收标准");
    assert.equal(task.pri, "P2");
    assert.equal(task.st, before.status);
    assert.equal(task.own, before.owner);
    assert.equal(task.reviewer, before.reviewer);
    assert.equal(task.createdBy, before.createdBy);
    assert.equal(task.pr, before.progress);
    assert.equal(JSON.stringify(task.timeline), before.timeline);

    assert.throws(
      () => gateway.saveTask({ id: task.id, description: "过期写入" }, before.revision),
      /revision_conflict/,
    );
    for (const protectedPatch of [
      { st: "已完成" },
      { own: S.me },
      { reviewer: S.me },
      { createdBy: S.me },
      { timeline: [] },
      { pr: 100 },
      { revision: 999 },
    ]) {
      assert.throws(
        () => gateway.saveTask({ id: task.id, ...protectedPatch }, task.revision),
        /protected_field/,
      );
    }

    const beforeInvalidName = task.n;
    const beforeInvalidRevision = task.revision;
    assert.throws(
      () => gateway.saveTask({ id: task.id, n: "不应部分写入", pri: "P9" }, task.revision),
      /invalid_priority/,
    );
    assert.equal(task.n, beforeInvalidName);
    assert.equal(task.revision, beforeInvalidRevision);

    S.me = S.me === "m7" ? "m8" : "m7";
    assert.throws(
      () => gateway.saveTask({ id: task.id, description: "越权写入" }, task.revision),
      /forbidden/,
    );
    assert.equal(task.st, before.status);
    assert.equal(task.own, before.owner);
    assert.equal(task.reviewer, before.reviewer);
    assert.equal(task.createdBy, before.createdBy);
    assert.equal(JSON.stringify(task.timeline), before.timeline);
  } finally {
    dom.window.close();
  }
});

test("does not honor legacy task mutation action bypasses", async () => {
  const dom = await openWorkbench();
  try {
    const { S } = dom.window.Q;
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

test("executes a pending task from the rendered detail controls", async () => {
  const dom = await openWorkbench();
  try {
    const task = dom.window.Q.S.tasks.find((item) => item.st === "待处理");
    dom.window.Q.S.me = task.own;
    dom.window.Q.S.sel.task = task.id;
    dom.window.Q.S.page = "execution";
    dom.window.Q.render();
    dom.window.document.querySelector('[data-act="task-claim"]').click();
    const progress = dom.window.document.querySelector("#execProgress");
    progress.value = "45";
    dom.window.document.querySelector('[data-act="task-save-progress"]').click();
    assert.equal(task.st, "进行中");
    assert.equal(task.pr, 45);
    assert.match(dom.window.document.querySelector("#view").textContent, /45%/);
  } finally {
    dom.window.close();
  }
});

test("shows only the selected identity payroll and clears stale month selection", async () => {
  const dom = await openWorkbench();
  try {
    const { S, gateway } = dom.window.Q;
    S.me = "m1";
    S.page = "fin";
    dom.window.Q.render();
    const firstNet = gateway.loadPayroll("m1")[0].net;
    assert.match(
      dom.window.document.querySelector("#view").textContent,
      new RegExp(firstNet.toLocaleString("zh-CN")),
    );

    S.f.payMonth = gateway.loadPayroll("m1")[1].month;
    S.f.payFocus = "performance";
    S.menu = true;
    dom.window.Q.render();
    dom.window.document.querySelector('[data-act="setme"][data-id="m2"]').click();

    assert.equal(S.me, "m2");
    assert.equal(S.f.payMonth, "");
    assert.equal(S.f.payFocus, "");
    const secondNet = gateway.loadPayroll("m2")[0].net;
    assert.notEqual(secondNet, firstNet);
    S.page = "fin";
    dom.window.Q.render();
    const secondView = dom.window.document.querySelector("#view").textContent;
    assert.match(secondView, new RegExp(secondNet.toLocaleString("zh-CN")));
    assert.doesNotMatch(secondView, new RegExp(firstNet.toLocaleString("zh-CN")));
  } finally {
    dom.window.close();
  }
});

test("opens a selected payroll month and salary component without leaving personal finance", async () => {
  const dom = await openWorkbench();
  try {
    const { S, gateway } = dom.window.Q;
    S.me = "m1";
    S.page = "fin";
    dom.window.Q.render();
    const month = gateway.loadPayroll("m1")[1].month;
    const monthButton = dom.window.document.querySelector(
      `[data-act="payroll-month"][data-month="${month}"]`,
    );
    assert.ok(monthButton);
    monthButton.click();
    assert.equal(S.page, "fin");
    assert.equal(S.f.payMonth, month);
    assert.match(dom.window.document.querySelector("#view").textContent, new RegExp(`${month} 薪酬明细`));

    const projectBonusCard = dom.window.document.querySelector(
      '[data-act="payroll-focus"][data-focus="projectBonus"]',
    );
    assert.ok(projectBonusCard);
    projectBonusCard.click();
    assert.equal(S.f.payFocus, "projectBonus");
    assert.match(dom.window.document.querySelector("#view").textContent, /项目奖金明细/);
  } finally {
    dom.window.close();
  }
});

test("recomputes displayed payroll totals instead of trusting stored aggregate fields", async () => {
  const dom = await openWorkbench();
  try {
    const { S } = dom.window.Q;
    S.me = "m1";
    S.page = "fin";
    const row = S.payroll.m1[0];
    const expectedGross = row.base + row.performance + row.projectBonus + row.otherBonus;
    const expectedDeductions = row.social + row.tax + row.otherDeduction;
    const expectedNet = expectedGross - expectedDeductions;
    row.gross = -111;
    row.deductions = -222;
    row.net = -333;
    dom.window.Q.render();
    const view = dom.window.document.querySelector("#view").textContent;
    assert.match(view, new RegExp(expectedGross.toLocaleString("zh-CN")));
    assert.match(view, new RegExp(expectedDeductions.toLocaleString("zh-CN")));
    assert.match(view, new RegExp(expectedNet.toLocaleString("zh-CN")));
    assert.doesNotMatch(view, /-333/);
  } finally {
    dom.window.close();
  }
});

test("renders a safe empty payroll state for the selected identity", async () => {
  const dom = await openWorkbench();
  try {
    const { S } = dom.window.Q;
    S.me = "m1";
    S.page = "fin";
    S.payroll.m1 = [];
    dom.window.Q.render();
    assert.match(dom.window.document.querySelector("#view").textContent, /当前身份暂无工资记录/);
    assert.equal(dom.window.document.querySelector('[data-act="payroll-month"]'), null);
    assert.equal(dom.window.document.querySelector('[data-act="payroll-focus"]'), null);
  } finally {
    dom.window.close();
  }
});

test("uses the true latest recomputed payroll on both personal workbench and finance", async () => {
  const dom = await openWorkbench();
  try {
    const { S } = dom.window.Q;
    S.me = "m1";
    S.payroll.m1 = [
      {
        month: "2026-05",
        base: 10000,
        performance: 500,
        projectBonus: 200,
        otherBonus: 100,
        social: 1000,
        tax: 300,
        otherDeduction: 50,
        gross: 1,
        deductions: 2,
        net: 3,
        status: "已发放",
        payDate: "2026-05-10",
      },
      {
        month: "2026-09",
        base: 20000,
        performance: 1200,
        projectBonus: 700,
        otherBonus: 100,
        social: 2100,
        tax: 800,
        otherDeduction: 200,
        gross: 111,
        deductions: 222,
        net: 333,
        status: "待发放",
        payDate: "",
      },
    ];

    S.page = "me";
    dom.window.Q.render();
    const personalText = dom.window.document.querySelector("#view").textContent;
    for (const expected of ["2026-09", "22,000", "3,100", "18,900"]) {
      assert.match(personalText, new RegExp(expected));
    }
    assert.doesNotMatch(personalText, /333/);

    S.page = "fin";
    dom.window.Q.render();
    const financeText = dom.window.document.querySelector("#view").textContent;
    for (const expected of ["2026-09", "22,000", "3,100", "18,900"]) {
      assert.match(financeText, new RegExp(expected));
    }
  } finally {
    dom.window.close();
  }
});

test("renders each payroll month as one native focusable button with one click action", async () => {
  const dom = await openWorkbench();
  try {
    const { S, gateway } = dom.window.Q;
    S.me = "m1";
    S.page = "fin";
    dom.window.Q.render();
    const targetMonth = gateway.loadPayroll("m1")[1].month;
    const control = dom.window.document.querySelector(
      `button[data-act="payroll-month"][data-month="${targetMonth}"]`,
    );
    assert.ok(control);
    assert.equal(control.hasAttribute("role"), false);
    assert.equal(control.hasAttribute("tabindex"), false);
    control.focus();
    assert.equal(dom.window.document.activeElement, control);

    let clickCount = 0;
    control.addEventListener("click", () => {
      clickCount += 1;
    });
    control.click();
    assert.equal(clickCount, 1);
    assert.equal(S.f.payMonth, targetMonth);
  } finally {
    dom.window.close();
  }
});

test("clears only namespaced demo business data and can restore seeds", async () => {
  const dom = await openWorkbench();
  try {
    dom.window.localStorage.setItem("unrelated", "keep");
    dom.window.localStorage.setItem("qxy_demo_auth", "1");

    dom.window.Q.gateway.clearDemoData();

    assert.equal(dom.window.localStorage.getItem("unrelated"), "keep");
    assert.equal(dom.window.localStorage.getItem("qxy_demo_auth"), "1");
    assert.equal(dom.window.localStorage.getItem("qxy.workstation.demo.v2"), null);
    assert.equal(dom.window.localStorage.getItem("qxy.workstation.demo.cleared"), "1");
    assert.match(dom.window.document.body.textContent, /演示数据已清除/);
    assert.deepEqual(Array.from(dom.window.Q.S.tasks), []);
    assert.deepEqual(Object.keys(dom.window.Q.S.payroll), []);

    dom.window.Q.gateway.resetDemoData();

    assert.ok(dom.window.Q.S.tasks.length > 0);
    assert.ok(Object.keys(dom.window.Q.S.payroll).length > 0);
    assert.equal(dom.window.localStorage.getItem("qxy.workstation.demo.cleared"), null);
  } finally {
    dom.window.close();
  }
});

test("keeps a cleared demo empty across reload until the user restores it", async () => {
  const dom = await openWorkbench({ "qxy.workstation.demo.cleared": "1" });
  try {
    assert.equal(dom.window.Q.S.demoCleared, true);
    assert.deepEqual(Array.from(dom.window.Q.S.tasks), []);
    assert.deepEqual(Object.keys(dom.window.Q.S.payroll), []);
    assert.match(dom.window.document.body.textContent, /演示数据已清除/);
    assert.ok(dom.window.document.querySelector('[data-act="restore-demo"]'));
  } finally {
    dom.window.close();
  }
});

test("hides and rejects arbitrary identity switching for a real authenticated session", async () => {
  const dom = await openWorkbench();
  try {
    const { S, gateway } = dom.window.Q;
    const originalMember = S.me;
    const otherMember = originalMember === "m1" ? "m2" : "m1";
    const originalLoadBootstrap = gateway.loadBootstrap;
    gateway.loadBootstrap = () => ({
      session: { authMode: "feishu", dataMode: "server", memberId: originalMember },
      features: { identitySwitch: true, demoReset: true },
    });

    S.menu = true;
    dom.window.Q.render();
    assert.equal(dom.window.document.querySelector('[data-act="setme"]'), null);

    const bypass = dom.window.document.createElement("button");
    bypass.setAttribute("data-act", "setme");
    bypass.setAttribute("data-id", otherMember);
    dom.window.document.body.appendChild(bypass);
    bypass.click();
    assert.equal(S.me, originalMember);

    gateway.loadBootstrap = originalLoadBootstrap;
  } finally {
    dom.window.close();
  }
});

test("returns to login when the server reports an expired AI session", async () => {
  const html = await readFile(htmlPath, "utf8");
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:3011/quantxy-ai-workbench-fused.html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = async (url) => {
        if (String(url) === "/api/demo-auth/session") return response(true, { authenticated: true });
        if (String(url) === "/api/ai/config") return response(false, { error: "unauthorized" }, 401);
        return response(false, {}, 404);
      };
    },
  });
  try {
    await waitFor(() => {
      const gate = dom.window.document.querySelector("#loginGate");
      const error = dom.window.document.querySelector(".login-error");
      return gate && !gate.hidden && /登录状态已失效/.test(error?.textContent || "");
    });
    assert.match(dom.window.document.querySelector(".login-error").textContent, /登录状态已失效/);
    assert.ok(dom.window.document.querySelector('[data-act="login-submit"]'));
    assert.equal(dom.window.Q.S.aiConfig.canManage, false);
  } finally {
    dom.window.close();
  }
});

test("returns to login when updating the AI configuration gets a 401", async () => {
  const html = await readFile(htmlPath, "utf8");
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:3011/quantxy-ai-workbench-fused.html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.fetch = async (url, options = {}) => {
        if (String(url) === "/api/demo-auth/session") return response(true, { authenticated: true });
        if (String(url) === "/api/ai/config" && options.method === "PUT") {
          return response(false, { error: "unauthorized" }, 401);
        }
        if (String(url) === "/api/ai/config") {
          return response(true, {
            provider: "deepseek",
            apiBaseUrl: "https://api.deepseek.com",
            model: "deepseek-v4-flash",
            keyConfigured: true,
            keyHint: "8bcf",
            updatedAt: null,
            canManage: true,
          });
        }
        return response(false, {}, 404);
      };
    },
  });
  try {
    await waitFor(() => dom.window.Q?.S.aiConfig.loaded);
    dom.window.Q.S.page = "set";
    dom.window.Q.render();
    dom.window.document.querySelector('[data-act="save-ai-model"]').click();
    await waitFor(() => {
      const gate = dom.window.document.querySelector("#loginGate");
      const error = dom.window.document.querySelector(".login-error");
      return gate && !gate.hidden && /登录状态已失效/.test(error?.textContent || "");
    });
    assert.ok(dom.window.document.querySelector('[data-act="login-submit"]'));
    assert.equal(dom.window.Q.S.aiConfig.saving, false);
  } finally {
    dom.window.close();
  }
});

test("fails closed without demo data or demo auth when real mode has no server adapter", async () => {
  const html = await readRealModeHtml();
  const requests = [];
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:3011/quantxy-ai-workbench-fused.html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.QUANTXY_WORKSTATION_RUNTIME = { authMode: "feishu", dataMode: "server" };
      window.fetch = async (url) => {
        requests.push(String(url));
        return response(false, { error: "unexpected_request" }, 404);
      };
    },
  });
  try {
    await waitFor(() => dom.window.Q);
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.deepEqual(Array.from(dom.window.Q.S.tasks), []);
    assert.deepEqual(Object.keys(dom.window.Q.S.payroll), []);
    assert.match(dom.window.document.querySelector("#view").textContent, /真实数据服务.*未配置|真实数据服务不可用/);
    assert.equal(dom.window.document.querySelector('[data-act="setme"]'), null);
    assert.equal(requests.includes("/api/demo-auth/session"), false);
  } finally {
    dom.window.close();
  }
});

test("uses an injected server adapter for real session and business data without touching demo auth", async () => {
  const html = await readRealModeHtml();
  const requests = [];
  const serverTask = {
    id: "server-task-1",
    n: "飞书真实任务",
    p: "server-project-1",
    own: "server-user-1",
    createdBy: "server-user-1",
    reviewer: "server-user-1",
    st: "待处理",
    revision: 7,
    e: "2026-08-30",
    timeline: [],
  };
  const session = {
    authenticated: true,
    authMode: "feishu",
    dataMode: "server",
    memberId: "server-user-1",
    permissions: ["task.execute", "payroll.read.self"],
  };
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:3011/quantxy-ai-workbench-fused.html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.QUANTXY_WORKSTATION_RUNTIME = { authMode: "feishu", dataMode: "server" };
      const members = [{ id: "server-user-1", n: "飞书用户", r: "产品经理", dept: "产品中心", lv: 3 }];
      const projects = [{ id: "server-project-1", n: "服务端项目", own: "server-user-1", st: "进行中" }];
      const payroll = { "server-user-1": [] };
      window.QUANTXY_WORKSTATION_SERVER_ADAPTER = {
        getSession: () => session,
        loadBootstrap: () => ({
          mode: "server",
          session,
          members,
          projects,
          tasks: [serverTask],
          payroll,
          features: { identitySwitch: false, demoReset: false },
        }),
        loadMyDashboard: () => ({ tasks: [serverTask], must: [serverTask], projects, payroll: null, reminders: [] }),
        listMyTasks: () => [serverTask],
        loadMyTask: () => serverTask,
        listMyProjects: () => projects,
        loadPayroll: () => [],
        saveTask: () => serverTask,
        claimTask: () => serverTask,
        updateTaskExecution: () => serverTask,
        submitTaskResult: () => serverTask,
        reviewTaskResult: () => serverTask,
        reopenTask: () => serverTask,
        clearDemoData: () => undefined,
        resetDemoData: () => undefined,
      };
      window.fetch = async (url) => {
        requests.push(String(url));
        if (String(url) === "/api/ai/config") {
          return response(true, {
            provider: "deepseek",
            apiBaseUrl: "https://api.deepseek.com",
            model: "deepseek-v4-flash",
            keyConfigured: false,
            keyHint: null,
            updatedAt: null,
            canManage: false,
          });
        }
        return response(false, { error: "unexpected_request" }, 404);
      };
    },
  });
  try {
    await waitFor(() => dom.window.Q?.S.me === "server-user-1");
    assert.deepEqual(dom.window.Q.S.tasks.map((task) => task.id), ["server-task-1"]);
    assert.equal(dom.window.Q.gateway.getSession().authMode, "feishu");
    dom.window.Q.S.page = "me";
    dom.window.Q.render();
    assert.match(dom.window.document.querySelector("#view").textContent, /飞书真实任务/);
    assert.doesNotMatch(dom.window.document.querySelector("#view").textContent, /量子计算平台接口设计评审/);
    assert.equal(dom.window.document.querySelector('[data-act="setme"]'), null);
    assert.equal(requests.includes("/api/demo-auth/session"), false);
  } finally {
    dom.window.close();
  }
});

test("rejects legacy browser writes in real mode without mutating server state or demo storage", async () => {
  const html = await readRealModeHtml();
  const serverTask = {
    id: "server-task-write-guard",
    n: "真实任务写保护",
    p: "server-project-write-guard",
    own: "server-user-write-guard",
    createdBy: "server-user-write-guard",
    reviewer: "server-user-write-guard",
    st: "待处理",
    revision: 3,
    e: "2026-08-30",
    timeline: [],
  };
  const session = {
    authenticated: true,
    authMode: "feishu",
    dataMode: "server",
    memberId: "server-user-write-guard",
    permissions: ["task.execute", "payroll.read.self"],
  };
  const adapterCalls = { clear: 0, reset: 0, claim: 0 };
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:3011/quantxy-ai-workbench-fused.html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.localStorage.setItem("qxy.workstation.demo.v2", "server-v2-sentinel");
      window.localStorage.setItem("qxy", "server-legacy-sentinel");
      window.localStorage.setItem("unrelated", "keep");
      window.QUANTXY_WORKSTATION_RUNTIME = { authMode: "feishu", dataMode: "server" };
      const members = [{ id: session.memberId, n: "真实用户", r: "产品经理", dept: "产品中心", lv: 3 }];
      const projects = [{ id: serverTask.p, n: "真实服务端项目", own: session.memberId, st: "进行中" }];
      window.QUANTXY_WORKSTATION_SERVER_ADAPTER = {
        getSession: () => session,
        loadBootstrap: () => ({
          mode: "server",
          session,
          members,
          projects,
          tasks: [serverTask],
          customers: [],
          payroll: { [session.memberId]: [] },
          features: { identitySwitch: false, demoReset: false },
        }),
        loadMyDashboard: () => ({ tasks: [serverTask], must: [serverTask], projects, payroll: null, reminders: [] }),
        listMyTasks: () => [serverTask],
        loadMyTask: () => serverTask,
        listMyProjects: () => projects,
        loadPayroll: () => [],
        clearDemoData: () => { adapterCalls.clear += 1; },
        resetDemoData: () => { adapterCalls.reset += 1; },
      };
      window.fetch = async (url) => {
        if (String(url) === "/api/ai/config") {
          return response(true, {
            provider: "deepseek",
            apiBaseUrl: "https://api.deepseek.com",
            model: "deepseek-v4-flash",
            keyConfigured: false,
            keyHint: null,
            updatedAt: null,
            canManage: false,
          });
        }
        return response(false, { error: "unexpected_request" }, 404);
      };
    },
  });
  try {
    await waitFor(() => dom.window.Q?.S.me === session.memberId);
    const { S } = dom.window.Q;
    const initialTasks = JSON.parse(JSON.stringify(S.tasks));
    const initialCustomers = JSON.parse(JSON.stringify(S.customers));
    const initialConfig = JSON.parse(JSON.stringify(S.cfg));
    const messages = [];
    const toastText = () => dom.window.document.querySelector("#toast")?.textContent || "";
    const clickAction = (action, attributes = {}) => {
      const button = dom.window.document.createElement("button");
      button.setAttribute("data-act", action);
      for (const [name, value] of Object.entries(attributes)) button.setAttribute(name, value);
      dom.window.document.body.appendChild(button);
      button.click();
      messages.push(toastText());
      button.remove();
    };

    S.page = "set";
    dom.window.Q.render();
    dom.window.document.querySelector("#cfgWd").value = "6";
    dom.window.document.querySelector("#cfgPl").value = "8";
    dom.window.document.querySelector("#cfgRl").value = "35";
    dom.window.document.querySelector('[data-act="save-schedule"]').click();
    messages.push(toastText());

    clickAction("clear-demo");
    const modalOk = dom.window.document.querySelector('[data-act="modal-ok"]');
    if (modalOk) modalOk.click();
    clickAction("reset");

    S.sel.task = serverTask.id;
    clickAction("task-claim");

    S.page = "new-customer";
    dom.window.Q.render();
    dom.window.document.querySelector('[data-f="n"]').value = "不得创建的客户";
    dom.window.document.querySelector('[data-f="contact"]').value = "测试联系人";
    dom.window.document.querySelector('[data-act="f-customer"]').click();
    messages.push(toastText());

    assert.deepEqual(messages, Array(messages.length).fill("真实数据写接口未配置"));
    assert.deepEqual(adapterCalls, { clear: 0, reset: 0, claim: 0 });
    assert.deepEqual(JSON.parse(JSON.stringify(S.tasks)), initialTasks);
    assert.deepEqual(JSON.parse(JSON.stringify(S.customers)), initialCustomers);
    assert.deepEqual(JSON.parse(JSON.stringify(S.cfg)), initialConfig);
    assert.equal(dom.window.localStorage.getItem("qxy.workstation.demo.v2"), "server-v2-sentinel");
    assert.equal(dom.window.localStorage.getItem("qxy"), "server-legacy-sentinel");
    assert.equal(dom.window.localStorage.getItem("unrelated"), "keep");
    const storageKeys = Array.from(
      { length: dom.window.localStorage.length },
      (_, index) => dom.window.localStorage.key(index),
    ).sort();
    assert.deepEqual(storageKeys, ["qxy", "qxy.workstation.demo.v2", "unrelated"]);
  } finally {
    dom.window.close();
  }
});

test("clears stale navigation filters and detail selections for clear reset and restore", async () => {
  const dom = await openWorkbench();
  try {
    const { S, gateway } = dom.window.Q;
    const dirtyUi = () => {
      S.page = "project";
      S.tab = { proj: "风险", task: "已完成", kb: "month" };
      for (const key of Object.keys(S.f)) S.f[key] = "stale";
      S.sch = { goal: "旧目标", deadline: "2099-12-31", budget: 999, must: "旧约束", busy: true, err: "旧错误", tasks: [{}], plans: [{}], pick: "C", from: "旧来源", issued: true };
      S.sel = { task: "old-task", wbs: "old-wbs" };
      S.curProj = "old-project";
      S.curAgent = "old-agent";
      S.curCustomer = "old-customer";
      S.curActivity = "old-activity";
      S.editId = "old-edit";
      S.menu = true;
      S.cmenu = true;
      S.confirm = { t: "old" };
      S.deptMgr = true;
    };
    const assertCleanUi = () => {
      assert.equal(S.page, "me");
      assert.deepEqual(JSON.parse(JSON.stringify(S.tab)), { proj: "all", task: "all", kb: "week" });
      assert.deepEqual(JSON.parse(JSON.stringify(S.f)), {
        projCat: "all", projSt: "all", projQ: "", taskQ: "", taskOwn: "all", taskPri: "all", taskSt: "all",
        meScope: "todo", meTab: "all", payMonth: "", payFocus: "", kbQ: "", kbCat: "all", orgQ: "", orgDept: "all", agentDept: "all", agentQ: "", agentTab: "dir", agentVis: "all",
        dashTab: "进行中", insightG: "日", gq: "", customerQ: "", customerSt: "all", activitySt: "all", decisionTab: "待我决策",
      });
      assert.equal(S.sch.goal, "");
      assert.equal(S.sch.budget, 30);
      assert.equal(S.sch.must, "");
      assert.equal(S.sch.busy, false);
      assert.equal(S.sch.tasks, null);
      assert.equal(S.sch.plans, null);
      assert.equal(S.sch.pick, "A");
      assert.equal(S.sch.issued, false);
      assert.deepEqual(JSON.parse(JSON.stringify(S.sel)), { task: null, wbs: null });
      for (const value of [S.curProj, S.curAgent, S.curCustomer, S.curActivity, S.editId, S.confirm]) {
        assert.equal(value, null);
      }
      assert.equal(S.menu, false);
      assert.equal(S.cmenu, false);
      assert.equal(S.deptMgr, false);
    };

    dirtyUi();
    gateway.clearDemoData();
    assertCleanUi();

    dirtyUi();
    gateway.resetDemoData();
    assertCleanUi();

    dirtyUi();
    gateway.resetDemoData();
    assertCleanUi();
  } finally {
    dom.window.close();
  }
});

test("binds every demo task mutation to the selected identity and rejects spoofed actors", async () => {
  const dom = await openWorkbench();
  try {
    const { gateway, S } = dom.window.Q;
    const task = S.tasks.find((item) => item.own !== item.reviewer);
    assert.ok(task);
    const original = JSON.stringify(task);
    const outsider = S.me === task.own || S.me === task.reviewer ? "m7" : S.me;
    S.me = outsider;

    task.st = "待处理";
    assert.throws(() => gateway.claimTask(task.id, task.own), /forbidden/);
    task.st = "进行中";
    assert.throws(() => gateway.updateTaskExecution(task.id, task.own, { progress: 40 }), /forbidden/);
    assert.throws(
      () => gateway.submitTaskResult(task.id, task.own, { resultText: "伪造成果", resultLink: "https://example.test" }),
      /forbidden/,
    );
    task.st = "待验收";
    assert.throws(() => gateway.reviewTaskResult(task.id, task.reviewer, { decision: "pass", note: "" }), /forbidden/);
    task.st = "已完成";
    assert.throws(() => gateway.reopenTask(task.id, task.reviewer, "伪造重开"), /forbidden/);

    task.st = JSON.parse(original).st;
    S.me = task.createdBy;
    const beforeSave = JSON.stringify(task);
    assert.throws(
      () => gateway.saveTask({ id: task.id, description: "伪造安全编辑" }, task.revision, task.own),
      /forbidden/,
    );
    assert.equal(JSON.stringify(task), beforeSave);
  } finally {
    dom.window.close();
  }
});

test("does not forward browser-supplied actor identities to real server writes", async () => {
  const html = await readRealModeHtml();
  const received = {};
  const session = { authenticated: true, authMode: "feishu", dataMode: "server", memberId: "server-user" };
  const task = { id: "server-task", n: "真实任务", p: "server-project", own: "server-user", createdBy: "server-user", reviewer: "server-user", st: "待处理", timeline: [] };
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:3011/quantxy-ai-workbench-fused.html",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      const members = [{ id: "server-user", n: "真实用户", r: "产品经理", dept: "产品中心", lv: 3 }];
      const projects = [{ id: "server-project", n: "真实项目", own: "server-user", st: "进行中" }];
      window.QUANTXY_WORKSTATION_RUNTIME = { authMode: "feishu", dataMode: "server" };
      window.QUANTXY_WORKSTATION_SERVER_ADAPTER = {
        getSession: () => session,
        loadBootstrap: () => ({ session, members, projects, tasks: [task], payroll: {}, features: {} }),
        loadMyDashboard: () => ({ tasks: [task], must: [task], projects, payroll: null, reminders: [] }),
        listMyTasks: () => [task],
        loadMyTask: () => task,
        listMyProjects: () => projects,
        loadPayroll: () => [],
        saveTask: (...args) => { received.saveTask = args; return task; },
        claimTask: (...args) => { received.claimTask = args; return task; },
        updateTaskExecution: (...args) => { received.updateTaskExecution = args; return task; },
        submitTaskResult: (...args) => { received.submitTaskResult = args; return task; },
        reviewTaskResult: (...args) => { received.reviewTaskResult = args; return task; },
        reopenTask: (...args) => { received.reopenTask = args; return task; },
      };
      window.fetch = async (url) => String(url) === "/api/ai/config"
        ? response(true, { provider: "deepseek", apiBaseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", keyConfigured: false, canManage: false })
        : response(false, {}, 404);
    },
  });
  try {
    await waitFor(() => dom.window.Q?.S.me === "server-user");
    const gateway = dom.window.Q.gateway;
    gateway.saveTask({ id: task.id, n: "编辑" }, 1, "spoof-user");
    gateway.claimTask(task.id, "spoof-user");
    gateway.updateTaskExecution(task.id, "spoof-user", { progress: 10 });
    gateway.submitTaskResult(task.id, "spoof-user", { resultText: "成果" });
    gateway.reviewTaskResult(task.id, "spoof-user", { decision: "pass" });
    gateway.reopenTask(task.id, "spoof-user", "重开");
    assert.deepEqual(received.saveTask, [{ id: task.id, n: "编辑" }, 1]);
    assert.deepEqual(received.claimTask, [task.id]);
    assert.deepEqual(received.updateTaskExecution, [task.id, { progress: 10 }]);
    assert.deepEqual(received.submitTaskResult, [task.id, { resultText: "成果" }]);
    assert.deepEqual(received.reviewTaskResult, [task.id, { decision: "pass" }]);
    assert.deepEqual(received.reopenTask, [task.id, "重开"]);
  } finally {
    dom.window.close();
  }
});

test("member profile editing leaves task assignment and audit history unchanged", async () => {
  const dom = await openWorkbench();
  try {
    const { S } = dom.window.Q;
    const task = S.tasks.find((item) => item.own === "m1");
    const before = {
      own: task.own,
      role: task.role,
      st: task.st,
      revision: task.revision,
      timeline: JSON.stringify(task.timeline),
    };
    S.page = "org";
    dom.window.Q.render();
    dom.window.document.querySelector('[data-act="edit-member"][data-id="m1"]').click();
    const role = dom.window.document.querySelector('[data-f="r"]');
    role.value = role.value === "项目经理" ? "产品经理" : "项目经理";
    dom.window.document.querySelector('[data-act="f-member"]').click();
    assert.deepEqual(
      { own: task.own, role: task.role, st: task.st, revision: task.revision, timeline: JSON.stringify(task.timeline) },
      before,
    );
  } finally {
    dom.window.close();
  }
});

test("blocks deletion of referenced members and keeps related modules renderable", async () => {
  const dom = await openWorkbench();
  try {
    const { S } = dom.window.Q;
    S.page = "org";
    dom.window.Q.render();
    dom.window.document.querySelector('[data-act="del-member"][data-id="m1"]').click();
    assert.ok(S.proj.some((project) => project.own === "m1"));
    assert.ok(S.tasks.some((task) => task.own === "m1"));
    assert.match(dom.window.document.querySelector("#toast").textContent, /无法删除.*仍被.*引用/);
    assert.equal(S.confirm, null);

    const pages = [
      ["org", null],
      ["task", null],
      ["project", () => { S.curProj = "p1"; }],
      ["me", () => { S.me = "m1"; }],
      ["fin", () => { S.me = "m1"; }],
    ];
    for (const [page, setup] of pages) {
      if (setup) setup();
      S.page = page;
      assert.doesNotThrow(() => dom.window.Q.render(), `${page} should render after a blocked deletion`);
      assert.ok(dom.window.document.querySelector("#view").textContent.trim().length > 0);
    }
  } finally {
    dom.window.close();
  }
});

test("preserves every valid persisted empty collection instead of reseeding it", async () => {
  const emptySnapshot = {
    tasks: [], members: [], projects: [], kb: [], agents: [], runs: [], depts: [], reqs: [],
    customers: [], activities: [], decisions: [], payroll: {},
    cfg: { workday: 5, parallel: 3, riskLine: 20 },
  };
  const dom = await openWorkbench({ "qxy.workstation.demo.v2": JSON.stringify(emptySnapshot) });
  try {
    const { S, gateway } = dom.window.Q;
    for (const key of ["tasks", "customers", "activities", "decisions", "agents", "runs", "reqs"]) {
      assert.deepEqual(Array.from(S[key]), [], `${key} should remain empty`);
    }
    const bootstrap = gateway.loadBootstrap();
    assert.deepEqual(Array.from(bootstrap.members), []);
    assert.deepEqual(Array.from(bootstrap.projects), []);
    assert.deepEqual(Object.keys(S.payroll), []);

    S.page = "set";
    dom.window.Q.render();
    dom.window.document.querySelector('[data-act="save-schedule"]').click();
    const persisted = JSON.parse(dom.window.localStorage.getItem("qxy.workstation.demo.v2"));
    for (const key of ["tasks", "members", "projects", "kb", "agents", "runs", "depts", "reqs", "customers", "activities", "decisions"]) {
      assert.deepEqual(persisted[key], [], `${key} should persist as empty`);
    }
    assert.deepEqual(persisted.payroll, {});
  } finally {
    dom.window.close();
  }
});

test("seeds only missing or invalid persisted collections", async () => {
  const invalidSnapshot = {
    tasks: null, members: {}, projects: "invalid", kb: null, agents: {}, runs: "invalid", depts: null,
    reqs: {}, customers: null, activities: {}, decisions: "invalid", payroll: [],
  };
  const dom = await openWorkbench({ "qxy.workstation.demo.v2": JSON.stringify(invalidSnapshot) });
  try {
    const { S, gateway } = dom.window.Q;
    const bootstrap = gateway.loadBootstrap();
    for (const [name, value] of [
      ["tasks", S.tasks], ["members", bootstrap.members], ["projects", bootstrap.projects],
      ["customers", S.customers], ["activities", S.activities], ["decisions", S.decisions], ["agents", S.agents],
    ]) {
      assert.ok(value.length > 0, `${name} should be seeded when invalid`);
    }
    assert.ok(Object.keys(S.payroll).length > 0);
    assert.deepEqual(Array.from(S.runs), []);
    assert.deepEqual(Array.from(S.reqs), []);
  } finally {
    dom.window.close();
  }
});

test("escapes malicious record ids and renders unknown task status with a safe fallback", async () => {
  const malicious = {
    member: 'member" autofocus onfocus="window.__memberXss=1',
    project: 'project" autofocus onfocus="window.__projectXss=1',
    task: 'task" autofocus onfocus="window.__taskXss=1',
    customer: 'customer" autofocus onfocus="window.__customerXss=1',
    status: '<img src=x onerror="window.__statusXss=1">',
  };
  const snapshot = {
    members: [
      { id: malicious.member, n: "恶意标识成员", r: "产品经理", sk: "测试", rate: 1000, cap: 0.8, dept: "产品中心", lv: 3 },
      { id: "m14", n: "管理员", r: "企业决策人", sk: "管理", rate: 0, cap: 0.3, dept: "管理层", lv: 5 },
    ],
    projects: [{ id: malicious.project, n: "恶意标识项目", own: malicious.member, cat: "AI研发", pr: 10, bud: 1, health: 90, st: "进行中", up: "今天" }],
    tasks: [{ id: malicious.task, n: "恶意状态任务", p: malicious.project, own: malicious.member, createdBy: malicious.member, reviewer: "m14", st: malicious.status, pri: "P1", s: "2026-08-01", e: "2099-08-30", timeline: [] }],
    customers: [{ id: malicious.customer, n: "恶意标识客户", industry: "测试", contact: "联系人", stage: "跟进中", own: malicious.member, progress: 10, project: malicious.project }],
    payroll: { [malicious.member]: [{ month: "2026-08", base: 1000, performance: 0, projectBonus: 0, otherBonus: 0, social: 0, tax: 0, otherDeduction: 0 }] },
    kb: [], agents: [], runs: [], depts: ["产品中心", "管理层"], reqs: [], activities: [], decisions: [],
  };
  const dom = await openWorkbench({ "qxy.workstation.demo.v2": JSON.stringify(snapshot) });
  try {
    const { S } = dom.window.Q;
    const assertNoInjectedAttributes = () => {
      assert.equal(dom.window.document.querySelector("#view [onfocus], #view [onerror], #view [onclick]"), null);
      assert.equal(dom.window.document.querySelector("#view img"), null);
      assert.equal(dom.window.__memberXss, undefined);
      assert.equal(dom.window.__projectXss, undefined);
      assert.equal(dom.window.__taskXss, undefined);
      assert.equal(dom.window.__customerXss, undefined);
      assert.equal(dom.window.__statusXss, undefined);
    };

    S.me = malicious.member;
    S.page = "me";
    dom.window.Q.render();
    assert.equal(dom.window.document.querySelector('[data-act="open-execution"]').getAttribute("data-id"), malicious.task);
    assert.equal(dom.window.document.querySelector('[data-act="open-my-project"]').getAttribute("data-id"), malicious.project);
    assert.match(dom.window.document.querySelector("#view").textContent, /状态未知/);
    assertNoInjectedAttributes();

    S.page = "org";
    dom.window.Q.render();
    assert.equal(dom.window.document.querySelector('[data-act="edit-member"]').getAttribute("data-id"), malicious.member);
    assertNoInjectedAttributes();

    S.page = "customers";
    dom.window.Q.render();
    assert.equal(dom.window.document.querySelector('[data-act="open-customer"]').getAttribute("data-id"), malicious.customer);
    assertNoInjectedAttributes();

    S.page = "dash";
    dom.window.Q.render();
    assertNoInjectedAttributes();

    S.f.gq = "恶意";
    S.page = "search";
    dom.window.Q.render();
    assertNoInjectedAttributes();
  } finally {
    dom.window.close();
  }
});

test("keeps known non-task project statuses while still rejecting unknown labels", async () => {
  const dom = await openWorkbench();
  try {
    const { S } = dom.window.Q;
    const project = S.proj.find((item) => item.own === "m1");
    project.st = "规划中";
    S.me = "m1";
    S.page = "me";
    dom.window.Q.render();
    assert.match(dom.window.document.querySelector("#view").textContent, /规划中/);
  } finally {
    dom.window.close();
  }
});

test("escapes malicious Agent ids and field keys without breaking permissions or input collection", async () => {
  const maliciousAgentId = 'agent" autofocus onfocus="window.__agentXss=1';
  const maliciousFieldKey = 'field" autofocus onfocus="window.__fieldXss=1';
  const snapshot = {
    members: [
      { id: "m14", n: "管理员", r: "企业决策人", sk: "管理", rate: 0, cap: 0.3, dept: "管理层", lv: 5 },
    ],
    projects: [], tasks: [], kb: [], runs: [], depts: ["管理层"], reqs: [], customers: [], activities: [], decisions: [], payroll: {},
    agents: [{
      id: maliciousAgentId,
      n: "安全测试 Agent",
      dept: "管理层",
      ic: "bot",
      d: "验证动态属性安全",
      sys: "你是一个用于验证动态属性安全的测试 Agent。",
      model: "",
      on: 1,
      runs: 0,
      ok: 100,
      scope: "dept",
      minLv: 1,
      grant: [],
      depts: ["管理层"],
      f: [{ k: maliciousFieldKey, l: "测试输入", t: "in", ph: "请输入测试内容" }],
    }],
  };
  const dom = await openWorkbench({ "qxy.workstation.demo.v2": JSON.stringify(snapshot) });
  try {
    const { S } = dom.window.Q;
    const assertNoInjectedAttributes = () => {
      assert.equal(dom.window.document.querySelector("#view [onfocus], #view [onerror], #view [onclick]"), null);
      assert.equal(dom.window.__agentXss, undefined);
      assert.equal(dom.window.__fieldXss, undefined);
    };

    S.me = "m14";
    S.page = "flow";
    S.f.agentTab = "perm";
    dom.window.Q.render();
    const permission = Array.from(dom.window.document.querySelectorAll("[data-perm]"))
      .find((node) => node.getAttribute("data-perm") === `${maliciousAgentId}:scope`);
    assert.ok(permission);
    assert.equal(permission.dataset.perm, `${maliciousAgentId}:scope`);
    assertNoInjectedAttributes();

    permission.value = "all";
    permission.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    assert.equal(S.agents[0].scope, "all");

    S.curAgent = maliciousAgentId;
    S.page = "agent";
    dom.window.Q.render();
    const field = Array.from(dom.window.document.querySelectorAll("[data-f]"))
      .find((node) => node.getAttribute("data-f") === `ai_${maliciousFieldKey}`);
    assert.ok(field);
    assert.equal(field.dataset.f, `ai_${maliciousFieldKey}`);
    assertNoInjectedAttributes();

    field.value = "安全输入内容";
    dom.window.document.querySelector('[data-act="run-agent"]').click();
    assert.equal(S.agentIn[maliciousFieldKey], "安全输入内容");
    await waitFor(() => !S.agentBusy);
  } finally {
    dom.window.close();
  }
});

test("allows deletion when payroll contains only empty or null member buckets", async () => {
  const snapshot = {
    members: [
      { id: "m14", n: "管理员", r: "企业决策人", sk: "管理", rate: 0, cap: 0.3, dept: "管理层", lv: 5 },
      { id: "empty-payroll", n: "空薪酬成员", r: "产品经理", sk: "产品", rate: 1000, cap: 0.8, dept: "产品中心", lv: 3 },
      { id: "null-payroll", n: "空值薪酬成员", r: "设计师", sk: "设计", rate: 900, cap: 0.8, dept: "设计部", lv: 2 },
    ],
    projects: [], tasks: [], kb: [], agents: [], runs: [], depts: ["管理层", "产品中心", "设计部"], reqs: [], customers: [], activities: [], decisions: [],
    payroll: { "empty-payroll": [], "null-payroll": null },
  };
  const dom = await openWorkbench({ "qxy.workstation.demo.v2": JSON.stringify(snapshot) });
  try {
    const { S, gateway } = dom.window.Q;
    S.page = "org";
    dom.window.Q.render();
    for (const memberId of ["empty-payroll", "null-payroll"]) {
      dom.window.document.querySelector(`[data-act="del-member"][data-id="${memberId}"]`).click();
      assert.ok(S.confirm, `${memberId} should reach the deletion confirmation`);
      dom.window.document.querySelector('[data-act="modal-ok"]').click();
      assert.equal(gateway.loadBootstrap().members.some((member) => member.id === memberId), false);
    }
  } finally {
    dom.window.close();
  }
});

test("keeps the sole current member and leaves the personal workbench renderable", async () => {
  const snapshot = {
    members: [
      { id: "m14", n: "管理员", r: "企业决策人", sk: "管理", rate: 0, cap: 0.3, dept: "管理层", lv: 5 },
    ],
    projects: [], tasks: [], kb: [], agents: [], runs: [], depts: ["管理层"], reqs: [], customers: [], activities: [], decisions: [], payroll: {},
  };
  const dom = await openWorkbench({ "qxy.workstation.demo.v2": JSON.stringify(snapshot) });
  try {
    const { S, gateway } = dom.window.Q;
    S.page = "org";
    dom.window.Q.render();
    dom.window.document.querySelector('[data-act="del-member"][data-id="m14"]').click();

    assert.equal(S.confirm, null);
    assert.match(dom.window.document.querySelector("#toast").textContent, /至少保留一名成员，当前成员不能删除/);
    assert.equal(gateway.loadBootstrap().members.length, 1);
    assert.equal(S.me, "m14");

    S.page = "me";
    assert.doesNotThrow(() => dom.window.Q.render());
    assert.ok(dom.window.document.querySelector("#view").textContent.trim().length > 0);
  } finally {
    dom.window.close();
  }
});

test("deletes an unreferenced non-only member and keeps the app renderable", async () => {
  const snapshot = {
    members: [
      { id: "m14", n: "管理员", r: "企业决策人", sk: "管理", rate: 0, cap: 0.3, dept: "管理层", lv: 5 },
      { id: "spare-member", n: "可删除成员", r: "产品经理", sk: "产品", rate: 1000, cap: 0.8, dept: "产品中心", lv: 3 },
    ],
    projects: [], tasks: [], kb: [], agents: [], runs: [], depts: ["管理层", "产品中心"], reqs: [], customers: [], activities: [], decisions: [], payroll: {},
  };
  const dom = await openWorkbench({ "qxy.workstation.demo.v2": JSON.stringify(snapshot) });
  try {
    const { S, gateway } = dom.window.Q;
    S.page = "org";
    dom.window.Q.render();
    dom.window.document.querySelector('[data-act="del-member"][data-id="spare-member"]').click();
    assert.ok(S.confirm);
    dom.window.document.querySelector('[data-act="modal-ok"]').click();

    assert.deepEqual(Array.from(gateway.loadBootstrap().members, (member) => member.id), ["m14"]);
    assert.equal(S.me, "m14");
    for (const page of ["org", "me", "fin"]) {
      S.page = page;
      assert.doesNotThrow(() => dom.window.Q.render(), `${page} should render after member deletion`);
      assert.ok(dom.window.document.querySelector("#view").textContent.trim().length > 0);
    }
  } finally {
    dom.window.close();
  }
});
