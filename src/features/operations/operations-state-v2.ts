import type {
  OperationTask,
  OperationWorkstream,
  OperationsState,
} from "@/features/operations/operations-types";

export type LegacyOperationTask = Omit<
  OperationTask,
  "workstreamId" | "projectId" | "runtimeSource"
> & { runtimeSource?: "ai_dispatch" };

type StoredOperationTask = Omit<
  OperationTask,
  "workstreamId" | "projectId" | "runtimeSource"
> & Partial<Pick<OperationTask, "workstreamId" | "projectId" | "runtimeSource">>;

export type OperationsStateV1 = Omit<
  OperationsState,
  "version" | "workstreams" | "activeAiWorkstreamId" | "tasks"
> & {
  version: 1;
  tasks: LegacyOperationTask[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function findDepartmentSeedTask(
  task: Pick<OperationTask, "id" | "assigneeId" | "department">,
  seed: OperationsState,
) {
  return seed.tasks.find((candidate) => candidate.id === task.id)
    ?? seed.tasks.find((candidate) => (
      candidate.assigneeId === task.assigneeId
      && candidate.department === task.department
    ))
    ?? seed.tasks.find((candidate) => candidate.department === task.department);
}

function normalizeStoredTask(
  task: StoredOperationTask,
  workstreams: OperationWorkstream[],
  activeAiWorkstreamId: string | undefined,
  seed: OperationsState,
): OperationTask {
  const storedWorkstream = workstreams.find(({ id }) => id === task.workstreamId);
  const activeAiWorkstream = workstreams.find(({ id }) => id === activeAiWorkstreamId);
  const runtimeSource = task.runtimeSource
    ?? storedWorkstream?.source
    ?? (activeAiWorkstreamId !== undefined && task.workstreamId === activeAiWorkstreamId
      ? "ai_dispatch"
      : "department_mock");
  const seededDepartmentTask = runtimeSource === "department_mock"
    ? findDepartmentSeedTask(task, seed)
    : undefined;
  const fallbackWorkstream = runtimeSource === "ai_dispatch"
    ? activeAiWorkstream ?? workstreams.find(({ source }) => source === "ai_dispatch")
    : seed.workstreams.find(({ id }) => id === seededDepartmentTask?.workstreamId)
      ?? seed.workstreams.find(({ source }) => source === "department_mock");

  return {
    ...task,
    workstreamId: task.workstreamId ?? fallbackWorkstream?.id ?? seed.workstreams[0].id,
    projectId: task.projectId
      ?? storedWorkstream?.projectId
      ?? fallbackWorkstream?.projectId
      ?? seed.workstreams[0].projectId,
    runtimeSource,
    dependencyIds: task.dependencyIds ?? [],
    escalationLevel: task.escalationLevel ?? "none",
  };
}

function createLegacyAiWorkstream(
  input: OperationsStateV1,
): OperationWorkstream {
  return {
    id: `legacy-ai-workstream-${input.command.id}`,
    source: "ai_dispatch",
    title: input.command.title,
    ownerId: input.command.ownerId,
    projectId: input.command.projectId ?? `legacy-ai-project-${input.command.id}`,
    status: input.command.status === "archived" ? "archived" : "active",
    createdAt: input.command.createdAt,
    updatedAt: input.command.updatedAt,
  };
}

export function normalizeOperationsState(
  input: unknown,
  seed: OperationsState,
): OperationsState {
  if (!isRecord(input)) return seed;
  if (input.version === 2) {
    const current = input as unknown as OperationsState;
    const workstreams = Array.isArray(current.workstreams) ? current.workstreams : seed.workstreams;
    return {
      ...seed,
      ...current,
      version: 2,
      workstreams,
      tasks: Array.isArray(current.tasks)
        ? current.tasks.map((task) => normalizeStoredTask(
          task,
          workstreams,
          current.activeAiWorkstreamId,
          seed,
        ))
        : seed.tasks,
      notificationReads: current.notificationReads ?? {},
      dispatchHistory: current.dispatchHistory ?? [],
    };
  }
  if (input.version === 1) {
    return migrateOperationsStateV1(input as OperationsStateV1, seed);
  }
  return seed;
}

export function migrateOperationsStateV1(
  input: OperationsStateV1,
  seed: OperationsState,
): OperationsState {
  const usesSeedCommand = input.command.id === seed.command.id;
  const isAiTask = (task: LegacyOperationTask) => (
    task.runtimeSource === "ai_dispatch"
    || (!usesSeedCommand && task.commandId === input.command.id)
  );
  const legacyAiTasks = input.tasks.filter(isAiTask);
  const legacyDepartmentTasks = input.tasks.filter((task) => !isAiTask(task));
  const migratedAi = legacyAiTasks.length ? createLegacyAiWorkstream(input) : undefined;
  const attachAi = (task: LegacyOperationTask): OperationTask => ({
    ...task,
    workstreamId: migratedAi!.id,
    projectId: migratedAi!.projectId,
    runtimeSource: "ai_dispatch",
    dependencyIds: task.dependencyIds ?? [],
    escalationLevel: task.escalationLevel ?? "none",
  });
  const defaultDepartmentWorkstream = seed.workstreams.find(
    ({ source }) => source === "department_mock",
  ) ?? seed.workstreams[0];
  const attachDepartment = (task: LegacyOperationTask): OperationTask => {
    const seeded = findDepartmentSeedTask(task, seed);
    return {
      ...task,
      workstreamId: seeded?.workstreamId ?? defaultDepartmentWorkstream.id,
      projectId: seeded?.projectId ?? defaultDepartmentWorkstream.projectId,
      runtimeSource: "department_mock",
      dependencyIds: task.dependencyIds ?? [],
      escalationLevel: task.escalationLevel ?? "none",
    };
  };
  const legacyTaskIds = new Set(input.tasks.map(({ id }) => id));

  return {
    ...seed,
    ...input,
    version: 2,
    workstreams: [
      ...seed.workstreams,
      ...(migratedAi ? [migratedAi] : []),
    ],
    activeAiWorkstreamId: migratedAi?.id,
    tasks: [
      ...seed.tasks.filter(({ id }) => !legacyTaskIds.has(id)),
      ...legacyDepartmentTasks.map(attachDepartment),
      ...(migratedAi ? legacyAiTasks.map(attachAi) : []),
    ],
    notificationReads: input.notificationReads ?? {},
    dispatchHistory: input.dispatchHistory ?? [],
  };
}
