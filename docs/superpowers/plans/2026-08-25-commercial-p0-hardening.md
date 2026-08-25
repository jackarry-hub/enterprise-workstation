# Commercial P0 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the highest-risk demo/mock leakage from production mode so the workstation can move from controlled demo toward real internal use.

**Architecture:** Add an explicit runtime-mode policy that makes production fail closed instead of silently falling back to mock data. Apply the policy to the project data path first, isolate demo authentication behind an explicit enable flag, stabilize the lint script, and fix the narrow viewport title overflow observed on the live workstation.

**Tech Stack:** Next.js 15 App Router, TypeScript, Supabase SSR/server client, Vitest, Node test runner, ESLint.

**Spec:** `docs/commercial-readiness-audit-2026-08-25.md`

## Global Constraints

- Do not remove AI 助理; Agent 中心 is an additional permanent entry.
- Production/customer mode must not silently render mock business data.
- Formal mode must keep role-based navigation: unavailable modules are hidden, not gray-disabled.
- Demo auth is allowed only when explicitly enabled by environment configuration.
- Every behavior change must have a failing test before production code changes.
- Do not print secrets or read business row contents during verification.

---

### Task 1: Runtime mode policy

**Files:**
- Create: `src/lib/runtime/workstation-mode.ts`
- Test: `tests/runtime/workstation-mode.test.ts`

**Interfaces:**
- Produces: `isDemoAuthEnabled(env?: NodeJS.ProcessEnv): boolean`
- Produces: `shouldAllowMockBusinessData(env?: NodeJS.ProcessEnv): boolean`

- [x] **Step 1: Write failing tests**

```ts
import { describe, expect, it } from "vitest";

import {
  isDemoAuthEnabled,
  shouldAllowMockBusinessData,
} from "@/lib/runtime/workstation-mode";

describe("workstation runtime mode", () => {
  it("disables demo auth unless explicitly enabled", () => {
    expect(isDemoAuthEnabled({ WORKSTATION_DEMO_ENABLED: "true" } as NodeJS.ProcessEnv)).toBe(true);
    expect(isDemoAuthEnabled({ WORKSTATION_DEMO_ENABLED: "false" } as NodeJS.ProcessEnv)).toBe(false);
    expect(isDemoAuthEnabled({} as NodeJS.ProcessEnv)).toBe(false);
  });

  it("allows mock business data only outside production or when explicitly opted in", () => {
    expect(shouldAllowMockBusinessData({ NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(false);
    expect(shouldAllowMockBusinessData({ NEXT_PUBLIC_WORKSTATION_ALLOW_MOCK_DATA: "true", NODE_ENV: "production" } as NodeJS.ProcessEnv)).toBe(true);
    expect(shouldAllowMockBusinessData({ NODE_ENV: "development" } as NodeJS.ProcessEnv)).toBe(true);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/runtime/workstation-mode.test.ts`

Expected: FAIL because `src/lib/runtime/workstation-mode.ts` does not exist.

- [x] **Step 3: Implement minimal runtime policy**

Create `src/lib/runtime/workstation-mode.ts` with strict boolean parsing and production fail-closed behavior.

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/runtime/workstation-mode.test.ts`

Expected: PASS.

### Task 2: Project data production fail-closed

**Files:**
- Modify: `src/features/projects/data/project-list-data.ts`
- Modify: `src/features/projects/data/project-detail-data.ts`
- Test: existing project data tests or new tests beside current project data tests.

**Interfaces:**
- Consumes: `shouldAllowMockBusinessData()`
- Keeps: explicit `allowMockFallback` test override still works.

- [x] **Step 1: Write failing tests**

Add tests proving production does not fall back to mock data when Supabase fails, and development still can fall back.

- [x] **Step 2: Run targeted tests to verify failure**

Run the relevant project data test file.

- [x] **Step 3: Implement policy usage**

Default `allowMockFallback` to `shouldAllowMockBusinessData()` instead of unconditional `true`.

- [x] **Step 4: Run targeted tests to verify pass**

Run the relevant project data tests.

### Task 3: Demo auth explicit enable flag

**Files:**
- Modify: `src/features/demo-auth/demo-auth-env.ts`
- Modify: `.env.example`
- Modify: `compose.yaml`
- Test: existing demo auth tests or a new focused test.

**Interfaces:**
- Consumes: `isDemoAuthEnabled()`
- Keeps: demo auth works when `WORKSTATION_DEMO_ENABLED=true` and all required secrets are present.

- [x] **Step 1: Write failing tests**

Add tests showing demo auth is unavailable when `WORKSTATION_DEMO_ENABLED` is absent or false.

- [x] **Step 2: Run targeted tests to verify failure**

Run the demo auth test file.

- [x] **Step 3: Implement explicit flag**

Return unavailable demo config unless the explicit flag is true.

- [x] **Step 4: Run targeted tests to verify pass**

Run the demo auth test file.

### Task 4: Engineering script and responsive cleanup

**Files:**
- Modify: `package.json`
- Modify: `quantxy-ai-workbench-fused.html`
- Modify: `public/quantxy-ai-workbench-fused.html`
- Test: existing HTML behavior tests.

**Interfaces:**
- Keeps: existing HTML behavior tests pass.
- Produces: `npm run lint` has enough Node heap on Windows/Linux shells through a portable command.

- [x] **Step 1: Write or extend behavior test where practical**

Add or update HTML test assertions for mobile/narrow header behavior if existing fixtures make it affordable.

- [x] **Step 2: Implement minimal cleanup**

Use a portable lint command with `cross-env` only if already installed; otherwise add a Node wrapper script. Add CSS constraints to avoid vertical title splitting and horizontal overflow.

- [x] **Step 3: Run verification**

Run `npm run lint`, `npm run test:html`, and `npm run build`.

### Task 5: P0 verification and handoff

**Files:**
- Modify: `docs/commercial-readiness-audit-2026-08-25.md`

**Interfaces:**
- Produces: updated report status with implemented P0 items and remaining P1/P2 items.

- [x] **Step 1: Run full verification**

Run:

```powershell
npm run test
npx tsc --noEmit --pretty false
npm run lint
npm run build
```

- [x] **Step 2: Record actual status**

Update the audit report with what was implemented and what remains blocked.

- [x] **Step 3: Present concise handoff**

Report verified commands, changed files, and next recommended phase.
