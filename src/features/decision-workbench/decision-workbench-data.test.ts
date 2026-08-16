import { beforeEach, describe, expect, it } from "vitest";

import {
  createDecisionPlan,
  createDecisionPlanFromDeepSeek,
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
import { customerDemoPeople } from "@/features/demo/customer-demo-data";
import { validDispatchPlan } from "@/test/ai-dispatch-test-utils";

const operationContext = createOperationFixtureContext(executiveWorkspaceSession);

describe("decision workbench data", () => {
  beforeEach(() => {
    window.localStorage.removeItem(getDecisionStorageKey(operationContext)!);
    clearLocalProjects(operationContext);
  });

  it("creates an executable responsibility plan with one owner per task", () => {
    const input = createDefaultDecisionInput();
    const plan = createDecisionPlan(input);
    const tasks = plan.departments.flatMap(({ tasks: departmentTasks }) => departmentTasks);
    const expectedAssignees = customerDemoPeople
      .filter(({ role }) => role !== "executive")
      .map(({ memberId }) => memberId);

    expect(input.goal).toBe("30 天完成星云智造量子智枢试点上线");
    expect(plan.departments).toHaveLength(7);
    expect(tasks).toHaveLength(10);
    expect(new Set(tasks.map(({ assignee }) => assignee.id))).toEqual(new Set(expectedAssignees));
    expect(tasks.every(({ assignee, acceptance, dueDate, requiredSkills }) => assignee.id && acceptance && dueDate && requiredSkills.length === 3)).toBe(true);
    expect(tasks.every((task) => getDecisionCandidateRanking(task)[0].member.id === task.assignee.id)).toBe(true);
    expect(getDecisionProgress(plan)).toEqual({ total: 10, pending: 10, inProgress: 0, inReview: 0, done: 0, completionRate: 0 });
  });

  it("adapts a DeepSeek response into the decision review workspace", () => {
    const plan = createDecisionPlanFromDeepSeek(
      validDispatchPlan,
      "deepseek-v4-flash",
      false,
      new Date("2026-08-13T08:00:00.000Z"),
    );
    const tasks = plan.departments.flatMap(({ tasks: departmentTasks }) => departmentTasks);

    expect(plan.ai).toMatchObject({ provider: "deepseek", model: "deepseek-v4-flash", summary: validDispatchPlan.summary });
    expect(tasks).toHaveLength(3);
    expect(tasks.map(({ assignee }) => assignee.displayName)).toEqual(["张伟", "陈晨", "郭敏"]);
    expect(tasks[1].dependencies).toEqual([tasks[0].id]);
    expect(tasks.every(({ acceptance }) => acceptance.includes("提交可核验成果"))).toBe(true);
  });

  it("explains AI staffing choices with evidence-based strengths and risks", () => {
    const plan = createDecisionPlan(createDefaultDecisionInput());
    const marketingTask = plan.departments.flatMap(({ tasks }) => tasks).find(({ id }) => id === "T02")!;
    const candidates = getDecisionCandidateRanking(marketingTask);
    const marketingProfile = getDecisionTalentProfile(candidates[0].member.id);

    expect(candidates[0].member.displayName).toBe("王芳");
    expect(candidates.some(({ member }) => member.displayName === "林远")).toBe(false);
    expect(candidates[0].matchedSkills).toEqual(["活动策划", "跨部门协同", "内容传播"]);
    expect(candidates[0].risks).toContain("近 30 天有 2 项延期");
    expect(marketingProfile.tags.find(({ label }) => label === "近期延期偏多")?.evidence).toContain("2 项任务");
  });

  it("dispatches the AI plan into the existing project and task repository", () => {
    const input = createDefaultDecisionInput();
    const plan = createDecisionPlan(input);
    const project = dispatchDecisionPlan(operationContext, input, plan, new Date("2026-08-08T08:00:00.000Z"));

    expect(project.tasks).toHaveLength(10);
    expect(project.members).toHaveLength(10);
    expect(project.tasks.every(({ assigneeId, description }) => assigneeId && description.startsWith("AI 决策下发"))).toBe(true);
    expect(hydrateDecisionPlan(plan, { ...project, tasks: project.tasks.map((task, index) => index === 0 ? { ...task, status: "done" as const } : task) }).departments.flatMap(({ tasks }) => tasks).filter(({ status }) => status === "done")).toHaveLength(1);

    const repeated = dispatchDecisionPlan(operationContext, input, plan, new Date("2026-08-09T08:00:00.000Z"));
    expect(repeated.project.id).toBe(project.project.id);
    expect(repeated.tasks).toHaveLength(10);
  });

  it("persists the decision stage for returning decision makers", () => {
    const decision = { version: 1 as const, stage: "review" as const, input: createDefaultDecisionInput(), plan: createDecisionPlan(createDefaultDecisionInput()) };
    saveStoredDecision(operationContext, decision);

    expect(readStoredDecision(operationContext)).toEqual(decision);
  });
});
