# QuantXY Analytics, Settings, Visualization, and PWA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace local settings and synthetic analytics with traceable server data, then deliver professional desktop visualization, mobile PWA navigation, and page-context quick creation.

**Architecture:** Settings persist through scoped PostgreSQL commands; analytics use tested database views with explicit as-of/definition metadata. A shared responsive shell renders desktop dropdowns or mobile bottom sheets from one contextual action registry.

**Tech Stack:** Next.js, React, TypeScript, Recharts, Supabase PostgreSQL, PWA manifest/Service Worker, Vitest, Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-26-quantxy-commercial-completion-design.md`

## Global Constraints

- Depends on Plans 01-08.
- Analytics never use fixed percentages, fabricated dates, mock members, or synthetic spark lines.
- Business settings are server-owned; localStorage may cache non-sensitive display preferences only.
- Desktop and mobile consume the same permissions, module capabilities, queries, and contextual actions.
- Mobile is an installable PWA, not a scaled desktop layout.

---

### Task 1: Persist enterprise, personal, notification, and scheduler settings

**Files:**
- Create: `supabase/migrations/202608260031_workspace_settings.sql`
- Create: `supabase/tests/workspace_settings.sql`
- Create: `src/features/settings/settings-data.ts`
- Create: `src/features/settings/settings-data.test.ts`
- Create: `src/features/settings/settings-command-handler.ts`
- Create: `src/features/settings/settings-command-handler.test.ts`
- Create: `src/app/api/workstation/settings/route.ts`
- Modify: `src/features/settings/settings-workspace.tsx`
- Delete: `src/features/settings/settings-session.ts`

**Interfaces:**
- Produces organization settings and per-member preferences with version numbers.
- Enterprise/scheduler changes require `settings.manage`; personal preferences require current user only.

- [ ] **Step 1: Write failing persistence, permission, and account-isolation tests**

```ts
expect((await updateEnterpriseSettings(employeeSession)).status).toBe(403);
expect((await updatePersonalSettings(employeeSession)).status).toBe(200);
expect(await loadSettings(otherEmployee)).not.toMatchObject(employeePreferences);
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/settings/settings-data.test.ts src/features/settings/settings-command-handler.test.ts src/features/settings/settings-page.test.tsx`
Expected: settings repository is localStorage and server modules are absent.

- [ ] **Step 3: Implement settings schema, scoped RPCs, and API-backed UI**

Persist organization, notification, personal and scheduler namespaces separately; validate each schema; use version conflict; append audit for organization-level changes.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/settings`
Run: `npm run db:test`
Expected: refresh/cross-account cases pass and local business settings key is absent.

- [ ] **Step 5: Commit**

```bash
git add -A src/features/settings src/app/api/workstation/settings/route.ts supabase/migrations/202608260031_workspace_settings.sql supabase/tests/workspace_settings.sql
git commit -m "feat: persist workspace settings"
```

### Task 2: Add traceable analytics views and real dashboards

**Files:**
- Create: `supabase/migrations/202608260032_commercial_analytics.sql`
- Create: `supabase/tests/commercial_analytics.sql`
- Create: `src/features/analytics/analytics-data.ts`
- Create: `src/features/analytics/analytics-data.test.ts`
- Modify: `src/features/analytics/analytics-workspace.tsx`
- Modify: `src/features/analytics/analytics-page.test.tsx`
- Modify: `src/features/dashboard/data.ts`
- Modify: `src/features/dashboard/dashboard-page.tsx`
- Modify: `src/features/dashboard/dashboard-page.test.tsx`

**Interfaces:**
- Produces RPC `current_commercial_metrics(from_date date, to_date date)` returning value, numerator, denominator, definition code, and `asOf`.
- Produces project health, task flow, customer pipeline, approval cycle, expense and AI usage aggregates.

- [ ] **Step 1: Write failing traceability and no-synthetic-data tests**

```ts
expect(metric).toMatchObject({ definitionCode: "task_completion_rate", numerator: 8, denominator: 10, value: 0.8 });
expect(dashboardSource).not.toContain("today()+18");
expect(screen.queryByText("固定洞察")).not.toBeInTheDocument();
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/analytics/analytics-data.test.ts src/features/analytics/analytics-page.test.tsx src/features/dashboard/dashboard-page.test.tsx`
Expected: analytics uses fixture projects/mock members and dashboard data is hard-coded.

- [ ] **Step 3: Implement database metrics and truthful visual states**

Use indexed views/RPC queries bounded by tenant/org and permission. Render metric definitions/as-of, null for unavailable metrics, and accessible chart/table alternatives.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/analytics src/features/dashboard`
Run: `npm run db:test`
Expected: known fixture rows in local DB produce exact documented numerators/denominators; no synthetic UI values remain.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260032_commercial_analytics.sql supabase/tests/commercial_analytics.sql src/features/analytics src/features/dashboard
git commit -m "feat: add traceable commercial analytics"
```

### Task 3: Build the real notification center

**Files:**
- Create: `supabase/migrations/202608260033_notification_center.sql`
- Create: `supabase/tests/notification_center.sql`
- Create: `src/features/notifications/notification-data.ts`
- Create: `src/features/notifications/notification-data.test.ts`
- Create: `src/features/notifications/notification-center.tsx`
- Create: `src/features/notifications/notification-center.test.tsx`
- Create: `src/app/api/workstation/notifications/[notificationId]/read/route.ts`
- Modify: `src/app/(workspace)/notifications/page.tsx`

**Interfaces:**
- Produces per-recipient notification projection and `mark_current_notification_read` RPC.
- Aggregates task, approval, expense, customer, knowledge and Agent events without exposing unauthorized entity detail.

- [ ] **Step 1: Write failing recipient and read-persistence tests**

```ts
expect(otherRecipientNotifications).not.toContainEqual(expect.objectContaining({ id: notificationId }));
expect((await markRead(currentRecipient)).status).toBe(200);
expect((await reloadNotification()).readAt).not.toBeNull();
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/notifications/notification-data.test.ts src/features/notifications/notification-center.test.tsx`
Expected: notification center uses operations fixture/localStorage and new modules are absent.

- [ ] **Step 3: Implement server notification projection and read command**

Store minimal safe payload, resolve entity links after authorization, mark read by recipient and version, and display sent/failed/unavailable states for Feishu delivery.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/notifications`
Run: `npm run db:test`
Expected: recipient isolation, safe payload and persistent read state pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/202608260033_notification_center.sql supabase/tests/notification_center.sql src/features/notifications src/app/api/workstation/notifications/[notificationId]/read/route.ts 'src/app/(workspace)/notifications/page.tsx'
git commit -m "feat: add the real notification center"
```

### Task 4: Implement page-context quick creation

**Files:**
- Create: `src/features/quick-create/contextual-create-actions.ts`
- Create: `src/features/quick-create/contextual-create-actions.test.ts`
- Create: `src/components/shell/contextual-create-menu.tsx`
- Create: `src/components/shell/contextual-create-menu.test.tsx`
- Create: `src/components/shell/mobile-create-sheet.tsx`
- Modify: `src/components/shell/workspace-header.tsx`
- Modify: `src/components/shell/workspace-shell.tsx`
- Modify: `src/components/shell/mobile-workspace-nav.tsx`

**Interfaces:**
- Produces `getContextualCreateActions({ pathname, session, capabilities }): readonly ContextualCreateAction[]`.
- `ContextualCreateAction` contains `id`, `label`, `icon`, `requiredPermission`, `module`, `target`.

- [ ] **Step 1: Write failing Agent-page and unrelated-action tests**

```ts
expect(getContextualCreateActions(agentContext).map((item) => item.id)).toEqual(["agent.create", "agent.orchestration.create", "agent.permission.request"]);
expect(getContextualCreateActions(agentContext).map((item) => item.id)).not.toContain("task.create");
expect(getContextualCreateActions(analyticsContext)).toEqual([]);
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/quick-create/contextual-create-actions.test.ts src/components/shell/contextual-create-menu.test.tsx`
Expected: registry/menu modules are absent and fused top action is globally task-based.

- [ ] **Step 3: Implement the approved page mapping and two presentations**

Desktop renders a dropdown in the header. Mobile renders a floating action button opening a bottom sheet. Both consume the exact same filtered array and hide entirely when empty.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/quick-create src/components/shell/contextual-create-menu.test.tsx src/components/shell/workspace-shell.test.tsx`
Expected: every approved page mapping and permission case passes; Agent Center shows only related actions.

- [ ] **Step 5: Commit**

```bash
git add src/features/quick-create src/components/shell/contextual-create-menu.tsx src/components/shell/contextual-create-menu.test.tsx src/components/shell/mobile-create-sheet.tsx src/components/shell/workspace-header.tsx src/components/shell/workspace-shell.tsx src/components/shell/mobile-workspace-nav.tsx
git commit -m "feat: add contextual quick creation"
```

### Task 5: Deliver the professional responsive PWA shell

**Files:**
- Create: `src/app/manifest.ts`
- Create: `public/sw.js`
- Create: `src/features/pwa/pwa-registration.tsx`
- Create: `src/features/pwa/pwa-registration.test.tsx`
- Modify: `src/app/layout.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/components/shell/workspace-shell.tsx`
- Modify: `src/components/shell/workspace-sidebar.tsx`
- Modify: `src/components/shell/mobile-workspace-nav.tsx`
- Modify: `src/components/ui/design-system.test.tsx`

**Interfaces:**
- Produces installable manifest and shell-only Service Worker cache.
- Breakpoints: phone `<768`, tablet `768-1199`, desktop `>=1200`.

- [ ] **Step 1: Write failing manifest, sensitive-cache, tap-target, and navigation tests**

```ts
expect(manifest.display).toBe("standalone");
expect(serviceWorkerSource).not.toMatch(/\/api\//);
expect(screen.getByTestId("mobile-primary-nav")).toBeVisible();
expect(primaryAction).toHaveStyle({ minHeight: "44px" });
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run src/features/pwa/pwa-registration.test.tsx src/components/ui/design-system.test.tsx src/components/shell/workspace-shell.test.tsx`
Expected: manifest/registration are absent and responsive App constraints fail.

- [ ] **Step 3: Implement PWA shell and responsive design tokens**

Cache only versioned static assets, show update/offline state, disable writes while offline, add safe-area padding, bottom navigation, full-screen mobile detail, sticky action bar, focus styles and WCAG AA status treatment.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run src/features/pwa src/components/ui src/components/shell`
Run: `npm run typecheck`
Expected: manifest, no-sensitive-cache, breakpoints, keyboard and tap-target tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/manifest.ts public/sw.js src/features/pwa src/app/layout.tsx src/app/globals.css src/components/shell src/components/ui/design-system.test.tsx
git commit -m "feat: deliver the responsive QuantXY PWA shell"
```

### Task 6: Add desktop/mobile visualization and interaction E2E

**Files:**
- Modify: `playwright.config.ts`
- Modify: `src/app/globals.css`
- Modify: `src/components/shell/workspace-shell.tsx`
- Modify: `src/components/shell/mobile-workspace-nav.tsx`
- Modify: `src/components/shell/contextual-create-menu.tsx`
- Modify: `src/components/shell/mobile-create-sheet.tsx`
- Modify: `src/components/ui/chart.tsx`
- Create: `tests/e2e/responsive-shell.spec.ts`
- Create: `tests/e2e/contextual-create.spec.ts`
- Create: `tests/e2e/pwa.spec.ts`
- Create: `tests/e2e/visual-data-truth.spec.ts`

**Interfaces:**
- Adds projects for Desktop Chrome, iPhone 13, Pixel 7, and iPad Mini compatible viewports.

- [ ] **Step 1: Write failing responsive and truthfulness scenarios**

```ts
await expect(page.getByTestId("mobile-primary-nav")).toBeVisible();
await expect(page.getByRole("button", { name: "快速创建" })).toBeVisible();
await expect(page.getByRole("menuitem", { name: "新建任务" })).toHaveCount(0); // Agent page
await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
```

- [ ] **Step 2: Verify RED on all four viewports**

Run: `npx playwright test tests/e2e/responsive-shell.spec.ts tests/e2e/contextual-create.spec.ts tests/e2e/pwa.spec.ts tests/e2e/visual-data-truth.spec.ts`
Expected: mobile projects and contextual/PWA contracts are not configured yet.

- [ ] **Step 3: Apply the responsive rules asserted by the browser tests**

Set the workspace content wrapper to `min-width: 0`, remove fixed-width header controls below 768px, reserve safe-area space for bottom navigation, render quick-create through the mobile bottom sheet on phone viewports, and make chart legends collapse into an accessible summary below the chart. Do not add global horizontal scrolling.

- [ ] **Step 4: Verify GREEN and full phase gate**

Run: `npx playwright test tests/e2e/responsive-shell.spec.ts tests/e2e/contextual-create.spec.ts tests/e2e/pwa.spec.ts tests/e2e/visual-data-truth.spec.ts`
Run: `npm run test:unit`
Run: `npm run typecheck`
Run: `npm run lint`
Expected: all viewports and code gates exit 0 with no horizontal critical-content overflow.

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts src/app/globals.css src/components/shell/workspace-shell.tsx src/components/shell/mobile-workspace-nav.tsx src/components/shell/contextual-create-menu.tsx src/components/shell/mobile-create-sheet.tsx src/components/ui/chart.tsx tests/e2e/responsive-shell.spec.ts tests/e2e/contextual-create.spec.ts tests/e2e/pwa.spec.ts tests/e2e/visual-data-truth.spec.ts
git commit -m "test: cover professional desktop and mobile PWA flows"
```
