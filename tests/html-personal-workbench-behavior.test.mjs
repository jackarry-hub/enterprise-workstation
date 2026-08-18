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
