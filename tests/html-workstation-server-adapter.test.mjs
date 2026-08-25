import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { JSDOM } from "jsdom";

test("skips the formal workstation adapter during local preview", async () => {
  const source = await readFile(
    path.join(process.cwd(), "public", "workstation-server-adapter.js"),
    "utf8",
  );
  const requests = [];
  const dom = new JSDOM("<!doctype html><script></script>", {
    url: "http://127.0.0.1:3030/quantxy-ai-workbench-fused.html?v=local-preview",
    runScripts: "outside-only",
  });
  dom.window.fetch = async (url) => {
    requests.push(String(url));
    throw new Error("local preview must not call formal workstation APIs");
  };

  dom.window.eval(source);

  assert.deepEqual(requests, []);
  assert.equal(dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER, undefined);
  assert.equal(dom.window.QUANTXY_WORKSTATION_RUNTIME, undefined);
  dom.window.close();
});

test("exposes a formal login redirect helper for unauthorized bootstrap", async () => {
  const source = await readFile(
    path.join(process.cwd(), "public", "workstation-server-adapter.js"),
    "utf8",
  );

  assert.match(source, /function redirectToLogin\(\)/);
  assert.match(source, /window\.QUANTXY_WORKSTATION_AUTH_REQUIRED = true/);
  assert.match(source, /window\.setTimeout\(redirectToLogin, 0\)/);
  assert.match(source, /throw new Error\("unauthorized"\)/);
  assert.match(source, /redirectToLogin:\s*redirectToLogin/);
});

test("loads the formal bootstrap through XHR when fetch is unavailable", async () => {
  const source = await readFile(
    path.join(process.cwd(), "public", "workstation-server-adapter.js"),
    "utf8",
  );
  const requests = [];
  const bootstrap = {
    session: {
      authenticated: true,
      authMode: "feishu",
      dataMode: "server",
      memberId: "m7",
      permissions: [],
    },
    members: [{ id: "m7", n: "张云帆" }],
    projects: [],
    tasks: [],
    payroll: { m7: [] },
    features: { identitySwitch: false, demoReset: false },
  };
  const dom = new JSDOM("<!doctype html><script></script>", {
    url: "https://work.quantumgalaxy.top/quantxy-ai-workbench-fused.html?formal=1",
    runScripts: "outside-only",
  });
  dom.window.fetch = undefined;
  dom.window.XMLHttpRequest = class FakeXMLHttpRequest {
    constructor() {
      this.headers = {};
      this.readyState = 0;
      this.responseText = "";
      this.status = 0;
      this.withCredentials = false;
    }

    open(method, url) {
      this.method = method;
      this.url = url;
    }

    setRequestHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    }

    send(body) {
      requests.push({
        body,
        headers: this.headers,
        method: this.method,
        url: this.url,
        withCredentials: this.withCredentials,
      });
      this.status = 200;
      this.responseText = JSON.stringify(bootstrap);
      this.readyState = 4;
      this.onreadystatechange();
    }
  };

  dom.window.eval(source);

  assert.equal(typeof dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER, "object");
  await dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER.ready();
  assert.deepEqual(requests, [{
    body: null,
    headers: {},
    method: "GET",
    url: "/api/workstation/bootstrap",
    withCredentials: true,
  }]);
  assert.equal(
    dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER.getSession().memberId,
    "m7",
  );
  dom.window.close();
});

test("uses embedded formal bootstrap when browser request APIs are unavailable", async () => {
  const source = await readFile(
    path.join(process.cwd(), "public", "workstation-server-adapter.js"),
    "utf8",
  );
  const bootstrap = {
    session: {
      authenticated: true,
      authMode: "feishu",
      dataMode: "server",
      memberId: "m7",
      permissions: ["task.manage"],
    },
    members: [{ id: "m7", n: "董佳瑶", r: "CEO" }],
    projects: [{ id: "p1", n: "真实项目", own: "m7" }],
    tasks: [{ id: "t1", n: "真实任务", own: "m7", createdBy: "m7", reviewer: "m7", st: "进行中" }],
    payroll: { m7: [] },
    features: { identitySwitch: false, demoReset: false },
  };
  const dom = new JSDOM("<!doctype html><script></script>", {
    url: "https://work.quantumgalaxy.top/quantxy-ai-workbench-fused.html?formal=1",
    runScripts: "outside-only",
  });
  dom.window.fetch = undefined;
  dom.window.XMLHttpRequest = undefined;
  dom.window.__QUANTXY_SERVER_BOOTSTRAP__ = bootstrap;

  dom.window.eval(source);

  assert.equal(typeof dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER, "object");
  const ready = await dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER.ready();
  assert.equal(ready.session.memberId, "m7");
  assert.equal(
    dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER.loadBootstrap().projects[0].n,
    "真实项目",
  );
  assert.equal(
    dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER.loadMyTask("m7", "t1").n,
    "真实任务",
  );
  dom.window.close();
});

test("loads the formal employee session and sends task updates without trusting a browser actor", async () => {
  const source = await readFile(
    path.join(process.cwd(), "public", "workstation-server-adapter.js"),
    "utf8",
  );
  const requests = [];
  const inheritedErrorCodes = ["constructor", "toString", "__proto__"];
  const encodedTaskId = "task%2Fpart%3Fquery%23fragment%20%E7%A9%BA%E6%A0%BC%20%E4%B8%AD%E6%96%87";
  const bootstrap = {
    session: { authenticated: true, authMode: "feishu", dataMode: "server", memberId: "m7", permissions: ["task.manage"] },
    members: [{ id: "m7", n: "张云帆" }],
    projects: [{ id: "p1", n: "企业工作站", own: "m7" }],
    tasks: [{ id: "t1", n: "完成接入", own: "m7", createdBy: "m8", reviewer: "m8", st: "进行中", pr: 20 }],
    payroll: { m7: [] },
    features: { identitySwitch: false, demoReset: false },
  };
  const dom = new JSDOM("<!doctype html><script></script>", {
    url: "http://127.0.0.1:3012/quantxy-ai-workbench-fused.html?formal=1",
    runScripts: "outside-only",
  });
  dom.window.fetch = async (url, init = {}) => {
    requests.push({ url: String(url), init });
    if (String(url) === "/api/workstation/bootstrap") {
      return response(true, bootstrap);
    }
    if (String(url) === "/api/workstation/directory-sync") {
      return response(true, { status: "completed", employeeCount: 2 });
    }
    if (String(url) === "/api/workstation/tasks" && init.method === "POST") {
      const input = JSON.parse(init.body);
      const inheritedErrorCode = inheritedErrorCodes.find((code) => (
        input.title === `原型键 ${code}`
      ));
      if (inheritedErrorCode) {
        return response(true, {
          task: {
            ...bootstrap.tasks[0],
            id: `created-${inheritedErrorCode}`,
            n: input.title,
            pr: 0,
          },
          notification: {
            status: "failed",
            errorCode: inheritedErrorCode,
            provider_error: "raw provider response",
          },
        });
      }
      const queueUnavailable = input.title === "队列不可用任务";
      return response(true, {
        task: {
          ...bootstrap.tasks[0],
          id: queueUnavailable ? "t3" : "t2",
          n: input.title,
          pr: 0,
        },
        notification: queueUnavailable
          ? { status: "unavailable", errorCode: "queue_unavailable" }
          : { status: "unavailable", errorCode: "delivery_unconfirmed" },
      });
    }
    if (String(url) === "/api/workstation/tasks/t1/notify") {
      return response(true, {
        notification: {
          status: "unavailable",
          errorCode: "delivery_unconfirmed",
        },
      });
    }
    if (String(url) === "/api/workstation/tasks/t2/notify") {
      return response(true, {
        notification: {
          status: "unavailable",
          errorCode: "queue_unavailable",
        },
      });
    }
    if (String(url) === `/api/workstation/tasks/${encodedTaskId}/notify`) {
      return response(true, { notification: { status: "sent" } });
    }
    const inheritedRetry = /^\/api\/workstation\/tasks\/retry-(constructor|toString|__proto__)\/notify$/.exec(String(url));
    if (inheritedRetry) {
      return response(true, {
        notification: {
          status: "failed",
          errorCode: inheritedRetry[1],
          provider_error: "raw provider response",
        },
      });
    }
    if (String(url) === "/api/workstation/payroll/policy") {
      if (init.method === "PUT") {
        return response(true, { status: "draft", publicId: "policy-1" });
      }
      return response(true, { active: { publicId: "policy-1" }, history: [] });
    }
    if (String(url) === "/api/workstation/payroll/preview") {
      return response(true, {
        employmentMonthsYtd: 8,
        calculation: { grossSalary: "25000.00", netSalary: "20877.00" },
      });
    }
    if (String(url) === "/api/workstation/payroll") {
      return response(true, {
        status: "draft",
        memberId: "m7",
        payroll: { month: "2026-08", grossSalary: 25000, net: 20877 },
      });
    }
    if (String(url) === "/api/workstation/work-profile") {
      return response(true, {
        profile: {
          ...JSON.parse(init.body),
          updatedAt: "2026-08-21T02:00:00.000Z",
        },
      });
    }
    if (String(url) === "/api/workstation/tasks/batch" && init.method === "POST") {
      const input = JSON.parse(init.body);
      return response(true, {
        tasks: input.tasks.map((row, index) => ({
          task: {
            ...bootstrap.tasks[0],
            id: `batch-${index + 1}`,
            n: row.title,
            pr: 0,
          },
          notification: index === 0
            ? { status: "sent" }
            : { status: "unavailable", errorCode: "recipient_unavailable" },
        })),
      });
    }
    return response(true, { task: { ...bootstrap.tasks[0], pr: 60 } });
  };

  dom.window.eval(source);
  await dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER.ready();

  assert.deepEqual(
    JSON.parse(JSON.stringify(dom.window.QUANTXY_WORKSTATION_RUNTIME)),
    { authMode: "feishu", dataMode: "server" },
  );
  assert.equal(
    dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER.getSession().memberId,
    "m7",
  );
  const task = await dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER.updateTaskExecution(
    "t1",
    { progress: 60, blocker: "", nextStep: "联调" },
  );
  assert.equal(task.pr, 60);
  assert.equal(requests[1].url, "/api/workstation/tasks/t1");
  assert.equal(requests[1].init.method, "PATCH");
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    action: "progress",
    progress: 60,
    blocker: "",
    nextStep: "联调",
  });
  await dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER.syncDirectory();
  const created = await dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER.createTask({
    projectId: "p1",
    assigneeMemberId: "m7",
    title: "新任务",
  });
  assert.equal(created.id, "t2");
  assert.deepEqual(JSON.parse(JSON.stringify(created.notification)), {
    status: "failed",
    errorCode: "delivery_unconfirmed",
  });
  const queueUnavailable = await dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER.createTask({
    projectId: "p1",
    assigneeMemberId: "m7",
    title: "队列不可用任务",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(queueUnavailable.notification)), {
    status: "failed",
    errorCode: "queue_unavailable",
  });
  assert.equal(
    typeof dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER.retryTaskNotification,
    "function",
  );
  const deliveryUnconfirmed = await dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER.retryTaskNotification("t1");
  const retryQueueUnavailable = await dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER.retryTaskNotification("t2");
  assert.deepEqual(JSON.parse(JSON.stringify(deliveryUnconfirmed)), {
    status: "failed",
    errorCode: "delivery_unconfirmed",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(retryQueueUnavailable)), {
    status: "failed",
    errorCode: "queue_unavailable",
  });
  const specialTaskId = "task/part?query#fragment 空格 中文";
  await dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER.retryTaskNotification(specialTaskId);
  const encodedRetryRequest = requests.find(({ url }) => (
    url === `/api/workstation/tasks/${encodedTaskId}/notify`
  ));
  assert.equal(encodedRetryRequest.init.method, "POST");
  assert.equal(encodedRetryRequest.init.credentials, "same-origin");
  for (const inheritedErrorCode of inheritedErrorCodes) {
    const unsafeCreate = await dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER.createTask({
      projectId: "p1",
      assigneeMemberId: "m7",
      title: `原型键 ${inheritedErrorCode}`,
    });
    assert.deepEqual(JSON.parse(JSON.stringify(unsafeCreate.notification)), {
      status: "failed",
      errorCode: "send_failed",
    });
    const unsafeRetry = await dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER.retryTaskNotification(
      `retry-${inheritedErrorCode}`,
    );
    assert.deepEqual(JSON.parse(JSON.stringify(unsafeRetry)), {
      status: "failed",
      errorCode: "send_failed",
    });
  }
  const policy = await dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER.loadPayrollPolicy();
  assert.equal(policy.active.publicId, "policy-1");
  const savedPolicy = await dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER.savePayrollPolicy({
    action: "saveDraft",
    effectiveMonth: "2026-08",
  });
  assert.equal(savedPolicy.status, "draft");
  const preview = await dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER.previewPayroll({
    memberId: "m7",
    month: "2026-08",
  });
  assert.equal(preview.calculation.netSalary, "20877.00");
  await dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER.savePayroll({
    memberId: "m7",
    month: "2026-08",
  });
  assert.equal(
    dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER.loadPayroll("m7")[0].net,
    20877,
  );
  const batchCreated = await dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER.createTasks([
    { projectId: "p1", assigneeMemberId: "m7", title: "批量任务一" },
    { projectId: "p1", assigneeMemberId: "m8", title: "批量任务二" },
  ]);
  assert.equal(batchCreated.length, 2);
  assert.equal(batchCreated[0].id, "batch-1");
  assert.deepEqual(JSON.parse(JSON.stringify(batchCreated[0].notification)), {
    status: "sent",
    errorCode: "",
  });
  assert.deepEqual(JSON.parse(JSON.stringify(batchCreated[1].notification)), {
    status: "unavailable",
    errorCode: "recipient_unavailable",
  });
  const batchRequests = requests.filter(({ url }) => url === "/api/workstation/tasks/batch");
  assert.equal(batchRequests.length, 1);
  assert.deepEqual(JSON.parse(batchRequests[0].init.body), {
    tasks: [
      { projectId: "p1", assigneeMemberId: "m7", title: "批量任务一" },
      { projectId: "p1", assigneeMemberId: "m8", title: "批量任务二" },
    ],
  });
  const workProfile = await dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER.saveWorkProfile({
    summary: "擅长需求拆解",
    preferredTaskTypes: ["需求分析"],
    growthGoals: ["AI产品设计"],
    weeklyCapacityHours: 36,
    selfSkills: [{ name: "客户访谈", level: 4 }],
  });
  assert.equal(workProfile.summary, "擅长需求拆解");
  const profileRequest = requests.find(({ url }) => url === "/api/workstation/work-profile");
  assert.equal(profileRequest.init.method, "PUT");
  assert.equal(profileRequest.init.credentials, "same-origin");
  assert.deepEqual(JSON.parse(profileRequest.init.body), {
    summary: "擅长需求拆解",
    preferredTaskTypes: ["需求分析"],
    growthGoals: ["AI产品设计"],
    weeklyCapacityHours: 36,
    selfSkills: [{ name: "客户访谈", level: 4 }],
  });
  assert.equal(requests.find(({ url }) => url === "/api/workstation/directory-sync").init.method, "POST");
  assert.equal(requests.find(({ url }) => url === "/api/workstation/tasks" && url !== "/api/workstation/tasks/t1").init.method, "POST");
  assert.equal(requests.find(({ url }) => url === "/api/workstation/payroll").init.method, "POST");
  assert.equal(requests.find(({ url, init }) => url === "/api/workstation/payroll/policy" && init.method === "GET").init.method, "GET");
  assert.equal(requests.find(({ url, init }) => url === "/api/workstation/payroll/policy" && init.method === "PUT").init.method, "PUT");
  assert.equal(requests.find(({ url }) => url === "/api/workstation/payroll/preview").init.method, "POST");
  for (const taskId of ["t1", "t2"]) {
    const notifyRequest = requests.find(({ url }) => (
      url === `/api/workstation/tasks/${taskId}/notify`
    ));
    assert.equal(notifyRequest.init.method, "POST");
    assert.equal(notifyRequest.init.credentials, "same-origin");
  }
  dom.window.close();
});

function response(ok, body) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  };
}
