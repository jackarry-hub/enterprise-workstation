# QuantXY Commercial Completion Plan Index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one tenant-safe, formally usable commercial workbench for an approximately 100-person customer, in dependency order, while reserving future multi-tenant foundations without building a SaaS operation platform.

**Architecture:** Ten independently reviewable plans build the security foundation, real business modules, professional Next.js/PWA UI, and final release evidence. Each plan uses TDD and local/Staging-safe verification; production remains untouched.

**Tech Stack:** Next.js 15.5, React 19, TypeScript 5, Supabase/PostgreSQL/Storage, Feishu OpenAPI, DeepSeek, Vitest, pgTAP, Playwright, Docker.

**Spec:** `docs/superpowers/specs/2026-08-26-quantxy-commercial-completion-design.md`

## Global Constraints

- Local/CI-Test/Staging may be used only with isolated infrastructure and synthetic data; Internal and Customer Production deployment, migration, backfill, key configuration and real-data writes require explicit authorization.
- No production credential or production data may enter Local, CI/Test or ordinary Staging.
- Preserve unrelated WIP and untracked handoff artifacts.
- Use test RED -> implementation GREEN -> refactor for every production change.
- Commit only files belonging to the active task.
- Leave and attendance are excluded and hidden.
- All ten plans must pass before Internal trial or Customer Production authorization can be requested; Staging is required for OAuth, webhook, Storage, PWA/mobile-device, migration and security validation.

## Execution Order

- `2026-08-26-quantxy-01-security-entry.md` — completed security/entry baseline; do not restart Tasks 1-6; Plan02 owns shared phase command safety and Plan10 owns later release evidence.
- `2026-08-26-quantxy-02-organization-people.md` — first shared fail-closed DB command guard, OAuth plus full/incremental Feishu sync, direct-manager/supervisor scope, private PII and offboarding revoke.
- `2026-08-26-quantxy-03-project-task-delivery.md` — members, activities/milestones/tasks/dependencies/acceptance, files/history/archive and durable notifications.
- `2026-08-26-quantxy-04-customer-crm.md` — contacts/opportunities/follow-ups, dedupe, ownership transfer, history, import/export and audit/archive.
- `2026-08-26-quantxy-05-approvals-expenses-payroll.md` — versioned approvals, expense payment/finance review and locked/snapshotted payroll, excluding a payroll engine/designer.
- `2026-08-26-quantxy-06-knowledge.md` — tenant Storage, scan/quarantine, OCR/parse, permissions, vector/citations and lifecycle cleanup.
- `2026-08-26-quantxy-07-ai-assistant-scheduler.md` — persistent conversations and governed queue/scheduler with human confirmation for eight high-risk actions.
- `2026-08-26-quantxy-08-agent-runtime.md` — remaining Agent runtime work: allowlists/budgets/human controls/Kill Switch; autonomous multi-Agent collaboration Deferred. Plan01 owns the already-delivered immutable invocation ledger and its service-authenticated stale-running recovery schedule.
- `2026-08-26-quantxy-09-analytics-settings-pwa.md` — desktop plus true mobile workflows, PWA security/cache behavior and real-device matrix.
- `2026-08-26-quantxy-10-cutover-release.md` — consumes the shared guard; migration safety, separate local/Staging/final evidence gates, authorized fused retirement, canary/runbooks and delivery bundle.

## Phase Gate

Plan02 Task1 owns the executable aliases `test:coverage`, `test:security`, `test:rls`, `db:reset:test`, `db:migrate:dry-run`, `db:test`, `db:seed:validate` and `db:rollback:test`; all later plans consume them.

After each plan:

```powershell
npm run test:unit
npm run test:coverage
npm run typecheck
npm run lint
npm run build
npm run test:security
npm run test:rls
git diff --check
```

After any migration plan:

```powershell
npm run db:reset:test
npm run db:migrate:dry-run
npm run db:test
npm run db:seed:validate
npm run db:rollback:test
```

After any user-facing workflow plan:

```powershell
npm run test:e2e
```

Final gate is defined only by Plan 10: `npm run verify:commercial:local` establishes local evidence, user-authorized `npm run verify:commercial:staging` establishes isolated Staging evidence, and `npm run verify:commercial` consumes signed/hash-matched evidence. The final command is BLOCKED when Staging/restore/canary/real-device/RPO/RTO/artifact evidence is missing; passing earlier unit/build commands is not sufficient for release.

## Spec Coverage

| Spec section | Implementing plans |
|---|---|
| Decisions, scope, architecture, global security | 01, 10 |
| Organization and people | 02 |
| Project execution, activities, tasks, files, notifications | 03 |
| Customer and delivery | 04 |
| Approvals, expenses, payroll | 05 |
| Knowledge | 06 |
| AI configuration, assistant and scheduling | 01, 07 |
| Agent Center and runtime | 01, 08 |
| Analytics, settings, quick create, visualization and PWA | 09 |
| Environment isolation, DB safety, migration, security, performance, recovery and completion gate | 02, 10 |
| Commercial capacity/RPO/RTO and desktop/mobile/device gates | 03, 07, 09, 10 |

## External dependencies and final readiness

Staging requires an isolated Supabase/Storage project, Feishu OAuth/Webhook test application, AI test key, domain/TLS, monitoring and backup target. Internal/Customer Production always need separate equivalents and explicit authorization. `verify:commercial:local` proves clean install/build, coverage, DB/RLS, integration, desktop/emulated-mobile E2E, a11y, dependency/secret scan, migration dry-run and load harness. Authorized `verify:commercial:staging` proves smoke, restore, canary and real-device/OAuth/Storage/security evidence. Final `verify:commercial` fails closed without signed/hash-matched evidence and artifact manifest; unit/lint/build alone never authorize release.
