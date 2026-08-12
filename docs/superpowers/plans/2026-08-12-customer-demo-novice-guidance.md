# Customer Demo Novice Guidance Implementation Plan

> **For Codex:** Use `superpowers:test-driven-development` task by task. Keep production and demo behavior separated; the guidance UI renders only when customer demo sessions are available.

**Goal:** Make the ten-person customer demo self-guiding, state-consistent, and completable by a first-time user from employee submission through archive.

**Architecture:** Add one pure journey selector that derives the current six-step demo position and recommended actor from the existing operations state. Render one shared client guidance card below the workspace header, using the current demo person catalog as the sole source of role, responsibility, and skill tags. Fix workflow feedback at the domain and role-workbench layers so the guide, inbox, timeline, and reset all reflect the same state.

**Tech Stack:** Next.js 15, React 19, TypeScript, Tailwind CSS, shadcn UI, Vitest, Testing Library.

---

### Task 1: Derive a deterministic six-step demo journey

**Files:**
- Create: `src/features/demo/customer-demo-journey.ts`
- Test: `src/features/demo/customer-demo-journey.test.ts`
- Modify: `src/features/demo/customer-demo-data.test.ts`

**Steps:**

1. Write failing tests for every journey state: initial employee submission, first manager return, employee resubmission, manager approval, executive review, executive acceptance, and archive.
2. Add assertions that all ten people have one responsibility and exactly three non-empty skill tags.
3. Run the focused tests and confirm they fail for the missing selector.
4. Implement typed journey step metadata and a pure `getCustomerDemoJourney(state)` selector.
5. Derive the step from command status, the canonical employee task, its deliverables, review note, and workflow events; do not store a separate step counter.
6. Run the focused tests until green.

### Task 2: Add the shared novice navigation and personal tags

**Files:**
- Create: `src/features/demo/customer-demo-guide.tsx`
- Create: `src/features/demo/customer-demo-guide.test.tsx`
- Modify: `src/components/shell/workspace-shell.tsx`
- Modify: `src/components/shell/workspace-header.tsx`

**Steps:**

1. Write component tests for current identity, department, job title, responsibility, three skill tags, current step, next actor, and identity switching.
2. Confirm the new tests fail before the component exists.
3. Implement a compact shared guide card using the existing card, badge, button, and icon components.
4. Render the guide only in customer demo mode, directly below the sticky header and above page content.
5. Add an expandable six-step overview and a primary CTA that either switches to the required person or navigates to the current task/closure action.
6. Enrich the identity menu with the current person’s responsibility and Chinese skill labels without expanding the list into large profile cards.
7. Run guide, session, shell, and header tests.

### Task 3: Fix task return, direct handling, and novice action hints

**Files:**
- Modify: `src/features/operations/operations-data.ts`
- Modify: `src/features/operations/operations-types.ts`
- Modify: `src/features/operations/operation-action-inbox.tsx`
- Modify: `src/features/operations/role-workbench.tsx`
- Modify: `src/features/operations/operations-data.test.ts`
- Modify: `src/features/operations/role-workbench.test.tsx`

**Steps:**

1. Write failing tests that a returned assignee task appears in “今日必须处理”, counts as attention, and produces a “退回修改” timeline event.
2. Write component tests for the direct task anchor, return guidance, disabled submission explanation, one-click sample review notes, and success copy naming the next person.
3. Confirm focused tests fail for the observed audit defects.
4. Update action-item derivation so returned tasks are actionable for the assignee and task-review actions link to `#task-{id}`.
5. Give each task card a stable anchor and scroll margin.
6. Require reviewer comments in the UI, add distinct sample return/approval comments, and keep domain validation as the final guard.
7. Add clear copy around “使用演示成果”, missing deliverables, resubmission, and cross-role state synchronization.
8. Use transition-aware timeline labels so `review -> in_progress` is “退回修改”, not “开始执行”.
9. Run focused data and component tests until green.

### Task 4: Fix executive status guidance and reset consistency

**Files:**
- Modify: `src/features/operations/executive-closure-panel.tsx`
- Modify: `src/features/decision-workbench/decision-workbench.tsx`
- Modify: `src/features/demo/customer-demo-state.ts`
- Modify: `src/features/operations/operations-data.ts`
- Modify: `src/features/operations/operations-data.test.ts`
- Modify: `src/features/demo/customer-demo-state.test.ts`
- Add or modify the closest executive/decision component tests.

**Steps:**

1. Write failing tests for the disabled total-acceptance reason, remaining actor/action copy, command-based decision step highlighting, and reset clearing transient feedback.
2. Confirm the focused tests expose the current inconsistencies.
3. Derive the executive unmet-condition explanation from incomplete tasks and open support requests.
4. Make the decision stepper follow live command status in demo mode while retaining the existing decision workflow behavior outside demo mode.
5. Clear shared demo feedback during reset and key feedback by the state that created it so stale archive messages cannot survive a reset.
6. Correct seed task dependencies so no completed task depends on an incomplete task.
7. Run focused tests until green.

### Task 5: Update the handoff guide and verify the complete novice journey

**Files:**
- Modify: `客户演示说明.md`
- Modify: `docs/企业工作站使用说明.md` only if the customer-demo section already exists and needs matching copy.

**Steps:**

1. Update the customer demo guide with the six steps, personal tags, guide card behavior, reset instructions, and the current local demo port fallback.
2. Run all unit/component tests.
3. Run TypeScript checking, lint, and `build:demo`.
4. Reload the existing in-app browser preview and visually verify desktop and narrow layouts.
5. Complete the full browser flow: employee submit → manager return → employee resubmit → manager approve → executive total review → approve → archive.
6. Check browser warnings/errors and verify the guide advances at every state.
7. Reset the demo and verify the initial guide, task state, timeline, and feedback are restored.
8. Record final screenshots for employee, manager, executive, and archive states, then leave the initial demo page open for the user.
