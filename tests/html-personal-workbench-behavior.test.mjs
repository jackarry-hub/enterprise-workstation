import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";

const htmlPath = path.join(process.cwd(), "quantxy-ai-workbench-fused.html");

async function openWorkbench(seedStorage, setupWindow, url = "http://127.0.0.1:3011/quantxy-ai-workbench-fused.html") {
  const html = await readFile(htmlPath, "utf8");
  const dom = new JSDOM(html, {
    url,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.matchMedia = (query) => ({
        matches: false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      });
      if (setupWindow) setupWindow(window);
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

async function openFormalWorkbench(url, bootstrap, adapterOverrides = {}, fetchOverride) {
  const html = await readRealModeHtml();
  const tasks = bootstrap.tasks || [];
  const projects = bootstrap.projects || [];
  const session = bootstrap.session;
  const adapter = {
    ready: async () => bootstrap,
    getSession: () => session,
    loadBootstrap: () => bootstrap,
    loadMyDashboard: (memberId) => ({
      tasks: tasks.filter((task) => task.own === memberId),
      must: tasks.filter((task) => task.own === memberId),
      projects,
      payroll: null,
      reminders: [],
    }),
    listMyTasks: (memberId) => tasks.filter((task) => task.own === memberId),
    loadMyTask: (memberId, taskId) => {
      const canManage = session.permissions.includes("task.manage");
      return tasks.find((task) => task.id === taskId && (
        canManage
        || task.own === memberId
        || task.createdBy === memberId
        || task.reviewer === memberId
      )) || null;
    },
    listMyProjects: () => projects,
    loadPayroll: () => [],
    saveTask: async () => null,
    claimTask: async () => null,
    updateTaskExecution: async () => null,
    submitTaskResult: async () => null,
    reviewTaskResult: async () => null,
    reopenTask: async () => null,
    saveWorkProfile: async () => null,
    syncDirectory: async () => ({}),
    createTask: async () => null,
    createTasks: async () => [],
    retryTaskNotification: async () => ({ status: "sent", errorCode: "" }),
    loadPayrollPolicy: async () => ({ active: null, history: [] }),
    savePayrollPolicy: async () => ({}),
    previewPayroll: async () => ({}),
    savePayroll: async () => ({}),
    ...adapterOverrides,
  };
  const dom = new JSDOM(html, {
    url,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.matchMedia = (query) => ({
        matches: false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      });
      window.QUANTXY_WORKSTATION_RUNTIME = { authMode: "feishu", dataMode: "server" };
      window.QUANTXY_WORKSTATION_SERVER_ADAPTER = adapter;
      window.fetch = async (requestUrl, init) => String(requestUrl) === "/api/ai/config"
        ? response(true, {
          provider: "deepseek",
          apiBaseUrl: "https://api.deepseek.com",
          model: "deepseek-v4-flash",
          keyConfigured: false,
          keyHint: null,
          updatedAt: null,
          canManage: true,
        })
        : fetchOverride
          ? fetchOverride(requestUrl, init)
          : response(false, { error: "unexpected_request" }, 404);
    },
  });
  await waitFor(() => dom.window.Q?.S.me === session.memberId && dom.window.Q.S.aiConfig.loaded);
  return dom;
}

test("previews and confirms a server-calculated payroll", async () => {
  const bootstrap = formalBootstrap({
    memberId: "m7",
    permissions: ["task.execute", "salary.self", "salary.manage"],
  });
  let saveCalls = 0;
  let lastSave = null;
  const dom = await openFormalWorkbench(
    "http://127.0.0.1:3012/quantxy-ai-workbench-fused.html?formal=1",
    bootstrap,
    {
      loadPayrollPolicy: async () => ({
        active: { publicId: "policy-1", effectiveMonth: "2026-01" },
        history: [],
      }),
      previewPayroll: async () => ({
        employee: { hireDate: "2026-01-15" },
        policy: { publicId: "policy-1", effectiveMonth: "2026-01" },
        employmentMonthsYtd: 8,
        openingRequired: false,
        calculation: {
          grossSalary: "25000.00",
          socialSecurity: "3502.00",
          individualIncomeTax: "620.00",
          deductions: "4122.00",
          netSalary: "20878.00",
        },
      }),
      savePayroll: async (input) => {
        saveCalls += 1;
        lastSave = input;
        return { status: "confirmed" };
      },
    },
  );
  try {
    const { S } = dom.window.Q;
    S.page = "pay-admin";
    dom.window.Q.render();
    await waitFor(() => dom.window.document.querySelector('[data-act="payroll-preview"]'));
    await waitFor(() => S.payrollPolicyLoaded);

    const values = {
      salaryMember: "m7",
      salaryMonth: "2026-08",
      salaryBase: "20000.00",
      salaryPerformance: "1000.00",
      salaryProjectBonus: "2000.00",
      salaryOtherBonus: "2000.00",
      salaryOtherIncome: "0.00",
      salarySocialBase: "20000.00",
      salaryHousingBase: "20000.00",
      salaryTaxExemptIncome: "0.00",
      salarySpecialAdditional: "0.00",
      salaryOtherStatutory: "0.00",
      salaryTaxRelief: "0.00",
      salaryOtherDeduction: "0.00",
      salaryAdjustmentReason: "",
      salaryNote: "",
    };
    for (const [id, value] of Object.entries(values)) {
      const node = dom.window.document.getElementById(id)
        || dom.window.document.querySelector(`[data-f="${id}"]`);
      assert.ok(node, `missing payroll input ${id}`);
      node.value = value;
    }

    dom.window.document.querySelector('[data-act="payroll-preview"]').click();
    await waitFor(() => S.payrollPreview?.calculation?.netSalary === "20878.00");
    assert.match(dom.window.document.querySelector("#view").textContent, /应发工资.*25,?000\.00/);
    assert.match(dom.window.document.querySelector("#view").textContent, /实发工资.*20,?878\.00/);

    dom.window.document.querySelector('[data-act="payroll-confirm"]').click();
    await waitFor(() => saveCalls === 1);
    await waitFor(() => !S.payrollSaving);
    assert.equal(lastSave.status, "processing");
    assert.equal(lastSave.employmentMonthsYtd, undefined);
  } finally {
    dom.window.close();
  }
});

test("shows a payroll calculation entry only for formal salary managers", async () => {
  const managerBootstrap = formalBootstrap({
    memberId: "m7",
    permissions: ["task.execute", "salary.self", "salary.manage"],
  });
  const managerDom = await openFormalWorkbench(
    "http://127.0.0.1:3012/quantxy-ai-workbench-fused.html?formal=1",
    managerBootstrap,
  );
  try {
    managerDom.window.Q.S.page = "fin";
    managerDom.window.Q.render();
    const managerView = managerDom.window.document.querySelector("#view").textContent;
    assert.match(managerView, /本月薪资核算/);
    assert.match(managerView, /累计预扣法/);
    const entry = managerDom.window.document.querySelector('[data-act="go"][data-page="pay-admin"]');
    assert.ok(entry, "salary manager should get a direct payroll calculation entry");
    entry.click();
    assert.equal(managerDom.window.Q.S.page, "pay-admin");
    assert.match(managerDom.window.document.querySelector("#view").textContent, /工资核算/);
  } finally {
    managerDom.window.close();
  }

  const employeeDom = await openFormalWorkbench(
    "http://127.0.0.1:3012/quantxy-ai-workbench-fused.html?formal=1",
    formalBootstrap({
      memberId: "m7",
      permissions: ["task.execute", "salary.self"],
    }),
  );
  try {
    employeeDom.window.Q.S.page = "fin";
    employeeDom.window.Q.render();
    assert.doesNotMatch(employeeDom.window.document.querySelector("#view").textContent, /本月薪资核算/);
    assert.equal(employeeDom.window.document.querySelector('[data-act="go"][data-page="pay-admin"]'), null);
  } finally {
    employeeDom.window.close();
  }
});

test("activates payroll policy only after the example is confirmed", async () => {
  const bootstrap = formalBootstrap({
    memberId: "m7",
    permissions: ["task.execute", "salary.manage"],
  });
  let saved = null;
  const policyResponse = {
    active: null,
    history: [{
      publicId: "policy-draft",
      status: "draft",
      effectiveMonth: "2026-08",
      pensionEmployeeRate: "8",
      medicalEmployeeRate: "2",
      medicalEmployeeFixedAmount: "3.00",
      unemploymentEmployeeRate: "0.5",
      housingFundEmployeeRate: "7",
      socialBaseMin: "5000.00",
      socialBaseMax: "30000.00",
      housingBaseMin: "5000.00",
      housingBaseMax: "30000.00",
    }],
    draftExample: {
      confirmationHash: "a".repeat(64),
      sample: {
        grossSalary: "10000.00",
        socialSecurity: "1553.00",
        individualIncomeTax: "103.41",
        deductions: "1656.41",
        netSalary: "8343.59",
      },
    },
  };
  const dom = await openFormalWorkbench(
    "http://127.0.0.1:3012/quantxy-ai-workbench-fused.html?formal=1",
    bootstrap,
    {
      loadPayrollPolicy: async () => policyResponse,
      savePayrollPolicy: async (input) => {
        saved = input;
        return { status: "active" };
      },
    },
  );
  try {
    const { S } = dom.window.Q;
    S.page = "set";
    dom.window.Q.render();
    await waitFor(() => S.payrollPolicyLoaded);
    const activate = dom.window.document.querySelector('[data-act="payroll-policy-activate"]');
    assert.ok(activate);
    assert.equal(activate.disabled, true);
    const confirm = dom.window.document.getElementById("policyExampleConfirmed");
    confirm.checked = true;
    confirm.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
    confirm.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    assert.equal(dom.window.document.querySelector('[data-act="payroll-policy-activate"]').disabled, false);
    dom.window.document.querySelector('[data-act="payroll-policy-activate"]').click();
    await waitFor(() => saved?.action === "activate");
    assert.equal(saved.exampleConfirmationHash, "a".repeat(64));
    await waitFor(() => !S.payrollPolicyBusy);
  } finally {
    dom.window.close();
  }
});

test("payroll summary cards open and focus the calculation detail", async () => {
  const bootstrap = formalBootstrap({
    memberId: "m7",
    permissions: ["task.execute", "salary.self"],
  });
  bootstrap.payroll = {
    m7: [{
      month: "2026-08",
      base: 100000,
      performance: 0,
      projectBonus: 0,
      otherBonus: 0,
      otherIncome: 0,
      pensionEmployee: 0,
      medicalEmployee: 0,
      unemploymentEmployee: 0,
      housingFundEmployee: 0,
      social: 0,
      tax: 0,
      otherDeduction: 0,
      gross: 100000,
      deductions: 0,
      net: 100000,
      status: "待发放",
      payDate: "",
    }],
  };
  const dom = await openFormalWorkbench(
    "http://127.0.0.1:3012/quantxy-ai-workbench-fused.html?formal=1",
    bootstrap,
    { loadPayroll: (memberId) => bootstrap.payroll[memberId] || [] },
  );
  try {
    const { S } = dom.window.Q;
    S.page = "fin";
    dom.window.Q.render();
    let scrolled = false;
    dom.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {
      if (this.id === "payrollDetailCard") scrolled = true;
    };
    await waitFor(() => dom.window.document.querySelector('[data-act="payroll-focus"][data-focus="deductions"]'));
    dom.window.document.querySelector('[data-act="payroll-focus"][data-focus="deductions"]').click();
    await waitFor(() => S.f.payFocus === "deductions" && S.payrollDetailsOpen);
    await waitFor(() => scrolled);
    assert.match(dom.window.document.querySelector("#view").textContent, /扣款合计明细/);
    assert.match(dom.window.document.querySelector(".modal")?.textContent || "", /扣款合计明细/);
    assert.match(dom.window.document.querySelector(".modal")?.textContent || "", /社保公积金/);
    assert.match(dom.window.document.querySelector(".modal")?.textContent || "", /仅显示当前登录员工本人薪资/);
  } finally {
    dom.window.close();
  }
});

test("lets a formal CEO close read-only payroll detail modals without write-interface warnings", async () => {
  const bootstrap = formalBootstrap({
    memberId: "m7",
    permissions: ["task.execute", "salary.self", "salary.manage"],
  });
  bootstrap.payroll = {
    m7: [{
      month: "2026-08",
      base: 4000,
      performance: 0,
      projectBonus: 500,
      otherBonus: 0,
      otherIncome: 0,
      pensionEmployee: 0,
      medicalEmployee: 0,
      unemploymentEmployee: 0,
      housingFundEmployee: 0,
      social: 0,
      tax: 0,
      otherDeduction: 0,
      gross: 4000,
      deductions: 0,
      net: 4000,
      status: "待发放",
      payDate: "",
    }],
  };
  const dom = await openFormalWorkbench(
    "http://127.0.0.1:3012/quantxy-ai-workbench-fused.html?formal=1",
    bootstrap,
    { loadPayroll: (memberId) => bootstrap.payroll[memberId] || [] },
  );
  try {
    const { S } = dom.window.Q;
    S.page = "fin";
    dom.window.Q.render();
    dom.window.document.querySelector('[data-act="payroll-focus"][data-focus="performance"]').click();
    await waitFor(() => dom.window.document.querySelector(".modal"));
    assert.match(dom.window.document.querySelector(".modal").textContent, /绩效奖金明细/);

    dom.window.document.querySelector('[data-act="modal-ok"]').click();
    await waitFor(() => !dom.window.document.querySelector(".modal"));
    assert.notEqual(dom.window.document.querySelector("#toast")?.textContent, "真实数据接口未配置");
    assert.equal(S.confirm, null);
  } finally {
    dom.window.close();
  }
});

function formalBootstrap({
  memberId = "77777777-7777-4777-8777-777777777777",
  taskId = "11111111-1111-4111-8111-111111111111",
  ownerId = memberId,
  permissions = ["task.execute", "payroll.read.self"],
  notification = { status: "failed", errorCode: "send_failed" },
} = {}) {
  const projectId = "22222222-2222-4222-8222-222222222222";
  return {
    mode: "server",
    session: {
      authenticated: true,
      authMode: "feishu",
      dataMode: "server",
      memberId,
      permissions,
    },
    members: [
      { id: memberId, n: "当前员工", r: "产品经理", dept: "产品中心", lv: 3 },
      { id: ownerId, n: "任务执行人", r: "产品经理", dept: "产品中心", lv: 3 },
    ].filter((member, index, rows) => rows.findIndex((row) => row.id === member.id) === index),
    projects: [{ id: projectId, n: "正式项目", own: memberId, st: "进行中", cat: "企业项目" }],
    tasks: [{
      id: taskId,
      n: "飞书深链任务",
      p: projectId,
      own: ownerId,
      createdBy: ownerId,
      reviewer: ownerId,
      pri: "P1",
      st: "待处理",
      s: "2026-08-20",
      e: "2026-08-25",
      pr: 0,
      description: "从飞书进入工作台处理任务",
      ac: "仅当前可见员工可以打开",
      timeline: [],
      notification,
    }],
    payroll: { [memberId]: [] },
    features: { identitySwitch: false, demoReset: false },
  };
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

test("opens the current employee payroll from the compact mobile income entry", async () => {
  const dom = await openWorkbench();
  try {
    dom.window.matchMedia = (query) => ({
      matches: query === "(max-width:820px)",
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
    const { S } = dom.window.Q;
    S.me = "m1";
    S.page = "me";
    S.mobileTaskFocus = false;
    dom.window.Q.render();

    const incomeButton = dom.window.document.querySelector(
      '.me-mobile-income[data-act="open-income"]',
    );
    assert.ok(incomeButton);
    const month = incomeButton.getAttribute("data-month");

    incomeButton.click();

    assert.equal(S.page, "fin");
    assert.equal(S.f.payMonth, month);
    assert.match(dom.window.document.querySelector("#top").textContent, /我的薪酬/);
  } finally {
    dom.window.close();
  }
});

test("keeps the four mobile destinations fixed while more opens only secondary modules", async () => {
  const dom = await openWorkbench();
  try {
    dom.window.Q.S.page = "me";
    dom.window.Q.render();
    const core = Array.from(dom.window.document.querySelectorAll("#nav .mobile-core"));
    assert.deepEqual(core.map((node) => node.getAttribute("data-page")), ["me", "task", "fin"]);
    const more = dom.window.document.querySelector('#nav [data-act="mobile-nav-more"]');
    assert.ok(more);
    assert.equal(dom.window.document.querySelector("#nav").classList.contains("expanded"), false);
    more.click();
    const expandedNav = dom.window.document.querySelector("#nav");
    const panel = expandedNav.querySelector(".mobile-more-panel");
    assert.equal(expandedNav.classList.contains("expanded"), true);
    assert.ok(panel);
    assert.equal(panel.querySelectorAll(".mobile-extra").length, 13);
    assert.ok(panel.querySelector('[data-page="profile"]'));
    assert.equal(expandedNav.querySelectorAll(":scope > .mobile-core").length, 3);
    assert.ok(expandedNav.querySelector(":scope > [data-act=\"mobile-nav-more\"]"));
    assert.equal(dom.window.document.activeElement?.getAttribute("data-act"), "mobile-nav-more");

    dom.window.document.body.click();
    assert.equal(dom.window.document.querySelector("#nav").classList.contains("expanded"), false);

    dom.window.document.querySelector('[data-act="mobile-nav-more"]').click();
    dom.window.document.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(dom.window.document.querySelector("#nav").classList.contains("expanded"), false);
    assert.equal(dom.window.document.activeElement?.getAttribute("data-act"), "mobile-nav-more");
  } finally {
    dom.window.close();
  }
});

test("opens a focused personal task screen from the mobile task destination", async () => {
  const dom = await openWorkbench();
  try {
    const calls = [];
    dom.window.scrollTo = (...args) => calls.push(args);
    dom.window.matchMedia = (query) => ({
      matches: query === "(max-width:820px)",
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
    const { S } = dom.window.Q;
    S.me = "m1";
    S.page = "me";
    S.mobileTaskFocus = false;
    dom.window.Q.render();
    dom.window.document.documentElement.scrollTop = 320;
    dom.window.document.body.scrollTop = 320;

    dom.window.document.querySelector('#nav [data-page="task"]').click();

    assert.equal(S.page, "me");
    assert.equal(S.mobileTaskFocus, true);
    assert.match(dom.window.document.querySelector("#top").textContent, /我的任务/);
    assert.ok(dom.window.document.querySelector(".personal-workbench.mobile-task-focus"));
    assert.ok(dom.window.document.querySelector('#nav [data-page="task"]').classList.contains("on"));
    assert.equal(dom.window.document.documentElement.scrollTop, 0);
    assert.equal(dom.window.document.body.scrollTop, 0);
    assert.ok(calls.length > 0);
  } finally {
    dom.window.close();
  }
});

test("opens filtered personal tasks from a workbench status and returns to the minimal home", async () => {
  const dom = await openWorkbench();
  try {
    dom.window.matchMedia = (query) => ({
      matches: query === "(max-width:820px)",
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
    const { S } = dom.window.Q;
    S.me = "m1";
    S.page = "me";
    S.mobileTaskFocus = false;
    dom.window.Q.render();

    dom.window.document.querySelector('.me-summary [data-act="my-task-filter"]').click();
    assert.equal(S.mobileTaskFocus, true);
    assert.ok(dom.window.document.querySelector(".personal-workbench.mobile-task-focus"));

    dom.window.document.querySelector('#nav [data-page="me"]').click();
    assert.equal(S.page, "me");
    assert.equal(S.mobileTaskFocus, false);
    assert.ok(dom.window.document.querySelector(".personal-workbench:not(.mobile-task-focus)"));
    assert.match(dom.window.document.querySelector("#top").textContent, /工作台/);
    assert.doesNotMatch(dom.window.document.querySelector("#top").textContent, /员工工作台/);
  } finally {
    dom.window.close();
  }
});

test("keeps mobile task focus through landscape and clears it after entering desktop width", async () => {
  const dom = await openWorkbench();
  try {
    let mobileShell = true;
    dom.window.matchMedia = (query) => ({
      matches: query === "(max-width:820px)" && mobileShell,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
    const { S } = dom.window.Q;
    S.me = "m1";
    S.page = "me";
    S.mobileTaskFocus = false;
    dom.window.Q.render();

    dom.window.document.querySelector('#nav [data-page="task"]').click();
    assert.equal(S.mobileTaskFocus, true);
    assert.ok(dom.window.document.querySelector(".personal-workbench.mobile-task-focus"));

    dom.window.dispatchEvent(new dom.window.Event("resize"));
    assert.equal(S.mobileTaskFocus, true);

    mobileShell = false;
    dom.window.dispatchEvent(new dom.window.Event("resize"));
    assert.equal(S.mobileTaskFocus, false);
    assert.ok(dom.window.document.querySelector(".personal-workbench:not(.mobile-task-focus)"));
    assert.match(dom.window.document.querySelector("#top").textContent, /员工工作台/);
  } finally {
    dom.window.close();
  }
});

test("refreshes the personal workbench shell when entering mobile width from desktop", async () => {
  const dom = await openWorkbench();
  try {
    let mobileShell = false;
    dom.window.matchMedia = (query) => ({
      matches: query === "(max-width:820px)" && mobileShell,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
    dom.window.Q.S.page = "me";
    dom.window.Q.S.mobileTaskFocus = false;
    dom.window.Q.render();
    assert.match(dom.window.document.querySelector("#top").textContent, /员工工作台/);

    mobileShell = true;
    dom.window.dispatchEvent(new dom.window.Event("resize"));

    assert.match(dom.window.document.querySelector("#top").textContent, /工作台/);
    assert.doesNotMatch(dom.window.document.querySelector("#top").textContent, /员工工作台/);
  } finally {
    dom.window.close();
  }
});

test("reacts to the mobile media-query change event when the viewport crosses the breakpoint", async () => {
  let mobileShell = false;
  let onShellChange;
  const dom = await openWorkbench(undefined, (window) => {
    window.matchMedia = (query) => ({
      matches: query === "(max-width:820px)" && mobileShell,
      media: query,
      addEventListener(type, listener) {
        if (query === "(max-width:820px)" && type === "change") onShellChange = listener;
      },
      removeEventListener() {},
      addListener(listener) {
        if (query === "(max-width:820px)") onShellChange = listener;
      },
      removeListener() {},
    });
  });
  try {
    dom.window.Q.S.page = "me";
    dom.window.Q.render();
    assert.equal(typeof onShellChange, "function");

    mobileShell = true;
    onShellChange({ matches: true });

    assert.match(dom.window.document.querySelector("#top").textContent, /工作台/);
    assert.doesNotMatch(dom.window.document.querySelector("#top").textContent, /员工工作台/);
  } finally {
    dom.window.close();
  }
});

test("resets page position and focuses the task heading when opening execution detail", async () => {
  const dom = await openWorkbench();
  try {
    const calls = [];
    dom.window.scrollTo = (...args) => calls.push(args);
    dom.window.Q.S.me = "m1";
    dom.window.Q.S.page = "me";
    dom.window.Q.render();
    dom.window.document.documentElement.scrollTop = 320;
    dom.window.document.body.scrollTop = 320;
    dom.window.document.querySelector('[data-act="open-execution"]').click();

    const heading = dom.window.document.querySelector("#view [data-page-heading]");
    assert.ok(heading);
    assert.equal(dom.window.document.activeElement, heading);
    assert.equal(dom.window.document.documentElement.scrollTop, 0);
    assert.equal(dom.window.document.body.scrollTop, 0);
    assert.ok(calls.length > 0);
  } finally {
    dom.window.close();
  }
});

test("keeps seeded in-progress demo tasks ready for the next action", async () => {
  const dom = await openWorkbench();
  try {
    const active = dom.window.Q.S.tasks.filter((task) => task.st === "进行中");
    assert.ok(active.length > 0);
    for (const task of active) {
      assert.ok(task.acceptedAt, `${task.id} should have a claim time`);
      assert.ok(task.nextStep, `${task.id} should have a next action`);
      assert.ok(task.timeline.length > 0, `${task.id} should have an execution record`);
    }
  } finally {
    dom.window.close();
  }
});

test("labels personal overdue counts and review reminders with distinct scopes", async () => {
  const dom = await openWorkbench();
  try {
    const { S } = dom.window.Q;
    const createdForReview = S.tasks.find((task) => task.own !== "m1");
    createdForReview.createdBy = "m1";
    createdForReview.reviewer = "m1";
    createdForReview.st = "待验收";
    createdForReview.e = "2020-01-01";
    S.me = "m1";
    S.page = "me";
    dom.window.Q.render();

    const text = dom.window.document.querySelector("#view").textContent;
    assert.match(text, /我的逾期/);
    assert.match(text, /待我验收 · 已逾期/);
  } finally {
    dom.window.close();
  }
});

test("explains the filtered empty task state and offers a return to all tasks", async () => {
  const dom = await openWorkbench();
  try {
    const { S } = dom.window.Q;
    S.me = "m1";
    S.page = "me";
    S.f.meScope = "todo";
    S.f.meTab = "已完成";
    S.tasks = S.tasks.filter((task) => !(task.own === "m1" && task.st === "已完成"));
    dom.window.Q.render();
    assert.match(dom.window.document.querySelector("#view").textContent, /暂无已完成任务/);
    const showAll = dom.window.document.querySelector('[data-act="my-task-filter"][data-status="all"][data-empty-action]');
    assert.ok(showAll);
    showAll.click();
    assert.equal(S.f.meTab, "all");
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

test("shows the current employee calculated payslip without exposing another employee payroll", async () => {
  const dom = await openWorkbench();
  try {
    const { S } = dom.window.Q;
    S.me = "m1";
    S.page = "fin";
    S.payroll.m1 = [{
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
    }];
    S.payroll.m2 = [{
      month: "2026-08",
      base: 999999,
      performance: 0,
      projectBonus: 0,
      otherBonus: 0,
      social: 0,
      tax: 0,
      otherDeduction: 0,
      calculationVersion: "cn-cumulative-withholding-v1",
    }];

    dom.window.Q.render();
    const view = dom.window.document.querySelector("#view").textContent;
    for (const label of [
      "应发工资",
      "养老保险",
      "医疗保险",
      "失业保险",
      "住房公积金",
      "累计应纳税所得额",
      "本期个人所得税",
      "扣款合计",
      "实发工资",
      "补扣上月餐费",
    ]) {
      assert.match(view, new RegExp(label));
    }
    assert.doesNotMatch(view, /999,999/);
    assert.doesNotMatch(view, /data-member-id/);
  } finally {
    dom.window.close();
  }
});

test("keeps payroll totals visible and collapses detailed items on compact mobile", async () => {
  const dom = await openWorkbench();
  try {
    dom.window.matchMedia = (query) => ({
      matches: query === "(max-width:680px)" || query === "(max-width:820px)",
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    });
    const { S } = dom.window.Q;
    S.me = "m1";
    S.page = "fin";
    S.payroll.m1 = [{
      month: "2026-08",
      base: 20000,
      performance: 1000,
      projectBonus: 2000,
      otherBonus: 2000,
      pensionEmployee: 1600,
      medicalEmployee: 400,
      unemploymentEmployee: 100,
      housingFundEmployee: 1400,
      social: 3500,
      cumulativeTaxableIncome: 120000,
      tax: 620,
      otherDeduction: 0,
      calculationVersion: "cn-cumulative-withholding-v1",
    }];

    dom.window.Q.render();
    const view = dom.window.document.querySelector("#view").textContent;
    assert.match(view, /应发工资/);
    assert.match(view, /扣款合计/);
    assert.match(view, /实发工资/);
    const toggle = dom.window.document.querySelector('[data-act="payroll-details-toggle"]');
    const details = dom.window.document.querySelector("[data-payroll-details]");
    assert.ok(toggle);
    assert.ok(details);
    assert.equal(toggle.getAttribute("aria-expanded"), "false");
    assert.equal(details.hidden, true);
    assert.ok(Number.parseInt(dom.window.getComputedStyle(toggle).minHeight, 10) >= 44);

    toggle.click();
    const expanded = dom.window.document.querySelector('[data-act="payroll-details-toggle"]');
    const expandedDetails = dom.window.document.querySelector("[data-payroll-details]");
    assert.equal(expanded.getAttribute("aria-expanded"), "true");
    assert.equal(expandedDetails.hidden, false);
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
  let logoutCalls = 0;
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
        logout: async () => { logoutCalls += 1; },
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
            canManage: true,
          });
        }
        return response(false, { error: "unexpected_request" }, 404);
      };
    },
  });
  try {
    await waitFor(() => dom.window.Q?.S.me === "server-user-1");
    await waitFor(() => dom.window.Q?.S.aiConfig.loaded && dom.window.Q.S.aiConfig.canManage);
    assert.deepEqual(dom.window.Q.S.tasks.map((task) => task.id), ["server-task-1"]);
    assert.equal(dom.window.Q.gateway.getSession().authMode, "feishu");
    dom.window.Q.S.page = "me";
    dom.window.Q.render();
    assert.match(dom.window.document.querySelector("#view").textContent, /飞书真实任务/);
    assert.doesNotMatch(dom.window.document.querySelector("#view").textContent, /量子计算平台接口设计评审/);
    assert.equal(dom.window.document.querySelector('[data-act="setme"]'), null);
    assert.equal(requests.includes("/api/demo-auth/session"), false);
    assert.match(dom.window.document.querySelector("#nav").textContent, /系统设置/);
    dom.window.Q.S.page = "set";
    dom.window.Q.render();
    assert.equal(dom.window.document.querySelector("#cfgModel").disabled, false);
    assert.equal(dom.window.document.querySelector("#cfgNewKey").disabled, false);
    assert.equal(dom.window.document.querySelector('[data-act="update-ai-key"]').disabled, false);
    assert.equal(dom.window.document.querySelector("#cfgWd").disabled, true);
    assert.equal(dom.window.document.querySelector('[data-act="save-schedule"]').disabled, true);
    assert.match(dom.window.document.querySelector("#view").textContent, /所有已登录内部成员均可更换模型和更新密钥/);
    dom.window.document.querySelector('[data-act="logout"]').click();
    await waitFor(() => logoutCalls === 1);
    assert.equal(dom.window.Q.S.serviceError, "");
    assert.doesNotMatch(
      dom.window.document.querySelector("#view").textContent,
      /真实数据服务不可用|真实身份会话已退出/,
    );
  } finally {
    dom.window.close();
  }
});

test("dispatches an approved AI schedule to the selected real project", async () => {
  const html = await readRealModeHtml();
  const createdBatches = [];
  const memberId = "m7";
  const projectId = "11111111-1111-4111-8111-111111111111";
  const session = {
    authenticated: true,
    authMode: "feishu",
    dataMode: "server",
    memberId,
    permissions: ["task.manage", "task.execute"],
  };
  const members = [
    { id: memberId, n: "张云帆", r: "产品经理", dept: "产品中心", lv: 3, sk: "产品设计" },
    { id: "m8", n: "周凯", r: "算法工程师", dept: "研发中心", lv: 3, sk: "AI能力" },
  ];
  const projects = [{ id: projectId, n: "真实项目", own: memberId, st: "进行中", cat: "企业项目" }];
  const dom = new JSDOM(html, {
    url: "http://127.0.0.1:3011/quantxy-ai-workbench-fused.html?formal=1",
    runScripts: "dangerously",
    pretendToBeVisual: true,
    beforeParse(window) {
      window.scrollTo = () => {};
      window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      window.QUANTXY_WORKSTATION_RUNTIME = { authMode: "feishu", dataMode: "server" };
      window.QUANTXY_WORKSTATION_SERVER_ADAPTER = {
        getSession: () => session,
        loadBootstrap: () => ({
          mode: "server",
          session,
          members,
          projects,
          tasks: [],
          payroll: { [memberId]: [] },
          features: { identitySwitch: false, demoReset: false },
        }),
        loadMyDashboard: () => ({ tasks: [], must: [], projects, payroll: null, reminders: [] }),
        listMyTasks: () => [],
        loadMyTask: () => null,
        listMyProjects: () => projects,
        loadPayroll: () => [],
        saveTask: () => null,
        claimTask: () => null,
        updateTaskExecution: () => null,
        submitTaskResult: () => null,
        reviewTaskResult: () => null,
        reopenTask: () => null,
        createTasks: async (inputs) => {
          createdBatches.push(inputs);
          return inputs.map((input, index) => ({
            id: index === 0
              ? "22222222-2222-4222-8222-222222222222"
              : "33333333-3333-4333-8333-333333333333",
            n: input.title,
            p: input.projectId,
            own: input.assigneeMemberId,
            createdBy: memberId,
            reviewer: memberId,
            pri: input.priority,
            st: "待处理",
            s: "2026-08-19",
            e: input.dueDate,
            pr: 0,
            description: input.description,
            ac: input.acceptanceCriteria,
            timeline: [],
            notification: index === 0
              ? { status: "sent", errorCode: "" }
              : { status: "failed", errorCode: "recipient_unavailable" },
          }));
        },
      };
      window.fetch = async (url) => String(url) === "/api/ai/config"
        ? response(true, { provider: "deepseek", apiBaseUrl: "https://api.deepseek.com", model: "deepseek-v4-flash", keyConfigured: true, canManage: true })
        : response(false, {}, 404);
    },
  });
  try {
    await waitFor(() => dom.window.Q?.S.me === memberId);
    const { S } = dom.window.Q;
    S.sch = {
      goal: "完成飞书团队协作上线",
      deadline: "2026-08-31",
      budget: 30,
      must: "按期验收",
      busy: false,
      err: "",
      projectId: "",
      tasks: [
        { id: "schedule-task-1", n: "完成任务领取联调", ph: "联调", role: "产品经理", days: 2, pri: "P1", ac: "员工可以领取并提交" },
        { id: "schedule-task-2", n: "完成算法验收", ph: "联调", role: "算法工程师", days: 1, pri: "P0", ac: "负责人确认结果" },
      ],
      plans: [{
        k: "A", name: "均衡方案", map: {
          "schedule-task-1": { own: memberId, s: 0, e: 1, dur: 2, crit: true },
          "schedule-task-2": { own: "m8", s: 0, e: 2, dur: 1, crit: false },
        },
        heads: 2, peak: 2, days: 2, end: "2026-08-21", cost: 2000, util: 50, inten: 70,
        tag: "测试方案", score: { speed: 90, cost: 90, risk: 90 },
      }],
      pick: "A",
      from: "测试",
      issued: false,
      issuing: false,
    };
    S.page = "sched";
    dom.window.Q.render();
    const projectSelect = dom.window.document.querySelector("#schProject");
    projectSelect.value = projectId;
    projectSelect.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
    assert.equal(S.sch.projectId, projectId);
    dom.window.document.querySelector('[data-act="issue"]').click();

    await waitFor(() => createdBatches.length === 1 && S.sch.issued === true);
    const expectedDue = new Date();
    expectedDue.setHours(0, 0, 0, 0);
    expectedDue.setDate(expectedDue.getDate() + 1);
    const expectedDueDate = `${expectedDue.getFullYear()}-${String(expectedDue.getMonth() + 1).padStart(2, "0")}-${String(expectedDue.getDate()).padStart(2, "0")}`;
    assert.deepEqual(JSON.parse(JSON.stringify(createdBatches[0][0])), {
      projectId,
      assigneeMemberId: memberId,
      title: "完成任务领取联调",
      description: "完成飞书团队协作上线",
      acceptanceCriteria: "员工可以领取并提交",
      dueDate: expectedDueDate,
      priority: "P1",
    });
    assert.equal(createdBatches[0].length, 2);
    assert.equal(createdBatches[0][1].assigneeMemberId, "m8");
    assert.equal(S.tasks.length, 2);
    assert.equal(S.tasks[0].p, projectId);
    assert.equal(
      dom.window.document.querySelector("#toast").textContent,
      "已创建 2 项任务，飞书送达 1 项，未送达 1 项",
    );
  } finally {
    dom.window.close();
  }
});

test("requests structured WBS output and keeps required employee skills", async () => {
  const bootstrap = formalBootstrap({ permissions: ["task.manage"] });
  let aiRequest;
  const dom = await openFormalWorkbench(
    "http://127.0.0.1:3012/quantxy-ai-workbench-fused.html?formal=1",
    bootstrap,
    {},
    async (url, init) => {
      if (String(url) !== "/api/ai/chat") {
        return response(false, { error: "unexpected_request" }, 404);
      }
      aiRequest = JSON.parse(String(init?.body));
      return response(true, {
        choices: [{
          finish_reason: "stop",
          message: {
            content: JSON.stringify({
              tasks: [{
                id: "W1",
                ph: "需求阶段",
                n: "完成客户需求访谈",
                role: "产品经理",
                skills: ["需求分析", "客户访谈"],
                days: 2,
                dep: [],
                pri: "P1",
                ac: "提交访谈纪要并通过负责人验收",
              }],
            }),
          },
        }],
      });
    },
  );

  try {
    dom.window.Q.S.page = "sched";
    dom.window.Q.render();
    dom.window.document.querySelector("#schGoal").value = "完成客户需求研究";
    dom.window.document.querySelector('[data-act="gen"]').click();

    await waitFor(() => dom.window.Q.S.sch.tasks?.[0]?.n === "完成客户需求访谈");
    assert.equal(aiRequest.structured_output, true);
    assert.equal(aiRequest.max_tokens, 2400);
    assert.deepEqual(
      JSON.parse(JSON.stringify(dom.window.Q.S.sch.tasks[0].skills)),
      ["需求分析", "客户访谈"],
    );
  } finally {
    dom.window.close();
  }
});

test("lets the signed-in employee maintain a concise work profile", async () => {
  const bootstrap = formalBootstrap();
  bootstrap.members[0].workProfile = {
    summary: "擅长需求拆解",
    preferredTaskTypes: ["需求分析"],
    growthGoals: ["AI产品设计"],
    weeklyCapacityHours: 36,
    verifiedSkills: [{ name: "产品规划", level: 5, yearsExperience: 4, verified: true }],
    selfSkills: [{ name: "客户访谈", level: 4 }],
    activeTaskCount: 2,
    overdueTaskCount: 0,
    completedTaskCount: 8,
    onTimeRate: 96,
    workloadPercent: 44,
    updatedAt: "2026-08-21T02:00:00.000Z",
  };
  let savedInput;
  const dom = await openFormalWorkbench(
    "http://127.0.0.1:3012/quantxy-ai-workbench-fused.html?formal=1",
    bootstrap,
    {
      saveWorkProfile: async (input) => {
        savedInput = input;
        return { ...input, updatedAt: "2026-08-21T03:00:00.000Z" };
      },
    },
  );

  try {
    dom.window.Q.S.page = "profile";
    dom.window.Q.render();
    assert.match(dom.window.document.querySelector("#view").textContent, /我的工作画像/);
    assert.match(dom.window.document.querySelector("#view").textContent, /已验证技能/);
    assert.match(dom.window.document.querySelector("#view").textContent, /岗位职能：产品经理/);
    assert.match(dom.window.document.querySelector("#view").textContent, /来自飞书通讯录/);
    assert.equal(dom.window.document.querySelector("#wpSummary").value, "擅长需求拆解");

    dom.window.document.querySelector("#wpSummary").value = "擅长把复杂目标转成可验收任务";
    dom.window.document.querySelector("#wpTypes").value = "需求分析，跨部门协作";
    dom.window.document.querySelector("#wpGoals").value = "AI产品设计，项目管理";
    dom.window.document.querySelector("#wpCapacity").value = "40";
    dom.window.document.querySelector("#wpSkills").value = "客户访谈:5，数据分析:3";
    dom.window.document.querySelector('[data-act="save-work-profile"]').click();

    await waitFor(() => savedInput && dom.window.document.querySelector("#toast")?.textContent === "工作画像已更新");
    assert.deepEqual(JSON.parse(JSON.stringify(savedInput)), {
      summary: "擅长把复杂目标转成可验收任务",
      preferredTaskTypes: ["需求分析", "跨部门协作"],
      growthGoals: ["AI产品设计", "项目管理"],
      weeklyCapacityHours: 40,
      selfSkills: [
        { name: "客户访谈", level: 5 },
        { name: "数据分析", level: 3 },
      ],
    });
    assert.equal(dom.window.document.querySelector("#wpSummary").value, "擅长把复杂目标转成可验收任务");
  } finally {
    dom.window.close();
  }
});

test("recommends the best employee with explainable skill and workload evidence", async () => {
  const bootstrap = formalBootstrap({ permissions: ["task.manage"] });
  bootstrap.members = [
    {
      id: "member-busy",
      n: "高负荷同事",
      r: "产品经理",
      dept: "产品中心",
      cap: 0.2,
      sk: "需求分析",
      workProfile: {
        verifiedSkills: [{ name: "需求分析", level: 3, verified: true }],
        selfSkills: [],
        preferredTaskTypes: [],
        growthGoals: [],
        activeTaskCount: 5,
        overdueTaskCount: 2,
        completedTaskCount: 8,
        onTimeRate: 62,
        workloadPercent: 92,
      },
    },
    {
      id: "member-fit",
      n: "匹配员工",
      r: "产品经理",
      dept: "产品中心",
      cap: 0.85,
      sk: "需求分析·客户访谈",
      workProfile: {
        verifiedSkills: [
          { name: "需求分析", level: 5, verified: true },
          { name: "客户访谈", level: 4, verified: true },
        ],
        selfSkills: [],
        preferredTaskTypes: ["客户访谈"],
        growthGoals: [],
        activeTaskCount: 1,
        overdueTaskCount: 0,
        completedTaskCount: 18,
        onTimeRate: 97,
        firstPassRate: 94,
        qualityScore: 96,
        efficiencyScore: 91,
        performanceSampleCount: 18,
        workloadPercent: 28,
      },
    },
  ];
  bootstrap.session.memberId = "member-fit";
  bootstrap.projects[0].own = "member-fit";
  bootstrap.payroll = { "member-fit": [] };

  const dom = await openFormalWorkbench(
    "http://127.0.0.1:3012/quantxy-ai-workbench-fused.html?formal=1",
    bootstrap,
  );

  try {
    const task = {
      id: "W1",
      ph: "需求阶段",
      n: "完成客户需求访谈",
      role: "产品经理",
      skills: ["需求分析", "客户访谈"],
      days: 2,
      dep: [],
      pri: "P1",
      ac: "提交访谈纪要",
    };
    const plans = dom.window.Q.makePlans([task]);
    assert.equal(plans[0].map.W1.own, "member-fit");

    dom.window.Q.S.page = "sched";
    dom.window.Q.S.sch.tasks = [task];
    dom.window.Q.S.sch.plans = plans;
    dom.window.Q.S.sch.pick = "A";
    dom.window.Q.render();

    const text = dom.window.document.querySelector("#view").textContent;
    assert.match(text, /匹配员工/);
    assert.match(text, /匹配技能：需求分析、客户访谈/);
    assert.match(text, /当前负荷：28%/);
    assert.match(text, /按时交付：97%/);
    assert.match(text, /质量表现：96%/);
    assert.match(text, /效率表现：91%/);
    assert.match(text, /推荐理由/);
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
    assert.equal(dom.window.document.querySelector('[data-act="save-schedule"]').disabled, true);
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

    assert.deepEqual(messages, ["", ...Array(messages.length - 1).fill("真实数据写接口未配置")]);
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
      S.topPanel = "old";
      S.confirm = { t: "old" };
      S.deptMgr = true;
    };
    const assertCleanUi = () => {
      assert.equal(S.page, "me");
      assert.deepEqual(JSON.parse(JSON.stringify(S.tab)), { proj: "all", task: "all", kb: "week" });
      assert.deepEqual(JSON.parse(JSON.stringify(S.f)), {
        projCat: "all", projSt: "all", projQ: "", taskQ: "", taskOwn: "all", taskPri: "all", taskSt: "all",
        meScope: "todo", meTab: "all", payMonth: "", payFocus: "", kbQ: "", kbCat: "all", kbAdvanced: "0", kbRecommend: "0", orgQ: "", orgDept: "all", agentDept: "all", agentQ: "", agentTab: "dir", agentVis: "all",
        dashTab: "进行中", dateDays: "30", insightG: "日", insightScope: "全部业务", insightCompare: "前一周期", insightLine: "全部", insightChannel: "全部", insightRegion: "全部", gq: "", customerQ: "", customerSt: "all", activitySt: "all", decisionTab: "待我决策",
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
      assert.equal(S.topPanel, null);
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

test("gives every enabled workbench button an owned click action", async () => {
  const dom = await openWorkbench();
  try {
    const { S } = dom.window.Q;
    const pages = [
      "dash", "proj", "sched", "task", "me", "assistant", "customers",
      "activities", "decisions", "insight", "kb", "flow", "fin", "org", "set",
    ];
    const deadButtons = [];

    for (const page of pages) {
      S.page = page;
      dom.window.Q.render();
      for (const button of dom.window.document.querySelectorAll("button:not([disabled])")) {
        if (button.closest("[data-act]")) continue;
        deadButtons.push(`${page}: ${button.textContent.replace(/\s+/g, " ").trim() || button.getAttribute("aria-label") || "未命名按钮"}`);
      }
    }

    assert.deepEqual(deadButtons, []);
  } finally {
    dom.window.close();
  }
});

test("opens the date range menu and applies a selected range", async () => {
  const dom = await openWorkbench();
  try {
    const { S } = dom.window.Q;
    S.page = "me";
    dom.window.Q.render();

    const trigger = dom.window.document.querySelector('[data-act="date-range"]');
    assert.ok(trigger);
    trigger.click();
    const sevenDays = dom.window.document.querySelector('[data-act="date-preset"][data-days="7"]');
    assert.ok(sevenDays);
    sevenDays.click();

    assert.equal(S.f.dateDays, "7");
    assert.match(dom.window.document.querySelector('[data-act="date-range"]').textContent, /2026-|~/);
    assert.match(dom.window.document.querySelector("#toast").textContent, /最近 7 天/);
  } finally {
    dom.window.close();
  }
});

test("opens identity-scoped notifications and routes a task notification to execution", async () => {
  const dom = await openWorkbench();
  try {
    const { S } = dom.window.Q;
    S.me = "m1";
    S.page = "me";
    dom.window.Q.render();

    const trigger = dom.window.document.querySelector('[data-act="notifications"]');
    assert.ok(trigger);
    trigger.click();
    const taskNotice = dom.window.document.querySelector('[data-notification-task][data-act="open-execution"]');
    assert.ok(taskNotice);
    const taskId = taskNotice.getAttribute("data-id");
    taskNotice.click();

    assert.equal(S.page, "execution");
    assert.equal(S.sel.task, taskId);
    assert.ok(dom.window.document.querySelector('[data-act="task-claim"]'));
  } finally {
    dom.window.close();
  }
});

test("makes insight and knowledge utility controls produce visible state changes", async () => {
  const dom = await openWorkbench();
  try {
    const { S } = dom.window.Q;

    S.page = "insight";
    S.f.insightG = "月";
    dom.window.Q.render();
    dom.window.document.querySelector('[data-act="insight-reset"]').click();
    assert.equal(S.f.insightG, "日");
    dom.window.document.querySelector('[data-act="insight-region"]').click();
    assert.match(S.confirm?.t || "", /区域经营详情/);
    dom.window.document.querySelector('[data-act="modal-cancel"]').click();

    S.page = "kb";
    dom.window.Q.render();
    const initialRecommendation = dom.window.document.querySelector("[data-kb-recommendation]").textContent;
    dom.window.document.querySelector('[data-act="kb-hot"]').click();
    assert.ok(S.f.kbQ);
    dom.window.document.querySelector('[data-act="kb-refresh"]').click();
    assert.notEqual(dom.window.document.querySelector("[data-kb-recommendation]").textContent, initialRecommendation);
    dom.window.document.querySelector('[data-act="kb-open-source"]').click();
    assert.match(S.confirm?.t || "", /知识原文/);
  } finally {
    dom.window.close();
  }
});

test("opens one authorized UUID task from a formal deep link", async () => {
  const taskId = "11111111-1111-4111-8111-111111111111";
  const dom = await openFormalWorkbench(
    `http://127.0.0.1:3012/quantxy-ai-workbench-fused.html?formal=1&task=${taskId}`,
    formalBootstrap({ taskId }),
  );
  try {
    assert.equal(dom.window.Q.S.page, "execution");
    assert.equal(dom.window.Q.S.sel.task, taskId);
    assert.match(dom.window.document.querySelector("#view").textContent, /飞书深链任务/);
  } finally {
    dom.window.close();
  }
});

test("ignores invalid or repeated formal task parameters", async () => {
  for (const suffix of [
    "task=not-a-uuid",
    "task=11111111-1111-4111-8111-111111111111&task=11111111-1111-4111-8111-111111111111",
  ]) {
    const dom = await openFormalWorkbench(
      `http://127.0.0.1:3012/quantxy-ai-workbench-fused.html?formal=1&${suffix}`,
      formalBootstrap(),
    );
    try {
      assert.equal(dom.window.Q.S.page, "me");
      assert.equal(dom.window.Q.S.sel.task, null);
    } finally {
      dom.window.close();
    }
  }
});

test("ignores task deep links in demo runtime", async () => {
  const dom = await openWorkbench(
    undefined,
    undefined,
    "http://127.0.0.1:3011/quantxy-ai-workbench-fused.html?task=11111111-1111-4111-8111-111111111111",
  );
  try {
    assert.notEqual(dom.window.Q.S.page, "execution");
    assert.equal(dom.window.Q.S.sel.task, null);
  } finally {
    dom.window.close();
  }
});

test("returns an unauthorized formal task deep link to the personal workbench without disclosure", async () => {
  const taskId = "11111111-1111-4111-8111-111111111111";
  const dom = await openFormalWorkbench(
    `http://127.0.0.1:3012/quantxy-ai-workbench-fused.html?formal=1&task=${taskId}`,
    formalBootstrap({
      taskId,
      ownerId: "88888888-8888-4888-8888-888888888888",
    }),
  );
  try {
    await waitFor(() => dom.window.document.querySelector("#toast")?.textContent === "任务不存在或当前账号无权查看");
    assert.equal(dom.window.Q.S.page, "me");
    assert.equal(dom.window.Q.S.sel.task, null);
    assert.doesNotMatch(dom.window.document.querySelector("#view").textContent, /飞书深链任务/);
    assert.equal(dom.window.document.querySelector("#toast").textContent, "任务不存在或当前账号无权查看");
  } finally {
    dom.window.close();
  }
});

test("shows the exact safe Feishu delivery feedback after formal task creation", async () => {
  const messages = {
    sent: "任务已创建，飞书通知已送达",
    failed: "任务已创建，飞书通知暂未送达",
    unavailable: "任务已创建，请先同步该员工的飞书身份",
    pending: "任务已创建，飞书通知正在发送",
  };
  const bootstrap = formalBootstrap({ permissions: ["task.manage"] });
  let nextStatus = "sent";
  let createdCount = 0;
  const dom = await openFormalWorkbench(
    "http://127.0.0.1:3012/quantxy-ai-workbench-fused.html?formal=1",
    bootstrap,
    {
      createTask: async (input) => ({
        id: `33333333-3333-4333-8333-${String(++createdCount).padStart(12, "0")}`,
        n: input.title,
        p: input.projectId,
        own: input.assigneeMemberId,
        createdBy: bootstrap.session.memberId,
        reviewer: bootstrap.session.memberId,
        pri: input.priority,
        st: "待处理",
        s: "2026-08-20",
        e: input.dueDate,
        pr: 0,
        description: input.description,
        ac: input.acceptanceCriteria,
        timeline: [],
        notification: { status: nextStatus, errorCode: nextStatus === "failed" ? "send_failed" : "" },
      }),
    },
  );
  try {
    for (const [status, expected] of Object.entries(messages)) {
      nextStatus = status;
      dom.window.Q.S.form.task = {
        n: `通知状态 ${status}`,
        proj: bootstrap.projects[0].id,
        own: bootstrap.session.memberId,
        pri: "P1",
        s: "2026-08-20",
        e: "2026-08-25",
        ac: "员工收到任务并可以领取",
        sub: "",
      };
      dom.window.Q.S.page = "new-task";
      dom.window.Q.render();
      dom.window.document.querySelector('[data-act="f-task"]').click();
      await waitFor(() => dom.window.document.querySelector("#toast")?.textContent === expected);
      assert.equal(dom.window.document.querySelector("#toast").textContent, expected);
    }
  } finally {
    dom.window.close();
  }
});

test("keeps notification retry manager-only and prevents duplicate clicks while pending", async () => {
  const managerBootstrap = formalBootstrap({ permissions: ["task.manage"] });
  let retryCalls = 0;
  let finishRetry;
  const retryResult = new Promise((resolve) => { finishRetry = resolve; });
  const managerDom = await openFormalWorkbench(
    "http://127.0.0.1:3012/quantxy-ai-workbench-fused.html?formal=1&task=11111111-1111-4111-8111-111111111111",
    managerBootstrap,
    {
      retryTaskNotification: () => {
        retryCalls += 1;
        return retryResult;
      },
    },
  );
  try {
    const retryButton = managerDom.window.document.querySelector('[data-act="retry-task-notification"]');
    assert.ok(retryButton);
    assert.equal(retryButton.textContent.trim(), "重发飞书通知");
    assert.match(managerDom.window.document.querySelector("#view").textContent, /飞书通知暂未送达/);
    retryButton.click();
    assert.equal(managerDom.window.Q.S.notificationRetryBusy, true);
    await waitFor(() => retryCalls === 1);
    assert.equal(retryCalls, 1);
    assert.ok(!managerDom.window.document.querySelector('[data-act="retry-task-notification"]')
      || managerDom.window.document.querySelector('[data-act="retry-task-notification"]').disabled);
    finishRetry({ status: "sent", errorCode: "" });
    await waitFor(() => managerDom.window.Q.S.tasks[0].notification?.status === "sent");
    assert.equal(managerDom.window.Q.S.notificationRetryBusy, false);
    assert.match(managerDom.window.document.querySelector("#view").textContent, /飞书通知已送达/);
    assert.equal(managerDom.window.document.querySelector('[data-act="retry-task-notification"]'), null);
    assert.equal(managerDom.window.document.querySelector("#toast").textContent, "飞书通知已送达");
  } finally {
    managerDom.window.close();
  }

  const employeeDom = await openFormalWorkbench(
    "http://127.0.0.1:3012/quantxy-ai-workbench-fused.html?formal=1&task=11111111-1111-4111-8111-111111111111",
    formalBootstrap(),
  );
  try {
    assert.match(employeeDom.window.document.querySelector("#view").textContent, /飞书通知暂未送达/);
    assert.equal(employeeDom.window.document.querySelector('[data-act="retry-task-notification"]'), null);
  } finally {
    employeeDom.window.close();
  }
});

test("keeps a safe failed notification state when retry rejects", async () => {
  const bootstrap = formalBootstrap({ permissions: ["task.manage"] });
  const dom = await openFormalWorkbench(
    "http://127.0.0.1:3012/quantxy-ai-workbench-fused.html?formal=1&task=11111111-1111-4111-8111-111111111111",
    bootstrap,
    { retryTaskNotification: async () => { throw new Error("raw provider failure"); } },
  );
  try {
    dom.window.document.querySelector('[data-act="retry-task-notification"]').click();
    await waitFor(() => dom.window.Q.S.notificationRetryBusy === false
      && dom.window.document.querySelector("#toast")?.textContent === "飞书通知暂未送达");
    assert.deepEqual(JSON.parse(JSON.stringify(dom.window.Q.S.tasks[0].notification)), {
      status: "failed",
      errorCode: "send_failed",
    });
    assert.doesNotMatch(dom.window.document.querySelector("#view").textContent, /provider|raw|send_failed|open_id/);
  } finally {
    dom.window.close();
  }
});
