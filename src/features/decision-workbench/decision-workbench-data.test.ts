import { beforeEach, describe, expect, it } from "vitest";

import {
  createDecisionPlan,
  createDefaultDecisionInput,
  dispatchDecisionPlan,
  getDecisionCandidateRanking,
  getDecisionProgress,
  getDecisionStorageKey,
  getDecisionTalentProfile,
  hydrateDecisionPlan,
  readStoredDecision,
  saveStoredDecision,
} from "@/features/decision-workbench/decision-workbench-data";
import { clearLocalProjects } from "@/features/projects/data/mock-project-repository";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

const operationContext = createOperationFixtureContext(executiveWorkspaceSession);

describe("decision workbench data", () => {
  beforeEach(() => {
    window.localStorage.removeItem(getDecisionStorageKey(operationContext)!);
    clearLocalProjects();
  });

  it("creates an executable responsibility plan with one owner per task", () => {
    const input = createDefaultDecisionInput();
    const plan = createDecisionPlan(input);
    const tasks = plan.departments.flatMap(({ tasks: departmentTasks }) => departmentTasks);

    expect(plan.departments).toHaveLength(6);
    expect(tasks).toHaveLength(13);
    expect(tasks.every(({ assignee, acceptance, dueDate, requiredSkills }) => assignee.id && acceptance && dueDate && requiredSkills.length === 3)).toBe(true);
    expect(tasks.every((task) => getDecisionCandidateRanking(task)[0].member.id === task.assignee.id)).toBe(true);
    expect(getDecisionProgress(plan)).toEqual({ total: 13, pending: 13, inProgress: 0, inReview: 0, done: 0, completionRate: 0 });
  });

  it("explains AI staffing choices with evidence-based strengths and risks", () => {
    const plan = createDecisionPlan(createDefaultDecisionInput());
    const marketingTask = plan.departments.flatMap(({ tasks }) => tasks).find(({ id }) => id === "T09")!;
    const candidates = getDecisionCandidateRanking(marketingTask);
    const marketingProfile = getDecisionTalentProfile(candidates[0].member.id);

    expect(candidates[0].member.displayName).toBe("王芳");
    expect(candidates[0].matchedSkills).toEqual(["活动策划", "跨部门协同", "内容传播"]);
    expect(candidates[0].risks).toContain("近 30 天有 2 项延期");
    expect(marketingProfile.tags.find(({ label }) => label === "近期延期偏多")?.evidence).toContain("2 项任务");
  });

  it("dispatches the AI plan into the existing project and task repository", () => {
    const input = createDefaultDecisionInput();
    const plan = createDecisionPlan(input);
    const project = dispatchDecisionPlan(operationContext, input, plan, new Date("2026-08-08T08:00:00.000Z"));

    expect(project.tasks).toHaveLength(13);
    expect(project.members).toHaveLength(6);
    expect(project.tasks.every(({ assigneeId, description }) => assigneeId && description.startsWith("AI 决策下发"))).toBe(true);
    expect(hydrateDecisionPlan(plan, { ...project, tasks: project.tasks.map((task, index) => index === 0 ? { ...task, status: "done" as const } : task) }).departments.flatMap(({ tasks }) => tasks).filter(({ status }) => status === "done")).toHaveLength(1);

    const repeated = dispatchDecisionPlan(operationContext, input, plan, new Date("2026-08-09T08:00:00.000Z"));
    expect(repeated.project.id).toBe(project.project.id);
    expect(repeated.tasks).toHaveLength(13);
  });

  it("persists the decision stage for returning decision makers", () => {
    const decision = { version: 1 as const, stage: "review" as const, input: createDefaultDecisionInput(), plan: createDecisionPlan(createDefaultDecisionInput()) };
    saveStoredDecision(operationContext, decision);

    expect(readStoredDecision(operationContext)).toEqual(decision);
  });
});
