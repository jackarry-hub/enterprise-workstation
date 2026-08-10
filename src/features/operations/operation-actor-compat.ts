import type {
  WorkspaceActor,
  WorkspaceRole,
} from "@/features/auth/workspace-session-types";

const operationFixtureIdsByRole: Record<
  WorkspaceRole,
  Pick<WorkspaceActor, "id" | "memberId">
> = {
  executive: {
    id: "actor-executive",
    memberId: "20000000-0000-4000-8000-000000000010",
  },
  department_head: {
    id: "actor-manager",
    memberId: "20000000-0000-4000-8000-000000000001",
  },
  employee: {
    id: "actor-employee",
    memberId: "20000000-0000-4000-8000-000000000004",
  },
  finance: {
    id: "actor-finance",
    memberId: "20000000-0000-4000-8000-000000000007",
  },
  hr: {
    id: "actor-hr",
    memberId: "20000000-0000-4000-8000-000000000006",
  },
};

export function toOperationFixtureActor(actor: WorkspaceActor) {
  return {
    ...actor,
    ...operationFixtureIdsByRole[actor.role],
  };
}
