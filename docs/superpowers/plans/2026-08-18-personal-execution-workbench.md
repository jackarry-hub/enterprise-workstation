# QuantXY Personal Execution Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the fused QuantXY HTML into a fully clickable, identity-scoped personal execution workbench with task claim-to-acceptance workflow, personal salary and bonus details, safe demo-data cleanup, and stable cutover interfaces for future Feishu-backed use.

**Architecture:** Keep the existing standalone HTML/CSS/ES5 JavaScript application and its delegated `data-act` event model. Put demo persistence and personal-data reads behind a `WORKSTATION_GATEWAY`, extend the existing task model and router, replace the corporate finance page with identity-scoped payroll, and keep the root and `public` HTML files byte-identical. The production server adapter is a documented contract only in this phase; the active implementation remains browser-local and starts without Supabase.

**Tech Stack:** Standalone HTML5, embedded CSS, ES5-compatible browser JavaScript, `localStorage`, Node.js built-in test runner, JSDOM, Next.js 15 production build, Docker Compose, Codex browser QA.

**Spec:** `docs/superpowers/specs/2026-08-18-personal-execution-workbench-design.md`

## Global Constraints

- Keep the deliverable as the existing single-file workstation; do not rewrite it as a new React page.
- `quantxy-ai-workbench-fused.html` and `public/quantxy-ai-workbench-fused.html` must remain byte-identical.
- The active phase uses `authMode=demo` and `dataMode=demo`; the page must start without Supabase or another database.
- The current identity is `S.me`; personal workbench, projects, tasks, reminders, salary, and bonuses must follow that identity.
- Do not add attendance, leave, scheduling, company payroll administration, or company-wide salary views.
- Do not store API keys, login passwords, Feishu secrets, OAuth codes, access tokens, or server cookies in business-data storage.
- Real mode must disable arbitrary identity switching and must never fall back silently to demo data.
- Preserve AI scheduling, projects, customers, activities, decisions, knowledge, Agent, organization, settings, and secure server-side AI behavior.
- Keep `audit-2026-08-17/` untracked and untouched.
- Every task uses test-first development and ends with a focused commit.
- Server deployment may update only `/srv/ai-enterprise-brain/app`, Compose project `ai-brain-demo`, its own image/container/network, and host port `3010`.

---

## File Map

- Modify: `quantxy-ai-workbench-fused.html` — canonical standalone source for data gateway, task workflow, personal workbench, payroll, cleanup, and interaction handlers.
- Modify: `public/quantxy-ai-workbench-fused.html` — exact deployed copy of the canonical HTML.
- Modify: `tests/html-fusion-contract.test.mjs` — static contracts for routes, labels, adapter interface, forbidden corporate finance content, and exact file sync.
- Create: `tests/html-personal-workbench-behavior.test.mjs` — JSDOM behavior coverage for identity isolation, task transitions, payroll, click routing, persistence, and cleanup.
- Modify: `package.json` — include the new behavior test in `test:html`.
- Read only: `src/features/auth/**`, `src/middleware.ts`, and `docs/superpowers/specs/2026-08-11-feishu-real-oauth-design.md` — existing Feishu/session boundary; no implementation changes in this phase.

---

### Task 1: Establish the demo data gateway and migration boundary

**Files:**
- Modify: `tests/html-fusion-contract.test.mjs`
- Create: `tests/html-personal-workbench-behavior.test.mjs`
- Modify: `package.json`
- Modify: `quantxy-ai-workbench-fused.html` near `save()`, `load()`, task seeds, `var S`, startup hydration, and the final `Q` export.
- Modify: `public/quantxy-ai-workbench-fused.html` by exact synchronization.

**Interfaces:**
- Consumes: existing `MEMBERS`, `MB`, `PROJECTS`, `PB`, `seedTasks()`, `S`, `save()`, `load()`, and browser storage.
- Produces: `WORKSTATION_RUNTIME`, `QXY_DEMO_DATA_KEY`, `QXY_DEMO_CLEARED_KEY`, `normalizeTask(task)`, `seedPayroll()`, `createDemoGateway()`, `WORKSTATION_GATEWAY`, and exported `Q.gateway`.

- [ ] **Step 1: Add the failing static gateway contract**

Append this test to `tests/html-fusion-contract.test.mjs`:

```js
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
```

- [ ] **Step 2: Add the failing JSDOM harness and migration tests**

Create `tests/html-personal-workbench-behavior.test.mjs` with these helpers and first tests:

```js
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
  await waitFor(() => dom.window.Q?.gateway);
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
```

- [ ] **Step 3: Register the new behavior test and verify RED**

Change `package.json` to:

```json
"test:html": "node --test tests/html-fusion-contract.test.mjs tests/html-demo-login-behavior.test.mjs tests/html-personal-workbench-behavior.test.mjs"
```

Run: `npm run test:html`

Expected: existing HTML tests pass; the gateway and migration tests fail because the new interface is absent.

- [ ] **Step 4: Add runtime constants, storage migration, and task normalization**

Replace the old `save()`/`load()` pair with these exact boundaries, keeping the existing serialized collections and adding `payroll`:

```js
var WORKSTATION_RUNTIME={authMode:'demo',dataMode:'demo'};
var QXY_DEMO_DATA_KEY='qxy.workstation.demo.v2';
var QXY_DEMO_CLEARED_KEY='qxy.workstation.demo.cleared';
var QXY_LEGACY_DATA_KEY='qxy';

function demoSnapshot(){
  return {tasks:S.tasks,cfg:S.cfg,members:MEMBERS,projects:PROJECTS,kb:KB,
    agents:S.agents,runs:S.runs.slice(0,40),depts:DEPTS,reqs:S.reqs,
    customers:S.customers,activities:S.activities,decisions:S.decisions,
    payroll:S.payroll};
}
function save(){
  try{ localStorage.setItem(QXY_DEMO_DATA_KEY,JSON.stringify(demoSnapshot())); }catch(e){}
}
function load(){
  try{
    var current=localStorage.getItem(QXY_DEMO_DATA_KEY);
    if(current) return JSON.parse(current);
    var legacy=localStorage.getItem(QXY_LEGACY_DATA_KEY);
    return legacy?JSON.parse(legacy):null;
  }catch(e){ return null; }
}
function defaultReviewer(task){
  var project=PB[task.p], candidate=project&&project.own;
  return candidate&&candidate!==task.own?candidate:'m14';
}
function normalizeTask(task){
  var item=task||{}, reviewer=item.reviewer||defaultReviewer(item);
  item.st=item.st==='待审核'?'待验收':(item.st||'待处理');
  item.createdBy=item.createdBy||reviewer;
  item.reviewer=reviewer;
  item.description=item.description||item.n||'';
  item.ac=item.ac||'成果满足任务说明并由验收人确认';
  item.pr=Math.max(0,Math.min(100,Number(item.pr||(item.st==='已完成'?100:0))));
  item.blocker=item.blocker||'';
  item.nextStep=item.nextStep||'';
  item.resultText=item.resultText||'';
  item.resultLink=item.resultLink||'';
  item.resultFiles=Array.isArray(item.resultFiles)?item.resultFiles:[];
  item.acceptedAt=item.acceptedAt||'';
  item.submittedAt=item.submittedAt||'';
  item.reviewedAt=item.reviewedAt||'';
  item.reviewNote=item.reviewNote||'';
  item.timeline=Array.isArray(item.timeline)?item.timeline:[];
  return item;
}
```

- [ ] **Step 5: Add deterministic payroll seeds and read-only gateway methods**

Use this data shape and expose it through `createDemoGateway()`:

```js
var PAYROLL_BASE={m1:22000,m2:24000,m3:30000,m4:23000,m5:21000,m6:22000,m7:19000,
  m8:28000,m9:18000,m10:16500,m11:19000,m12:20000,m13:18000,m14:45000};
function payrollMonth(offset){
  var d=new Date(); d.setDate(1); d.setMonth(d.getMonth()+offset);
  return d.getFullYear()+'-'+pad(d.getMonth()+1);
}
function seedPayroll(){
  var out={};
  MEMBERS.forEach(function(member,index){
    var base=PAYROLL_BASE[member.id]||18000;
    out[member.id]=[-2,-1,0].map(function(offset,monthIndex){
      var performance=1800+((index+monthIndex)%5)*600;
      var projectBonus=((index+monthIndex)%4)*900;
      var otherBonus=(index+monthIndex)%3===0?500:0;
      var social=Math.round(base*0.105);
      var tax=Math.max(0,Math.round((base+performance+projectBonus+otherBonus-social-5000)*0.08));
      var otherDeduction=0;
      var gross=base+performance+projectBonus+otherBonus;
      var deductions=social+tax+otherDeduction;
      return {month:payrollMonth(offset),base:base,performance:performance,
        projectBonus:projectBonus,otherBonus:otherBonus,social:social,tax:tax,
        otherDeduction:otherDeduction,gross:gross,deductions:deductions,
        net:gross-deductions,status:offset<0?'已发放':'待发放',payDate:offset<0?payrollMonth(offset)+'-10':''};
    }).reverse();
  });
  return out;
}
function copyPayrollRow(row){
  var copy={}; Object.keys(row).forEach(function(key){ copy[key]=row[key]; }); return copy;
}
function personalTasks(memberId,scope,filter){
  var rows=S.tasks.filter(function(task){ return scope==='created'?task.createdBy===memberId:task.own===memberId; });
  if(filter&&filter!=='all') rows=rows.filter(function(task){ return task.st===filter; });
  return rows;
}
function personalDashboard(memberId){
  var tasks=personalTasks(memberId,'todo','all'), payroll=(S.payroll[memberId]||[])[0]||null;
  return {tasks:tasks,must:tasks.filter(function(task){ return task.st!=='已完成'; }).slice(0,6),
    projects:PROJECTS.filter(function(project){ return project.own===memberId; }).slice(0,4),payroll:payroll,reminders:[]};
}
function createDemoGateway(){
  return {
    getSession:function(){ return {authMode:'demo',dataMode:'demo',memberId:S.me,permissions:['task.execute','payroll.read.self']}; },
    loadBootstrap:function(){ return {mode:'demo',session:this.getSession(),members:MEMBERS,projects:PROJECTS,tasks:S.tasks,payroll:S.payroll,features:{identitySwitch:true,demoReset:true}}; },
    loadMyDashboard:function(memberId){ return personalDashboard(memberId); },
    listMyTasks:function(memberId,scope,filter){ return personalTasks(memberId,scope,filter); },
    loadMyTask:function(memberId,taskId){ return S.tasks.filter(function(task){ return task.id===taskId&&(task.own===memberId||task.createdBy===memberId||task.reviewer===memberId); })[0]||null; },
    listMyProjects:function(memberId){ return PROJECTS.filter(function(project){ return project.own===memberId||S.tasks.some(function(task){ return task.p===project.id&&task.own===memberId; }); }); },
    loadPayroll:function(memberId){ return (S.payroll[memberId]||[]).map(copyPayrollRow); }
  };
}
var WORKSTATION_GATEWAY=createDemoGateway();
```

After the static member, project, knowledge, and department arrays are declared, capture `INITIAL_MEMBERS`, `INITIAL_PROJECTS`, `INITIAL_KB`, and `INITIAL_DEPTS` as cloned seed snapshots and add a `rebuildLookups()` helper that reconstructs `MB` and `PB`. Add `payroll:{}` to `S`. During startup, hydrate members and projects first, call `rebuildLookups()`, then hydrate `S.tasks` through `.map(normalizeTask)` and hydrate payroll with `saved.payroll||seedPayroll()`. Save migrated legacy state to the new key and export `gateway:WORKSTATION_GATEWAY` from `Q`.

- [ ] **Step 6: Synchronize the deployed HTML and verify GREEN**

Run:

```powershell
Copy-Item -LiteralPath 'E:\新企业工作站\quantxy-ai-workbench-fused.html' -Destination 'E:\新企业工作站\public\quantxy-ai-workbench-fused.html' -Force
npm run test:html
```

Expected: all HTML tests pass and the root/public equality contract remains green.

- [ ] **Step 7: Commit the gateway boundary**

```powershell
git add -- package.json tests/html-fusion-contract.test.mjs tests/html-personal-workbench-behavior.test.mjs quantxy-ai-workbench-fused.html public/quantxy-ai-workbench-fused.html
git commit -m "feat: add personal workbench demo gateway"
```

---

### Task 2: Implement task execution transitions and permissions

**Files:**
- Modify: `tests/html-personal-workbench-behavior.test.mjs`
- Modify: `quantxy-ai-workbench-fused.html` near task helpers, `issue()`, `createTask()`, and `createDemoGateway()`.
- Modify: `public/quantxy-ai-workbench-fused.html` by exact synchronization.

**Interfaces:**
- Consumes: `normalizeTask(task)`, `WORKSTATION_GATEWAY`, `S.tasks`, `S.me`, `MB`, `PB`, `save()`, `fmt()`, and `today()`.
- Produces: `claimTask(taskId,actorId)`, `updateTaskExecution(taskId,actorId,input)`, `submitTaskResult(taskId,actorId,input)`, `reviewTaskResult(taskId,actorId,input)`, `reopenTask(taskId,actorId,note)`, and timeline records.

- [ ] **Step 1: Write failing transition and permission tests**

Append:

```js
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
  dom.window.close();
});

test("validates task result and review input", async () => {
  const dom = await openWorkbench();
  const gateway = dom.window.Q.gateway;
  const task = dom.window.Q.S.tasks.find((item) => item.st === "待处理" && item.own !== item.reviewer);
  gateway.claimTask(task.id, task.own);
  assert.throws(() => gateway.updateTaskExecution(task.id, task.own, { progress: 101, blocker: "", nextStep: "" }), /invalid_progress/);
  assert.throws(() => gateway.submitTaskResult(task.id, task.own, { resultText: "", resultLink: "", resultFiles: [] }), /result_required/);
  gateway.submitTaskResult(task.id, task.own, { resultText: "成果", resultLink: "https://example.test", resultFiles: [] });
  assert.throws(() => gateway.reviewTaskResult(task.id, task.reviewer, { decision: "reject", note: "" }), /review_note_required/);
  dom.window.close();
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `node --test --test-name-pattern="runs claim|validates task" tests/html-personal-workbench-behavior.test.mjs`

Expected: FAIL because the mutation methods do not exist.

- [ ] **Step 3: Implement actor checks, validation, and timeline writing**

Add these helpers and attach them to `createDemoGateway()`:

```js
function stamp(){ var d=new Date(); return fmt(d)+' '+pad(d.getHours())+':'+pad(d.getMinutes()); }
function findTask(taskId){ var task=S.tasks.filter(function(item){ return item.id===taskId; })[0]; if(!task) throw new Error('task_not_found'); return task; }
function requireActor(actual,expected){ if(actual!==expected) throw new Error('forbidden'); }
function addTimeline(task,actorId,action,note){ task.timeline.push({actor:actorId,action:action,note:note||'',at:stamp()}); }
function claimTask(taskId,actorId){
  var task=findTask(taskId); requireActor(actorId,task.own);
  if(task.st!=='待处理') throw new Error('invalid_status');
  task.st='进行中'; task.acceptedAt=stamp(); task.pr=Math.max(1,task.pr||0);
  addTimeline(task,actorId,'领取任务',''); save(); return task;
}
function updateTaskExecution(taskId,actorId,input){
  var task=findTask(taskId), progress=Number(input.progress); requireActor(actorId,task.own);
  if(task.st!=='进行中') throw new Error('invalid_status');
  if(!isFinite(progress)||progress<0||progress>100) throw new Error('invalid_progress');
  task.pr=progress; task.blocker=String(input.blocker||'').trim(); task.nextStep=String(input.nextStep||'').trim();
  addTimeline(task,actorId,'更新执行','进度 '+progress+'%'+(task.blocker?'；阻塞：'+task.blocker:'')); save(); return task;
}
function submitTaskResult(taskId,actorId,input){
  var task=findTask(taskId), text=String(input.resultText||'').trim(), link=String(input.resultLink||'').trim();
  var files=(input.resultFiles||[]).filter(function(name){ return String(name).trim(); }); requireActor(actorId,task.own);
  if(task.st!=='进行中') throw new Error('invalid_status');
  if(!text||(!link&&!files.length)) throw new Error('result_required');
  task.resultText=text; task.resultLink=link; task.resultFiles=files; task.submittedAt=stamp(); task.st='待验收';
  addTimeline(task,actorId,'提交验收',text); save(); return task;
}
function reviewTaskResult(taskId,actorId,input){
  var task=findTask(taskId), decision=input.decision, note=String(input.note||'').trim();
  if(actorId!==task.reviewer&&actorId!==task.createdBy) throw new Error('forbidden');
  if(task.st!=='待验收') throw new Error('invalid_status');
  if(decision!=='pass'&&decision!=='reject') throw new Error('invalid_decision');
  if(decision==='reject'&&!note) throw new Error('review_note_required');
  task.reviewNote=note; task.reviewedAt=stamp(); task.st=decision==='pass'?'已完成':'进行中';
  if(decision==='pass') task.pr=100;
  addTimeline(task,actorId,decision==='pass'?'验收通过':'驳回修改',note); save(); return task;
}
function reopenTask(taskId,actorId,note){
  var task=findTask(taskId);
  if(actorId!==task.reviewer&&actorId!==task.createdBy) throw new Error('forbidden');
  if(task.st!=='已完成') throw new Error('invalid_status');
  task.st='进行中'; task.pr=Math.min(95,task.pr); addTimeline(task,actorId,'重新打开',String(note||'').trim()); save(); return task;
}
function saveTaskRecord(task,revision){
  var current=findTask(task.id), index=S.tasks.indexOf(current), normalized=normalizeTask(task);
  void revision; S.tasks[index]=normalized; save(); return normalized;
}
```

Expose these functions on the gateway as `saveTask:saveTaskRecord`, `claimTask:claimTask`, `updateTaskExecution:updateTaskExecution`, `submitTaskResult:submitTaskResult`, `reviewTaskResult:reviewTaskResult`, and `reopenTask:reopenTask`.

- [ ] **Step 4: Make newly created and AI-issued tasks conform immediately**

In `issue()` create each task through `normalizeTask()` and set `createdBy:S.me`, `reviewer:S.me`, `description:t.n`, and `timeline:[{actor:S.me,action:'下发任务',note:'AI 调度',at:stamp()}]`. In `createTask()` set `createdBy:S.me`, choose `reviewer` as `defaultReviewer(task)`, and add `action:'创建任务'` to the initial timeline.

- [ ] **Step 5: Run the focused and full HTML tests**

Run:

```powershell
Copy-Item -LiteralPath 'E:\新企业工作站\quantxy-ai-workbench-fused.html' -Destination 'E:\新企业工作站\public\quantxy-ai-workbench-fused.html' -Force
node --test tests/html-personal-workbench-behavior.test.mjs
npm run test:html
```

Expected: transition tests pass; existing fusion and login contracts remain green.

- [ ] **Step 6: Commit the execution state machine**

```powershell
git add -- tests/html-personal-workbench-behavior.test.mjs quantxy-ai-workbench-fused.html public/quantxy-ai-workbench-fused.html
git commit -m "feat: add personal task execution workflow"
```

---

### Task 3: Rebuild the personal workbench around identity-scoped clickable data

**Files:**
- Modify: `tests/html-fusion-contract.test.mjs`
- Modify: `tests/html-personal-workbench-behavior.test.mjs`
- Modify: `quantxy-ai-workbench-fused.html` near personal-data helpers, `viewMe()`, `S.f`, and the delegated click handler.
- Modify: `public/quantxy-ai-workbench-fused.html` by exact synchronization.

**Interfaces:**
- Consumes: `WORKSTATION_GATEWAY.loadMyDashboard()`, `listMyTasks()`, `listMyProjects()`, `loadPayroll()`, `S.me`, `S.f`, `S.sel`, `PB`, `stTag()`, and `priTag()`.
- Produces: `personalTasks(memberId,scope,filter)`, `personalDashboard(memberId)`, `taskUrgency(task)`, `viewMe()`, actions `my-task-filter`, `open-execution`, `open-my-project`, and `open-income`.

- [ ] **Step 1: Add failing personal-workbench contracts**

Append static assertions for labels and actions:

```js
test("renders the complete clickable personal workbench", async () => {
  const html = await readFusionHtml();
  for (const label of ["今日必须处理", "我的待办", "我发起的", "我的项目", "个人收入", "执行提醒"]) {
    assert.match(html, new RegExp(label));
  }
  for (const action of ["my-task-filter", "open-execution", "open-my-project", "open-income"]) {
    assert.match(html, new RegExp(`data-act="${action}"`));
  }
});
```

Append behavior coverage:

```js
test("changes all personal workbench collections with the selected identity", async () => {
  const dom = await openWorkbench();
  dom.window.Q.S.me = "m1";
  dom.window.Q.render();
  const firstTasks = dom.window.Q.gateway.listMyTasks("m1", "todo", "all");
  assert.ok(firstTasks.every((task) => task.own === "m1"));
  dom.window.Q.S.me = "m2";
  dom.window.Q.render();
  const secondTasks = dom.window.Q.gateway.listMyTasks("m2", "todo", "all");
  assert.ok(secondTasks.every((task) => task.own === "m2"));
  assert.notDeepEqual(firstTasks.map((task) => task.id), secondTasks.map((task) => task.id));
  dom.window.close();
});

test("routes clickable workbench records to their exact destination", async () => {
  const dom = await openWorkbench();
  dom.window.Q.S.me = "m1";
  dom.window.Q.S.page = "me";
  dom.window.Q.render();
  const taskButton = dom.window.document.querySelector('[data-act="open-execution"]');
  assert.ok(taskButton);
  const taskId = taskButton.getAttribute("data-id");
  taskButton.click();
  assert.equal(dom.window.Q.S.page, "execution");
  assert.equal(dom.window.Q.S.sel.task, taskId);
  dom.window.close();
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test --test-name-pattern="personal workbench|clickable workbench" tests/html-fusion-contract.test.mjs tests/html-personal-workbench-behavior.test.mjs`

Expected: FAIL because the new sections and actions are absent.

- [ ] **Step 3: Add personal scopes, dynamic overdue state, and urgency ordering**

Replace Task 1's basic personal readers with these urgency-aware signatures:

```js
function isOverdue(task){ return task.st!=='已完成'&&diffD(today(),new Date(task.e))<0; }
function taskUrgency(task){
  if(isOverdue(task)) return 0;
  if(task.blocker) return 1;
  if(task.st==='待验收') return 2;
  if(task.pri==='P0') return 3;
  return 4+Math.max(0,diffD(today(),new Date(task.e)));
}
function personalTasks(memberId,scope,filter){
  var rows=S.tasks.filter(function(task){ return scope==='created'?task.createdBy===memberId:task.own===memberId; });
  if(filter==='已逾期') rows=rows.filter(isOverdue);
  else if(filter&&filter!=='all') rows=rows.filter(function(task){ return task.st===filter; });
  return rows.sort(function(a,b){ return taskUrgency(a)-taskUrgency(b); });
}
function personalDashboard(memberId){
  var tasks=personalTasks(memberId,'todo','all'), payroll=(S.payroll[memberId]||[])[0]||null;
  return {tasks:tasks,must:tasks.filter(function(task){ return task.st!=='已完成'; }).slice(0,6),
    projects:WORKSTATION_GATEWAY.listMyProjects(memberId).slice(0,4),payroll:payroll,
    reminders:tasks.filter(function(task){ return isOverdue(task)||task.blocker||task.st==='待验收'; }).slice(0,5)};
}
```

Add `meScope:'todo'` to `S.f` and use the exact status filters `all`, `待处理`, `进行中`, `待验收`, `已完成`, `已逾期`.

- [ ] **Step 4: Replace `viewMe()` with the approved six-section layout**

Render, in order, the current identity summary, four clickable status cards, “今日必须处理”, “我的待办/我发起的” task tabs, “我的项目”, “个人收入”, and “执行提醒”. Every record uses one of these exact attributes:

```js
'<button data-act="my-task-filter" data-scope="todo" data-status="进行中">进行中</button>'
'<button data-act="open-execution" data-id="'+task.id+'">'+esc(task.n)+'</button>'
'<button data-act="open-my-project" data-id="'+project.id+'">'+esc(project.n)+'</button>'
'<button data-act="open-income" data-month="'+payroll.month+'">'+payrollMoney(payroll.net)+'</button>'
```

Task count values come from `personalTasks(S.me,'todo',status)`, project rows from `WORKSTATION_GATEWAY.listMyProjects(S.me)`, and income values from `WORKSTATION_GATEWAY.loadPayroll(S.me)[0]`. Empty collections render explicit personal empty states and never substitute another member's data.

- [ ] **Step 5: Wire all personal workbench actions**

Add delegated handlers with these state effects:

```js
else if(a==='my-task-filter'){
  S.f.meScope=t.getAttribute('data-scope')||'todo';
  S.f.meTab=t.getAttribute('data-status')||'all';
  S.page='me'; render();
}
else if(a==='open-execution'){
  S.sel.task=t.getAttribute('data-id'); S.page='execution'; render();
}
else if(a==='open-my-project'){
  S.curProj=t.getAttribute('data-id'); S.page='project'; render();
}
else if(a==='open-income'){
  S.f.payMonth=t.getAttribute('data-month')||''; S.page='fin'; render();
}
```

Change `pick-task-go` to route to `execution`, so task clicks from search and project detail use the same execution page.

- [ ] **Step 6: Synchronize, test, and commit**

Run:

```powershell
Copy-Item -LiteralPath 'E:\新企业工作站\quantxy-ai-workbench-fused.html' -Destination 'E:\新企业工作站\public\quantxy-ai-workbench-fused.html' -Force
npm run test:html
git add -- tests/html-fusion-contract.test.mjs tests/html-personal-workbench-behavior.test.mjs quantxy-ai-workbench-fused.html public/quantxy-ai-workbench-fused.html
git commit -m "feat: rebuild the personal execution workbench"
```

Expected: all HTML tests pass before the commit.

---

### Task 4: Add the task execution detail and interactive workflow controls

**Files:**
- Modify: `tests/html-fusion-contract.test.mjs`
- Modify: `tests/html-personal-workbench-behavior.test.mjs`
- Modify: `quantxy-ai-workbench-fused.html` near `META`, view functions, `VIEWS`, event handlers, input/change handlers, and task status tags.
- Modify: `public/quantxy-ai-workbench-fused.html` by exact synchronization.

**Interfaces:**
- Consumes: gateway mutation methods from Task 2, `S.sel.task`, `S.me`, `MB`, `PB`, `stTag()`, `priTag()`, `toast()`, and `render()`.
- Produces: route `execution`, `viewExecution()`, form readers, timeline rendering, and actions `task-claim`, `task-save-progress`, `task-submit`, `task-pass`, `task-reject`, and `task-reopen`.

- [ ] **Step 1: Add failing execution-page contracts**

```js
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
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test --test-name-pattern="execution detail" tests/html-fusion-contract.test.mjs`

Expected: FAIL because `viewExecution()` and its controls are absent.

- [ ] **Step 3: Register the route and render identity-aware controls**

Add `execution:['个人执行台','领取任务、反馈进度、提交成果并完成验收']` to `META`, add `execution:viewExecution` to `VIEWS`, and implement `viewExecution()` so it:

- returns to `me` with a toast if `WORKSTATION_GATEWAY.loadMyTask(S.me,S.sel.task)` is null;
- displays task/project/status/deadline, description, acceptance criteria, executor, creator, reviewer, progress, blocker, next step, result, files, link, review note, and timeline;
- shows `task-claim`, progress inputs, and result inputs only when `S.me===task.own` and the task state permits them;
- shows pass/reject only when `S.me===task.reviewer||S.me===task.createdBy` and `task.st==='待验收'`;
- shows reopen only to creator/reviewer when `task.st==='已完成'`.

Use these stable field IDs:

```text
execProgress
execBlocker
execNextStep
execResultText
execResultLink
execResultFiles
execReviewNote
```

The files field accepts one file name per line and does not upload binary data.

- [ ] **Step 4: Add exact form readers and error translation**

```js
function fieldValue(id){ var node=el(id); return node?node.value.trim():''; }
function readExecutionInput(){ return {progress:Number(fieldValue('execProgress')),blocker:fieldValue('execBlocker'),nextStep:fieldValue('execNextStep')}; }
function readResultInput(){ return {resultText:fieldValue('execResultText'),resultLink:fieldValue('execResultLink'),resultFiles:fieldValue('execResultFiles').split(/\r?\n/).map(function(v){ return v.trim(); }).filter(Boolean)}; }
function taskError(error){
  var code=String(error&&error.message||error);
  return {forbidden:'当前身份没有此操作权限',invalid_status:'当前任务状态不允许此操作',invalid_progress:'进度必须在 0 到 100 之间',result_required:'请填写成果说明，并提供成果链接或文件名称',review_note_required:'驳回时必须填写验收意见',task_not_found:'任务不存在'}[code]||'任务操作失败';
}
```

- [ ] **Step 5: Wire execution controls through the gateway only**

Each handler calls one gateway method inside `try/catch`, renders on success, and calls `toast(taskError(error))` on failure. Use `fieldValue('execReviewNote')` for reject/reopen notes and pass `{decision:'pass',note:fieldValue('execReviewNote')}` or `{decision:'reject',note:fieldValue('execReviewNote')}` to review.

- [ ] **Step 6: Add one UI-path behavior test**

Append this JSDOM test:

```js
test("executes a pending task from the rendered detail controls", async () => {
  const dom = await openWorkbench();
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
  dom.window.close();
});
```

- [ ] **Step 7: Synchronize, run all HTML tests, and commit**

```powershell
Copy-Item -LiteralPath 'E:\新企业工作站\quantxy-ai-workbench-fused.html' -Destination 'E:\新企业工作站\public\quantxy-ai-workbench-fused.html' -Force
npm run test:html
git add -- tests/html-fusion-contract.test.mjs tests/html-personal-workbench-behavior.test.mjs quantxy-ai-workbench-fused.html public/quantxy-ai-workbench-fused.html
git commit -m "feat: add interactive task execution detail"
```

---

### Task 5: Replace corporate finance with identity-scoped salary and bonus detail

**Files:**
- Modify: `tests/html-fusion-contract.test.mjs`
- Modify: `tests/html-personal-workbench-behavior.test.mjs`
- Modify: `quantxy-ai-workbench-fused.html` near `META.fin`, `S.f`, `viewFin()`, identity switching, and delegated click handling.
- Modify: `public/quantxy-ai-workbench-fused.html` by exact synchronization.

**Interfaces:**
- Consumes: `WORKSTATION_GATEWAY.loadPayroll(memberId)`, `S.me`, `S.f.payMonth`, `MB`, `num()`, and `render()`.
- Produces: personal-only `viewFin()`, `payrollRow(memberId,month)`, actions `payroll-month` and `payroll-focus`, and identity-safe month selection.

- [ ] **Step 1: Add failing finance replacement contracts**

Append:

```js
test("replaces corporate finance with personal salary and bonus detail", async () => {
  const html = await readFusionHtml();
  const start = html.indexOf("function viewFin()");
  const end = html.indexOf("/* ---------------- 页面：知识中心", start);
  const source = html.slice(start, end);
  for (const label of ["我的薪酬", "基本工资", "绩效奖金", "项目奖金", "其他奖励", "社保公积金", "个人所得税", "应发工资", "实发工资", "最近月份工资记录"]) {
    assert.match(source, new RegExp(label));
  }
  for (const forbidden of ["营业收入", "净利润", "经营现金流", "预算执行", "收入 / 支出结构"]) {
    assert.doesNotMatch(source, new RegExp(forbidden));
  }
  assert.match(source, /data-act="payroll-month"/);
  assert.match(source, /data-act="payroll-focus"/);
});
```

Append identity-isolation behavior:

```js
test("shows only the selected identity payroll and clears stale month selection", async () => {
  const dom = await openWorkbench();
  dom.window.Q.S.me = "m1";
  dom.window.Q.S.page = "fin";
  dom.window.Q.render();
  const firstNet = dom.window.Q.gateway.loadPayroll("m1")[0].net;
  assert.match(dom.window.document.querySelector("#view").textContent, new RegExp(String(firstNet.toLocaleString("zh-CN"))));
  dom.window.Q.S.f.payMonth = dom.window.Q.gateway.loadPayroll("m1")[1].month;
  dom.window.Q.S.menu = true;
  dom.window.Q.render();
  dom.window.document.querySelector('[data-act="setme"][data-id="m2"]').click();
  assert.equal(dom.window.Q.S.me, "m2");
  assert.equal(dom.window.Q.S.f.payMonth, "");
  assert.notEqual(dom.window.Q.gateway.loadPayroll("m2")[0].net, firstNet);
  dom.window.close();
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test --test-name-pattern="personal salary|selected identity payroll" tests/html-fusion-contract.test.mjs tests/html-personal-workbench-behavior.test.mjs`

Expected: FAIL because `viewFin()` still renders corporate finance.

- [ ] **Step 3: Replace `viewFin()` with personal payroll cards and monthly detail**

Set `META.fin` to `['我的薪酬','工资、奖金、扣款与实发明细']`. Add `payMonth:''` and `payFocus:''` to `S.f`. `viewFin()` reads only `WORKSTATION_GATEWAY.loadPayroll(S.me)`, selects `S.f.payMonth` or the first row, recomputes `gross`, `deductions`, and `net`, and renders:

- cards for net salary, gross salary, performance bonus, and project bonus;
- a detail table for base, performance, project bonus, other bonus, social, tax, other deduction, gross, deductions, and net;
- a clickable recent-month table with status and pay date;
- an explicit empty state when the current identity has no payroll rows.

All money formatting uses `¥ ` plus `num(value)` and no company aggregates are calculated.

Use these selector and formatter helpers before rendering:

```js
function payrollRow(memberId,month){
  var rows=WORKSTATION_GATEWAY.loadPayroll(memberId), selected=null;
  rows.forEach(function(row){ if(row.month===month) selected=row; });
  return selected||rows[0]||null;
}
function payrollMoney(value){ return '¥ '+num(Number(value||0)); }
```

Every salary card uses `data-act="payroll-focus"` with one of `net`, `gross`, `performance`, or `projectBonus`. Every history row renders `data-act="payroll-month" data-month="'+row.month+'"`. The detail table reads only the selected row and displays no member selector.

- [ ] **Step 4: Add payroll click handlers and identity reset**

```js
else if(a==='payroll-month'){
  S.f.payMonth=t.getAttribute('data-month')||''; S.f.payFocus=''; render();
}
else if(a==='payroll-focus'){
  S.f.payFocus=t.getAttribute('data-focus')||''; render();
}
```

Extend `setme` to set `S.f.payMonth=''`, `S.f.payFocus=''`, and `S.sel.task=null` before routing to `me`.

- [ ] **Step 5: Synchronize and run finance plus full HTML tests**

```powershell
Copy-Item -LiteralPath 'E:\新企业工作站\quantxy-ai-workbench-fused.html' -Destination 'E:\新企业工作站\public\quantxy-ai-workbench-fused.html' -Force
node --test --test-name-pattern="salary|payroll" tests/html-fusion-contract.test.mjs tests/html-personal-workbench-behavior.test.mjs
npm run test:html
```

Expected: all focused and full HTML tests pass.

- [ ] **Step 6: Commit personal payroll**

```powershell
git add -- tests/html-fusion-contract.test.mjs tests/html-personal-workbench-behavior.test.mjs quantxy-ai-workbench-fused.html public/quantxy-ai-workbench-fused.html
git commit -m "feat: add identity-scoped personal payroll"
```

---

### Task 6: Add safe demo cleanup, cutover guards, and expired-session recovery

**Files:**
- Modify: `tests/html-fusion-contract.test.mjs`
- Modify: `tests/html-personal-workbench-behavior.test.mjs`
- Modify: `quantxy-ai-workbench-fused.html` near runtime constants, startup, `render()`, `viewSet()`, AI configuration error handling, and delegated actions.
- Modify: `public/quantxy-ai-workbench-fused.html` by exact synchronization.

**Interfaces:**
- Consumes: `QXY_DEMO_DATA_KEY`, `QXY_DEMO_CLEARED_KEY`, `QXY_LEGACY_DATA_KEY`, `QXY_AUTH_KEY`, `WORKSTATION_RUNTIME`, seed functions, `LOGIN`, `renderLogin()`, and `ask()`.
- Produces: `clearDemoData()`, `resetDemoData()`, `renderDemoCleared()`, `expireSession()`, features `identitySwitch` and `demoReset`, and safe settings actions.

- [ ] **Step 1: Add failing cleanup and auth-recovery tests**

Append:

```js
test("clears only namespaced demo business data and can restore seeds", async () => {
  const dom = await openWorkbench();
  dom.window.localStorage.setItem("unrelated", "keep");
  dom.window.localStorage.setItem("qxy_demo_auth", "1");
  dom.window.Q.gateway.clearDemoData();
  assert.equal(dom.window.localStorage.getItem("unrelated"), "keep");
  assert.equal(dom.window.localStorage.getItem("qxy_demo_auth"), "1");
  assert.equal(dom.window.localStorage.getItem("qxy.workstation.demo.v2"), null);
  assert.equal(dom.window.localStorage.getItem("qxy.workstation.demo.cleared"), "1");
  assert.match(dom.window.document.body.textContent, /演示数据已清除/);
  dom.window.Q.gateway.resetDemoData();
  assert.ok(dom.window.Q.S.tasks.length > 0);
  assert.ok(Object.keys(dom.window.Q.S.payroll).length > 0);
  dom.window.close();
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
  await waitFor(() => /登录状态已失效/.test(dom.window.document.body.textContent));
  assert.match(dom.window.document.body.textContent, /登录状态已失效/);
  assert.equal(dom.window.Q.S.aiConfig.canManage, false);
  dom.window.close();
});
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `node --test --test-name-pattern="clears only|expired AI session" tests/html-personal-workbench-behavior.test.mjs`

Expected: FAIL because cleanup and automatic session expiry handling are absent.

- [ ] **Step 3: Implement destructive cleanup with a persistent cleared marker**

Add these exact state utilities:

```js
function replaceArray(target,rows){
  target.length=0;
  rows.forEach(function(row){ var copy={}; Object.keys(row).forEach(function(key){ copy[key]=row[key]; }); target.push(copy); });
}
function clearDemoData(){
  try{
    localStorage.removeItem(QXY_DEMO_DATA_KEY);
    localStorage.removeItem(QXY_LEGACY_DATA_KEY);
    localStorage.setItem(QXY_DEMO_CLEARED_KEY,'1');
  }catch(e){}
  S.tasks=[]; S.customers=[]; S.activities=[]; S.decisions=[]; S.agents=[]; S.runs=[]; S.reqs=[]; S.payroll={}; S.appr=[];
  MEMBERS.length=0; PROJECTS.length=0; KB.length=0; DEPTS.length=0; rebuildLookups(); S.demoCleared=true; render();
}
function resetDemoData(){
  try{ localStorage.removeItem(QXY_DEMO_CLEARED_KEY); }catch(e){}
  replaceArray(MEMBERS,INITIAL_MEMBERS); replaceArray(PROJECTS,INITIAL_PROJECTS);
  replaceArray(KB,INITIAL_KB); replaceArray(DEPTS,INITIAL_DEPTS); rebuildLookups();
  S.tasks=seedTasks().map(normalizeTask); S.customers=seedCustomers(); S.activities=seedActivities();
  S.decisions=seedDecisions(); S.agents=seedAgents(); S.runs=[]; S.reqs=[]; S.payroll=seedPayroll(); S.appr=seedAppr();
  S.f.meScope='todo'; S.f.meTab='all'; S.f.payMonth=''; S.f.payFocus=''; S.sel.task=null;
  S.demoCleared=false; S.page='me'; save(); render();
}
```

Attach `clearDemoData` and `resetDemoData` to `WORKSTATION_GATEWAY`. At startup, read the cleared marker before automatic seeding. When present, set `S.demoCleared=true` and skip all business seeds.

At startup, read the cleared marker before automatic seeding. When present, set `S.demoCleared=true` and skip all business seeds.

- [ ] **Step 4: Render a safe cleared state and settings controls**

Before `renderNav()` in `render()`, handle `S.demoCleared` by showing a centered `renderDemoCleared()` panel with “演示数据已清除” and a `data-act="restore-demo"` button. Add `workstationFeatures()` that returns `WORKSTATION_GATEWAY.loadBootstrap().features`. `renderTop()` renders the identity menu only when `workstationFeatures().identitySwitch` is true; when false it renders the authenticated name and role without `data-act="setme"`. In settings, keep “重置演示数据” and add a risk-styled `data-act="clear-demo"` button only when `WORKSTATION_RUNTIME.dataMode==='demo'`.

Handlers:

```js
else if(a==='clear-demo'){
  ask('清除演示数据？','只清除当前浏览器中的 QuantXY 演示业务数据，不影响登录状态和服务器模型配置。','确认清除',function(){ S.confirm=null; WORKSTATION_GATEWAY.clearDemoData(); },true);
}
else if(a==='reset'){ WORKSTATION_GATEWAY.resetDemoData(); toast('演示数据已重置'); }
else if(a==='restore-demo'){ WORKSTATION_GATEWAY.resetDemoData(); toast('演示数据已恢复'); }
```

- [ ] **Step 5: Recover expired sessions instead of leaving false-active buttons**

Add:

```js
function expireSession(){
  LOGIN.authenticated=false; LOGIN.checked=true; LOGIN.error='登录状态已失效，请重新登录';
  S.aiConfig.canManage=false; S.aiConfig.loaded=false; S.aiConfig.loading=false; S.aiConfig.saving=false;
  renderLogin();
}
```

In `loadAiConfig()` and `updateAiConfig()`, detect HTTP 401 before throwing the general error, call `expireSession()`, and stop the settings render chain. Keep 403 as a permission error. This makes “更新密钥” unavailable only on the login screen, not as a misleading blue disabled button.

- [ ] **Step 6: Add static cutover guard contracts**

Append this contract:

```js
test("reserves Feishu cutover without activating a fake server adapter", async () => {
  const html = await readFusionHtml();
  assert.match(html, /features:\{identitySwitch:true,demoReset:true\}/);
  assert.match(html, /workstationFeatures\(\)\.identitySwitch/);
  for (const method of ["getSession", "loadBootstrap", "loadMyDashboard", "listMyTasks", "loadMyTask", "listMyProjects", "saveTask", "submitTaskResult", "reviewTaskResult", "loadPayroll", "clearDemoData"]) {
    assert.match(html, new RegExp(`${method}:`));
  }
  assert.doesNotMatch(html, /createServerGateway\(\)/);
  assert.doesNotMatch(html, /NEXT_PUBLIC_FEISHU|FEISHU_APP_SECRET|user_access_token|authorization_code/);
});
```

- [ ] **Step 7: Synchronize, run HTML tests, and commit**

```powershell
Copy-Item -LiteralPath 'E:\新企业工作站\quantxy-ai-workbench-fused.html' -Destination 'E:\新企业工作站\public\quantxy-ai-workbench-fused.html' -Force
npm run test:html
git add -- tests/html-fusion-contract.test.mjs tests/html-personal-workbench-behavior.test.mjs quantxy-ai-workbench-fused.html public/quantxy-ai-workbench-fused.html
git commit -m "feat: add safe demo cleanup and cutover guards"
```

---

### Task 7: Full regression, browser QA, Git publication, and isolated deployment

**Files:**
- Modify only if a verified defect is found: files already listed in Tasks 1–6.
- Read only: `Dockerfile`, `compose.yaml`, `.dockerignore`, `package-lock.json`, and current Git state.

**Interfaces:**
- Consumes: completed root/public HTML, all tests, current `main`, private remote `private`, server directory `/srv/ai-enterprise-brain/app`, Compose project `ai-brain-demo`, and `.env.production` already present on the server.
- Produces: verified production build, pushed private `main`, rebuilt isolated deployment, and browser acceptance evidence.

- [ ] **Step 1: Verify the HTML copies and repository scope**

Run:

```powershell
$a=(Get-FileHash -Algorithm SHA256 -LiteralPath 'E:\新企业工作站\quantxy-ai-workbench-fused.html').Hash
$b=(Get-FileHash -Algorithm SHA256 -LiteralPath 'E:\新企业工作站\public\quantxy-ai-workbench-fused.html').Hash
if($a -ne $b){ throw 'fused HTML copies differ' }
git status --short
git diff --check
```

Expected: hashes match; only planned files plus the untouched untracked `audit-2026-08-17/` appear.

- [ ] **Step 2: Run every local quality gate without skipping TypeScript**

```powershell
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: every command exits `0`; no TypeScript error is suppressed.

- [ ] **Step 3: Run browser QA on the production app**

Start the production app on local port `3012`:

```powershell
$qaProc=Start-Process -FilePath 'npm.cmd' -ArgumentList 'run','start','--','--hostname','127.0.0.1','--port','3012' -WorkingDirectory 'E:\新企业工作站' -WindowStyle Hidden -PassThru
Invoke-WebRequest -Uri 'http://127.0.0.1:3012/quantxy-ai-workbench-fused.html' -UseBasicParsing -TimeoutSec 20 | Select-Object StatusCode
```

In Chrome, open `http://127.0.0.1:3012/quantxy-ai-workbench-fused.html` and verify:

1. login and enter the fused workstation;
2. switch to an executor and open “今日必须处理”;
3. claim a task, save progress and blocker, submit result, switch to reviewer, reject, resubmit, and accept;
4. open all status cards and confirm the matching filter;
5. open a personal project and return;
6. open personal income, performance bonus, project bonus, and two salary months;
7. switch identities and confirm tasks/projects/payroll change without stale details;
8. reset demo data, then clear demo data, verify the cleared state, and restore demo data;
9. confirm AI scheduling, projects, customers, activities, decisions, knowledge, Agent, organization, and settings still open;
10. confirm no attendance, leave, corporate finance, or company salary list appears.

Save screenshots outside the repository under `C:\Users\Administrator\.codex\visualizations\2026\08\18\personal-workbench-qa\`.

After browser checks, stop only the process started above:

```powershell
Stop-Process -Id $qaProc.Id
```

- [ ] **Step 4: Fix only verified defects and rerun the affected test first**

For each browser defect, add one failing JSDOM or static contract assertion, run it to confirm RED, make the smallest HTML change, rerun it to GREEN, synchronize the public copy, then rerun `npm test` and `npm run build`.

- [ ] **Step 5: Commit any final QA correction**

If Step 4 produced tracked changes:

```powershell
git add -- package.json tests/html-fusion-contract.test.mjs tests/html-personal-workbench-behavior.test.mjs quantxy-ai-workbench-fused.html public/quantxy-ai-workbench-fused.html
git commit -m "fix: complete personal workbench browser QA"
```

If there are no tracked changes, do not create an empty commit.

- [ ] **Step 6: Push the verified branch to the private repository**

```powershell
git fetch private main
git merge-base --is-ancestor private/main HEAD
git push private main:main
git ls-remote private refs/heads/main
git rev-parse HEAD
```

Expected: the remote `refs/heads/main` hash equals local `HEAD`. Do not push `audit-2026-08-17/`.

- [ ] **Step 7: Update only the isolated server checkout**

From the authorized Ubuntu terminal:

```bash
cd /srv/ai-enterprise-brain/app
git fetch origin main
expected_commit=$(git rev-parse origin/main)
git merge --ff-only origin/main
test "$(git rev-parse HEAD)" = "$expected_commit"
git status --short
```

Expected: the checkout is on the private `main` head and the worktree is clean. Do not enter `/opt/quantumgalaxy`.

- [ ] **Step 8: Rebuild only the AI enterprise brain Compose project**

```bash
cd /srv/ai-enterprise-brain/app
sudo docker compose -p ai-brain-demo -f compose.yaml --env-file .env.production config --quiet
sudo docker compose -p ai-brain-demo -f compose.yaml --env-file .env.production up -d --build
sudo docker compose -p ai-brain-demo -f compose.yaml --env-file .env.production ps
sudo docker compose -p ai-brain-demo -f compose.yaml --env-file .env.production logs --tail=100
curl --fail --silent --show-error http://127.0.0.1:3010/quantxy-ai-workbench-fused.html > /dev/null
```

Expected: only `ai-brain-demo` resources are rebuilt, the app is running on `3010`, and logs contain no fatal startup error. Do not run `down -v`, prune commands, or touch ports 80/443.

- [ ] **Step 9: Verify the public deployment in Chrome**

Open `http://8.210.64.239:3010/quantxy-ai-workbench-fused.html`, log in with the currently configured server password without exposing it, and repeat the identity switch, one complete task cycle, personal payroll isolation, and demo reset/clear/restore checks. Confirm the deployed page hash corresponds to the pushed commit and report the final commit, container status, local curl result, public-page result, and any remaining external blocker.

---

## Completion Gate

Implementation is complete only when all of the following are true:

- `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` pass.
- The two fused HTML files are byte-identical.
- Task claim, execution, submission, rejection, resubmission, and acceptance work under the correct identities.
- Personal dashboard, projects, reminders, salary, and bonuses follow `S.me` without cross-identity leakage.
- Every visual affordance introduced by this feature has a verified click result or a visible disabled reason.
- Demo reset, clear, and restore affect only namespaced demo business data.
- The future Feishu/server cutover contract exists without making the demo depend on Supabase.
- The private GitHub `main` and isolated server checkout point to the same verified commit.
- `ai-brain-demo` serves the page on port `3010` without affecting `quantumgalaxy` or other server resources.
