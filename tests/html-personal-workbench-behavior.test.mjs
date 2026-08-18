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
