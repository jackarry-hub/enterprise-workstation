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
- Create: `scripts/phase-gates.mjs`
- Create: `scripts/phase-gates.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces `assertSafeDatabaseTarget({ command, environment, databaseUrl }): EnvironmentFingerprint`; `unknown`, `internal` and `production` always throw `environment_mutation_forbidden` before opening a DB connection.
- Produces exactly `db:reset:test`, `db:migrate:dry-run`, `db:test`, `db:seed:validate`, `db:rollback:test`, `test:coverage`, `test:security`, `test:rls`; removes/disables raw `db:reset` and tests its absence. Local/CI-Test may mutate only isolated targets while Staging accepts only explicit non-destructive validation.

- [ ] **Step 1: Write failing fail-closed command tests**

```js
await assert.rejects(() => runDbCommand({ command: "db:reset:test", environment: "unknown" }), /environment_mutation_forbidden/);
await assert.rejects(() => runDbCommand({ command: "db:test", environment: "production" }), /environment_mutation_forbidden/);
await assert.rejects(() => runDbCommand({ command: "db:seed:validate", environment: "internal" }), /environment_mutation_forbidden/);
await assert.rejects(() => runDbCommand({ command: "db:reset:test", environment: "local", databaseUrl: "https://prod.example" }), /environment_mutation_forbidden/);
await assert.rejects(() => runDbCommand({ command: "db:reset:test", environment: "staging" }), /environment_mutation_forbidden/);
await assert.rejects(() => runDbCommand({ command: "db:seed:validate", environment: "staging" }), /environment_mutation_forbidden/);
assert.equal(await packageHasScript("db:reset"), false);
```

- [ ] **Step 2: Verify RED**

Run: `node --test scripts/environment-guard.test.mjs scripts/db-command-runner.test.mjs scripts/phase-gates.test.mjs`
Expected: the common guard and safe named commands do not exist.

- [ ] **Step 3: Implement the one shared guard and package commands**

Parse explicit marker plus URL/host fingerprint; a spoofed `local` marker with remote/production URL, unknown, Internal and Customer Production must fail before any connection. Remove raw `db:reset`; implement and test coverage/security/RLS aliases as shared phase scripts. All later plans consume these commands and must not create another guard.

- [ ] **Step 4: Verify GREEN**

Run: `node --test scripts/environment-guard.test.mjs scripts/db-command-runner.test.mjs scripts/phase-gates.test.mjs`
Run: `npm run test:coverage`
Run: `npm run test:security`
Run: `npm run test:rls`
Run: `npm run db:migrate:dry-run`
Run: `npm run db:test`
Expected: safe Local/CI-Test commands work; unknown/Internal/Production hard-fail before mutation.

- [ ] **Step 5: Commit**

```bash
git add scripts/environment-guard.mjs scripts/environment-guard.test.mjs scripts/db-command-runner.mjs scripts/db-command-runner.test.mjs scripts/phase-gates.mjs scripts/phase-gates.test.mjs package.json
git commit -m "test: add fail-closed database command guard"
```

### Task 2: Split public directory data from private employee PII

**Files:**
- Create: `supabase/migrations/202608260010_employee_private_profiles.sql`
- Create: `supabase/tests/employee_privacy.sql`
- Modify: `src/features/hr/employee-types.ts`
- Modify: `src/features/hr/employee-data.ts`
- Modify: `src/features/hr/employee-data.test.ts`
- Modify: `src/features/hr/employee-privacy-migration.test.ts`
- Modify: `src/features/payroll-calculation/server-service.ts`
- Modify: `src/features/payroll-calculation/server-service.test.ts`

**Interfaces:**
- Produces view/RPC `current_employee_directory()` with name, avatar, department, title, status.
- Produces RPC `current_employee_private_profile(employee_public_id uuid)` for self/HR/admin fields.
- Produces salary-manager-only RPC `current_payroll_employee_facts(...)` for the minimum hire-date facts required by payroll calculation, scoped from the authenticated tenant/organization instead of reopening private table columns.
- Browser-authenticated roles receive no direct `INSERT`/`UPDATE` privilege on `employee_profiles`; Feishu-owned directory facts use controlled synchronization/RPCs, while self-managed work-profile content persists only in `employee_work_profiles`.

- [ ] **Step 1: Write failing public/private projection tests**

```ts
expect(directoryEmployee).not.toHaveProperty("phone");
expect(directoryEmployee).not.toHaveProperty("departureDate");
expect(hrPrivateEmployee.phone).toBe("13800000000");
expect(client.rpc).toHaveBeenCalledWith("current_payroll_employee_facts", { p_employee_member_id: employeeMemberId });
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/hr/employee-data.test.ts src/features/payroll-calculation/server-service.test.ts`
Run: `npm run db:test`
Expected: current directory projection includes private fields and the authenticated payroll repository cannot read protected hire-date data through its current direct table query.

- [ ] **Step 3: Add the private table/projection and repositories**

Move phone, private email, hire/departure dates and sensitive HR notes into the private profile or protected RPC result. Preserve foreign keys to the public employee row. Revoke browser-authenticated writes to every public employee-directory column so identity, lifecycle, department, position, manager and job facts cannot bypass the Feishu/offboarding transaction. Route payroll hire-date reads through a SECURITY DEFINER RPC that derives the current tenant/actor organization, requires `salary.manage`, and returns only the requested member facts needed for calculation; ordinary employees and cross-organization targets receive no data.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/hr/employee-data.test.ts src/features/payroll-calculation/server-service.test.ts`
Run: `npm run db:test`
Expected: employee sees public directory only; self and HR cases pass; unrelated employee reads zero private rows; authorized payroll calculation still resolves hire date while ordinary/cross-organization callers cannot.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260010_employee_private_profiles.sql supabase/tests/employee_privacy.sql src/features/hr/employee-types.ts src/features/hr/employee-data.ts src/features/hr/employee-data.test.ts src/features/payroll-calculation/server-service.ts src/features/payroll-calculation/server-service.test.ts
git commit -m "security: isolate employee private profiles"
```

### Task 3: Make Feishu directory synchronization fail closed and observable

**Files:**
- Create: `supabase/migrations/202608260048_directory_sync_observability.sql`
- Create: `supabase/tests/directory_sync_observability.sql`
- Create: `src/features/feishu/directory-sync-observability-migration.test.ts`
- Modify: `src/features/feishu/directory-sync.test.ts`
- Modify: `src/features/feishu/directory-sync.ts`
- Modify: `src/app/api/workstation/directory-sync/handler.test.ts`
- Modify: `src/app/api/workstation/directory-sync/handler.ts`
- Create: `tests/e2e/directory-sync.spec.ts`

**Interfaces:**
- Produces `DirectorySyncResult { runId, status, departmentCount, employeeCount, issueCount }`.
- Produces service-only tenant-scoped RPCs `apply_feishu_directory_sync_observed(...)` and `record_feishu_directory_sync_failure(...)`; neither browser-authenticated roles nor direct table writes may manufacture run evidence.
- Pagination uses one bounded budget across the entire synchronization, rejects missing or repeated page tokens, throws stable `directory_pagination_limit`, and leaves the prior complete snapshot active.
- Every success and failure returns or records one immutable public run ID. Failed API responses include the same non-secret request ID in the body and `x-request-id` header; raw provider/database details are never returned or persisted.

- [ ] **Step 1: Write failing pagination and snapshot-preservation tests**

```ts
await expect(syncDirectory({ fetchPage: endlessPager, maxPages: 1000 })).rejects.toMatchObject({ code: "directory_pagination_limit" });
expect(markSnapshotComplete).not.toHaveBeenCalled();
expect(recordFailure).toHaveBeenCalledWith(expect.objectContaining({ code: "directory_pagination_limit", requestId: expect.any(String) }));
expect(response.headers.get("x-request-id")).toBe((await response.json()).requestId);
```

Add pgTAP cases proving failed runs and sanitized issues are persisted through the service-only command, authenticated execution/direct inserts are denied, and the prior successful connection timestamp plus directory entity links remain unchanged.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/feishu/directory-sync.test.ts src/features/feishu/directory-sync-observability-migration.test.ts src/app/api/workstation/directory-sync/handler.test.ts`
Run: `npm run db:test`
Expected: the endless pager is currently accepted as a complete snapshot and there is no durable service-only failure command.

- [ ] **Step 3: Implement failure state, request ID, and issue counts**

Use migration `202608260048` because `011` through `047` are already reserved by Plans 02-10. Wrap the existing successful apply RPC under `apply_feishu_directory_sync_observed(...)` so the same transaction/advisory lock returns the exact public run ID and issue count. Add `record_feishu_directory_sync_failure(...)` as a separate SECURITY DEFINER transaction that derives tenant/organization/actor/provider, takes the tenant directory lock, creates a `failed`/`snapshot_complete=false` run, appends one allowlisted issue plus audit event, and never mutates entity links or the last successful snapshot marker. Explicitly revoke both RPCs from PUBLIC/anon/authenticated and grant only service_role.

Implement typed synchronization errors, one global page budget, repeated-token detection and request ID propagation. The handler records a sanitized failure after snapshot-fetch or apply failure, but if failure recording itself fails it still returns the stable API error and logs only the request ID/error class. Never apply a partial snapshot and never expose Feishu/database messages.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/feishu/directory-sync.test.ts src/features/feishu/directory-sync-observability-migration.test.ts src/app/api/workstation/directory-sync/handler.test.ts`
Run: `npm run db:test`
Run: `npx playwright test tests/e2e/directory-sync.spec.ts`
Expected: limit exhaustion fails closed with one durable failed run/issue, the previous complete snapshot remains active, and normal pagination returns the exact completed run ID and counts.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260048_directory_sync_observability.sql supabase/tests/directory_sync_observability.sql src/features/feishu/directory-sync-observability-migration.test.ts src/features/feishu/directory-sync.test.ts src/features/feishu/directory-sync.ts src/app/api/workstation/directory-sync/handler.test.ts src/app/api/workstation/directory-sync/handler.ts tests/e2e/directory-sync.spec.ts
git commit -m "fix: make directory synchronization fail closed"
```

### Task 4: Add department, position, and role commands

**Files:**
- Create: `supabase/migrations/202608260011_organization_commands.sql`
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
git add supabase/migrations/202608260011_organization_commands.sql supabase/tests/organization_commands.sql src/features/organization/organization-command-types.ts src/features/organization/organization-command-handler.ts src/features/organization/organization-command-handler.test.ts src/app/api/workstation/organization/route.ts src/app/api/workstation/organization/roles/route.ts
git commit -m "feat: add audited organization commands"
```

### Task 5: Secure work-profile updates and add skill verification

**Files:**
- Modify: `src/app/api/workstation/work-profile/handler.test.ts`
- Modify: `src/app/api/workstation/work-profile/handler.ts`
- Create: `supabase/migrations/202608260012_skill_verification_commands.sql`
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
git add src/app/api/workstation/work-profile/handler.test.ts src/app/api/workstation/work-profile/handler.ts supabase/migrations/202608260012_skill_verification_commands.sql supabase/tests/organization_commands.sql src/app/api/workstation/skills/[skillId]/verify/route.ts src/features/work-profile/skill-verification.test.ts
git commit -m "feat: secure profiles and verify employee skills"
```

### Task 6: Replace the Next people empty shell with real responsive pages

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `vitest.config.mts`
- Modify: `supabase/migrations/202608260010_employee_private_profiles.sql`
- Create: `supabase/migrations/202608270001_employee_rpc_session_scope.sql`
- Modify: `supabase/tests/employee_privacy.sql`
- Modify: `src/app/(workspace)/people/page.tsx`
- Modify: `src/app/(workspace)/people/[id]/page.tsx`
- Modify: `src/features/hr/people-page.tsx`
- Modify: `src/features/hr/people-workspace.tsx`
- Modify: `src/features/hr/employee-data.ts`
- Modify: `src/features/hr/employee-data.test.ts`
- Modify: `src/features/hr/employee-privacy-migration.test.ts`
- Modify: `src/features/hr/components/employee-filters.tsx`
- Modify: `src/features/hr/components/employee-stats.tsx`
- Modify: `src/features/hr/components/employee-detail-header.tsx`
- Modify: `src/features/commercial/module-capabilities.ts`
- Modify: `src/features/commercial/module-capabilities.test.ts`
- Modify: `src/features/auth/server-route-access.test.ts`
- Modify: `src/features/auth/route-policy.test.ts`
- Create: `src/features/organization/organization-command-data.ts`
- Create: `src/features/organization/organization-command-data.test.ts`
- Create: `src/features/organization/organization-dialogs.test.tsx`
- Create: `src/features/work-profile/skill-verification-handler.ts`
- Modify: `src/app/api/workstation/skills/[skillId]/verify/route.ts`
- Modify: `src/features/work-profile/skill-verification.test.ts`
- Modify: `tests/unit/phase1-e2e-real-session-contract.test.ts`
- Modify: `src/components/shell/workspace-search-dialog.test.tsx`
- Modify: `src/app/(workspace)/sensitive-routes.test.tsx`
- Modify: `src/features/hr/people-page.test.tsx`
- Modify: `src/features/hr/employee-detail-page.tsx`
- Modify: `src/features/hr/employee-detail-page.test.tsx`
- Create: `src/features/organization/organization-dialogs.tsx`
- Modify: `tests/e2e/people.spec.ts`

**Interfaces:**
- Consumes public/private repositories and organization commands from Tasks 2-5; Task8 extends this UI with manager/supervisor capabilities and cross-department E2E coverage.
- Produces server-backed list/detail UI with desktop table and mobile cards.
- The list route must always pass an explicit repository result; the detail route must resolve the public directory item and the capability-scoped private profile through the dedicated repositories. Both RPCs receive the verified session organization public ID, but the database must accept it only when the active `external_identities` row for `auth.uid()` binds to that exact organization and linked active member. A second membership for the same user in the same tenant is not an alternate selectable session organization and must never appear or reveal PII. Deliver this final contract in a later forward-only migration that explicitly revokes/drops legacy signatures and recreates the secured signatures; do not rely on mutating an already-applied numbered migration. Neither route nor component may gate real identities through the fixture compatibility adapter or fall back to mock employees, including under `NODE_ENV=development`.
- Marks only the completed `people` module as commercial-ready. Every active authenticated workspace member may enter the safe public directory because the repository RPC itself enforces tenant/organization scope; management controls remain separately permission-gated and private fields remain target-authorized by the private RPC.
- Produces a server-only, `role.manage`-gated role-command target model containing only selectable employee identity, internal command target ID and current role version. It explicitly filters by the verified session organization public ID in addition to database tenant/RLS protection, including for users with multiple organization memberships. The client must select a real employee and carry the server-read version; raw database IDs/versions are never manual form fields. Use the official `server-only` marker dependency in production code; Vitest may resolve only the exact bare `server-only` specifier to that package's official `empty.js` React-server entry so unit tests preserve the same marker contract without disabling other server/client boundaries.
- Preserves the completed Task 5 skill-verification behavior while moving its testable handler factory out of the Next Route Module; the production route exports only supported Next route symbols so a clean generated-type build passes.
- Updates the cross-cutting real-session, workspace-search and sensitive-route contracts to the completed people capability and its dedicated private repository. Old assertions that real users must see an empty directory or that people remains commercially unavailable are prohibited.

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

Remove fixture gating from both list and detail routes/components, remove the `PeoplePage` mock default, and enable the completed `people` capability in the server route registry so real sessions can actually reach both routes. Pass `allowMockFallback: false` from production people routes even in a development server. The safe directory is available to every active workspace member, while management controls still require their specific server-derived permissions. Bind both public/private RPCs to the authoritative active external identity for `auth.uid()` and require its organization to equal the verified session organization public ID; a second membership alone cannot authorize an alternate organization. Add a forward migration after every already-numbered Task 6 migration so upgrades revoke/drop legacy RPC signatures and install the final secured definitions. The pgTAP fixture creates exactly one authoritative external identity for the primary membership, may create a second membership without a second identity, and directly proves that passing the second organization UUID returns no public or private data. The detail route loads the safe public record and separately requests the private profile; the secure repository/RLS result determines whether private fields exist, and absence must not be distinguishable from an unauthorized target. Do not render an "unlinked account" conclusion or header badge when the public repository did not return authoritative account data. Desktop uses directory table/detail panel; mobile uses employee cards/full-screen detail. Remove hard-coded trend claims such as fixed monthly growth or full coverage, do not advertise searches over private fields excluded from the public projection, and do not offer a departed filter while the safe directory contract excludes departed employees. Show sync/department/role actions only when server capability allows them. Role assignment uses a server-loaded employee selector and hidden current version, never manual member/version inputs. Organization command forms preserve one idempotency key across an uncertain retry, synchronously block duplicate submission, recover from transport failure, handle the full stable error set (including directory-owned and not-found), and refresh only after a successful authoritative response; all mobile inputs and filters are at least 44px. Move the Task 5 skill-verification handler factory into its feature module and leave the Route Module with supported Next exports only; keep its focused behavioral tests green. Update every affected cross-cutting test to assert the new real-session/readiness/private-loader contract rather than deleting coverage or relaxing fail-closed behavior for unfinished modules.

- [ ] **Step 4: Verify GREEN and responsive E2E contract**

Run: `npx vitest run src/features/hr/people-page.test.tsx src/features/hr/employee-detail-page.test.tsx`
Run: `npx playwright test tests/e2e/people.spec.ts --project=chrome`
Expected: real local DB data survives refresh; private fields remain hidden from employee.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.mts supabase/migrations/202608260010_employee_private_profiles.sql supabase/migrations/202608270001_employee_rpc_session_scope.sql supabase/tests/employee_privacy.sql 'src/app/(workspace)/people/page.tsx' 'src/app/(workspace)/people/[id]/page.tsx' src/features/hr/people-page.tsx src/features/hr/people-workspace.tsx src/features/hr/employee-data.ts src/features/hr/employee-data.test.ts src/features/hr/employee-privacy-migration.test.ts src/features/hr/components/employee-filters.tsx src/features/hr/components/employee-stats.tsx src/features/hr/components/employee-detail-header.tsx src/features/hr/people-page.test.tsx src/features/hr/employee-detail-page.tsx src/features/hr/employee-detail-page.test.tsx src/features/organization/organization-dialogs.tsx src/features/organization/organization-dialogs.test.tsx src/features/organization/organization-command-data.ts src/features/organization/organization-command-data.test.ts src/features/commercial/module-capabilities.ts src/features/commercial/module-capabilities.test.ts src/features/auth/server-route-access.test.ts src/features/auth/route-policy.test.ts src/features/work-profile/skill-verification-handler.ts 'src/app/api/workstation/skills/[skillId]/verify/route.ts' src/features/work-profile/skill-verification.test.ts tests/unit/phase1-e2e-real-session-contract.test.ts src/components/shell/workspace-search-dialog.test.tsx 'src/app/(workspace)/sensitive-routes.test.tsx' tests/e2e/people.spec.ts
git commit -m "feat: connect the people workspace to real data"
```

### Task 7: Complete Feishu OAuth and resilient directory synchronization

**Files:**
- Create: `supabase/migrations/202608270002_feishu_sync_control.sql`
- Create: `supabase/tests/feishu_sync_control.sql`
- Create: `src/features/feishu/feishu-sync-control-migration.test.ts`
- Modify: `src/app/auth/login/feishu/handler.ts`
- Modify: `src/app/auth/login/feishu/route.ts`
- Modify: `src/app/auth/login/feishu/route.test.ts`
- Modify: `src/app/auth/callback/route.ts`
- Modify: `src/app/auth/callback/route.test.ts`
- Modify: `src/features/auth/oauth-start.ts`
- Create: `src/features/auth/oauth-start.test.ts`
- Create: `src/features/auth/feishu-oauth-attempt.ts`
- Create: `src/features/auth/feishu-oauth-attempt.test.ts`
- Modify: `src/features/feishu/directory-sync.ts`
- Modify: `src/features/feishu/directory-sync.test.ts`
- Create: `src/features/feishu/directory-sync-worker.ts`
- Create: `src/features/feishu/directory-sync-worker.test.ts`
- Modify: `src/app/api/workstation/directory-sync/handler.ts`
- Modify: `src/app/api/workstation/directory-sync/handler.test.ts`
- Modify: `src/app/api/workstation/directory-sync/route.ts`
- Create: `src/features/feishu/webhook-event.ts`
- Create: `src/features/feishu/webhook-event.test.ts`
- Create: `src/app/api/workstation/feishu/webhook/handler.ts`
- Create: `src/app/api/workstation/feishu/webhook/handler.test.ts`
- Create: `src/app/api/workstation/feishu/webhook/route.ts`
- Create: `src/app/api/internal/feishu-directory-sync/handler.ts`
- Create: `src/app/api/internal/feishu-directory-sync/handler.test.ts`
- Create: `src/app/api/internal/feishu-directory-sync/route.ts`
- Create: `src/features/feishu/sync-issues-data.ts`
- Create: `src/features/feishu/sync-issues-data.test.ts`
- Create: `src/features/feishu/sync-issues-panel.tsx`
- Create: `src/features/feishu/sync-issues-panel.test.tsx`
- Create: `src/app/(workspace)/people/sync-issues/page.tsx`
- Create: `src/app/(workspace)/people/sync-issues/page.test.tsx`
- Create: `src/app/api/workstation/feishu/sync-issues/[issueId]/resolve/handler.ts`
- Create: `src/app/api/workstation/feishu/sync-issues/[issueId]/resolve/handler.test.ts`
- Create: `src/app/api/workstation/feishu/sync-issues/[issueId]/resolve/route.ts`
- Modify: `tests/e2e/directory-sync.spec.ts`

**Interfaces:**
- Produces `startFeishuFullSync`, `resumeFeishuIncrementalSync(cursor)` and `reconcileFeishuDirectory` with `{ runId, cursor, status, retryAfter }`.
- Extends the canonical `/auth/login/feishu` and `/auth/callback` flow; produces signed webhook persistence keyed by provider event ID, an out-of-order sequence guard, scheduled reconciliation worker/cron, and `revokeDepartedMemberAccess(memberPublicId, eventId)`.
- Uses a forward migration later than the already-present `202608260048` observability migration; upgraded databases must receive the control tables, RPCs, ACL changes and audit actions without rewriting an applied migration.
- Adds an application OAuth-attempt state around the existing Supabase custom-provider PKCE flow: the database stores only a digest of a high-entropy nonce plus a single-use state ID, safe return path, expiry and terminal status. The browser receives only a Secure, HttpOnly, SameSite=Lax nonce cookie scoped to `/auth/callback`; callback must atomically validate/consume exactly one unexpired attempt before accepting the exchanged identity. Provider/Supabase tokens, raw nonce and unsafe return URLs are never persisted or logged.
- Implements the official Feishu webhook contract against the raw request body: URL-verification challenge is gated by the configured Verification Token; production events require `X-Lark-Request-Timestamp`, `X-Lark-Request-Nonce` and `X-Lark-Signature = sha256(timestamp + nonce + encryptKey + rawBody)`, constant-time comparison, a bounded timestamp window, AES-256-CBC decryption when the official encrypted envelope is used, and post-decrypt Verification Token/app/tenant checks. Only the declared contact user/department v3 event types are accepted; provider payloads and secrets never reach client responses or logs.
- Persists sanitized event metadata and payload digest, dedupes by provider event ID, converts official `header.create_time` into a monotonic per-entity sequence guard, and sends ambiguous equal/out-of-order events to reconciliation instead of applying stale data. Immediate departure handling revokes the member, external identity, active auth sessions/refresh tokens and queued access grants in one database transaction before acknowledging the event.
- Normalizes webhook user IDs to the existing directory identity contract (`open_id:<lower-open-id>`) through the exact provider/connection before offboarding. A deleted event may be acknowledged as applied only after pgTAP proves member/profile/external-identity/session/refresh-token/queued-grant revocation and one audit record; duplicate delivery and lost-response command retries return the same terminal result without a second mutation or audit.
- Uses offboarding command idempotency keyed by the provider event/command ID only. The command locks the current member/profile while it revokes access; rehire followed by a distinct later departure must execute a new command, while retrying the same event returns the prior terminal result and never duplicates audit.
- Reuses the real full-snapshot adapter behind a fenced observed mutation. The claimed `directory_sync_runs` row is the request/idempotency/run record; apply must not create a second run. The same database transaction that applies the snapshot locks and validates that exact run ID, organization, actor, `organization.manage` permission, active lease and lease expiry before any directory change; a committed result replay returns the stored run result without a second mutation/audit. All identity/profile/entity-link lookups include exact organization. A tenant/provider-wide Feishu subject already owned by another organization becomes a durable conflict and is never mutated or cross-linked. Long paginated fetches heartbeat during page traversal or abort under a total deadline below the lease, and an expired worker can never mutate after a newer worker claims the connection. Incremental work consumes the durable event cursor; scheduled cron uses the existing constant-time bearer-secret pattern, bounded attempts/exponential backoff, periodic full reconciliation and exact reason/retry metadata for no-connection, active-lease, backoff and invalid-cursor states. No invented run ID, cursor-only success, in-memory queue, fixture adapter, or direct production credential is allowed.
- Every database `organization.manage` authorization path (claim, exact apply, fenced apply/replay, resolution and RLS) joins the authoritative role row and requires an enabled role whose tenant is exact and whose organization is global or the exact target organization. Disabled roles and roles owned by another organization never authorize reads, actor selection or mutation. Incremental claim resolves and locks the connection directly from the durable cursor; unscoped full/reconcile selects ready connections with `FOR UPDATE ... SKIP LOCKED` and includes authoritative scheduled-actor eligibility in candidate selection, so a concurrently claimed, actorless or disabled-role older connection cannot starve another ready connection. After connection and lease locks, every exact and scheduled claim revalidates and locks the active Feishu provider, exact tenant key, active external identity/member, enabled role and permission before returning any run/cursor/attempt/retry metadata, terminalizing a prior run or creating a new run; concurrent provider disablement or access revocation must fail closed. If no unlocked ready connection exists, a separate bounded wait/recheck path returns an accurate no-work reason only after proving whether work is locked, active, backed off, actorless or absent. Expired-lease takeover locks and terminalizes the superseded run with one audit before replacement, carries and increments its attempt count, and never leaves an ownerless `running` run or resets crash retries to one. Its recovery-critical audit is attributed to the verified active takeover actor, or a valid actorless system audit where the audit contract permits it, never to a revoked/deleted historical actor. Claim, apply and finish use one documented `connection -> lease -> run` row-lock order so overlapping cron and manager operations cannot deadlock. Capability-gated behavioral concurrency coverage must separately prove an eligible locked A is skipped for ready B, an actorless/disabled A is skipped for ready B, and pre-locked connection prevents apply/finish from acquiring lease/run; all remote sessions require statement/lock timeouts and cancellation/drain cleanup on every failure path.
- Wires both scheduled and manager-triggered reconciliation to the same durable worker, scoped to the verified session organization and actor; production defaults, not only injected tests, must use the durable branch. Every worker claim and completion is exact-organization-bound.
- Produces a server-only, exact-active-workspace-organization `organization.manage` issue repository plus audited, retry-idempotent resolution command. The forward migration explicitly drops every legacy permissive directory sync SELECT policy before installing exact-active-workspace replacements; PostgreSQL policy OR-composition must not leave old access open. Direct PostgREST/RLS access by the same auth user in a second managed organization must fail, with behavioral same-user/two-organization pgTAP proof. Repository transport/RLS/database failure is a discriminated unavailable state and the responsive UI must show a retryable outage, never the false-green “no issues” state. The page shows sanitized real runs/events/conflicts and actionable retry/reconcile/resolve states; Feishu-owned identity, department, position and lifecycle fields remain read-only. The page and all mobile actions keep at least 44px touch targets.

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

Use the isolated environment's Feishu app only. Extend the canonical login/callback routes rather than creating a parallel callback. Wrap the existing Supabase custom-provider PKCE flow with a durable single-use OAuth attempt and HttpOnly nonce cookie; preserve only a validated relative return path. A malformed percent-encoded nonce cookie must be rejected with the stable auth-error redirect and cookie clearing, never throw before the callback guard. Persist cursor, attempts, backoff, failures and reconciliation differences in the forward-only migration. The SQL file must be parse-clean (including no diff-marker artifacts), use every current post-`048` three-column directory connection conflict target, and preserve fresh/upgrade compatibility. Verify the official Feishu raw-body signature and encrypted envelope, reject replay/invalid app or tenant/type, dedupe by event ID, and guard official create-time sequences before any mutation. For encrypted URL verification, verify the signature, decrypt first, then validate Verification Token and return the challenge without requiring event headers. Run scheduled and interactive incremental/full reconciliation through a constant-time bearer-protected or session-authorized durable worker with exact-organization claimed-run fencing, enabled exact/global role-aware `organization.manage` authorization, active provider and identity revalidation before every metadata return or mutation, cursor-owned incremental connection routing, scheduled-actor-aware `SKIP LOCKED` fair unscoped scheduling plus accurate bounded recheck, takeover-actor-attributed expired-run terminalization with cumulative attempts, one connection-to-lease-to-run lock order and pagination heartbeats. Audit department move, transfer, conflict resolution and immediate departure revoke; normalize open ID identities and revoke active sessions, refresh tokens and queued access grants in the same event-idempotent offboarding transaction, including rehire and later departure. Keep Feishu-owned fields read-only while showing a real, exact-workspace-organization manager-authorized conflict resolution UI with explicit unavailable state. Local tests use synthetic official-shape events through the real verification/persistence/worker path; pgTAP must create one auth user who legitimately manages both organizations while an authoritative active-workspace identity binds organization A, then directly prove organization B sync rows remain denied. Positive E2E contracts cover signed ingestion, dedupe, out-of-order handling, complete offboarding with preexisting nonzero sessions/refresh/grants and exact post-revocation zero counts, full/incremental/reconcile and issue resolution without business interception. Capability-gated dblink coverage must keep separate valid-locked-A, actorless-A, old-actor-revoked takeover and pre-lock apply/finish scenarios. It must set remote statement/lock timeouts, cancel and drain pending async results before cleanup, may SKIP only before behavior begins when the extension or local connection prerequisite is unavailable, and must fail any SQL, lock-order, fairness, audit, authorization or terminalization error after setup. Staging remains blocked until isolated credentials are explicitly supplied.

- [ ] **Step 4: Verify GREEN in Local and authorized Staging**

Run: `npx vitest run src/app/auth/login/feishu src/app/auth/callback src/features/feishu src/app/api/workstation/feishu`
Run: `npm run db:test`
Run: `npx playwright test tests/e2e/directory-sync.spec.ts --project=chrome`
Expected: Local uses synthetic identities through the real adapter/persistence path; Staging verification is blocked pending isolated OAuth/webhook credentials, never production credentials.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608270002_feishu_sync_control.sql supabase/tests/feishu_sync_control.sql src/app/auth/login/feishu src/app/auth/callback src/features/auth/oauth-start.ts src/features/auth/oauth-start.test.ts src/features/auth/feishu-oauth-attempt.ts src/features/auth/feishu-oauth-attempt.test.ts src/features/feishu src/app/api/workstation/directory-sync src/app/api/workstation/feishu src/app/api/internal/feishu-directory-sync 'src/app/(workspace)/people/sync-issues' tests/e2e/directory-sync.spec.ts
git commit -m "feat: add resilient Feishu OAuth directory sync"
```

### Task 8: Add direct-manager mapping and a distinct supervisor scope

**Files:**
- Create: `supabase/migrations/202608260046_manager_supervisor_scope.sql`
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
git add supabase/migrations/202608260046_manager_supervisor_scope.sql supabase/tests/organization_commands.sql src/features/auth src/features/organization src/app/api/workstation/organization/members tests/e2e/people.spec.ts
git commit -m "feat: add direct manager and supervisor scope"
```
