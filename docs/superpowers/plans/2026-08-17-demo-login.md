# QuantXY Demo Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Add a standalone demo login gate to the fused QuantXY HTML while preserving the existing identity switcher and all locally stored business data.

**Architecture:** Keep authentication as a small UI/state layer inside the existing single HTML file. Store the auth marker under a dedicated key in `sessionStorage` or `localStorage`; keep the existing `qxy` business-data key untouched. Gate the existing `render()` function so unauthenticated visitors see only a login card, then reuse the current render/navigation flow after authentication.

**Tech Stack:** Standalone HTML, CSS, ES5-compatible browser JavaScript, Node.js built-in test runner, Acorn syntax validation, browser interaction QA.

## Global Constraints

- Preserve `E:/xwechat_files/wxid_dlkzyugmv5rz22_ab99/msg/file/2026-08/quantxy-ai-workbench_10(1).html` byte-for-byte.
- Make production edits only in `quantxy-ai-workbench-fused.html`.
- Keep demo authentication separate from the existing `qxy` business-data record.
- Do not add attendance, leave, payroll, registration, password recovery, OAuth, or claims of production-grade security.
- Reuse the existing QuantXY logo and blue/white visual system.
- Preserve `S.me` and the right-top identity switching behavior after login.
- Use test-driven development: write one failing contract test, verify RED, implement the minimum change, verify GREEN, then commit.

---

## File Map

- Modify: `tests/html-fusion-contract.test.mjs`
  - Add static contracts for login markup, auth state separation, persistence, logout, and retained identity switching.
- Modify: `quantxy-ai-workbench-fused.html`
  - Add the login root, responsive login styles, authentication helpers, login rendering and events, `render()` gating, and logout menu action.
- Verify only: `E:/xwechat_files/wxid_dlkzyugmv5rz22_ab99/msg/file/2026-08/quantxy-ai-workbench_10(1).html`
  - Recompute the existing SHA-256 contract; never edit this file.

---

## Task 1: Render an authenticated gate and demo login form

**Files:**

- Modify: `tests/html-fusion-contract.test.mjs`
- Modify: `quantxy-ai-workbench-fused.html`

- [ ] **Step 1: Write the failing login-shell contract test**

Add a test named `renders a standalone demo login gate before the workstation` that asserts:

```js
for (const token of [
  'id="loginGate"',
  'data-login="user"',
  'data-login="pass"',
  'data-login="remember"',
  'data-act="login-toggle"',
  'data-act="login-submit"',
  '演示环境',
]) {
  assert.match(html, new RegExp(token));
}
for (const fn of ["authState", "renderLogin", "submitLogin"]) {
  assert.match(html, new RegExp(`function ${fn}\\(`));
}
assert.match(html, /if\(!authState\(\)\)/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test --test-name-pattern "standalone demo login gate" tests/html-fusion-contract.test.mjs
```

Expected: FAIL because the login root and functions do not exist.

- [ ] **Step 3: Add the static login root and responsive styles**

Insert `<div id="loginGate" class="login-gate" hidden></div>` before the existing `.app` element. Add styles for:

- `.login-gate`, `.login-card`, `.login-brand`, `.login-field`, `.login-input`, `.login-toggle`
- `.login-options`, `.login-submit`, `.login-error`, `.login-note`
- `.app.auth-hidden { display:none }`
- A `max-width:480px` adjustment using viewport-safe padding and `width:min(100%, 420px)` so the page does not overflow at 390×844.

- [ ] **Step 4: Add isolated authentication state and login rendering**

Add these constants beside the existing helpers:

```js
var QXY_DEMO_USER='admin';
var QXY_DEMO_PASS='123456';
var QXY_AUTH_KEY='qxy_demo_auth';
var LOGIN={user:'',pass:'',remember:true,show:false,error:'',memory:false,busy:false};
```

Add helpers with these interfaces:

```js
function authState() -> boolean
function setAuthState(remember) -> void
function renderLogin() -> void
function submitLogin() -> void
```

`authState()` must check the page-memory flag, then `sessionStorage`, then `localStorage`, catching storage failures. `renderLogin()` must hide `.app`, show `#loginGate`, reuse `logoSVG()`, render the two inputs, password visibility toggle, remember checkbox, submit button, error region, and the explicit demo-account note. `submitLogin()` must validate blank fields and incorrect credentials with the approved Chinese errors; valid credentials set auth state and render the app.

- [ ] **Step 5: Gate the current renderer**

At the start of `render()`:

```js
if(!authState()){ renderLogin(); return; }
```

On the authenticated path, hide `#loginGate`, remove `.auth-hidden` from `.app`, then call the existing `renderNav()`, `renderTop()`, and view renderer without changing existing routes.

- [ ] **Step 6: Add form input, click, and Enter-key behavior**

Extend the existing delegated listeners so:

- `input[data-login]` updates `LOGIN.user` or `LOGIN.pass` and clears the error.
- `change[data-login="remember"]` updates `LOGIN.remember`.
- `data-act="login-toggle"` changes `LOGIN.show` and re-renders the login form.
- `data-act="login-submit"` calls `submitLogin()`.
- Pressing Enter in either login field calls `submitLogin()`.
- Repeated submit while `LOGIN.busy` is true returns immediately.

- [ ] **Step 7: Verify GREEN and commit**

Run:

```powershell
node --test --test-name-pattern "standalone demo login gate" tests/html-fusion-contract.test.mjs
```

Expected: PASS.

Commit:

```powershell
git add tests/html-fusion-contract.test.mjs quantxy-ai-workbench-fused.html
git commit -m "feat: add standalone demo login gate"
```

---

## Task 2: Remember login, retain identity switching, and log out safely

**Files:**

- Modify: `tests/html-fusion-contract.test.mjs`
- Modify: `quantxy-ai-workbench-fused.html`

- [ ] **Step 1: Write the failing persistence/logout contract test**

Add a test named `keeps authentication separate from identity and business data` that asserts:

```js
assert.match(html, /var QXY_AUTH_KEY='qxy_demo_auth'/);
assert.match(html, /sessionStorage\.setItem\(QXY_AUTH_KEY/);
assert.match(html, /localStorage\.setItem\(QXY_AUTH_KEY/);
assert.match(html, /sessionStorage\.removeItem\(QXY_AUTH_KEY/);
assert.match(html, /localStorage\.removeItem\(QXY_AUTH_KEY/);
assert.match(html, /function logoutDemo\(/);
assert.match(html, /data-act="logout"/);
assert.match(html, /data-act="setme"/);
assert.match(html, /切换身份查看工作台/);
assert.match(html, /localStorage\.setItem\('qxy'/);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node --test --test-name-pattern "authentication separate" tests/html-fusion-contract.test.mjs
```

Expected: FAIL because logout is not implemented.

- [ ] **Step 3: Implement explicit persistence semantics**

`setAuthState(remember)` must:

- Always set `LOGIN.memory=true` so storage failures do not block the current page.
- If remembered, write the auth marker to `localStorage` and remove it from `sessionStorage`.
- Otherwise, write the auth marker to `sessionStorage` and remove it from `localStorage`.
- Catch storage exceptions without changing the successful in-page login result.

- [ ] **Step 4: Add safe logout and menu action**

Add:

```js
function logoutDemo() -> void
```

It must set `LOGIN.memory=false`, clear password and errors, remove `QXY_AUTH_KEY` from both storage locations inside `try` blocks, close `S.menu`, and call `render()`. It must never call `localStorage.removeItem('qxy')` or reset business collections.

Append a divider and `data-act="logout"` button after the existing member buttons in the right-top menu. Keep every existing `data-act="setme"` button unchanged. Add a click branch that invokes `logoutDemo()`.

- [ ] **Step 5: Verify GREEN and commit**

Run:

```powershell
node --test --test-name-pattern "authentication separate" tests/html-fusion-contract.test.mjs
node --test tests/html-fusion-contract.test.mjs
```

Expected: the focused test and full contract suite PASS.

Commit:

```powershell
git add tests/html-fusion-contract.test.mjs quantxy-ai-workbench-fused.html
git commit -m "feat: remember demo login and add safe logout"
```

---

## Task 3: Validate syntax and browser behavior

**Files:**

- Verify: `quantxy-ai-workbench-fused.html`
- Verify: `tests/html-fusion-contract.test.mjs`

- [ ] **Step 1: Parse the application script**

Extract the main inline application script from the HTML in memory and parse it with the available Acorn runtime using `ecmaVersion: 'latest'`. Do not write a generated script file.

Expected: no syntax errors.

- [ ] **Step 2: Run all automated contracts**

Run:

```powershell
node --test tests/html-fusion-contract.test.mjs
```

Expected: all tests PASS, including the unchanged source hash and excluded HR workflows.

- [ ] **Step 3: Perform desktop browser QA**

Using the local preview:

1. If already authenticated, open the user menu and click “退出登录”.
2. Confirm the login card is visible and the workstation navigation is hidden.
3. Submit blank fields and confirm “请输入账号和密码”.
4. Submit incorrect credentials and confirm “账号或密码错误，请使用演示账号”.
5. Submit `admin / 123456` with remember enabled and confirm the decision dashboard appears.
6. Open the user menu, switch to another member, and confirm the displayed name changes without another login.
7. Reload and confirm remembered login remains active.
8. Log out, log in again, and confirm existing customers/activities/decisions remain present.

- [ ] **Step 4: Perform 390×844 narrow-screen QA**

Use a same-origin 390×844 browser harness. Confirm the login card, fields, password toggle, checkbox, and button are visible; `document.documentElement.scrollWidth <= document.documentElement.clientWidth`; then log in and reconfirm the existing workstation has no page-level horizontal overflow.

- [ ] **Step 5: Check runtime logs and repository state**

Confirm fresh browser error logs are empty. Confirm the worktree contains only the intended committed changes and the supplied source hash still matches.

- [ ] **Step 6: Record QA-only verification**

If no code changes are needed during QA, do not create an empty commit. If a defect is found, first add a failing regression contract, implement the fix, rerun Tasks 3.1–3.5, and commit the focused fix.

---

## Plan Self-Review Checklist

- [ ] Every approved behavior in `docs/superpowers/specs/2026-08-17-demo-login-design.md` maps to a task and verification step.
- [ ] All named functions, storage keys, DOM attributes, errors, and test commands are exact; no placeholder or TODO text remains.
- [ ] Auth markers use only `QXY_AUTH_KEY`; the existing `qxy` key remains business-data-only.
- [ ] `S.me` is not used as an authentication signal and identity switching remains available after login.
- [ ] Desktop, refresh persistence, logout safety, storage failure, and 390×844 behavior are covered.
