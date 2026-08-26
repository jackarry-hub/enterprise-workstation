# QuantXY Commercial Completion Plan Index

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the approved QuantXY commercial completion design in dependency order without deploying until every module passes the release gate.

**Architecture:** Ten independently reviewable plans build the security foundation, real business modules, professional Next.js/PWA UI, and final release evidence. Each plan uses TDD and local/Staging-safe verification; production remains untouched.

**Tech Stack:** Next.js 15.5, React 19, TypeScript 5, Supabase/PostgreSQL/Storage, Feishu OpenAPI, DeepSeek, Vitest, pgTAP, Playwright, Docker.

**Spec:** `docs/superpowers/specs/2026-08-26-quantxy-commercial-completion-design.md`

## Global Constraints

- Do not upload or deploy during implementation.
- Do not write production data.
- Preserve unrelated WIP and untracked handoff artifacts.
- Use test RED -> implementation GREEN -> refactor for every production change.
- Commit only files belonging to the active task.
- Leave and attendance are excluded and hidden.
- All ten plans must pass before production authorization can be requested.

## Execution Order

- [ ] `2026-08-26-quantxy-01-security-entry.md` — P0 security, salary privacy, Agent authorization, single route registry.
- [ ] `2026-08-26-quantxy-02-organization-people.md` — Feishu directory, private PII, organization commands, profiles and skills.
- [ ] `2026-08-26-quantxy-03-project-task-delivery.md` — projects, activities, tasks, reports, files and durable notifications.
- [ ] `2026-08-26-quantxy-04-customer-crm.md` — customers, contacts, opportunities, follow-ups and delivery conversion.
- [ ] `2026-08-26-quantxy-05-approvals-expenses-payroll.md` — approval state machine, expense payment and payroll UI.
- [ ] `2026-08-26-quantxy-06-knowledge.md` — directories, versions, permissions, upload, search and sources.
- [ ] `2026-08-26-quantxy-07-ai-assistant-scheduler.md` — AI runtime, conversations, scheduling plans, overrides and dispatch.
- [ ] `2026-08-26-quantxy-08-agent-runtime.md` — Agent versions, permissions, orchestration, runs and Agent Center.
- [ ] `2026-08-26-quantxy-09-analytics-settings-pwa.md` — analytics, settings, notifications, contextual creation and mobile PWA.
- [ ] `2026-08-26-quantxy-10-cutover-release.md` — fused removal, CI, clean DB, security hardening and release evidence.

## Phase Gate

After each plan:

```powershell
npm run test:unit
npm run typecheck
npm run lint
git diff --check
```

After any migration plan:

```powershell
npm run db:reset
npm run db:test
```

After any user-facing workflow plan:

```powershell
npm run test:e2e
```

Final gate is defined only by Plan 10 and must finish with `npm run verify:commercial`; passing earlier unit/build commands is not sufficient for release.

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
| Error handling, testing, cutover and completion gate | 01, 10 |
