import type { WorkspaceActor } from "@/features/auth/workspace-session-types";
import {
  requireAuthenticatedActor,
  type WorkspaceIdentityContext,
} from "@/features/operations/operation-actor-compat";
import { mockMembers, mockProjects } from "@/features/projects/mock-data";
import type {
  CreateMockProjectInput,
  ProjectDetailData,
  ProjectMember,
} from "@/features/projects/types";

export const PROJECTS_STORAGE_KEY = "enterprise-workspace.projects.v1";
const STORAGE_VERSION = 1;

export const PROJECTS_CHANGED_EVENT = "enterprise-workspace:projects-changed";

type LocalProjectStore = {
  version: 1;
  projects: Array<{ detail: ProjectDetailData; savedAt: string }>;
};

export type MockProjectRepositoryOptions = {
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  now?: () => Date;
  createId?: () => string;
};

function resolveStorage(options?: MockProjectRepositoryOptions) {
  return options?.storage
    ?? (typeof window === "undefined" ? undefined : window.localStorage);
}

export function getProjectsStorageKey(context: WorkspaceIdentityContext) {
  return context.storageNamespace
    ? `${PROJECTS_STORAGE_KEY}:${context.storageNamespace}`
    : null;
}

function requireProjectContext(context: WorkspaceIdentityContext) {
  const storageKey = getProjectsStorageKey(context);
  if (!context.actor || !storageKey) {
    throw new Error("当前真实身份未绑定本地项目夹具");
  }
  return storageKey;
}

function currentDate(options?: MockProjectRepositoryOptions) {
  return options?.now?.() ?? new Date();
}

function createIdentifier(options?: MockProjectRepositoryOptions) {
  return options?.createId?.() ?? crypto.randomUUID();
}

function isProjectDetailData(value: unknown): value is ProjectDetailData {
  if (!value || typeof value !== "object") {
    return false;
  }

  const detail = value as Partial<ProjectDetailData>;
  return Boolean(
    detail.project
    && typeof detail.project.id === "string"
    && typeof detail.project.name === "string"
    && detail.owner
    && typeof detail.owner.id === "string"
    && Array.isArray(detail.members)
    && Array.isArray(detail.milestones)
    && Array.isArray(detail.tasks),
  );
}

function parseStore(raw: string | null): LocalProjectStore {
  if (!raw) {
    return { version: STORAGE_VERSION, projects: [] };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<LocalProjectStore>;
    if (parsed.version !== STORAGE_VERSION || !Array.isArray(parsed.projects)) {
      return { version: STORAGE_VERSION, projects: [] };
    }

    return {
      version: STORAGE_VERSION,
      projects: parsed.projects.flatMap((record) => (
        record
        && typeof record === "object"
        && "detail" in record
        && isProjectDetailData(record.detail)
          ? [{
            detail: record.detail,
            savedAt: typeof record.savedAt === "string" ? record.savedAt : "",
          }]
          : []
      )),
    };
  } catch {
    return { version: STORAGE_VERSION, projects: [] };
  }
}

function notifyProjectChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(PROJECTS_CHANGED_EVENT));
  }
}

function validateCreateInput(input: CreateMockProjectInput) {
  if (!input.name.trim()) {
    throw new Error("请输入项目名称");
  }
  if (!input.description.trim()) {
    throw new Error("请输入项目描述");
  }
  if (!input.startDate || !input.dueDate) {
    throw new Error("请选择项目周期");
  }
  if (input.dueDate < input.startDate) {
    throw new Error("截止日期不能早于开始日期");
  }
  if (!mockMembers.some(({ id }) => id === input.ownerId)) {
    throw new Error("请选择有效的项目负责人");
  }
}

function nextProjectCode(
  localProjects: readonly ProjectDetailData[],
  date: Date,
) {
  const year = date.getUTCFullYear();
  const pattern = new RegExp(`^PRJ-${year}-(\\d+)$`);
  const sequence = [...mockProjects, ...localProjects.map(({ project }) => project)]
    .reduce((maximum, project) => {
      const match = pattern.exec(project.code);
      return match ? Math.max(maximum, Number(match[1])) : maximum;
    }, 0) + 1;

  return `PRJ-${year}-${String(sequence).padStart(3, "0")}`;
}

export function readLocalProjects(
  context: WorkspaceIdentityContext,
  options?: MockProjectRepositoryOptions,
): ProjectDetailData[] {
  const storageKey = getProjectsStorageKey(context);
  if (!context.actor || !storageKey) return [];
  const storage = resolveStorage(options);
  return storage ? parseStore(storage.getItem(storageKey)).projects.map(({ detail }) => detail) : [];
}

export function findLocalProject(
  context: WorkspaceIdentityContext,
  projectId: string,
  options?: MockProjectRepositoryOptions,
) {
  return readLocalProjects(context, options).find(({ project }) => project.id === projectId);
}

export function saveLocalProject(
  context: WorkspaceIdentityContext,
  detail: ProjectDetailData,
  options?: MockProjectRepositoryOptions,
) {
  const storageKey = requireProjectContext(context);
  const storage = resolveStorage(options);
  if (!storage) {
    return;
  }

  const now = currentDate(options).toISOString();
  const current = parseStore(storage.getItem(storageKey));
  const nextRecords = current.projects.filter(
    ({ detail: record }) => record.project.id !== detail.project.id,
  );
  nextRecords.push({ detail, savedAt: now });
  const nextStore: LocalProjectStore = {
    version: STORAGE_VERSION,
    projects: nextRecords,
  };

  storage.setItem(storageKey, JSON.stringify(nextStore));
  notifyProjectChange();
}

export function createLocalProject(
  context: WorkspaceIdentityContext,
  input: CreateMockProjectInput,
  auditActor: WorkspaceActor,
  options?: MockProjectRepositoryOptions,
): ProjectDetailData {
  requireProjectContext(context);
  requireAuthenticatedActor(context, auditActor);
  validateCreateInput(input);

  const now = currentDate(options);
  const timestamp = now.toISOString();
  const projectId = createIdentifier(options);
  const owner = mockMembers.find(({ id }) => id === input.ownerId)!;
  const requestedMemberIds = [...new Set([input.ownerId, ...input.memberIds])];
  const members = requestedMemberIds.flatMap((memberId): ProjectMember[] => {
    const member = mockMembers.find(({ id }) => id === memberId);
    if (!member) {
      return [];
    }

    return [{
      id: createIdentifier(options),
      organizationId: mockProjects[0].organizationId,
      projectId,
      member,
      role: memberId === owner.id ? "owner" : "member",
      allocationPercent: memberId === owner.id ? 60 : 40,
      joinedAt: timestamp,
    }];
  });

  const detail: ProjectDetailData = {
    project: {
      id: projectId,
      organizationId: mockProjects[0].organizationId,
      code: nextProjectCode(readLocalProjects(context, options), now),
      name: input.name.trim(),
      description: input.description.trim(),
      ownerId: owner.id,
      createdById: auditActor.memberId,
      status: input.status,
      health: "on_track",
      priority: input.priority,
      startDate: input.startDate,
      dueDate: input.dueDate,
      progress: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    owner,
    members,
    milestones: [],
    tasks: [],
    comments: [],
    files: [],
    dailyReports: [],
    activities: [{
      id: createIdentifier(options),
      organizationId: mockProjects[0].organizationId,
      projectId,
      userId: auditActor.id,
      actionType: "project_created",
      content: `${auditActor.name}创建了项目“${input.name.trim()}”。`,
      createdAt: timestamp,
    }],
    risks: [],
    fileRelations: [],
  };

  saveLocalProject(context, detail, options);
  return detail;
}

export function clearLocalProjects(
  context: WorkspaceIdentityContext,
  options?: MockProjectRepositoryOptions,
) {
  const storageKey = requireProjectContext(context);
  const storage = resolveStorage(options);
  if (!storage) {
    return;
  }

  storage.removeItem(storageKey);
  notifyProjectChange();
}
