# QuantXY Organization and People Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a real Feishu-backed organization directory with private employee data, role management, work profiles, and skills.

**Architecture:** Feishu remains the authoritative directory source; QuantXY stores synchronized identities and organization facts while owning roles, permissions, work profiles, and skill verification. Next.js pages read server repositories and mutations use tenant-scoped RPCs.

**Tech Stack:** Next.js 15.5, TypeScript, Supabase Auth/PostgreSQL, Feishu OpenAPI adapter, Vitest, pgTAP, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-26-quantxy-commercial-completion-design.md`

## Global Constraints

- Depends on Plan 01 module capabilities and permissions.
- Do not implement leave or attendance.
- Feishu-owned identity fields are read-only in QuantXY.
- Private PII is self/HR/admin only.
- No production deployment or production synchronization.

---

### Task 1: Establish the shared fail-closed environment and database command guard

**Files:**
- Create: `scripts/environment-guard.mjs`
- Create: `scripts/environment-guard.test.mjs`
- Create: `scripts/db-command-runner.mjs`
- Create: `scripts/db-command-runner.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces `assertSafeDatabaseTarget({ command, environment, databaseUrl }): EnvironmentFingerprint`; `unknown`, `internal` and `production` always throw `environment_mutation_forbidden` before opening a DB connection.
- Produces exactly `db:reset:test`, `db:migrate:dry-run`, `db:test`, `db:seed:validate`, `db:rollback:test`; Local/CI-Test may mutate only their isolated target, while Staging accepts only its explicit non-destructive validation context.

- [ ] **Step 1: Write failing fail-closed command tests**

```js
await assert.rejects(() => runDbCommand({ command: "db:reset:test", environment: "unknown" }), /environment_mutation_forbidden/);
await assert.rejects(() => runDbCommand({ command: "db:test", environment: "production" }), /environment_mutation_forbidden/);
await assert.rejects(() => runDbCommand({ command: "db:seed:validate", environment: "internal" }), /environment_mutation_forbidden/);
```

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/environment-guard.test.mjs scripts/db-command-runner.test.mjs`
Expected: the common guard and safe named commands do not exist.

- [ ] **Step 3: Implement the one shared guard and package commands**

Parse an explicit environment marker plus URL/host fingerprint. Reject unknown, Internal and Customer Production before invoking Supabase/PostgreSQL tools; do not infer safety from a name alone. Permit only isolated Local/CI-Test reset/seed/rollback and an explicitly non-mutating Staging dry run. All later plans consume these commands and must not create another environment guard.

- [ ] **Step 4: Verify GREEN**

Run: `node --test scripts/environment-guard.test.mjs scripts/db-command-runner.test.mjs`
Run: `npm run db:migrate:dry-run`
Run: `npm run db:test`
Expected: safe Local/CI-Test commands work; unknown/Internal/Production hard-fail before mutation.

- [ ] **Step 5: Commit**

```bash
git add scripts/environment-guard.mjs scripts/environment-guard.test.mjs scripts/db-command-runner.mjs scripts/db-command-runner.test.mjs package.json
git commit -m "test: add fail-closed database command guard"
```

### Task 2: Split public directory data from private employee PII

**Files:**
- Create: `supabase/migrations/202608260005_employee_private_profiles.sql`
- Create: `supabase/tests/employee_privacy.sql`
- Modify: `src/features/hr/employee-types.ts`
- Modify: `src/features/hr/employee-data.ts`
- Modify: `src/features/hr/employee-data.test.ts`

**Interfaces:**
- Produces view/RPC `current_employee_directory()` with name, avatar, department, title, status.
- Produces RPC `current_employee_private_profile(employee_public_id uuid)` for self/HR/admin fields.

- [ ] **Step 1: Write failing public/private projection tests**

```ts
expect(directoryEmployee).not.toHaveProperty("phone");
expect(directoryEmployee).not.toHaveProperty("departureDate");
expect(hrPrivateEmployee.phone).toBe("13800000000");
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/hr/employee-data.test.ts`
Run: `npm run db:test`
Expected: current directory projection includes private fields and broad RLS permits access.

- [ ] **Step 3: Add the private table/projection and repositories**

Move phone, private email, hire/departure dates and sensitive HR notes into the private profile or protected RPC result. Preserve foreign keys to the public employee row.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/hr/employee-data.test.ts`
Run: `npm run db:test`
Expected: employee sees public directory only; self and HR cases pass; unrelated employee reads zero private rows.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260005_employee_private_profiles.sql supabase/tests/employee_privacy.sql src/features/hr/employee-types.ts src/features/hr/employee-data.ts src/features/hr/employee-data.test.ts
git commit -m "security: isolate employee private profiles"
```

### Task 3: Make Feishu directory synchronization fail closed and observable

**Files:**
- Modify: `src/features/feishu/directory-sync.test.ts`
- Modify: `src/features/feishu/directory-sync.ts`
- Modify: `src/app/api/workstation/directory-sync/handler.test.ts`
- Modify: `src/app/api/workstation/directory-sync/handler.ts`
- Create: `tests/e2e/directory-sync.spec.ts`

**Interfaces:**
- Produces `DirectorySyncResult { runId, status, departmentCount, employeeCount, issueCount }`.
- Pagination limit exhaustion throws `directory_pagination_limit` and leaves prior complete snapshot active.

- [ ] **Step 1: Write failing pagination and snapshot-preservation tests**

```ts
await expect(syncDirectory({ fetchPage: endlessPager, maxPages: 1000 })).rejects.toMatchObject({ code: "directory_pagination_limit" });
expect(markSnapshotComplete).not.toHaveBeenCalled();
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/feishu/directory-sync.test.ts src/app/api/workstation/directory-sync/handler.test.ts`
Expected: the endless pager is currently accepted as a complete snapshot.

- [ ] **Step 3: Implement failure state, request ID, and issue counts**

Persist run `failed`, append a synchronization issue, preserve the previous complete snapshot, and return a stable API error.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/feishu/directory-sync.test.ts src/app/api/workstation/directory-sync/handler.test.ts`
Expected: limit exhaustion fails closed and normal pagination still completes.

- [ ] **Step 5: Commit**

```bash
git add src/features/feishu/directory-sync.test.ts src/features/feishu/directory-sync.ts src/app/api/workstation/directory-sync/handler.test.ts src/app/api/workstation/directory-sync/handler.ts tests/e2e/directory-sync.spec.ts
git commit -m "fix: make directory synchronization fail closed"
```

### Task 4: Add department, position, and role commands

**Files:**
- Create: `supabase/migrations/202608260006_organization_commands.sql`
- Create: `supabase/tests/organization_commands.sql`
- Create: `src/features/organization/organization-command-types.ts`
- Create: `src/features/organization/organization-command-handler.ts`
- Create: `src/features/organization/organization-command-handler.test.ts`
- Create: `src/app/api/workstation/organization/route.ts`
- Create: `src/app/api/workstation/organization/roles/route.ts`

**Interfaces:**
- Produces RPCs `create_current_department`, `update_current_department`, `upsert_current_position`, `assign_current_member_role`.
- Produces commands with `version` and `idempotencyKey` fields.

- [ ] **Step 1: Write failing command authorization tests**

```ts
expect((await handleOrganizationCommand(employeeRequest)).status).toBe(403);
expect((await handleOrganizationCommand(adminRequest)).status).toBe(201);
expect(rpc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ request_id: expect.any(String) }));
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/organization/organization-command-handler.test.ts`
Expected: command handler does not exist.

- [ ] **Step 3: Implement validated handlers and audited RPCs**

All RPCs derive tenant/org/actor through `auth.uid()`, reject Feishu-owned field mutation, enforce `organization.manage` or `role.manage`, and append audit rows.

- [ ] **Step 4: Verify GREEN and database transactions**

Run: `npx vitest run src/features/organization/organization-command-handler.test.ts`
Run: `npm run db:test`
Expected: employee is denied, admin succeeds, cross-tenant IDs return not-found, and role changes are audited.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260006_organization_commands.sql supabase/tests/organization_commands.sql src/features/organization/organization-command-types.ts src/features/organization/organization-command-handler.ts src/features/organization/organization-command-handler.test.ts src/app/api/workstation/organization/route.ts src/app/api/workstation/organization/roles/route.ts
git commit -m "feat: add audited organization commands"
```

### Task 5: Secure work-profile updates and add skill verification

**Files:**
- Modify: `src/app/api/workstation/work-profile/handler.test.ts`
- Modify: `src/app/api/workstation/work-profile/handler.ts`
- Create: `supabase/migrations/202608260007_skill_verification_commands.sql`
- Modify: `supabase/tests/organization_commands.sql`
- Create: `src/app/api/workstation/skills/[skillId]/verify/route.ts`
- Create: `src/features/work-profile/skill-verification.test.ts`

**Interfaces:**
- Work-profile lookup requires session tenant/org plus current member.
- Produces RPC `verify_current_employee_skill(skill_public_id uuid, decision text, reason text, request_id uuid)`.

- [ ] **Step 1: Write failing cross-tenant and verifier-permission tests**

```ts
expect((await updateWorkProfile(crossTenantProfileRequest)).status).toBe(404);
expect((await verifySkill(employeeRequest)).status).toBe(403);
expect((await verifySkill(hrRequest)).status).toBe(200);
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/app/api/workstation/work-profile/handler.test.ts src/features/work-profile/skill-verification.test.ts`
Expected: cross-tenant scope is not explicit and verification route is missing.

- [ ] **Step 3: Implement composite scope and verification RPC**

Resolve the current profile from session only. Skill verification records verifier, decision, reason, timestamp, old state, new state, and request ID.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/app/api/workstation/work-profile/handler.test.ts src/features/work-profile/skill-verification.test.ts`
Run: `npm run db:test`
Expected: self update persists; cross-tenant overwrite fails; authorized verification is audited.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/workstation/work-profile/handler.test.ts src/app/api/workstation/work-profile/handler.ts supabase/migrations/202608260007_skill_verification_commands.sql supabase/tests/organization_commands.sql src/app/api/workstation/skills/[skillId]/verify/route.ts src/features/work-profile/skill-verification.test.ts
git commit -m "feat: secure profiles and verify employee skills"
```

### Task 6: Replace the Next people empty shell with real responsive pages

**Files:**
- Modify: `src/app/(workspace)/people/page.tsx`
- Modify: `src/features/hr/people-workspace.tsx`
- Modify: `src/features/hr/people-page.test.tsx`
- Modify: `src/features/hr/employee-detail-page.tsx`
- Modify: `src/features/hr/employee-detail-page.test.tsx`
- Create: `src/features/organization/organization-dialogs.tsx`
- Modify: `tests/e2e/people.spec.ts`

**Interfaces:**
- Consumes public/private repositories and organization commands from Tasks 2-5; Task8 extends this UI with manager/supervisor capabilities and cross-department E2E coverage.
- Produces server-backed list/detail UI with desktop table and mobile cards.

- [ ] **Step 1: Write failing real-session rendering tests**

```tsx
render(<PeopleWorkspace result={realDirectoryResult} session={employeeSession} />);
expect(screen.getByText("工程部")).toBeInTheDocument();
expect(screen.queryByText("13800000000")).not.toBeInTheDocument();
expect(screen.queryByText(/演示/)).not.toBeInTheDocument();
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/hr/people-page.test.tsx src/features/hr/employee-detail-page.test.tsx`
Expected: non-fixture sessions are currently forced to an empty result.

- [ ] **Step 3: Render real repositories and permission-aware commands**

Remove fixture gating. Desktop uses directory table/detail panel; mobile uses employee cards/full-screen detail. Show sync/department/role actions only when server capability allows them.

- [ ] **Step 4: Verify GREEN and responsive E2E contract**

Run: `npx vitest run src/features/hr/people-page.test.tsx src/features/hr/employee-detail-page.test.tsx`
Run: `npx playwright test tests/e2e/people.spec.ts --project=chrome`
Expected: real local DB data survives refresh; private fields remain hidden from employee.

- [ ] **Step 5: Commit**

```bash
git add 'src/app/(workspace)/people/page.tsx' src/features/hr/people-workspace.tsx src/features/hr/people-page.test.tsx src/features/hr/employee-detail-page.tsx src/features/hr/employee-detail-page.test.tsx src/features/organization/organization-dialogs.tsx tests/e2e/people.spec.ts
git commit -m "feat: connect the people workspace to real data"
```

### Task 7: Complete Feishu OAuth and resilient directory synchronization

**Files:**
- Create: `supabase/migrations/202608260034_feishu_sync_control.sql`
- Create: `supabase/tests/feishu_sync_control.sql`
- Modify: `src/app/auth/login/feishu/handler.ts`
- Modify: `src/app/auth/login/feishu/route.ts`
- Modify: `src/app/auth/login/feishu/route.test.ts`
- Modify: `src/app/auth/callback/route.ts`
- Modify: `src/app/auth/callback/route.test.ts`
- Modify: `src/features/feishu/directory-sync.ts`
- Create: `src/features/feishu/directory-sync-worker.ts`
- Create: `src/features/feishu/directory-sync-worker.test.ts`
- Create: `src/app/api/workstation/feishu/webhook/route.ts`
- Create: `src/app/api/workstation/feishu/webhook/route.test.ts`
- Create: `src/app/(workspace)/people/sync-issues/page.tsx`

**Interfaces:**
- Produces `startFeishuFullSync`, `resumeFeishuIncrementalSync(cursor)` and `reconcileFeishuDirectory` with `{ runId, cursor, status, retryAfter }`.
- Extends the canonical `/auth/login/feishu` and `/auth/callback` flow; produces signed webhook persistence keyed by provider event ID, an out-of-order sequence guard, scheduled reconciliation worker/cron, and `revokeDepartedMemberAccess(memberPublicId, eventId)`.

- [ ] **Step 1: Write failing OAuth, webhook, move/offboarding and reconciliation tests**

```ts
expect(await handleUnsignedWebhook(event)).toMatchObject({ status: 401 });
expect(await deliverEventTwice(event)).toMatchObject({ applied: 1 });
expect(await memberAfterOffboarding(event)).toMatchObject({ access: "revoked" });
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/app/auth/login/feishu src/app/auth/callback src/features/feishu src/app/api/workstation/feishu`
Run: `npm run db:test`
Expected: OAuth/webhook control state, conflict UI and revocation path are absent.

- [ ] **Step 3: Implement controlled OAuth and synchronization lifecycle**

Use the isolated environment's Feishu app only. Extend the canonical login/callback routes rather than creating a parallel callback. Persist OAuth state/nonce, cursor, attempts, backoff, failures and reconciliation differences; reject invalid signatures, dedupe events, order by provider sequence, and run scheduled incremental/full reconciliation. Audit department move, transfer, conflict resolution and immediate departure revoke; revoke active Session, refresh token and queued access grants in the same offboarding transaction. Keep Feishu-owned fields read-only while showing a manager-authorized conflict resolution UI.

- [ ] **Step 4: Verify GREEN in Local and authorized Staging**

Run: `npx vitest run src/app/auth/login/feishu src/app/auth/callback src/features/feishu src/app/api/workstation/feishu`
Run: `npm run db:test`
Run: `npx playwright test tests/e2e/directory-sync.spec.ts --project=chrome`
Expected: Local uses synthetic identities through the real adapter/persistence path; Staging verification is blocked pending isolated OAuth/webhook credentials, never production credentials.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260034_feishu_sync_control.sql supabase/tests/feishu_sync_control.sql src/app/auth/login/feishu src/app/auth/callback src/features/feishu src/app/api/workstation/feishu 'src/app/(workspace)/people/sync-issues/page.tsx' tests/e2e/directory-sync.spec.ts
git commit -m "feat: add resilient Feishu OAuth directory sync"
```

### Task 8: Add direct-manager mapping and a distinct supervisor scope

**Files:**
- Create: `supabase/migrations/202608260041_manager_supervisor_scope.sql`
- Modify: `supabase/tests/organization_commands.sql`
- Modify: `src/features/auth/workspace-session-types.ts`
- Modify: `src/features/auth/workspace-access.ts`
- Create: `src/features/organization/manager-scope-handler.ts`
- Create: `src/features/organization/manager-scope-handler.test.ts`
- Create: `src/app/api/workstation/organization/members/[memberId]/manager/route.ts`
- Modify: `tests/e2e/people.spec.ts`

**Interfaces:**
- Produces a nullable direct-manager foreign key and `supervisor` role/scope, distinct from `employee`, `department_head`, `hr`, `finance`, `admin` and `owner`.
- Produces `canReadSupervisorScope(session, memberPublicId)` and audited `assignCurrentMemberManager(memberPublicId, managerPublicId, expectedVersion, requestId)`; RLS enforces direct-report/department scope and rejects cross-department enumeration.

- [ ] **Step 1: Write failing role and cross-department scope tests**

```ts
expect(await assignManager(crossDepartmentSupervisor)).toMatchObject({ status: 403 });
expect(await readDirectReport(supervisorSession)).toMatchObject({ status: 200 });
expect(await readPeerInOtherDepartment(supervisorSession)).toMatchObject({ status: 404 });
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/organization/manager-scope-handler.test.ts src/features/auth/workspace-access.test.ts`
Run: `npm run db:test`
Expected: direct-manager mapping and a distinct supervisor scope do not exist.

- [ ] **Step 3: Implement database, session, API and RLS scope**

Add tenant/org-safe manager FK constraints, roles and policies. Map direct manager from Feishu synchronization but retain an audited conflict-safe command. Do not substitute owner/admin for supervisor; API/session capabilities and all queries enforce the declared scope.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/organization src/features/auth`
Run: `npm run db:test`
Run: `npx playwright test tests/e2e/people.spec.ts --project=chrome`
Expected: employee, supervisor, department head, HR, finance, admin and owner behave distinctly; cross-tenant and cross-department reads fail.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260041_manager_supervisor_scope.sql supabase/tests/organization_commands.sql src/features/auth src/features/organization src/app/api/workstation/organization/members tests/e2e/people.spec.ts
git commit -m "feat: add direct manager and supervisor scope"
```
