import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const outputPath = path.join(root, "quantxy-ai-workbench-fused.html");
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
