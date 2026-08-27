# QuantXY Task 7 Release Gate Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the two load-bearing Task 7 release blockers: post-lock fail-closed Feishu authorization and independent valid-connection `SKIP LOCKED` fairness proof.

**Architecture:** Keep `public.claim_feishu_sync_work(...)` as the single durable claim RPC and preserve the existing `connection -> lease -> run` order. After the connection and lease rows are locked, revalidate and lock the active Feishu provider plus the exact active identity/member/role/permission chain before any durable metadata return or mutation. Extend the capability-gated dblink harness with separate valid-locked-A and actorless-A scenarios, plus concurrent provider/role revocation cases that prove no metadata or new run escapes after pre-authorization.

**Tech Stack:** PostgreSQL/PLpgSQL, Supabase Auth/RLS, pgTAP, dblink, TypeScript, Vitest, Playwright discovery.

**Spec:** `docs/superpowers/specs/2026-08-26-quantxy-commercial-completion-design.md`

## Global Constraints

- This plan carries the load-bearing Task 7 findings recorded after commit `d276f90`; the original Plan 02 Task 8 remains blocked until this plan receives a clean independent review.
- Supabase/PostgreSQL remains the authoritative business store and Feishu remains the authoritative identity/directory source.
- Tenant, organization and actor come from the verified session/provider identity; UI hiding is never authorization.
- Every claim remains exact-tenant, exact-organization and exact-provider bound. Browser roles never receive service-role access to internal apply/proof functions.
- Preserve all previously reviewed Task 7 behavior: claimed-run idempotency, exact-organization directory mutation, event-only offboarding idempotency, expired-run terminalization, cumulative attempts, role-aware RLS, cursor-owned incremental routing, page heartbeats and sanitized outage states.
- Do not implement leave or attendance. Do not call remote Feishu/Supabase, write real credentials, upload, push, merge or deploy.
- Local PostgreSQL `127.0.0.1:54322` must be probed before `npm run db:test`; if unavailable, do not consume the original Task 7 single Local DB attempt and record live pgTAP/dblink/PostgREST as an external release gate.
- Real Playwright may run only when the Local database, app and authenticated synthetic prerequisites exist; otherwise run discovery only and keep real browser execution open.
- C: is full. Set `TEMP`, `TMP` and `npm_config_cache` to existing E: workspace paths for every Node/npm command.

---

### Task 1: Make Feishu claims post-lock fail-closed and prove independent fairness

**Files:**
- Modify: `supabase/migrations/202608270002_feishu_sync_control.sql`
- Modify: `supabase/tests/feishu_sync_control.sql`
- Modify: `src/features/feishu/feishu-sync-control-migration.test.ts`

**Interfaces:**
- Preserves `public.claim_feishu_sync_work(p_mode text, p_cursor text, p_provider_tenant_key text, p_lease_seconds integer default 120, p_organization_public_id uuid default null, p_actor_auth_user_id uuid default null) returns jsonb`.
- Preserves claim results `{ acquired, runId, cursor, attempt, reason, retryAfter, organizationId? }` and existing `locked`, `actorless`, `active_lease`, `backoff`, `invalid_cursor` and `no_connection` meanings.
- Produces a post-lock authorization boundary: after exact connection and lease locks, `identity_providers`, `external_identities`, `organization_members`, `member_roles`, `roles`, `role_permissions` and `permissions` are revalidated and row-locked before any run metadata return, takeover mutation or new run insertion.
- Produces separate capability-gated dblink facts for valid locked A -> ready B, actorless A -> ready B, concurrent role revocation -> `42501`, and concurrent provider disablement -> `42501` with no new run.

- [ ] **Step 1: Write static and behavioral regression tests that fail for the current ordering**

In `src/features/feishu/feishu-sync-control-migration.test.ts`, extract the final six-argument claim body and assert the post-lock provider/actor authorization occurs after the lease lock but before both metadata returns:

```ts
const leaseLock = claim.indexOf("select * into v_lease");
const lockedProvider = claim.indexOf("join public.identity_providers provider", leaseLock);
const activeLeaseReturn = claim.indexOf("'reason', 'active_lease'", leaseLock);
const backoffReturn = claim.indexOf("'reason', 'backoff'", leaseLock);

expect(lockedProvider).toBeGreaterThan(leaseLock);
expect(lockedProvider).toBeLessThan(activeLeaseReturn);
expect(lockedProvider).toBeLessThan(backoffReturn);
expect(claim.slice(lockedProvider, activeLeaseReturn)).toContain("provider.provider_code = 'feishu'");
expect(claim.slice(lockedProvider, activeLeaseReturn)).toContain("provider.status = 'active'");
expect(claim.slice(lockedProvider, activeLeaseReturn)).toContain("provider.provider_tenant_key = p_provider_tenant_key");
expect(claim.slice(lockedProvider, activeLeaseReturn)).toContain("for share of provider, member, identity, assignment, role, rp, permission");
```

In `supabase/tests/feishu_sync_control.sql`, keep the existing actorless-A case and add independent capability-gated dblink scenarios with both A and B fully eligible before A is locked:

```sql
select is(
  current_setting('test.feishu_valid_locked_fairness')::jsonb ->> 'organizationId',
  '99000000-0000-4000-8000-000000000012',
  'eligible locked organization A is skipped and ready organization B is claimed'
);

select is(
  current_setting('test.feishu_revoked_metadata_sqlstate'),
  '42501',
  'post-lock role revocation denies active lease metadata'
);

select is(
  current_setting('test.feishu_disabled_provider_sqlstate'),
  '42501',
  'post-lock provider disablement denies a new claim'
);

select is(
  current_setting('test.feishu_disabled_provider_new_runs')::integer,
  0,
  'provider disablement race creates no run'
);
```

For each race, session A locks the exact `directory_connections` row; session B starts the exact claim and is observed waiting on a PostgreSQL `Lock`; session C commits the role revocation or provider disablement before A releases the connection. Capture remote `SQLSTATE` inside session B. Set remote `statement_timeout = '5s'` and `lock_timeout = '1s'`; after capability setup, any SQL/assertion error must cancel and bounded-drain pending results, roll back, clean fixtures, disconnect and rethrow.

- [ ] **Step 2: Run RED and verify each failure names the missing boundary**

Run from PowerShell with E: temp/cache:

```powershell
$env:TEMP='E:\新企业工作站\.tmp'
$env:TMP='E:\新企业工作站\.tmp'
$env:npm_config_cache='E:\新企业工作站\.npm-cache'
npx vitest run src/features/feishu/feishu-sync-control-migration.test.ts --pool=forks --maxWorkers=1
```

Expected: the ordering test fails because the post-lock provider authorization starts after `active_lease`/`backoff`; the independent valid-A fairness and concurrent revoke/disable markers are absent.

- [ ] **Step 3: Move the authoritative authorization boundary before all metadata returns**

After the connection row and `feishu_sync_leases` row are locked, resolve the actor with the active provider in the same row-locking query:

```sql
select member.user_id, member.id
  into v_actor, v_actor_member_id
  from public.identity_providers provider
  join public.external_identities identity
    on identity.tenant_id = provider.tenant_id
   and identity.identity_provider_id = provider.id
   and identity.organization_id = v_connection.organization_id
   and identity.status = 'active'
  join public.organization_members member
    on member.tenant_id = identity.tenant_id
   and member.organization_id = identity.organization_id
   and member.id = identity.organization_member_id
   and member.user_id = identity.auth_user_id
   and member.status = 'active'
  join public.member_roles assignment
    on assignment.tenant_id = member.tenant_id
   and assignment.member_id = member.id
  join public.roles role
    on role.tenant_id = assignment.tenant_id
   and role.id = assignment.role_id
   and role.is_enabled
  join public.role_permissions rp
    on rp.tenant_id = role.tenant_id
   and rp.role_id = role.id
  join public.permissions permission
    on permission.id = rp.permission_id
 where provider.tenant_id = v_connection.tenant_id
   and provider.id = v_connection.identity_provider_id
   and provider.provider_code = 'feishu'
   and provider.status = 'active'
   and provider.provider_tenant_key = p_provider_tenant_key
   and identity.provider_tenant_key = p_provider_tenant_key
   and (p_actor_auth_user_id is null or member.user_id = p_actor_auth_user_id)
   and (role.organization_id is null or role.organization_id = v_connection.organization_id)
   and permission.code = 'organization.manage'
 order by member.id
 for share of provider, identity, member, assignment, role, rp, permission
 limit 1;
```

For exact callers, recheck `active_workspace_organization_id(p_actor_auth_user_id) = v_connection.organization_id` immediately before this query. If the query finds no row, exact calls raise `42501 forbidden` and scheduled calls raise `42501 sync_actor_missing`. Only after this query succeeds may the function return `active_lease`/`backoff`, lock/terminalize a superseded run, or insert a new run. Remove the later duplicate authorization block so one authoritative boundary controls every path.

- [ ] **Step 4: Separate valid-lock fairness from actorless fairness in dblink behavior coverage**

Keep A and B roles enabled for the first scenario, lock eligible A in session A, call unscoped claim in session B, and require immediate organization B acquisition before releasing A. Finish/clear B's lease/run, then disable A and run the independent actorless-A scenario. Add the role-revocation active-lease race and provider-disable new-run race described in Step 1. Static tests must assert the valid-lock marker occurs before the SQL that disables A, so removing `SKIP LOCKED` makes RED again.

- [ ] **Step 5: Verify focused GREEN and pgTAP source integrity**

Run:

```powershell
$env:TEMP='E:\新企业工作站\.tmp'
$env:TMP='E:\新企业工作站\.tmp'
$env:npm_config_cache='E:\新企业工作站\.npm-cache'
npx vitest run src/features/feishu/feishu-sync-control-migration.test.ts src/features/feishu/directory-sync-worker.test.ts --pool=forks --maxWorkers=1
git diff --check
```

Expected: focused tests pass; the declared `plan(N)` equals the exact top-level pgTAP assertion count; no behavior-stage dblink error is converted to SKIP.

- [ ] **Step 6: Run the complete local non-database gates**

Run:

```powershell
$env:TEMP='E:\新企业工作站\.tmp'
$env:TMP='E:\新企业工作站\.tmp'
$env:npm_config_cache='E:\新企业工作站\.npm-cache'
npx vitest run --exclude "scripts/**/*.test.mjs" --exclude "tests/html-*.test.mjs" --exclude ".worktrees/**" --pool=forks --maxWorkers=1
npm run test:html
npm run typecheck
npm run lint
npm run test:security
$env:NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54321'
$env:NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='sb_publishable_example'
npm run build
npx playwright test tests/e2e/directory-sync.spec.ts --list
git diff --check
```

Expected: every command exits 0; synthetic public build values are explicitly recorded as build-only, never credentials.

- [ ] **Step 7: Probe the Local database once and preserve external gates honestly**

Run:

```powershell
Test-NetConnection -ComputerName 127.0.0.1 -Port 54322 -InformationLevel Quiet
```

If `True`, run the original Task 7 single allowed `npm run db:test` attempt and record the exact output. If `False`, do not run `db:test`; record Local migration/pgTAP/dblink/PostgREST and real Playwright as external release gates. Never substitute remote credentials or interception.

- [ ] **Step 8: Commit only the three authorized files**

```bash
git add supabase/migrations/202608270002_feishu_sync_control.sql supabase/tests/feishu_sync_control.sql src/features/feishu/feishu-sync-control-migration.test.ts
git commit -m "fix: close Feishu post-lock authorization race"
```
