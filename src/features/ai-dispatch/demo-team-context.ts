import type { DemoTeamMemberContext } from "@/features/ai-dispatch/dispatch-contract";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import { createInitialOperationsState } from "@/features/operations/operations-data";
import {
  customerDemoPeople,
  customerDemoSessions,
  getCustomerDemoSkillLabel,
} from "@/features/demo/customer-demo-data";

function workStatus(activeTaskCount: number): DemoTeamMemberContext["status"] {
  if (activeTaskCount >= 3) return "满负荷";
  if (activeTaskCount > 0) return "执行中";
  return "可接受任务";
}

export function buildDemoTeamContext(): DemoTeamMemberContext[] {
  const context = createOperationFixtureContext(customerDemoSessions[0]);
  const state = createInitialOperationsState(context);

  return customerDemoPeople.map((person) => {
    const activeTaskCount = state.tasks.filter((task) => (
      task.assigneeId === person.actorId && task.status !== "done"
    )).length;
    return {
      name: person.name,
      jobTitle: person.jobTitle,
      department: person.department,
      skills: person.skills.map(getCustomerDemoSkillLabel),
      responsibility: person.responsibility,
      workload: Math.min(100, activeTaskCount * 25),
      activeTaskCount,
      status: workStatus(activeTaskCount),
      canDispatch: person.role !== "employee",
    };
  });
}
