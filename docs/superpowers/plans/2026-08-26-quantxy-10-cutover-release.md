# QuantXY Commercial Cutover and Release Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the fused/demo production surface, prove the database and full business flows from a clean environment, and produce a release-ready evidence bundle without deploying.

**Architecture:** The Next.js application becomes the only formal route; CI starts a clean local Supabase stack and runs database, unit, HTML-removal, type, lint, build, and real browser gates. Runtime hardening and a dependency-aware readiness route are verified before a release candidate is packaged.

**Tech Stack:** Next.js, Supabase CLI/PostgreSQL, GitHub Actions, Docker/Compose, Playwright, Vitest, pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-26-quantxy-commercial-completion-design.md`

## Global Constraints

- Depends on Plans 01-09.
- This plan does not deploy production.
- Release gate fails on any reachable fixture/mock/business-localStorage path.
- A health route is not ready unless auth dependencies, database and required migrations are healthy.
- Production secrets are never copied into test artifacts.

---

### Task 1: Remove the fused formal route and production mock reachability

**Files:**
- Delete: `src/app/quantxy-ai-workbench-fused.html/route.ts`
- Delete: `src/app/quantxy-ai-workbench-fused.html/route-support.ts`
- Delete: `src/app/quantxy-ai-workbench-fused.html/route.test.ts`
- Delete: `quantxy-ai-workbench-fused.html`
- Delete: `public/workstation-server-adapter.js`
- Create: `tests/unit/commercial-source-boundary.test.ts`
- Modify: `src/config/navigation.ts`
- Modify: `src/features/operations/role-access.ts`
- Modify: `src/middleware.ts`

**Interfaces:**
- `/` and role home routes resolve to Next workspaces only.
- Source-boundary test scans production imports for forbidden mock/fixture/local business repositories.

- [ ] **Step 1: Write the failing production-source boundary test**

```ts
expect(forbiddenProductionImports).toEqual([]);
expect(formalRoutes).not.toContain("/quantxy-ai-workbench-fused.html");
expect(formalRoutes).not.toContain("/leave");
expect(formalRoutes).not.toContain("/attendance");
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/unit/commercial-source-boundary.test.ts`
Expected: fused route, formal adapter, fixture imports and excluded routes are reported.

- [ ] **Step 3: Delete fused assets and remove production fixture imports**

Keep historical Git commits and documentation as recovery evidence. Test-only fixture utilities may remain only under test paths; no production page or feature entry imports them.

- [ ] **Step 4: Verify GREEN and route build**

Run: `npx vitest run tests/unit/commercial-source-boundary.test.ts`
Run: `npm run build`
Expected: only Next routes build and forbidden production imports are empty.

- [ ] **Step 5: Commit**

```bash
git add -A quantxy-ai-workbench-fused.html public/workstation-server-adapter.js src/app/quantxy-ai-workbench-fused.html src/config/navigation.ts src/features/operations/role-access.ts src/middleware.ts tests/unit/commercial-source-boundary.test.ts
git commit -m "refactor: retire the fused formal workstation"
```

### Task 2: Make clean database reset and security invariants mandatory

**Files:**
- Create: `supabase/seed.sql`
- Create: `supabase/tests/schema_security_invariants.sql`
- Create: `supabase/tests/audit_immutability.sql`
- Create: `supabase/tests/workflow_transactions.sql`
- Create: `scripts/verify-database-reset.mjs`
- Create: `scripts/verify-database-reset.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces script `verify:db` that starts/reset/tests a local Supabase database and rejects remote URLs.
- Seed creates only deterministic non-production tenant/roles/test identities and is idempotent.

- [ ] **Step 1: Write failing seed-presence and invariant tests**

```js
assert.equal(await exists("supabase/seed.sql"), true);
assert.deepEqual(await tablesMissingRlsOrForce(), []);
assert.equal(await canUpdateAuditAsAuthenticated(), false);
```

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/verify-database-reset.test.mjs`
Run: `npm run db:reset`
Expected: seed file is missing and security invariants report remaining tables.

- [ ] **Step 3: Add safe seed, invariants, and verify script**

The script parses the configured Supabase URL, accepts only localhost/127.0.0.1, runs reset and pgTAP, and exits non-zero on missing RLS/FORCE RLS/policy/grant/audit constraints.

- [ ] **Step 4: Verify GREEN twice for idempotency**

Run: `npm run verify:db`
Run: `npm run verify:db`
Expected: both clean resets and all DB tests exit 0.

- [ ] **Step 5: Commit**

```bash
git add supabase/seed.sql supabase/tests/schema_security_invariants.sql supabase/tests/audit_immutability.sql supabase/tests/workflow_transactions.sql scripts/verify-database-reset.mjs scripts/verify-database-reset.test.mjs package.json
git commit -m "test: require clean database security verification"
```

### Task 3: Add full CI release gates

**Files:**
- Create: `.github/workflows/commercial-ci.yml`
- Create: `scripts/verify-commercial-source.mjs`
- Create: `scripts/verify-commercial-source.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces `npm run verify:commercial` executing DB, unit, HTML-removal/source-boundary, typecheck, lint, build and Playwright.

- [ ] **Step 1: Write failing command-order and failure-propagation tests**

```js
assert.deepEqual(commercialSteps, ["verify:db", "test:unit", "test:html", "typecheck", "lint", "build", "test:e2e"]);
assert.equal(await runWithFailingStep("lint"), 1);
```

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/verify-commercial-source.test.mjs`
Expected: commercial verification script/workflow is absent.

- [ ] **Step 3: Implement the workflow and ordered local runner**

CI pins Node version from the repository policy, caches npm only, starts local Supabase, never receives production secrets, uploads Playwright traces on failure, and cancels later steps after the first failure.

- [ ] **Step 4: Verify GREEN and validate workflow syntax**

Run: `node --test scripts/verify-commercial-source.test.mjs`
Run: `npm run verify:commercial`
Expected: ordered gate exits 0 from a clean local environment.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/commercial-ci.yml scripts/verify-commercial-source.mjs scripts/verify-commercial-source.test.mjs package.json
git commit -m "ci: add QuantXY commercial release gate"
```

### Task 4: Harden HTTP, container runtime, and readiness

**Files:**
- Modify: `next.config.ts`
- Create: `src/app/api/health/ready/route.ts`
- Create: `src/app/api/health/ready/route.test.ts`
- Modify: `Dockerfile`
- Modify: `compose.yaml`
- Create: `docs/operations/container-security.md`

**Interfaces:**
- Produces `/api/health/ready` that checks database reachability, required migration marker, and auth configuration without exposing secret values.
- Adds CSP, HSTS, frame, content-type, referrer and permissions headers.

- [ ] **Step 1: Write failing readiness and header tests**

```ts
expect((await readyWithDatabaseFailure()).status).toBe(503);
expect((await readyWithOldMigration()).status).toBe(503);
expect(headers["content-security-policy"]).toBeDefined();
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/app/api/health/ready/route.test.ts`
Run: `npm run build`
Expected: readiness route is absent and security-header assertion fails.

- [ ] **Step 3: Implement readiness, headers, and runtime restrictions**

Compose uses `read_only`, tmpfs for required writable paths, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, PID/CPU/memory limits, and the new readiness endpoint. Keep non-root runtime.

- [ ] **Step 4: Verify GREEN and inspect the built container**

Run: `npx vitest run src/app/api/health/ready/route.test.ts`
Run: `npm run build`
Run: `docker compose config`
Expected: tests/build/config exit 0 and readiness fails when DB/migration checks are unhealthy.

- [ ] **Step 5: Commit**

```bash
git add next.config.ts src/app/api/health/ready/route.ts src/app/api/health/ready/route.test.ts Dockerfile compose.yaml docs/operations/container-security.md
git commit -m "security: harden runtime and readiness"
```

### Task 5: Run the complete real-flow browser matrix and produce evidence

**Files:**
- Modify: `tests/e2e/auth-state.ts`
- Modify: `tests/e2e/global-setup.ts`
- Create: `tests/e2e/commercial-journeys.spec.ts`
- Create: `scripts/collect-commercial-evidence.mjs`
- Create: `docs/operations/commercial-release-checklist.md`
- Create: `docs/operations/staging-evidence-template.md`

**Interfaces:**
- Produces deterministic local identities for owner/admin/department_head/employee/hr/finance in two tenants.
- Produces evidence manifest with commit, migration hashes, test commands, timestamps, result counts and artifact paths.

- [ ] **Step 1: Write failing end-to-end journey and evidence-manifest tests**

```ts
await expect(page.getByText("真实数据服务不可用")).toHaveCount(0);
expect(manifest).toMatchObject({ commit: expect.any(String), migrations: expect.any(Array), failed: 0 });
```

The journey covers organization -> project/task -> customer -> approval/expense -> payroll -> knowledge -> AI -> Agent -> analytics/settings on desktop and mobile.

- [ ] **Step 2: Verify RED**

Run: `npx playwright test tests/e2e/commercial-journeys.spec.ts`
Run: `node scripts/collect-commercial-evidence.mjs --check`
Expected: journey and evidence collector are absent.

- [ ] **Step 3: Implement deterministic setup and evidence collection**

Use local Supabase only, never intercept business APIs, isolate rows by test-run ID, clean them transactionally, and write artifacts outside tracked source except the checklist/template.

- [ ] **Step 4: Run the final local commercial gate**

Run: `npm run verify:commercial`
Run: `node scripts/collect-commercial-evidence.mjs`
Expected: zero failed tests, zero forbidden source paths, migration hashes present, desktop/mobile journey artifacts recorded.

- [ ] **Step 5: Commit the harness and checklists, not generated evidence**

```bash
git add tests/e2e/auth-state.ts tests/e2e/global-setup.ts tests/e2e/commercial-journeys.spec.ts scripts/collect-commercial-evidence.mjs docs/operations/commercial-release-checklist.md docs/operations/staging-evidence-template.md
git commit -m "test: add full commercial acceptance evidence"
```

### Task 6: Prepare the Staging validation package without deploying

**Files:**
- Create: `docs/operations/staging-validation-runbook.md`
- Create: `docs/operations/recovery-drill-runbook.md`
- Modify: `docs/commercial-database-sop.md`

**Interfaces:**
- Produces exact operator steps for a user-authorized future Staging run and restore drill.

- [ ] **Step 1: Write the release checklist assertions**

The checklist must require commit hash, migration hash, separate Staging secrets, demo=false, DB/RLS pass, browser matrix pass, Feishu send/receive evidence, DeepSeek success/failure evidence, Storage evidence, backup ID, restore result, RPO/RTO, and explicit production authorization.

- [ ] **Step 2: Validate that no production action is embedded**

Run: `rg -n "supabase db push|docker compose up -d|ssh |scp |git push" docs/operations/staging-validation-runbook.md docs/operations/recovery-drill-runbook.md`
Expected: commands are presented only under explicit approval gates and no command is executed by this task.

- [ ] **Step 3: Add the exact read-only/preflight and approval boundaries**

Document environment fingerprint checks, database target verification, backup-before-migration, rollback boundary, secret redaction, and stop conditions.

- [ ] **Step 4: Verify documentation and repository status**

Run: `git diff --check`
Run: `npm run verify:commercial`
Expected: documentation has no whitespace errors and the full gate remains green.

- [ ] **Step 5: Commit**

```bash
git add docs/operations/staging-validation-runbook.md docs/operations/recovery-drill-runbook.md docs/commercial-database-sop.md
git commit -m "docs: add staging and recovery validation runbooks"
```
