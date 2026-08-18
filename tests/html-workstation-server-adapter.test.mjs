import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { JSDOM } from "jsdom";

test("loads the formal employee session and sends task updates without trusting a browser actor", async () => {
  const source = await readFile(
    path.join(process.cwd(), "public", "workstation-server-adapter.js"),
    "utf8",
  );
  const requests = [];
  const bootstrap = {
    session: { authenticated: true, authMode: "feishu", dataMode: "server", memberId: "m7", permissions: ["task.manage"] },
    members: [{ id: "m7", n: "张云帆" }],
    projects: [{ id: "p1", n: "企业工作站", own: "m7" }],
    tasks: [{ id: "t1", n: "完成接入", own: "m7", createdBy: "m8", reviewer: "m8", st: "进行中", pr: 20 }],
    payroll: { m7: [] },
    features: { identitySwitch: false, demoReset: false },
  };
  const dom = new JSDOM("<!doctype html><script></script>", {
    url: "http://127.0.0.1:3012/quantxy-ai-workbench-fused.html",
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
      return response(true, { task: { ...bootstrap.tasks[0], id: "t2", n: "新任务", pr: 0 } });
    }
    if (String(url) === "/api/workstation/payroll") {
      return response(true, { status: "saved" });
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
  await dom.window.QUANTXY_WORKSTATION_SERVER_ADAPTER.savePayroll({
    memberId: "m7",
    month: "2026-08",
  });
  assert.equal(requests.find(({ url }) => url === "/api/workstation/directory-sync").init.method, "POST");
  assert.equal(requests.find(({ url }) => url === "/api/workstation/tasks" && url !== "/api/workstation/tasks/t1").init.method, "POST");
  assert.equal(requests.find(({ url }) => url === "/api/workstation/payroll").init.method, "POST");
  dom.window.close();
});

function response(ok, body) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  };
}
