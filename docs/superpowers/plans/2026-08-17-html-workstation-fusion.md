# QuantXY HTML Workstation Fusion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `quantxy-ai-workbench-fused.html` from the approved local HTML baseline and add customer delivery, activity execution, and business decision workflows without adding attendance, leave, or payroll.

**Architecture:** Preserve the existing self-contained HTML/CSS/JavaScript application and extend its existing `NAV`, `META`, global state, view router, form helpers, delegated event handler, search, and `localStorage` persistence. Add three bounded state collections (`customers`, `activities`, `decisions`) with seed functions and page renderers, then surface their highest-priority records on the existing dashboard.

**Tech Stack:** Standalone HTML5, existing embedded CSS, ES5-compatible browser JavaScript, Node.js built-in test runner, Codex in-app Browser.

## Global Constraints

- The source file `E:\xwechat_files\wxid_dlkzyugmv5rz22_ab99\msg\file\2026-08\quantxy-ai-workbench_10(1).html` must remain unchanged; its SHA-256 before implementation is `7E2437FDC2D6E9688076D582AA683F12E9FAFB40994E2936DAB34A0A4CD44607`.
- Create `E:\新企业工作站\quantxy-ai-workbench-fused.html`; do not modify the current Next.js source tree.
- Keep the deliverable as one directly runnable HTML file with no new runtime dependency.
- Preserve the existing visual language, navigation shell, AI, project, task, knowledge, Agent, finance, organization, and settings behavior.
- Do not add attendance, leave, payroll, salary slips, or salary approval flows.
- Persist new state through the existing `qxy` local-storage record.
- Use existing icon, card, table, tag, form, toast, modal, and delegated-event patterns.

---

## File Map

- Create: `quantxy-ai-workbench-fused.html` — final standalone fused workstation.
- Create: `tests/html-fusion-contract.test.mjs` — static contract tests for baseline preservation, modules, routes, persistence, banned HR features, and search integration.
- Modify: none of `src/**`, `public/**`, `supabase/**`, or the original HTML source.
- Temporary QA screenshots: save under `C:\Users\Administrator\.codex\visualizations\2026\08\17\01a00d57-d65c-70d2-85a1-11e27afcbd83\html-fusion-qa\`, not in the repository.

---

### Task 1: Create a protected standalone baseline

**Files:**
- Create: `tests/html-fusion-contract.test.mjs`
- Create: `quantxy-ai-workbench-fused.html`

**Interfaces:**
- Consumes: original HTML path and its recorded SHA-256.
- Produces: a byte-for-byte baseline copy that later tasks extend; helper `readFusionHtml()` for all contract tests.

- [ ] **Step 1: Write the failing baseline contract**

```js
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
```

- [ ] **Step 2: Run the baseline contract and verify RED**

Run: `node --test tests/html-fusion-contract.test.mjs`

Expected: the source-hash test passes and the standalone-output test fails with `ENOENT` for `quantxy-ai-workbench-fused.html`.

- [ ] **Step 3: Create the mechanical baseline copy**

Run:

```powershell
Copy-Item -LiteralPath 'E:\xwechat_files\wxid_dlkzyugmv5rz22_ab99\msg\file\2026-08\quantxy-ai-workbench_10(1).html' -Destination 'E:\新企业工作站\quantxy-ai-workbench-fused.html'
```

- [ ] **Step 4: Run the baseline contract and verify GREEN**

Run: `node --test tests/html-fusion-contract.test.mjs`

Expected: 2 tests pass, 0 fail.

- [ ] **Step 5: Commit the protected baseline**

```powershell
git add -- tests/html-fusion-contract.test.mjs quantxy-ai-workbench-fused.html
git commit -m "feat: create protected standalone html fusion baseline"
```

---

### Task 2: Add bounded state, navigation, routing, and persistence

**Files:**
- Modify: `tests/html-fusion-contract.test.mjs`
- Modify: `quantxy-ai-workbench-fused.html` near `save()`, `PROJECTS`, `var S`, `NAV`, `META`, `VIEWS`, and startup hydration.

**Interfaces:**
- Consumes: existing globals `MEMBERS`, `PROJECTS`, `S`, `NAV`, `META`, `VIEWS`, `save()`, and `load()`.
- Produces: `seedCustomers()`, `seedActivities()`, `seedDecisions()`, `S.customers`, `S.activities`, `S.decisions`, `S.curCustomer`, `S.curActivity`, and filters `customerQ`, `customerSt`, `activitySt`, `decisionTab`.

- [ ] **Step 1: Add a failing state-and-route contract**

Append:

```js
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
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/html-fusion-contract.test.mjs`

Expected: state-and-route contract fails because seed functions and fused routes are absent; baseline and banned-HR tests pass.

- [ ] **Step 3: Add exact seed collection shapes**

Add seed functions after `PROJECTS` using these stable properties:

```js
function seedCustomers(){ return [
  {id:'c1',n:'星河科技有限公司',industry:'信息技术',contact:'张宇',phone:'138 **** 9921',source:'官网咨询',stage:'跟进中',own:'m13',last:'2026-08-05',next:'2026-08-18 10:00',progress:60,amount:480000,project:'p3',need:'建设企业知识与客户成功交付体系'},
  {id:'c2',n:'未来智造集团',industry:'制造业',contact:'李明',phone:'139 **** 1123',source:'市场活动',stage:'方案报价',own:'m1',last:'2026-08-04',next:'2026-08-19 14:00',progress:75,amount:700000,project:'p2',need:'数据中台与供应链运营升级'},
  {id:'c3',n:'云启信息技术有限公司',industry:'信息技术',contact:'陈静',phone:'137 **** 5566',source:'客户推荐',stage:'初步沟通',own:'m2',last:'2026-08-03',next:'2026-08-20 09:30',progress:30,amount:0,project:'',need:'评估 AI 智能体落地方案'},
  {id:'c4',n:'锐思数据服务有限公司',industry:'金融服务',contact:'赵敏',phone:'135 **** 7766',source:'市场活动',stage:'跟进中',own:'m13',last:'2026-08-02',next:'2026-08-21 11:00',progress:50,amount:0,project:'p5',need:'指标归因与模型优化'},
  {id:'c5',n:'博远软件股份有限公司',industry:'信息技术',contact:'周强',phone:'136 **** 8899',source:'官网咨询',stage:'已成交',own:'m6',last:'2026-07-30',next:'',progress:100,amount:1180000,project:'p1',need:'智能体平台升级交付'},
  {id:'c6',n:'创想未来科技有限公司',industry:'零售消费',contact:'孙凯',phone:'138 **** 3344',source:'客户推荐',stage:'谈判中',own:'m1',last:'2026-07-29',next:'2026-08-22 15:00',progress:80,amount:0,project:'p4',need:'品牌升级与增长活动'}
]; }

function seedActivities(){ return [
  {id:'a1',n:'企业官网升级项目',own:'m1',project:'p1',s:'2026-07-01',e:'2026-09-30',goal:'完成新版官网上线并形成可复用交付案例',progress:68,roi:3.2,stage:'执行',st:'进行中'},
  {id:'a2',n:'新产品发布活动',own:'m13',project:'p4',s:'2026-07-15',e:'2026-10-20',goal:'建立可持续品牌增长引擎',progress:42,roi:3.62,stage:'执行',st:'进行中'},
  {id:'a3',n:'年度市场推广计划',own:'m13',project:'p4',s:'2026-08-01',e:'2026-12-15',goal:'提升品牌触达和有效线索',progress:15,roi:2.1,stage:'策划',st:'规划中'},
  {id:'a4',n:'客户成功知识库建设',own:'m1',project:'p3',s:'2026-04-08',e:'2026-07-28',goal:'沉淀客户交付与复用知识',progress:100,roi:4.1,stage:'复盘',st:'已完成'}
]; }

function seedDecisions(){ return [
  {id:'d1',type:'费用报销',n:'市场推广活动费用报销（5月）',by:'m13',detail:'金额 ¥ 28,650.00',at:'10:20',st:'待我决策',ref:'a2'},
  {id:'d2',type:'采购申请',n:'云服务资源扩容采购申请',by:'m2',detail:'金额 ¥ 120,000.00',at:'09:55',st:'待我决策',ref:'p2'},
  {id:'d3',type:'项目变更',n:'智能客服升级项目范围变更申请',by:'m1',detail:'影响：周期延长 5 天',at:'09:30',st:'待我决策',ref:'p1'},
  {id:'d4',type:'合同审批',n:'与上海某科技公司合作协议',by:'m3',detail:'金额 ¥ 500,000.00',at:'昨天 17:40',st:'我发起的',ref:'c1'},
  {id:'d5',type:'预算申请',n:'Q3 数字化营销预算变更申请',by:'m11',detail:'金额 ¥ 300,000.00',at:'昨天 16:20',st:'已完成',result:'已通过',ref:'a3'},
  {id:'d6',type:'成果验收',n:'量子平台一期交付验收',by:'m10',detail:'测试报告与交付清单已齐备',at:'昨天 15:10',st:'待我决策',ref:'p1'}
]; }
```

- [ ] **Step 4: Wire state and persistence**

Extend `save()` with `customers:S.customers,activities:S.activities,decisions:S.decisions`; add the collections, filters, and current selections to `S`; hydrate from saved values at startup with seed fallbacks.

- [ ] **Step 5: Register navigation, metadata, and views**

Add keys `customers`, `activities`, and `decisions` to `NAV`, `META`, and `VIEWS`. Add `new-customer` and `new-activity` form routes to `META` and `VIEWS`.

- [ ] **Step 6: Run and verify GREEN**

Run: `node --test tests/html-fusion-contract.test.mjs`

Expected: all state, route, persistence, baseline, and banned-HR tests pass.

- [ ] **Step 7: Commit state and routing**

```powershell
git add -- tests/html-fusion-contract.test.mjs quantxy-ai-workbench-fused.html
git commit -m "feat: add fused workstation state and routes"
```

---

### Task 3: Implement customer delivery workflow

**Files:**
- Modify: `tests/html-fusion-contract.test.mjs`
- Modify: `quantxy-ai-workbench-fused.html` near form configuration, page views, and click actions.

**Interfaces:**
- Consumes: `S.customers`, `MEMBERS`, `MB`, `PROJECTS`, `PB`, `formShell()`, `save()`, `toast()`, and existing style utilities.
- Produces: `viewCustomers()`, `viewNewCustomer()`, `createCustomer()`, `S.form.customer`, customer filtering, detail selection, and project navigation.

- [ ] **Step 1: Add a failing customer contract**

```js
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
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/html-fusion-contract.test.mjs`

Expected: customer contract fails because the page and form functions do not exist.

- [ ] **Step 3: Extend the shared form model**

Add:

```js
customer:{n:'',industry:'信息技术',contact:'',phone:'',source:'官网咨询',stage:'初步沟通',own:'m1',next:'',amount:0,project:'',need:''}
```

Set `customer.next=fmt(addD(today(),3))+' 10:00'` in `blankForm()`.

- [ ] **Step 4: Implement the customer page**

Render four summary cards, stage and text filters, the customer table, a side detail card for `S.curCustomer`, follow-up reminders, and the `new-customer` CTA. Customer rows use `data-act="open-customer"`; linked projects use existing `data-act="open-proj"`.

- [ ] **Step 5: Implement creation and interaction actions**

`createCustomer()` must validate name and contact, assign `c` plus a timestamp id, push the normalized record to `S.customers`, save, return to `customers`, select the created customer, and toast success. Add `f-customer` and `open-customer` click branches.

- [ ] **Step 6: Run and verify GREEN**

Run: `node --test tests/html-fusion-contract.test.mjs`

Expected: customer contract and all previous tests pass.

- [ ] **Step 7: Commit the customer workflow**

```powershell
git add -- tests/html-fusion-contract.test.mjs quantxy-ai-workbench-fused.html
git commit -m "feat: add customer delivery workflow"
```

---

### Task 4: Implement activity execution workflow

**Files:**
- Modify: `tests/html-fusion-contract.test.mjs`
- Modify: `quantxy-ai-workbench-fused.html` near form configuration, page views, and click actions.

**Interfaces:**
- Consumes: `S.activities`, `S.tasks`, `MEMBERS`, `PROJECTS`, `formShell()`, `save()`, and existing progress and status helpers.
- Produces: `viewActivities()`, `viewNewActivity()`, `createActivity()`, `activityPhases()`, `S.form.activity`, status filtering, activity selection, and task/project cross-links.

- [ ] **Step 1: Add a failing activity contract**

```js
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
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/html-fusion-contract.test.mjs`

Expected: activity contract fails because activity functions are absent.

- [ ] **Step 3: Extend the shared form model**

Add:

```js
activity:{n:'',own:'m13',project:'p4',s:'',e:'',goal:'',progress:0,roi:0,stage:'策划',st:'规划中'}
```

Set activity dates in `blankForm()` to today and 45 days later.

- [ ] **Step 4: Implement activity list and detail**

Render count, active count, average completion, and average ROI cards; a status filter; selectable activity cards; stage rail from `activityPhases()`; project link; related tasks from `S.tasks.filter(t => t.p===activity.project)`; and key milestone dates.

- [ ] **Step 5: Implement creation and interaction actions**

`createActivity()` validates name, dates, and goal, normalizes numeric progress and ROI, saves, selects the new record, and returns to `activities`. Add `f-activity` and `open-activity` click branches.

- [ ] **Step 6: Run and verify GREEN**

Run: `node --test tests/html-fusion-contract.test.mjs`

Expected: activity contract and all previous tests pass.

- [ ] **Step 7: Commit the activity workflow**

```powershell
git add -- tests/html-fusion-contract.test.mjs quantxy-ai-workbench-fused.html
git commit -m "feat: add activity execution workflow"
```

---

### Task 5: Implement business decisions, dashboard summaries, and search

**Files:**
- Modify: `tests/html-fusion-contract.test.mjs`
- Modify: `quantxy-ai-workbench-fused.html` near `viewDash()`, `viewSearch()`, decision page view, and click actions.

**Interfaces:**
- Consumes: `S.decisions`, `S.customers`, `S.activities`, `PROJECTS`, `S.tasks`, `save()`, `toast()`, and existing tabs/cards.
- Produces: `viewDecisions()`, `decisionRef()`, decision tabs, decision state changes, dashboard compact summaries, and global search results for customers and activities.

- [ ] **Step 1: Add failing decision and integration contracts**

```js
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
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/html-fusion-contract.test.mjs`

Expected: decision and integration contracts fail while previous module tests pass.

- [ ] **Step 3: Implement the business decision page**

Render tabs using `S.f.decisionTab`, decision cards with type, title, requester, detail, time, linked-object label from `decisionRef()`, and approve/reject actions only for `待我决策` records.

- [ ] **Step 4: Implement durable decision actions**

`decision-pass` and `decision-reject` set the selected record to `已完成`, set `result` to `已通过` or `已驳回`, call `save()`, re-render, and show a toast. Do not splice records out of state.

- [ ] **Step 5: Integrate compact dashboard panels**

Replace the existing static “近期活动” and transient approval areas with three compact cards sourced from `S.customers`, `S.activities`, and pending `S.decisions`. Each card has a working link to its full page.

- [ ] **Step 6: Extend global search**

Update the placeholder and `viewSearch()` to add `S.customers` and `S.activities` results. Customer hits open the customer page and select the customer; activity hits open the activity page and select the activity.

- [ ] **Step 7: Run and verify GREEN**

Run: `node --test tests/html-fusion-contract.test.mjs`

Expected: all contracts pass.

- [ ] **Step 8: Commit decision and cross-module integration**

```powershell
git add -- tests/html-fusion-contract.test.mjs quantxy-ai-workbench-fused.html
git commit -m "feat: connect customer activity and decision workflows"
```

---

### Task 6: Browser regression, responsive QA, and final verification

**Files:**
- Modify only if failures are found: `quantxy-ai-workbench-fused.html`
- Test: `tests/html-fusion-contract.test.mjs`

**Interfaces:**
- Consumes: completed standalone HTML and all static contracts.
- Produces: fresh automated test evidence, desktop and mobile screenshots, console-health evidence, and interaction evidence.

- [ ] **Step 1: Run full static verification**

Run:

```powershell
node --test tests/html-fusion-contract.test.mjs
git diff --check
Get-FileHash -Algorithm SHA256 -LiteralPath 'E:\xwechat_files\wxid_dlkzyugmv5rz22_ab99\msg\file\2026-08\quantxy-ai-workbench_10(1).html'
```

Expected: all tests pass; diff check is empty; source hash remains `7E2437FDC2D6E9688076D582AA683F12E9FAFB40994E2936DAB34A0A4CD44607`.

- [ ] **Step 2: Start a scoped local static server**

Run:

```powershell
python -m http.server 8765 --bind 127.0.0.1 --directory 'E:\新企业工作站'
```

Open `http://127.0.0.1:8765/quantxy-ai-workbench-fused.html` in the selected in-app Browser.

- [ ] **Step 3: Verify the desktop target flow**

Use a 1280×800 viewport and confirm:

1. app loads → decision dashboard renders;
2. customer navigation → status filter changes the visible list → a customer detail opens;
3. activity navigation → another activity selection changes the detail and stage rail;
4. decision navigation → approve one pending item → result becomes `已通过`;
5. reload → the decision result remains completed;
6. AI scheduling, tasks, knowledge, Agent, finance, and organization pages still render.

- [ ] **Step 4: Verify browser health**

Check page URL/title, meaningful DOM, absence of framework overlays, console warning/error log, and capture screenshots for dashboard, customers, activities, and decisions.

- [ ] **Step 5: Verify mobile reflow**

Use a 390×844 viewport. Verify that navigation remains usable, cards reflow, tables scroll horizontally instead of clipping, and no fixed element obscures primary controls. Capture dashboard and one fused-module screenshot.

- [ ] **Step 6: Run the final full check after any QA fixes**

Run:

```powershell
node --test tests/html-fusion-contract.test.mjs
git diff --check
```

Expected: all tests pass and diff check is empty.

- [ ] **Step 7: Commit final QA fixes**

```powershell
git add -- tests/html-fusion-contract.test.mjs quantxy-ai-workbench-fused.html
git commit -m "test: verify fused standalone workstation"
```

## Plan Self-Review

- Spec coverage: all approved sections map to Tasks 2–5; original preservation and standalone delivery map to Task 1; desktop/mobile verification maps to Task 6.
- Scope: the work is one bounded standalone HTML deliverable; the Next.js application remains a read-only reference.
- Type consistency: customer ids use `c*`, activity ids use `a*`, decision ids use `d*`; member, project, task, and reference ids reuse existing identifiers.
- Error states: required-field validation, empty filters, stale relationships, local persistence fallback, and console verification are explicitly covered.
- Placeholder scan: the plan contains no deferred implementation markers or unspecified tests.
