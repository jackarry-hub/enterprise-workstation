# QuantXY Customer CRM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the customer seed/localStorage workspace with a tenant-safe customer, contact, opportunity, follow-up, and delivery system.

**Architecture:** New CRM tables use tenant/org composite keys and RLS; transactional RPCs own customer and opportunity changes; Next.js pages use server repositories and real commands.

**Tech Stack:** Next.js, TypeScript, Supabase PostgreSQL, Vitest, pgTAP, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-26-quantxy-commercial-completion-design.md`

## Global Constraints

- Depends on Plans 01-03.
- Customer PII is visible only to assigned members and `customer.manage` users.
- No customer data may remain in localStorage.
- Every follow-up actor and timestamp is server-derived.

---

### Task 1: Create tenant-safe CRM schema and RLS

**Files:**
- Create: `supabase/migrations/202608280001_customer_crm.sql`
- Create: `supabase/tests/customer_crm.sql`
- Create: `src/features/customers/customer-types-v2.ts`
- Create: `src/features/customers/customer-crm-migration.test.ts`
- Verify: `src/features/auth/workspace-session-types.ts` and `src/features/auth/workspace-access.ts` already carry the Plan 01 `customer.manage` contract.

**Interfaces:**
- Produces tables `customers`, `customer_contacts`, `opportunities`, `customer_follow_ups`, `customer_project_links`.
- Produces tenant-unique normalized customer name and optional registration-code constraints.

- [x] **Step 1: Write failing two-tenant RLS and uniqueness tests**

```sql
select is((select count(*) from public.customers where name = 'A 客户'), 1::bigint, 'assigned tenant reads customer');
select throws_ok($$ insert into public.customers (...) values (...) $$, '42501', null, 'employee cannot direct insert');
```

- [x] **Step 2: Verify RED**

Run: `npm run db:test`
Expected: CRM tables do not exist.

RED was confirmed by the initial repository scan: the five authoritative CRM tables and `customer_crm.sql` were absent and the formal page still depended on seed/localStorage. Live `npm run db:test` was not run because this workstation has no PostgreSQL, `psql`, Supabase CLI or Docker runtime.

- [x] **Step 3: Create tables, indexes, RLS, FORCE RLS, and grants**

Use composite tenant/org foreign keys, soft archive timestamps, decimal opportunity amounts, assigned-member visibility, and no authenticated direct writes.

- [x] **Step 4: Verify GREEN**

Run: `npm run db:reset:test`
Run: `npm run db:test`
Expected: cross-tenant reads return zero, duplicate normalized customer fails, direct writes are denied.

Task 1 local verification (2026-08-28):

- Focused CRM Vitest — 3 files / 10 tests passed.
- `npm run typecheck` and `git diff --check` — passed.
- `customer_crm.sql` static pgTAP plan/assertion count — 36/36.
- Independent SQL/RLS review — CLEAN with no remaining P0-P3 findings.
- The fixture contains real rows for customer, assigned/manager-only contacts, opportunity, follow-up and project link across owner, manager, outsider and second-tenant sessions.
- Live migration, pgTAP and database constraint execution remain mandatory external gates and are not reported as passed locally.

- [x] **Step 5: Commit**

```bash
git add supabase/migrations/202608280001_customer_crm.sql supabase/tests/customer_crm.sql src/features/customers/customer-types-v2.ts src/features/customers/customer-crm-migration.test.ts docs/superpowers/plans/2026-08-26-quantxy-04-customer-crm.md
git commit -m "feat: add tenant-safe customer CRM schema"
```

### Task 2: Add customer and contact commands

**Files:**
- Create: `src/features/customers/customer-command-handler.ts`
- Create: `src/features/customers/customer-command-handler.test.ts`
- Create: `src/app/api/workstation/customers/route.ts`
- Create: `src/app/api/workstation/customers/[customerId]/route.ts`
- Create: `src/app/api/workstation/customers/[customerId]/contacts/route.ts`
- Create: `supabase/migrations/202608280002_customer_commands.sql`
- Modify: `supabase/tests/customer_crm.sql`

**Interfaces:**
- Produces audited RPCs `create_current_customer`, `update_current_customer`, `create_current_customer_contact`.
- Commands require `idempotencyKey`; updates require `version`.

- [x] **Step 1: Write failing validation, permission, and duplicate tests**

```ts
expect((await createCustomer({ name: "" })).status).toBe(400);
expect((await createCustomerAs(employeeSession)).status).toBe(403);
expect((await repeatCustomerCreate(sameKey)).body.customerId).toBe(firstCustomerId);
```

- [x] **Step 2: Verify RED**

Run: `npx vitest run src/features/customers/customer-command-handler.test.ts`
Expected: handler is absent.

The repository baseline had no customer/contact command handler, routes, command migration, or command pgTAP coverage. The new tests define the previously missing permission, validation, exact DTO, PII, idempotency, duplicate and optimistic-version boundaries.

- [x] **Step 3: Implement handlers and RPC transactions**

Normalize names on the server, encrypt or restrict sensitive contact fields, derive actor and organization from session, and append audit rows.

Implementation uses a forced-RLS, no-direct-access idempotency ledger bound to organization, actor, target and payload. Contact audit rows omit caller-controlled reason and entity PII, retaining SHA-256 digests. Owner validation uses `FOR SHARE` so concurrent reverse assignments remain compatible with foreign-key `KEY SHARE` locks.

- [x] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/customers/customer-command-handler.test.ts`
Run: `npm run db:test`
Expected: authorization, validation, idempotency and duplicate-name conflict pass.

Task 2 local verification (2026-08-28):

- Focused customer command/migration Vitest — 2 files / 20 tests passed.
- Full unit regression — 178 files / 1221 tests passed; HTML contract suite — 152/152 passed.
- `npm run typecheck` and `git diff --check` — passed.
- `npm run lint` — passed with 0 errors and one pre-existing generated coverage warning.
- `customer_crm.sql` static pgTAP plan/assertion count — 58/58.
- Independent API review and independent SQL/RLS/concurrency review — CLEAN with no remaining P0-P3 findings.
- Live migration and pgTAP execution remain mandatory external gates because this workstation has no PostgreSQL, `psql`, Supabase CLI or Docker runtime.

- [x] **Step 5: Commit**

```bash
git add src/features/customers/customer-command-handler.ts src/features/customers/customer-command-handler.test.ts src/features/customers/customer-crm-migration.test.ts src/app/api/workstation/customers/route.ts src/app/api/workstation/customers/[customerId]/route.ts src/app/api/workstation/customers/[customerId]/contacts/route.ts supabase/migrations/202608280002_customer_commands.sql supabase/tests/customer_crm.sql docs/superpowers/plans/2026-08-26-quantxy-04-customer-crm.md
git commit -m "feat: add customer and contact commands"
```

### Task 3: Add opportunity, follow-up, and project conversion commands

**Files:**
- Create: `src/features/customers/opportunity-command-handler.ts`
- Create: `src/features/customers/opportunity-command-handler.test.ts`
- Create: `src/app/api/workstation/customers/[customerId]/opportunities/route.ts`
- Create: `src/app/api/workstation/customers/[customerId]/follow-ups/route.ts`
- Create: `src/app/api/workstation/opportunities/[opportunityId]/route.ts`
- Create: `src/app/api/workstation/opportunities/[opportunityId]/convert/route.ts`
- Create: `supabase/migrations/202608280003_opportunity_commands.sql`
- Modify: `supabase/tests/customer_crm.sql`

**Interfaces:**
- Produces stage transition RPC with allowed sequence lead -> qualified -> proposal -> won/lost.
- Produces transactional opportunity-to-project conversion returning both public IDs.

- [x] **Step 1: Write failing stage, actor, and conversion rollback tests**

```ts
expect((await moveOpportunity("lead", "won")).status).toBe(422);
expect(savedFollowUp.actorId).toBe(session.member.publicId);
expect(projectAfterInjectedLinkFailure).toBeNull();
```

- [x] **Step 2: Verify RED**

Run: `npx vitest run src/features/customers/opportunity-command-handler.test.ts`
Expected: commands do not exist.

RED was executed on 2026-08-28: Vitest failed to resolve the absent `opportunity-command-handler` module before implementation.

- [x] **Step 3: Implement state machine and conversion transaction**

Follow-up timestamps use database time. Conversion calls the project lifecycle RPC inside one transaction and creates `customer_project_links` plus audit.

The implementation also rejects PostgreSQL infinite dates/timestamps, preserves historical owner projection after profile soft deletion, hardens the reused project command identity binding, and keeps nested project/ledger/audit/link changes in one rollback scope while persisting the outer CRM failure result and audit.

- [x] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/customers/opportunity-command-handler.test.ts`
Run: `npm run db:test`
Expected: invalid jumps fail, actor spoof is ignored, failed linking rolls back the project.

Task 3 local verification (2026-08-28):

- Focused opportunity command/migration Vitest — 2 files / 23 tests passed.
- Full unit regression — 179 files / 1235 tests passed; HTML contract suite — 152/152 passed.
- `npm run typecheck`, production `npm run build`, and `git diff --check` — passed.
- `npm run lint` — passed with 0 errors and one pre-existing generated coverage warning.
- `npm run test:security` — passed with 0 vulnerabilities.
- `customer_crm.sql` static pgTAP plan/assertion count — 91/91.
- Independent API review and independent SQL/RLS/concurrency/rollback review — CLEAN with no remaining P0-P3 findings.
- Live migration and pgTAP execution remain mandatory external gates because this workstation has no PostgreSQL, `psql`, Supabase CLI or Docker runtime.

- [x] **Step 5: Commit**

```bash
git add src/features/customers/opportunity-command-handler.ts src/features/customers/opportunity-command-handler.test.ts src/features/customers/customer-crm-migration.test.ts src/app/api/workstation/customers/[customerId]/opportunities/route.ts src/app/api/workstation/customers/[customerId]/follow-ups/route.ts src/app/api/workstation/opportunities/[opportunityId]/route.ts src/app/api/workstation/opportunities/[opportunityId]/convert/route.ts supabase/migrations/202608280003_opportunity_commands.sql supabase/tests/customer_crm.sql docs/superpowers/plans/2026-08-26-quantxy-04-customer-crm.md
git commit -m "feat: add opportunity and customer delivery workflow"
```

### Task 4: Replace customer repository and UI with real responsive data

**Files:**
- Delete: `src/features/customers/customer-repository.ts`
- Delete: `src/features/customers/customer-mock-data.ts`
- Modify: `src/app/(workspace)/customers/page.tsx`
- Modify: `src/app/api/workstation/customers/[customerId]/route.ts`
- Create: `src/app/api/workstation/customers/[customerId]/route.test.ts`
- Modify: `src/features/customers/customers-workspace.tsx`
- Modify: `src/features/customers/customers-page.tsx`
- Modify: `src/features/customers/customers-page.test.tsx`
- Modify: `src/features/customers/components/create-customer-dialog.tsx`
- Modify: `src/features/customers/components/customer-detail-dialog.tsx`
- Create: `src/features/customers/customer-data.ts`
- Create: `src/features/customers/customer-data.test.ts`
- Create: `supabase/migrations/202608280004_customer_read_models.sql`
- Modify: `supabase/tests/customer_crm.sql`
- Create: `tests/e2e/customers.spec.ts`

**Interfaces:**
- Consumes Tasks 1-3 APIs.
- Produces server list/detail loaders and responsive customer workspace.

- [x] **Step 1: Write failing no-seed and refresh tests**

```tsx
expect(screen.getByText(databaseCustomer.name)).toBeInTheDocument();
expect(screen.queryByText(seedCustomer.name)).not.toBeInTheDocument();
expect(window.localStorage.getItem("enterprise-workstation-customers")).toBeNull();
```

- [x] **Step 2: Verify RED**

Run: `npx vitest run src/features/customers/customers-page.test.tsx src/features/customers/customer-data.test.ts`
Expected: current workspace initializes from seed/localStorage.

RED was executed on 2026-08-28: tests exposed the existing seed/localStorage repository and absent server customer loader before implementation.

- [x] **Step 3: Implement server loaders and API-backed dialogs**

Desktop uses list plus detail panel; mobile uses customer cards and full-screen detail. All mutations wait for server success and reload the entity.

The implementation removes formal seed/localStorage reads, loads a bounded server page plus on-demand detail through the authenticated Supabase session, applies name/status/source/industry filters before exact count and pagination, and preserves decimal money with BigInt cents. Mutations use timeout-bound requests, target-bound canonical success validation and retry-stable idempotency keys. The mobile surface uses customer cards and a full-height detail workflow; unavailable or RLS-hidden related data is represented explicitly instead of being fabricated.

- [x] **Step 4: Verify GREEN and browser flow**

Run: `npx vitest run src/features/customers`
Run: `npx playwright test tests/e2e/customers.spec.ts --project=chrome`
Expected: customer -> contact -> opportunity -> follow-up -> project conversion survives refresh and another authorized browser.

Task 4 local verification (2026-08-28):

- Focused customer/API/project-scope Vitest — 11 files / 72 tests passed.
- Full unit regression — 181 files / 1252 tests passed; HTML contract suite — 152/152 passed.
- `npm run typecheck`, `npm run lint -- --quiet`, production `npm run build`, `npm run test:security`, and `git diff --check` — passed; dependency audit found 0 vulnerabilities.
- Playwright customer workflow and mobile flow — 2 tests discovered successfully with `--list`; live execution remains an isolated database/auth browser gate.
- `customer_crm.sql` static pgTAP plan/assertion count — 101/101, including four RLS-invoker read models and owner/manager/outsider/second-tenant projections.
- Independent API/interaction review and independent SQL/RLS review — CLEAN with no remaining P0-P3 findings.
- Live migration, pgTAP and persistence E2E remain mandatory external gates because this workstation has no PostgreSQL, `psql`, Supabase CLI, Docker runtime or isolated authenticated test backend.

- [x] **Step 5: Commit**

```bash
git add -A -- src/features/customers 'src/app/(workspace)/customers/page.tsx' 'src/app/api/workstation/customers/[customerId]' src/components/ui/data-card.tsx src/features/projects supabase/migrations/202608280004_customer_read_models.sql supabase/tests/customer_crm.sql tests/e2e/customers.spec.ts docs/superpowers/plans/2026-08-26-quantxy-04-customer-crm.md
git commit -m "feat: connect customer CRM to real data"
```

### Task 5: Add commercial CRM governance, exchange and lifecycle controls

**Files:**
- Create: `supabase/migrations/202608280005_crm_governance.sql`
- Modify: `supabase/tests/customer_crm.sql`
- Modify: `src/features/customers/customer-command-handler.ts`
- Modify: `src/features/customers/opportunity-command-handler.ts`
- Create: `src/features/customers/crm-import-export-handler.ts`
- Create: `src/features/customers/crm-import-export-handler.test.ts`
- Create: `src/app/api/workstation/customers/import/route.ts`
- Create: `src/app/api/workstation/customers/export/route.ts`
- Create: `src/app/api/workstation/customers/export/[exportId]/route.ts`
- Create: `src/app/api/workstation/customers/[customerId]/contracts/route.ts`
- Create: `src/app/api/workstation/customers/[customerId]/source-links/route.ts`
- Modify: `src/features/customers/components/customer-detail-dialog.tsx`

**Interfaces:**
- Defines QuantXY PostgreSQL as the authoritative CRM source; produces `customer_contracts` and `crm_source_links` tables with tenant/org composite FKs to customers, contacts, opportunities and projects, FORCE RLS and immutable provenance/audit.
- Produces ownership transfer, contact PII projection, stage-history, contract/source/project link, archive/restore and audit RPCs.
- Produces `validateCrmImport(rows, tenantId)` and `requestCrmExport(scope, idempotencyKey)` with permission-scoped columns and export audit.

- [x] **Step 1: Write failing duplicate, transfer, PII, source-link and export-audit tests**

```ts
expect((await transferCustomer(unassignedEmployee)).status).toBe(403);
expect(opportunityStageHistory).toContainEqual(expect.objectContaining({ from: "qualified", to: "proposal" }));
expect(await exportAsUnassigned()).toMatchObject({ status: 403 });
expect(await createContractForOtherTenant()).toMatchObject({ status: 404 });
```

- [x] **Step 2: Verify RED**

Run: `npx vitest run src/features/customers/crm-import-export-handler.test.ts src/features/customers`
Run: `npm run db:test`
Expected: CRM governance and controlled import/export surfaces are absent.

RED exposed the absent governance migration, routes, immutable history/provenance models, controlled PII projection and durable import/export lifecycle before implementation.

- [x] **Step 3: Implement tenant-safe governance**

Normalize dedupe keys, preserve ownership-transfer and opportunity-stage history, restrict contact PII, and make QuantXY CRM the authoritative record while modeling contracts and source provenance as first-class tenant-scoped entities. Enforce composite FKs/RLS in RPCs and contract/source APIs; render authorized contract/project provenance in customer detail. Validate imports before one transaction per accepted row; export only authorized projections, watermark sensitive exports and append audit. Archive rather than hard-delete business entities and allow authorized restore.

Implementation adds tenant/org exact-pair constraints and FORCE RLS, immutable ownership/stage/source facts, permission-scoped contact projection, optimistic transfer/archive/restore/contract/source commands, resumable 20-row import batches with content-bound manifests, and separately requested/audited 15-minute export snapshots. Client and server validate exact DTOs, stable idempotency, rejection completeness, current download scope and snapshot SHA before saving an artifact. Source URLs use one fail-closed canonical HTTPS contract across command, read model, CHECK and RPC validation.

- [x] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/customers`
Run: `npm run db:test`
Run: `npx playwright test tests/e2e/customers.spec.ts --project=chrome`
Expected: dedupe, transfer, stage history, PII restrictions, import/export audit and archive/restore all respect tenant/role scope.

Task 5 local/static verification (2026-08-28):

- Customer Vitest — 9 files / 83 tests passed; final governance/exchange delta — 4 files / 39 tests passed.
- Full declared test command — 184 unit files / 1275 tests plus 152/152 HTML contracts passed.
- `npm run typecheck`, `npm run lint -- --quiet`, production `npm run build`, and `git diff --check` — passed (line-ending notices only).
- `customer_crm.sql` static pgTAP plan/assertion count — 167/167, including exact contract pairing, durable failure replay, current-scope export revocation/purge, and canonical source URL rejection.
- Customer Playwright suite — two desktop/mobile workflows discovered successfully with `--list`; live persistence execution remains an isolated database/auth browser gate.
- Independent API/UI and SQL/RLS delta reviews — CLEAN with no remaining P0-P3 findings.
- `npm run db:test` remains BLOCKED with `connection_refused`; this workstation has no running local PostgreSQL/Supabase target, so live migration, pgTAP and authenticated persistence E2E are mandatory pre-deployment gates and are not reported as passed.

- [x] **Step 5: Commit**

```bash
git add supabase/migrations/202608280005_crm_governance.sql supabase/tests/customer_crm.sql src/features/customers src/app/api/workstation/customers tests/e2e/customers.spec.ts
git commit -m "feat: add commercial CRM governance"
```
