# AI Structured Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DeepSeek WBS generation return validated JSON or one stable failure after one retry.

**Architecture:** Extend the existing authenticated server chat proxy with an explicit structured-output mode. Keep generic chat behavior unchanged; validate only structured responses and retry inside the server boundary so secrets and raw provider failures never reach the browser.

**Tech Stack:** Next.js 15 route handlers, TypeScript, Vitest, standalone HTML, Node test runner

**Spec:** `docs/superpowers/specs/2026-08-21-ai-talent-notification-design.md`

## Global Constraints

- DeepSeek credentials remain server-only.
- Structured mode retries at most once.
- The browser never parses `reasoning_content` as final WBS JSON.
- Existing generic chat behavior remains backward compatible.

---

### Task 1: Structured DeepSeek proxy

**Files:**
- Modify: `src/features/ai-config/ai-chat-handler.ts`
- Modify: `src/features/ai-config/ai-chat-handler.test.ts`

**Interfaces:**
- Consumes: request field `structured_output?: boolean`.
- Produces: DeepSeek payload with `response_format: { type: "json_object" }` and `thinking: { type: "disabled" }`; stable `upstream_invalid_response` after two invalid attempts.

- [ ] **Step 1: Write failing tests** for forwarding JSON mode, retrying empty/invalid/truncated content once, accepting the second valid JSON object, and stopping after the second failure.
- [ ] **Step 2: Run `npm run test:unit -- src/features/ai-config/ai-chat-handler.test.ts`** and confirm failures identify missing structured behavior.
- [ ] **Step 3: Implement request validation and the two-attempt structured response loop** without changing normal chat forwarding.
- [ ] **Step 4: Run the focused test** and confirm all cases pass.

### Task 2: Formal WBS client contract

**Files:**
- Modify: `public/quantxy-ai-workbench-fused.html`
- Modify: `tests/html-personal-workbench-behavior.test.mjs`

**Interfaces:**
- Consumes: `/api/ai/chat` with `structured_output: true` and `max_tokens: 2400`.
- Produces: validated WBS tasks containing `skills: string[]`; user-facing fallback copy that distinguishes response formatting from key configuration.

- [ ] **Step 1: Write a failing jsdom behavior test** that clicks generation, captures the request, supplies valid structured content, and verifies skills are preserved.
- [ ] **Step 2: Run the focused HTML test** and confirm the request/skills assertions fail.
- [ ] **Step 3: Update the WBS prompt, request, parser and stable fallback copy.**
- [ ] **Step 4: Run the focused HTML test and the full HTML suite.**

### Task 3: AI verification

**Files:**
- Verify only.

- [ ] **Step 1: Run `npm run test:unit -- src/features/ai-config/ai-chat-handler.test.ts`.**
- [ ] **Step 2: Run `npm run test:html`.**
- [ ] **Step 3: Run `npm run typecheck`.**
