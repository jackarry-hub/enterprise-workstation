# Project Detail Overview And Milestones Implementation Plan

**Goal:** Build `/projects/[id]` with Supabase-first data, a faithful project header, working overview and milestone tabs, milestone creation, responsive enterprise styling, and same-ID Mock fallback.

**Architecture:** The dynamic route is an async Next.js 15 Server Component that loads an RLS-scoped read model. A focused Client Component owns Tab state and local milestone state. The only write is a validated milestone Server Action; task and other modules remain placeholders.

## Constraints

- Implement only `/projects/[id]`, overview, milestones, and milestone creation.
- Tasks, Gantt, files, daily reports, and retrospective are interactive placeholders only.
- Reads prefer Supabase and fall back to matching Mock data.
- No task-center or unrelated module code.

### Task 1: Read model

- [ ] Add failing tests for matching Mock fallback and unknown IDs.
- [ ] Implement `loadProjectDetail()` and `ProjectDetailResult`.
- [ ] Query project first, then members, milestones, tasks, activities, and risks in parallel.
- [ ] Run the focused data tests green.

### Task 2: Header and Tab shell

- [ ] Add failing component tests for header data, seven Tab transitions, and task placeholder.
- [ ] Implement project detail header with edit, add-task, and more actions.
- [ ] Implement responsive seven-Tab shell.
- [ ] Run the focused component tests green.

### Task 3: Overview and milestones

- [ ] Add failing assertions for project goal, health, members, activities, and milestone rows.
- [ ] Implement overview cards and milestone stage list.
- [ ] Add failing test for the new-milestone form and immediate list update.
- [ ] Implement validated milestone Server Action plus local Mock fallback.
- [ ] Run project detail tests green.

### Task 4: Route and list navigation

- [ ] Add failing project-list navigation test.
- [ ] Implement async `/projects/[id]` route and loading state.
- [ ] Link project rows/cards to detail and keep sidebar project state active.
- [ ] Run all project feature tests green.

### Task 5: Verification and design QA

- [ ] Run typecheck, lint, full test suite, and production build.
- [ ] Verify overview, milestone, placeholder, create flow, console, and overflow in Browser/IAB.
- [ ] Capture desktop overview, desktop milestones, and mobile overview screenshots.
- [ ] Compare source and implementation together and write `design-qa.md` with final result `passed`.
