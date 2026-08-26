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
- Create: `supabase/migrations/202608260013_customer_crm.sql`
- Create: `supabase/tests/customer_crm.sql`
- Create: `src/features/customers/customer-types-v2.ts`
- Modify: `src/features/auth/workspace-session-types.ts`
- Modify: `src/features/auth/workspace-access.ts`

**Interfaces:**
- Produces tables `customers`, `customer_contacts`, `opportunities`, `customer_follow_ups`, `customer_project_links`.
- Produces tenant-unique normalized customer name and optional registration-code constraints.

- [ ] **Step 1: Write failing two-tenant RLS and uniqueness tests**

```sql
select is((select count(*) from public.customers where name = 'A 客户'), 1::bigint, 'assigned tenant reads customer');
select throws_ok($$ insert into public.customers (...) values (...) $$, '42501', null, 'employee cannot direct insert');
```

- [ ] **Step 2: Verify RED**

Run: `npm run db:test`
Expected: CRM tables do not exist.

- [ ] **Step 3: Create tables, indexes, RLS, FORCE RLS, and grants**

Use composite tenant/org foreign keys, soft archive timestamps, decimal opportunity amounts, assigned-member visibility, and no authenticated direct writes.

- [ ] **Step 4: Verify GREEN**

Run: `npm run db:reset`
Run: `npm run db:test`
Expected: cross-tenant reads return zero, duplicate normalized customer fails, direct writes are denied.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260013_customer_crm.sql supabase/tests/customer_crm.sql src/features/customers/customer-types-v2.ts src/features/auth/workspace-session-types.ts src/features/auth/workspace-access.ts
git commit -m "feat: add tenant-safe customer CRM schema"
```

### Task 2: Add customer and contact commands

**Files:**
- Create: `src/features/customers/customer-command-handler.ts`
- Create: `src/features/customers/customer-command-handler.test.ts`
- Create: `src/app/api/workstation/customers/route.ts`
- Create: `src/app/api/workstation/customers/[customerId]/route.ts`
- Create: `src/app/api/workstation/customers/[customerId]/contacts/route.ts`
- Create: `supabase/migrations/202608260014_customer_commands.sql`
- Modify: `supabase/tests/customer_crm.sql`

**Interfaces:**
- Produces audited RPCs `create_current_customer`, `update_current_customer`, `create_current_customer_contact`.
- Commands require `idempotencyKey`; updates require `version`.

- [ ] **Step 1: Write failing validation, permission, and duplicate tests**

```ts
expect((await createCustomer({ name: "" })).status).toBe(400);
expect((await createCustomerAs(employeeSession)).status).toBe(403);
expect((await repeatCustomerCreate(sameKey)).body.customerId).toBe(firstCustomerId);
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/customers/customer-command-handler.test.ts`
Expected: handler is absent.

- [ ] **Step 3: Implement handlers and RPC transactions**

Normalize names on the server, encrypt or restrict sensitive contact fields, derive actor and organization from session, and append audit rows.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/customers/customer-command-handler.test.ts`
Run: `npm run db:test`
Expected: authorization, validation, idempotency and duplicate-name conflict pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/customers/customer-command-handler.ts src/features/customers/customer-command-handler.test.ts src/app/api/workstation/customers/route.ts src/app/api/workstation/customers/[customerId]/route.ts src/app/api/workstation/customers/[customerId]/contacts/route.ts supabase/migrations/202608260014_customer_commands.sql supabase/tests/customer_crm.sql
git commit -m "feat: add customer and contact commands"
```

### Task 3: Add opportunity, follow-up, and project conversion commands

**Files:**
- Create: `src/features/customers/opportunity-command-handler.ts`
- Create: `src/features/customers/opportunity-command-handler.test.ts`
- Create: `src/app/api/workstation/customers/[customerId]/opportunities/route.ts`
- Create: `src/app/api/workstation/customers/[customerId]/follow-ups/route.ts`
- Create: `src/app/api/workstation/opportunities/[opportunityId]/convert/route.ts`
- Create: `supabase/migrations/202608260015_opportunity_commands.sql`
- Modify: `supabase/tests/customer_crm.sql`

**Interfaces:**
- Produces stage transition RPC with allowed sequence lead -> qualified -> proposal -> won/lost.
- Produces transactional opportunity-to-project conversion returning both public IDs.

- [ ] **Step 1: Write failing stage, actor, and conversion rollback tests**

```ts
expect((await moveOpportunity("lead", "won")).status).toBe(422);
expect(savedFollowUp.actorId).toBe(session.member.publicId);
expect(projectAfterInjectedLinkFailure).toBeNull();
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/customers/opportunity-command-handler.test.ts`
Expected: commands do not exist.

- [ ] **Step 3: Implement state machine and conversion transaction**

Follow-up timestamps use database time. Conversion calls the project lifecycle RPC inside one transaction and creates `customer_project_links` plus audit.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/customers/opportunity-command-handler.test.ts`
Run: `npm run db:test`
Expected: invalid jumps fail, actor spoof is ignored, failed linking rolls back the project.

- [ ] **Step 5: Commit**

```bash
git add src/features/customers/opportunity-command-handler.ts src/features/customers/opportunity-command-handler.test.ts src/app/api/workstation/customers/[customerId]/opportunities/route.ts src/app/api/workstation/customers/[customerId]/follow-ups/route.ts src/app/api/workstation/opportunities/[opportunityId]/convert/route.ts supabase/migrations/202608260015_opportunity_commands.sql supabase/tests/customer_crm.sql
git commit -m "feat: add opportunity and customer delivery workflow"
```

### Task 4: Replace customer repository and UI with real responsive data

**Files:**
- Delete: `src/features/customers/customer-repository.ts`
- Modify: `src/features/customers/customers-workspace.tsx`
- Modify: `src/features/customers/customers-page.tsx`
- Modify: `src/features/customers/customers-page.test.tsx`
- Modify: `src/features/customers/components/create-customer-dialog.tsx`
- Modify: `src/features/customers/components/customer-detail-dialog.tsx`
- Create: `src/features/customers/customer-data.ts`
- Create: `src/features/customers/customer-data.test.ts`
- Create: `tests/e2e/customers.spec.ts`

**Interfaces:**
- Consumes Tasks 1-3 APIs.
- Produces server list/detail loaders and responsive customer workspace.

- [ ] **Step 1: Write failing no-seed and refresh tests**

```tsx
expect(screen.getByText(databaseCustomer.name)).toBeInTheDocument();
expect(screen.queryByText(seedCustomer.name)).not.toBeInTheDocument();
expect(window.localStorage.getItem("enterprise-workstation-customers")).toBeNull();
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/customers/customers-page.test.tsx src/features/customers/customer-data.test.ts`
Expected: current workspace initializes from seed/localStorage.

- [ ] **Step 3: Implement server loaders and API-backed dialogs**

Desktop uses list plus detail panel; mobile uses customer cards and full-screen detail. All mutations wait for server success and reload the entity.

- [ ] **Step 4: Verify GREEN and browser flow**

Run: `npx vitest run src/features/customers`
Run: `npx playwright test tests/e2e/customers.spec.ts --project=chrome`
Expected: customer -> contact -> opportunity -> follow-up -> project conversion survives refresh and another authorized browser.

- [ ] **Step 5: Commit**

```bash
git add -A src/features/customers tests/e2e/customers.spec.ts
git commit -m "feat: connect customer CRM to real data"
```

### Task 5: Add commercial CRM governance, exchange and lifecycle controls

**Files:**
- Create: `supabase/migrations/202608260036_crm_governance.sql`
- Modify: `supabase/tests/customer_crm.sql`
- Modify: `src/features/customers/customer-command-handler.ts`
- Modify: `src/features/customers/opportunity-command-handler.ts`
- Create: `src/features/customers/crm-import-export-handler.ts`
- Create: `src/features/customers/crm-import-export-handler.test.ts`
- Create: `src/app/api/workstation/customers/import/route.ts`
- Create: `src/app/api/workstation/customers/export/route.ts`

**Interfaces:**
- Produces ownership transfer, contact PII projection, stage-history, contract/source/project link, archive/restore and audit RPCs.
- Produces `validateCrmImport(rows, tenantId)` and `requestCrmExport(scope, idempotencyKey)` with permission-scoped columns and export audit.

- [ ] **Step 1: Write failing duplicate, transfer, PII, source-link and export-audit tests**

```ts
expect((await transferCustomer(unassignedEmployee)).status).toBe(403);
expect(opportunityStageHistory).toContainEqual(expect.objectContaining({ from: "qualified", to: "proposal" }));
expect(await exportAsUnassigned()).toMatchObject({ status: 403 });
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/customers/crm-import-export-handler.test.ts src/features/customers`
Run: `npm run db:test`
Expected: CRM governance and controlled import/export surfaces are absent.

- [ ] **Step 3: Implement tenant-safe governance**

Normalize dedupe keys, preserve ownership-transfer and opportunity-stage history, restrict contact PII, and link each customer/opportunity to permitted contract/project source records. Validate imports before one transaction per accepted row; export only authorized projections, watermark sensitive exports and append audit. Archive rather than hard-delete business entities and allow authorized restore.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/customers`
Run: `npm run db:test`
Run: `npx playwright test tests/e2e/customers.spec.ts --project=chrome`
Expected: dedupe, transfer, stage history, PII restrictions, import/export audit and archive/restore all respect tenant/role scope.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260036_crm_governance.sql supabase/tests/customer_crm.sql src/features/customers src/app/api/workstation/customers/import/route.ts src/app/api/workstation/customers/export/route.ts tests/e2e/customers.spec.ts
git commit -m "feat: add commercial CRM governance"
```
