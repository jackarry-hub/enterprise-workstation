# QuantXY Commercial Cutover and Release Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conditionally retire the fused/demo surface, prove the database and full business flows from a clean environment, and produce a release-ready evidence bundle without deploying Internal or Customer Production.

**Architecture:** The Next.js application becomes the only formal route; CI starts a clean local Supabase stack and runs database, unit, HTML-removal, type, lint, build, and real browser gates. Runtime hardening and a dependency-aware readiness route are verified before a release candidate is packaged.

**Tech Stack:** Next.js, Supabase CLI/PostgreSQL, GitHub Actions, Docker/Compose, Playwright, Vitest, pgTAP.

**Spec:** `docs/superpowers/specs/2026-08-26-quantxy-commercial-completion-design.md`

## Global Constraints

- Depends on Plans 01-09.
- Staging verification is required and may run only against separately authorized, isolated synthetic-data infrastructure; Internal and Customer Production never deploy without explicit authorization.
- Release gate fails on any reachable fixture/mock/business-localStorage path.
- A health route is not ready unless auth dependencies, database and required migrations are healthy.
- Production secrets are never copied into test artifacts.
- Internal/Production reset, DROP, TRUNCATE and test seed must hard-fail; all migrations are forward-only, reviewed and validated first in Local/Staging.

---

### Task 1: Establish non-destructive parity/source boundaries and remove excluded public scope

**Files:**
- Create: `tests/unit/commercial-source-boundary.test.ts`
- Create: `tests/unit/excluded-scope-public-surface.test.ts`
- Create: `scripts/scan-formal-public-surface.mjs`
- Create: `scripts/scan-formal-public-surface.test.mjs`
- Modify: `src/config/navigation.ts`
- Modify: `src/features/operations/role-access.ts`
- Modify: `src/middleware.ts`
- Delete: `src/app/(workspace)/leave/page.tsx`
- Delete: `src/app/(workspace)/attendance/page.tsx`
- Delete: `src/app/(workspace)/attendance/page.test.tsx`
- Delete: `tests/e2e/attendance.spec.ts`
- Modify: `README.md`
- Modify: `docs/企业工作站使用说明.md`
- Modify: `docs/企业工作站使用说明.docx`
- Modify: `scripts/build_usage_manual.py`
- Modify: `src/app/layout.tsx`
- Modify: `src/features/help/help-center.tsx`
- Modify: `src/app/(workspace)/help/page.tsx`
- Modify: `src/features/settings/settings-workspace.tsx`
- Modify: `src/features/salary/payroll-workspace.tsx`
- Modify: `src/features/settings/components/permission-matrix.tsx`
- Modify: `src/features/salary/components/payroll-aside.tsx`
- Modify: `src/features/approvals/approvals-workspace.tsx`
- Modify: `src/features/approvals/approval-meta.ts`

**Interfaces:**
- `/` and role home routes resolve to Next workspaces only.
- Source-boundary/parity tests scan the formal Next.js dependency graph for forbidden mock/fixture/local business repositories and assert no formal navigation, metadata, README/manual/generator/help or dead link points to leave/attendance. `scripts/scan-formal-public-surface.mjs` is the only public-surface scanner: it scans formal imports and built public output for `leave|attendance|请假|考勤`, and allows matches only in historical `docs/commercial-database-sop.md`, schema, migrations, audit and phase-record records.
- Fused route/assets remain preserved as an explicitly quarantined migration exception: they cannot appear in formal navigation or the formal Next.js dependency graph, and this task must not delete or mutate them.

- [ ] **Step 1: Write the failing production-source boundary test**

```ts
expect(forbiddenProductionImports).toEqual([]);
expect(fusedAssets).toEqual(expect.arrayContaining(["quantxy-ai-workbench-fused.html", "workstation-server-adapter.js"]));
expect(formalRoutes).not.toContain("/leave");
expect(formalRoutes).not.toContain("/attendance");
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/unit/commercial-source-boundary.test.ts`
Run: `npx vitest run tests/unit/excluded-scope-public-surface.test.ts`
Run: `node --test scripts/scan-formal-public-surface.test.mjs`
Expected: forbidden production imports, excluded public references and dead links are reported; fused assets remain present.

- [ ] **Step 3: Remove excluded public routes and references without touching historical data**

Delete the leave/attendance App Routes and public E2E route coverage; remove all detected public navigation, metadata, README, `docs/企业工作站使用说明.md`, generated DOCX/manual generator, help, settings-permission-matrix and salary/payroll aside-copy/state references and dead links. Preserve historical database tables/migrations and all fused assets.

- [ ] **Step 4: Verify GREEN and route build**

Run: `npx vitest run tests/unit/commercial-source-boundary.test.ts`
Run: `npx vitest run tests/unit/excluded-scope-public-surface.test.ts`
Run: `npm run build`
Run: `node --test scripts/scan-formal-public-surface.test.mjs`
Run: `node scripts/scan-formal-public-surface.mjs --formal-imports --built-public-output --terms "leave|attendance|请假|考勤" --allowlist "docs/commercial-database-sop.md,supabase/schema/**,supabase/migrations/**,docs/audit/**,docs/phase-records/**"`
Expected: only supported public routes build, excluded-scope source/link checks are empty, and fused assets are still present.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/企业工作站使用说明.md docs/企业工作站使用说明.docx scripts/build_usage_manual.py scripts/scan-formal-public-surface.mjs scripts/scan-formal-public-surface.test.mjs src/app/layout.tsx 'src/app/(workspace)/leave' 'src/app/(workspace)/attendance' 'src/app/(workspace)/help/page.tsx' src/config/navigation.ts src/features/help/help-center.tsx src/features/settings src/features/salary src/features/approvals src/features/operations/role-access.ts src/middleware.ts tests/e2e/attendance.spec.ts tests/unit/commercial-source-boundary.test.ts tests/unit/excluded-scope-public-surface.test.ts
git commit -m "refactor: remove excluded public leave and attendance scope"
```

### Task 2: Make clean database reset and security invariants mandatory

**Files:**
- Create: `supabase/seed.sql`
- Create: `supabase/tests/schema_security_invariants.sql`
- Create: `supabase/tests/audit_immutability.sql`
- Create: `supabase/tests/workflow_transactions.sql`
- Create: `scripts/verify-database-reset.mjs`
- Create: `scripts/verify-database-reset.test.mjs`

**Interfaces:**
- Consumes Plan02's only shared `scripts/environment-guard.mjs` and named DB commands; produces DB invariant verification without creating a second environment guard or redefining package commands.
- Seed creates only deterministic non-production tenant/roles/test identities and is idempotent.

- [ ] **Step 1: Write failing seed-presence and invariant tests**

```js
assert.equal(await exists("supabase/seed.sql"), true);
assert.deepEqual(await tablesMissingRlsOrForce(), []);
assert.equal(await canUpdateAuditAsAuthenticated(), false);
```

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/environment-guard.test.mjs scripts/db-command-runner.test.mjs scripts/verify-database-reset.test.mjs`
Run: `npm run db:reset:test`
Expected: seed file is missing and security invariants report remaining tables.

- [ ] **Step 3: Add safe seed, invariants, and verify script**

Import the Plan02 guard and add seed/invariant assertions only: missing RLS/FORCE RLS/policy/grant/audit constraints fail closed. Do not duplicate target parsing, package command definitions or any DB mutation bypass.

- [ ] **Step 4: Verify GREEN twice for idempotency**

Run: `npm run db:reset:test`
Run: `npm run db:migrate:dry-run`
Run: `npm run db:test`
Run: `npm run db:seed:validate`
Run: `npm run db:rollback:test`
Expected: all safe DB commands pass twice where idempotency applies and all Internal/Production attempts hard-fail before mutation.

- [ ] **Step 5: Commit**

```bash
git add supabase/seed.sql supabase/tests/schema_security_invariants.sql supabase/tests/audit_immutability.sql supabase/tests/workflow_transactions.sql scripts/verify-database-reset.mjs scripts/verify-database-reset.test.mjs
git commit -m "test: require clean database security verification"
```

### Task 3: Add full CI release gates

**Files:**
- Create: `.github/workflows/commercial-ci.yml`
- Create: `scripts/verify-commercial-preflight.mjs`
- Create: `scripts/verify-commercial-preflight.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces preliminary `verify:commercial:preflight` only: `npm ci`, migration dry-run, typecheck, lint, build, unit/coverage, DB/RLS, integration, desktop/emulated-mobile E2E, a11y and scans. It makes no load, delivery-artifact, candidate, Staging or final-evidence claim.
- Task3 changes `package.json` only to expose `verify:commercial:preflight`. Task7 exclusively owns the full-local/final verifier aliases, all verifier/evidence/artifact-validator files, load runner and thresholds.

- [ ] **Step 1: Write failing command-order and failure-propagation tests**

```js
assert.deepEqual(preflightSteps, ["npm-ci", "db-migrate-dry-run", "typecheck", "lint", "build", "unit", "coverage", "db-test-pgtap-rls", "integration", "desktop-e2e", "emulated-mobile-e2e", "a11y", "dependency-scan", "secret-scan"]);
```

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/verify-commercial-preflight.test.mjs`
Expected: the ordered preflight runner/workflow is absent.

- [ ] **Step 3: Implement the workflow and ordered local runner**

CI pins Node version from the repository policy, caches npm only, starts local Supabase, never receives production secrets, uploads Playwright traces on failure, and cancels later steps after the first failure. Implement only the exact preflight list above and its package alias. Task7 later adds candidate manifests, load/artifact validation, authorized Staging and the final verifier.

- [ ] **Step 4: Verify GREEN and validate workflow syntax**

Run: `node --test scripts/verify-commercial-preflight.test.mjs`
Run: `npm run verify:commercial:preflight`
Expected: preflight passes only preliminary checks; Task7 owns full local GREEN.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/commercial-ci.yml scripts/verify-commercial-preflight.mjs scripts/verify-commercial-preflight.test.mjs package.json
git commit -m "ci: add QuantXY commercial release gate"
```

### Task 4: Harden HTTP, container runtime, and readiness

**Files:**
- Modify: `next.config.ts`
- Modify: `src/middleware.ts`
- Create: `supabase/migrations/202608260042_distributed_rate_limits.sql`
- Create: `supabase/tests/distributed_rate_limits.sql`
- Create: `src/features/security/distributed-rate-limit.ts`
- Create: `src/features/security/distributed-rate-limit.test.ts`
- Create: `src/features/security/csrf-origin.ts`
- Create: `src/features/security/csrf-origin.test.ts`
- Create: `docs/operations/waf-evidence.md`
- Create: `scripts/validate-waf-evidence.mjs`
- Create: `scripts/validate-waf-evidence.test.mjs`
- Modify: `src/app/auth/login/feishu/handler.ts`
- Modify: `src/app/auth/login/feishu/route.test.ts`
- Create: `src/app/api/health/ready/route.ts`
- Create: `src/app/api/health/ready/route.test.ts`
- Modify: `Dockerfile`
- Modify: `compose.yaml`
- Create: `docs/operations/container-security.md`

**Interfaces:**
- Produces `/api/health/ready` that checks database reachability, required migration marker, and auth configuration without exposing secret values.
- Adds CSP, HSTS, frame, content-type, referrer and permissions headers.
- Produces a tenant-safe PostgreSQL migration/RPC plus pgTAP-backed distributed persistent tenant/user/IP limiter, login throttle/lockout, CSRF/origin validation and WAF/middleware policy.
- `docs/operations/waf-evidence.md` defines the Staging-owner WAF evidence contract. `scripts/validate-waf-evidence.mjs` and its Node test require `provider`, `rules`, `environment`, `candidate`, `operator`, `timestamps`, `results`, `configHash` (config hash) and `signature`; `node --test scripts/validate-waf-evidence.test.mjs` rejects missing, unsigned or candidate/config-hash-mismatched evidence with `BLOCKED`. Only an explicitly authorized Staging owner may supply this evidence.

- [ ] **Step 1: Write failing readiness and header tests**

```ts
expect((await readyWithDatabaseFailure()).status).toBe(503);
expect((await readyWithOldMigration()).status).toBe(503);
expect(headers["content-security-policy"]).toBeDefined();
expect(await limitAcrossRestart({ tenantId, userId, ip })).toMatchObject({ allowed: false });
expect(await rejectCrossOriginMutation()).toMatchObject({ status: 403 });
expect(await throttleLoginAbuse(ip)).toMatchObject({ status: 429 });
expect(await validateWafEvidence({ provider, rules, environment: "staging", candidate, operator, timestamps, results, configHash, signature })).toMatchObject({ status: "valid" });
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/app/api/health/ready/route.test.ts src/features/security/distributed-rate-limit.test.ts src/features/security/csrf-origin.test.ts`
Run: `npx vitest run src/app/auth/login/feishu/route.test.ts`
Run: `node --test scripts/validate-waf-evidence.test.mjs`
Run: `npm run test:security`
Run: `npm run db:test`
Run: `npm run build`
Run: `docker compose config`
Expected: readiness route is absent and security-header assertion fails.

- [ ] **Step 3: Implement readiness, headers, and runtime restrictions**

Compose uses `read_only`, tmpfs for required writable paths, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, PID/CPU/memory limits, and the new readiness endpoint. Keep non-root runtime. Use the Task4 PostgreSQL migration/RPC as the durable shared limiter backend; test tenant/user/IP isolation, atomic windows, expiry cleanup, multi-instance/restart persistence and lockout recovery. Apply login lockout and CSRF/origin checks before mutations. The authorized Staging owner records the exact WAF provider/rules/config hash and signed test results through the WAF validator; absent, unsigned or mismatched evidence remains `BLOCKED`.

- [ ] **Step 4: Verify GREEN and inspect the built container**

Run: `npx vitest run src/app/api/health/ready/route.test.ts src/features/security/distributed-rate-limit.test.ts src/features/security/csrf-origin.test.ts`
Run: `npx vitest run src/app/auth/login/feishu/route.test.ts`
Run: `node --test scripts/validate-waf-evidence.test.mjs`
Run: `npm run test:security`
Run: `npm run db:test`
Run: `npm run build`
Run: `docker compose config`
Expected: the exact RED commands now pass; tests cover tenant/user/IP isolation, atomic windows, expiry cleanup, multi-instance/restart persistence, login-abuse lockout recovery and CSRF/origin rejection. Readiness fails when DB/migration checks are unhealthy, and WAF evidence is `BLOCKED` unless the Staging-owner record has every signed, hash-matched field.

- [ ] **Step 5: Commit**

```bash
git add next.config.ts src/middleware.ts supabase/migrations/202608260042_distributed_rate_limits.sql supabase/tests/distributed_rate_limits.sql src/features/security src/app/auth/login/feishu src/app/api/health/ready/route.ts src/app/api/health/ready/route.test.ts Dockerfile compose.yaml docs/operations/container-security.md docs/operations/waf-evidence.md scripts/validate-waf-evidence.mjs scripts/validate-waf-evidence.test.mjs
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
- Produces deterministic local identities for owner/admin/supervisor/department_head/employee/hr/finance in two tenants; supervisor is the Plan02 direct-manager scope and is never substituted by owner.
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

Run: `npm run verify:commercial:preflight`
Run: `node scripts/collect-commercial-evidence.mjs`
Expected: preliminary checks pass with zero failed tests, zero forbidden source paths, migration hashes and desktop/emulated-mobile journey artifacts recorded; Task7 owns the full local gate and final commercial verification remains blocked until authorized Staging evidence is present.

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
- Produces exact operator steps and `verify:commercial:staging` evidence contract for a user-authorized isolated Staging run, restore drill and canary; absent authorization/configuration returns `BLOCKED` rather than success.

- [ ] **Step 1: Write the release checklist assertions**

The checklist must require candidate commit/config/migration hashes, separate Staging secrets, demo=false, DB/RLS pass, browser matrix pass, Feishu send/receive evidence, DeepSeek success/failure evidence, Storage evidence, backup ID, restore result, canary result, real-device evidence, RPO/RTO, signed operator attestation and explicit production authorization.

- [ ] **Step 2: Validate that no production action is embedded**

Run: `rg -n "supabase db push|docker compose up -d|ssh |scp |git push" docs/operations/staging-validation-runbook.md docs/operations/recovery-drill-runbook.md`
Expected: commands are presented only under explicit approval gates and no command is executed by this task.

- [ ] **Step 3: Add the exact read-only/preflight and approval boundaries**

Document environment fingerprint checks, database target verification, backup-before-migration, rollback boundary, secret redaction, canary stop/rollback boundary, hashed evidence capture and `BLOCKED` stop conditions when isolated credentials or authorization are unavailable.

- [ ] **Step 4: Verify documentation and repository status**

Run: `git diff --check`
Run: `npm run verify:commercial:preflight`
Expected: documentation has no whitespace errors and the preliminary gate remains green; Staging verification remains an explicit authorized gate.

- [ ] **Step 5: Commit**

```bash
git add docs/operations/staging-validation-runbook.md docs/operations/recovery-drill-runbook.md docs/commercial-database-sop.md
git commit -m "docs: add staging and recovery validation runbooks"
```

### Task 7: Prove commercial acceptance, operational readiness and handoff package

**Files:**
- Modify: `package.json`
- Create: `scripts/verify-commercial-local.mjs`
- Create: `scripts/verify-commercial-staging.mjs`
- Create: `scripts/verify-commercial-evidence.mjs`
- Create: `scripts/verify-commercial-evidence.test.mjs`
- Create: `scripts/verify-commercial.test.mjs`
- Create: `scripts/validate-delivery-artifacts.mjs`
- Create: `scripts/validate-delivery-artifacts.test.mjs`
- Create: `tests/load/commercial-thresholds.yml`
- Create: `tests/load/run-commercial-load.mjs`
- Create: `tests/load/run-commercial-load.test.mjs`
- Create: `docs/operations/commercial-delivery-manifest.md`
- Create: `docs/operations/external-release-manifest.schema.json`
- Create: `docs/operations/architecture.md`
- Create: `docs/operations/database-er.md`
- Create: `docs/operations/data-dictionary.md`
- Create: `docs/operations/permission-matrix.md`
- Create: `docs/operations/feishu-sync-rules.md`
- Create: `docs/operations/openapi.yaml`
- Create: `docs/operations/admin-manual.md`
- Create: `docs/operations/employee-manual.md`
- Create: `docs/operations/import-templates/customers.csv`
- Create: `docs/operations/import-templates/employees.xlsx`
- Create: `docs/operations/deployment-manual.md`
- Create: `docs/operations/backup-restore-manual.md`
- Create: `docs/operations/incident-response.md`
- Create: `docs/operations/release-runbook.md`
- Create: `docs/operations/rollback-runbook.md`
- Create: `docs/operations/security-test-report.md`
- Create: `docs/operations/performance-test-report.md`
- Create: `docs/operations/third-party-services.md`
- Create: `docs/operations/secret-locations.md`
- Create: `docs/operations/third-party-fees.md`
- Create: `docs/operations/known-limitations.md`
- Create: `docs/operations/commercial-acceptance-checklist.md`

**Interfaces:**
- Owns every full-local/final package alias and verifier/evidence/artifact-validator file, including `load:commercial`, `validate:delivery-artifacts`, `verify:commercial:local`, `verify:commercial:staging` and `verify:commercial`; it consumes Plan02's shared DB guard. No command may reset/drop/truncate/seed an Internal or Customer Production target.
- Produces the individually version-linked and hash-listed delivery artifacts named above. The tracked delivery index and external append-only manifest schema are completed and frozen before the Task8 deletion candidate; the manifest maps every artifact to candidate commit, migration hash, author/date, checksum and its validation command; `secret-locations.md` records only location/purpose, never secret values.

- [ ] **Step 1: Write failing environment guard, load and manifest tests**

```js
await assert.rejects(() => runDbCommand({ environment: "internal", command: "db:reset:test" }), /environment_mutation_forbidden/);
expect(loadResult).toMatchObject({ seededStaff: 100, activeUsers: 50, concurrentWrites: 20, queuedAiAgentJobs: 10, nonAiP95Ms: expect.any(Number), errorRate: expect.any(Number), mobileInteractiveMs: expect.any(Number) });
expect(loadResult.nonAiP95Ms).toBeLessThanOrEqual(800);
expect(loadResult.errorRate).toBeLessThan(0.005);
expect(loadResult.mobileInteractiveMs).toBeLessThanOrEqual(3000);
expect(await validateOpenApi("docs/operations/openapi.yaml")).toBe(true);
expect(await validateImportTemplates(["docs/operations/import-templates/customers.csv", "docs/operations/import-templates/employees.xlsx"])).toEqual([]);
expect(await validateRequiredDocumentSections(manifest)).toEqual([]);
expect(await validateChecksumsAndCandidate(manifest)).toEqual({ valid: true });
```

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/verify-commercial.test.mjs scripts/validate-delivery-artifacts.test.mjs tests/load/run-commercial-load.test.mjs`
Expected: `load:commercial` asserts 100 seeded staff, 50 active users, 20 concurrent writes, 10 queued AI/Agent jobs, non-AI P95 <=800ms, error <0.5% and mobile interactive <=3s; every OpenAPI/CSV/XLSX/template/document section/artifact checksum and candidate version is valid.
Run: `npm run verify:commercial:local`
Expected: full evidence aggregation, artifact-hash validation and commercial thresholds are not yet fully enforced.

- [ ] **Step 3: Implement guarded verification and operational preparation**

Consume the Plan02 guard; require reviewed forward migration, backup, dry run, resumable/observable batch backfill, integrity count and repair/rollback record. Wire CSRF/XSS/CSP/security headers, login/rate-limit tests, dependency/secret scans, unit/coverage/build/RLS/integration/desktop/mobile/a11y E2E, and load thresholds (100 staff, 50 active, 20 concurrent writes, 10 queued AI/Agent, non-AI P95 <=800ms, error rate <0.5%, mobile P95 interactive <=3s). Fill every individual artifact, validate OpenAPI, CSV/XLSX templates, required document sections and checksum/candidate linkage in the manifest. Freeze the tracked delivery index and create the external append-only manifest schema before Task8. Require automatic backup/restore evidence for RPO <=24h and RTO <=4h, monitoring/alerts, Staging smoke, canary, runbooks, 7-day observation, handoff/training and import templates.

- [ ] **Step 4: Verify GREEN in permitted environments**

Run: `npm ci`
Run: `npm run verify:commercial:local`
Run: `git diff --check`
Expected: Local/CI verification proves local commands and artifact completeness; `verify:commercial:staging` and final `verify:commercial` are BLOCKED until signed/hash-matched Staging smoke/canary, restore, RPO/RTO and real-device/OAuth/Storage/security evidence exists. Internal/Customer Production remains untouched without explicit authorization.

- [ ] **Step 5: Commit**

```bash
git add package.json scripts/verify-commercial-local.mjs scripts/verify-commercial-staging.mjs scripts/verify-commercial-evidence.mjs scripts/verify-commercial-evidence.test.mjs scripts/verify-commercial.test.mjs scripts/validate-delivery-artifacts.mjs scripts/validate-delivery-artifacts.test.mjs tests/load docs/operations
git commit -m "docs: add commercial operations and acceptance package"
```

### Task 8: Retire fused assets only after authorized evidence closure

**Files:**
- Delete: `src/app/quantxy-ai-workbench-fused.html/route.ts`
- Delete: `src/app/quantxy-ai-workbench-fused.html/route-support.ts`
- Delete: `src/app/quantxy-ai-workbench-fused.html/route.test.ts`
- Delete: `quantxy-ai-workbench-fused.html`
- Delete: `public/workstation-server-adapter.js`
- Modify: `tests/unit/commercial-source-boundary.test.ts`

**Interfaces:**
- Consumes the Task7-frozen tracked delivery index and external append-only manifest schema. The authorization binds a non-self-referential prospective deletion patch/tree digest; the tracked index is frozen before the candidate and is never changed in this task. Fused presence/reachability always makes final `verify:commercial` BLOCKED.

- [ ] **Step 1: Write failing retirement-authorization tests**

```ts
expect(await assertFusedRetirementEvidence({ authorization: null })).toMatchObject({ status: "BLOCKED" });
expect(await assertFusedRetirementEvidence({ canary: "failed" })).toMatchObject({ status: "BLOCKED" });
expect(await assertFusedRetirementEvidence({ prospectiveTreeHash, stagingTreeHash: "other" })).toMatchObject({ status: "BLOCKED" });
expect(await verifyCommercial({ fusedPresent: true })).toMatchObject({ status: "BLOCKED" });
```

Run: `node --test scripts/verify-commercial-evidence.test.mjs scripts/verify-commercial.test.mjs`
Run: `npx vitest run tests/unit/commercial-source-boundary.test.ts`
Expected: `fusedPresent => BLOCKED` and authorization/evidence mismatch cases fail before any deletion.

- [ ] **Step 2: Verify BLOCKED before deletion**

Run: `npm run verify:commercial`
Expected: `commercial_evidence_blocked` until prospective digest authorization, parity/data validation, rollback and pre-retirement evidence are present.

- [ ] **Step 3: Delete fused assets only after evidence and explicit authorization**

Record authorization against prospective digest, apply deletion and create the immutable candidate now:

```bash
git add -A -- src/app/quantxy-ai-workbench-fused.html quantxy-ai-workbench-fused.html public/workstation-server-adapter.js
git add tests/unit/commercial-source-boundary.test.ts
git commit -m "refactor: retire authorized fused workstation"
```

Retain historical DB/migrations and update source-boundary verifier to require no fused reachability.

- [ ] **Step 4: Collect final-commit external evidence, then verify**

Only after the immutable deletion-candidate commit exists, submit its exact commit/tree digest to the authorized Staging process and collect fresh external final-commit Staging/canary evidence through the Task7 schema.

Run: `npm run verify:commercial:local`
Run: `npm run verify:commercial:staging`
Run: `npm run verify:commercial`
Expected: final succeeds only after post-deletion local/source-boundary plus fresh final-commit Staging/canary evidence are hash-bound; otherwise remains BLOCKED.

- [ ] **Step 5: Report external result; do not commit tracked files**

Record only the external append-only manifest result/signature and report it; no tracked commit follows final evidence.
