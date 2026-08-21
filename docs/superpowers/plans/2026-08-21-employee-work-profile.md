# Employee Work Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each authenticated employee maintain a professional work profile and let managers receive explainable real-data task recommendations.

**Architecture:** Store self-maintained fields in a dedicated tenant-scoped table, reuse verified skill rows, and derive delivery/load evidence from formal tasks during bootstrap. Keep the large standalone HTML as the presentation shell while adding one narrow server adapter method for writes.

**Tech Stack:** Supabase Postgres/RLS, Next.js route handlers, TypeScript, Vitest, standalone HTML/jsdom

**Spec:** `docs/superpowers/specs/2026-08-21-ai-talent-notification-design.md`

## Global Constraints

- Salary data is never read by matching code.
- Employees may write only their own profile.
- Colleagues see professional collaboration fields only.
- Mobile keeps the profile under “More”; the employee home stays minimal.

---

### Task 1: Work profile persistence

**Files:**
- Create: `supabase/migrations/202608210001_employee_work_profiles.sql`
- Create: `src/features/work-profile/work-profile-schema.ts`
- Create: `src/features/work-profile/work-profile-schema.test.ts`

**Interfaces:**
- Produces: `employee_work_profiles` with summary, task preferences, growth goals, weekly capacity and validated self-rated skills.
- Produces: `parseWorkProfileInput(value)` returning normalized server-safe input or `null`.

- [ ] **Step 1: Write failing parser tests** for valid normalization and all field/count/length boundaries.
- [ ] **Step 2: Run the focused tests and confirm the parser is missing.**
- [ ] **Step 3: Implement the parser and tenant-safe RLS migration.**
- [ ] **Step 4: Run the focused tests.**

### Task 2: Self-service API and formal bootstrap

**Files:**
- Create: `src/app/api/workstation/work-profile/handler.ts`
- Create: `src/app/api/workstation/work-profile/handler.test.ts`
- Create: `src/app/api/workstation/work-profile/route.ts`
- Modify: `src/app/api/workstation/bootstrap/handler.ts`
- Modify: `src/app/api/workstation/bootstrap/handler.test.ts`
- Modify: `src/features/workstation/server-bootstrap.ts`
- Modify: `src/features/workstation/server-bootstrap.test.ts`

**Interfaces:**
- Produces: authenticated `PUT /api/workstation/work-profile` for the current member only.
- Produces: bootstrap member field `workProfile` with self/verified skills and derived delivery evidence.

- [ ] **Step 1: Write failing route tests** for unauthenticated, invalid and successful current-member writes.
- [ ] **Step 2: Write failing bootstrap tests** for verified/self skill merge, workload, overdue and on-time evidence.
- [ ] **Step 3: Run focused tests and confirm expected failures.**
- [ ] **Step 4: Implement the API and bootstrap mapping using parallel independent reads.**
- [ ] **Step 5: Run focused tests and confirm they pass.**

### Task 3: Employee profile UI and recommendation explanations

**Files:**
- Modify: `public/workstation-server-adapter.js`
- Modify: `public/quantxy-ai-workbench-fused.html`
- Modify: `tests/html-workstation-server-adapter.test.mjs`
- Modify: `tests/html-personal-workbench-behavior.test.mjs`

**Interfaces:**
- Produces: `WORKSTATION_GATEWAY.saveWorkProfile(input)`.
- Produces: clickable “我的工作画像” page and top-three explainable candidates for every scheduled task.

- [ ] **Step 1: Write failing adapter and jsdom behavior tests** for saving only the current profile, mobile placement, and candidate explanation.
- [ ] **Step 2: Run the focused tests and confirm the new interactions are absent.**
- [ ] **Step 3: Implement the adapter, profile page, form validation and explainable scoring.**
- [ ] **Step 4: Run focused tests and the full HTML suite.**

### Task 4: Work profile verification

- [ ] **Step 1: Run the work-profile and bootstrap unit tests.**
- [ ] **Step 2: Run `npm run test:html`.**
- [ ] **Step 3: Run `npm run typecheck` and `npm run lint`.**
