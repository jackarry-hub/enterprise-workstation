import {
  createLocalProject,
  findLocalProject,
  readLocalProjects,
  saveLocalProject,
} from "@/features/projects/data/mock-project-repository";
import { mockMembers } from "@/features/projects/mock-data";
import type {
  ProjectActivity,
  ProjectDetailData,
  ProjectTask,
  TaskStatus,
} from "@/features/projects/types";
import type {
  DecisionInput,
  DecisionPlan,
  DecisionProgress,
  DecisionTalentProfile,
  DecisionTask,
  DecisionTaskStatus,
  DepartmentPlan,
  AssigneeRecommendation,
  StoredDecision,
} from "@/features/decision-workbench/decision-workbench-types";
import { syncDecisionToOperations } from "@/features/operations/operations-data";
import type { OperationFixtureContext } from "@/features/operations/operation-actor-compat";

export const DECISION_STORAGE_KEY = "enterprise-workspace.decision-workbench.v1";

export function getDecisionStorageKey(context: OperationFixtureContext) {
  return context.storageNamespace
    ? `${DECISION_STORAGE_KEY}:${context.storageNamespace}`
    : null;
}

function requireDecisionFixtureContext(context: OperationFixtureContext) {
  const storageKey = getDecisionStorageKey(context);
  if (!context.actor || !storageKey) {
    throw new Error("褰撳墠鐪熷疄韬唤鏈粦瀹氭湰鍦颁笟鍔″す鍏?");
  }
  return storageKey;
}

const departmentDefinitions = [
  {
    id: "pmo",
    name: "决策推进办公室",
    objective: "把决策目标转成可度量、可验收的推进章程",
    ownerId: mockMembers[0].id,
  },
  {
    id: "product",
    name: "产品研发中心",
    objective: "完成 AI 拆解、任务分发与结果回流能力",
    ownerId: mockMembers[0].id,
  },
  {
    id: "design",
    name: "设计中心",
    objective: "让决策人、部门负责人和执行者都能快速上手",
    ownerId: mockMembers[2].id,
  },
  {
    id: "market",
    name: "市场中心",
    objective: "组织试点沟通并沉淀可复用的推广材料",
    ownerId: mockMembers[1].id,
  },
  {
    id: "sales",
    name: "销售中心",
    objective: "收集一线场景并验证试点业务价值",
    ownerId: mockMembers[4].id,
  },
  {
    id: "hr",
    name: "人力资源中心",
    objective: "明确角色边界、协作规则和培训机制",
    ownerId: mockMembers[5].id,
  },
] as const;

type TaskDefinition = {
  id: string;
  phase: string;
  departmentId: string;
  title: string;
  description: string;
  requiredSkills: readonly string[];
  priority: DecisionTask["priority"];
  startOffset: number;
  dueOffset: number;
  acceptance: string;
  dependencies: readonly string[];
};

const taskDefinitions: readonly TaskDefinition[] = [
  { id: "T01", phase: "目标澄清", departmentId: "pmo", title: "确认试点范围与成功标准", description: "将决策目标转成范围、指标与验收口径。", requiredSkills: ["目标拆解", "产品策略", "项目治理"], priority: "urgent", startOffset: 0, dueOffset: 2, acceptance: "形成一页式试点章程，并由决策人确认范围、目标值和不做事项。", dependencies: [] },
  { id: "T02", phase: "目标澄清", departmentId: "pmo", title: "建立周度推进与升级机制", description: "明确周报节奏、阻塞升级和需要决策的事项格式。", requiredSkills: ["项目治理", "目标拆解", "跨部门协同"], priority: "high", startOffset: 2, dueOffset: 4, acceptance: "发布周度推进模板，包含进度、风险、阻塞、需决策项四个字段。", dependencies: ["T01"] },
  { id: "T03", phase: "场景调研", departmentId: "sales", title: "访谈首批试点部门", description: "收集高频决策场景、现有流程与关键痛点。", requiredSkills: ["客户访谈", "需求洞察", "客户沟通"], priority: "high", startOffset: 0, dueOffset: 4, acceptance: "完成不少于 5 位业务负责人的访谈，沉淀前 10 个高频场景。", dependencies: ["T01"] },
  { id: "T04", phase: "方案设计", departmentId: "design", title: "设计三角色工作流原型", description: "覆盖决策人、部门负责人和个人执行者三个视角。", requiredSkills: ["流程设计", "原型设计", "用户研究"], priority: "high", startOffset: 3, dueOffset: 7, acceptance: "原型完整覆盖输入、拆解、认领、执行、回流五个关键状态。", dependencies: ["T01"] },
  { id: "T05", phase: "方案设计", departmentId: "design", title: "定义任务详情与反馈规范", description: "统一责任、截止、依赖、验收和反馈字段。", requiredSkills: ["规范沉淀", "流程设计", "原型设计"], priority: "medium", startOffset: 7, dueOffset: 10, acceptance: "每项任务均能展示唯一负责人、截止时间、前置依赖和验收标准。", dependencies: ["T04"] },
  { id: "T06", phase: "能力构建", departmentId: "product", title: "实现目标拆解与责任映射", description: "把决策输入转换为部门目标和个人任务清单。", requiredSkills: ["AI 工作流", "任务自动化", "系统集成"], priority: "urgent", startOffset: 5, dueOffset: 13, acceptance: "一次输入可稳定生成 5 个以上部门目标和 10 项以上可执行任务。", dependencies: ["T03", "T04"] },
  { id: "T07", phase: "能力构建", departmentId: "product", title: "打通项目与任务中心", description: "将确认后的 AI 方案写入现有项目和任务数据。", requiredSkills: ["系统集成", "前端开发", "任务自动化"], priority: "urgent", startOffset: 13, dueOffset: 19, acceptance: "下发后，所有任务在任务中心可按负责人筛选并可更新执行状态。", dependencies: ["T05", "T06"] },
  { id: "T08", phase: "能力构建", departmentId: "product", title: "建立结果回流摘要", description: "自动汇总完成率、阻塞项和待决策事项。", requiredSkills: ["数据复盘", "产品策略", "项目治理"], priority: "high", startOffset: 16, dueOffset: 23, acceptance: "决策人首页可看到实时完成率、阻塞数量和下一检查点。", dependencies: ["T07"] },
  { id: "T09", phase: "试点运营", departmentId: "market", title: "制定试点沟通与共创计划", description: "让参与部门理解试点目标、规则与反馈入口。", requiredSkills: ["活动策划", "跨部门协同", "内容传播"], priority: "medium", startOffset: 4, dueOffset: 9, acceptance: "完成试点启动会，参与人员确认角色分工和首周任务。", dependencies: ["T01"] },
  { id: "T10", phase: "试点运营", departmentId: "market", title: "沉淀试点案例与发布材料", description: "记录试点前后效率变化和典型协作案例。", requiredSkills: ["内容传播", "数据复盘", "活动策划"], priority: "medium", startOffset: 20, dueOffset: 27, acceptance: "形成一份可对内发布的试点案例，包含量化结果和使用故事。", dependencies: ["T08", "T09"] },
  { id: "T11", phase: "组织保障", departmentId: "hr", title: "确认角色权限与 RACI", description: "明确决策人、部门负责人、执行人和协同人的责任边界。", requiredSkills: ["RACI", "权限治理", "组织协同"], priority: "high", startOffset: 2, dueOffset: 7, acceptance: "发布 RACI 表，所有核心任务均只有一位最终负责人。", dependencies: ["T01"] },
  { id: "T12", phase: "组织保障", departmentId: "hr", title: "完成使用培训与运行规则", description: "提供角色化培训和日常操作规范。", requiredSkills: ["培训运营", "组织协同", "权限治理"], priority: "medium", startOffset: 14, dueOffset: 20, acceptance: "核心团队完成培训并通过一次完整的演练流程。", dependencies: ["T07", "T11"] },
  { id: "T13", phase: "验收复盘", departmentId: "sales", title: "评估试点价值并提出下一步建议", description: "汇总业务反馈、效率变化和推广条件。", requiredSkills: ["价值评估", "需求洞察", "客户沟通"], priority: "high", startOffset: 24, dueOffset: 30, acceptance: "提交试点评估报告，明确继续推广、调整或停止的建议及依据。", dependencies: ["T08", "T10", "T12"] },
];

export const decisionTalentProfiles = [
  {
    memberId: mockMembers[0].id,
    skills: ["目标拆解", "项目治理", "产品策略", "跨部门协同", "数据复盘"],
    onTimeRate: 96,
    activeTasks: 4,
    workload: 78,
    averageResponseHours: 3,
    recentDelayCount: 1,
    updatedAt: "2026-08-08",
    tags: [
      { label: "交付稳定", tone: "strength", evidence: "近 90 天 24 项任务，按时完成率 96%" },
      { label: "决策清晰", tone: "strength", evidence: "最近 6 次方案评审均一次明确责任边界" },
      { label: "负荷可控", tone: "capacity", evidence: "当前 4 项进行中，综合负荷 78%" },
    ],
  },
  {
    memberId: mockMembers[1].id,
    skills: ["活动策划", "内容传播", "跨部门协同", "数据复盘"],
    onTimeRate: 86,
    activeTasks: 5,
    workload: 88,
    averageResponseHours: 7,
    recentDelayCount: 2,
    updatedAt: "2026-08-08",
    tags: [
      { label: "创意推动强", tone: "strength", evidence: "最近 3 场活动方案均通过首轮评审" },
      { label: "近期延期偏多", tone: "watch", evidence: "近 30 天有 2 项任务晚于计划完成" },
      { label: "当前负荷较高", tone: "watch", evidence: "当前 5 项进行中，综合负荷 88%" },
    ],
  },
  {
    memberId: mockMembers[2].id,
    skills: ["流程设计", "原型设计", "用户研究", "规范沉淀"],
    onTimeRate: 98,
    activeTasks: 3,
    workload: 64,
    averageResponseHours: 2,
    recentDelayCount: 0,
    updatedAt: "2026-08-08",
    tags: [
      { label: "审阅细致", tone: "strength", evidence: "最近 8 个交付物未发生验收字段遗漏" },
      { label: "响应及时", tone: "strength", evidence: "近 30 天平均响应时间 2 小时" },
      { label: "交付稳定", tone: "strength", evidence: "近 90 天按时完成率 98%" },
    ],
  },
  {
    memberId: mockMembers[3].id,
    skills: ["前端开发", "系统集成", "AI 工作流", "任务自动化"],
    onTimeRate: 91,
    activeTasks: 4,
    workload: 72,
    averageResponseHours: 4,
    recentDelayCount: 1,
    updatedAt: "2026-08-08",
    tags: [
      { label: "技术攻坚强", tone: "strength", evidence: "最近 4 个高复杂度集成事项均独立闭环" },
      { label: "估时偏乐观", tone: "watch", evidence: "近 30 天 1 项任务因低估联调量延期" },
      { label: "负荷可控", tone: "capacity", evidence: "当前 4 项进行中，综合负荷 72%" },
    ],
  },
  {
    memberId: mockMembers[4].id,
    skills: ["客户访谈", "需求洞察", "价值评估", "客户沟通"],
    onTimeRate: 95,
    activeTasks: 2,
    workload: 58,
    averageResponseHours: 2,
    recentDelayCount: 0,
    updatedAt: "2026-08-08",
    tags: [
      { label: "客户洞察强", tone: "strength", evidence: "最近 12 次访谈均形成结构化问题清单" },
      { label: "响应及时", tone: "strength", evidence: "近 30 天平均响应时间 2 小时" },
      { label: "本周有空档", tone: "capacity", evidence: "当前 2 项进行中，综合负荷 58%" },
    ],
  },
  {
    memberId: mockMembers[5].id,
    skills: ["RACI", "权限治理", "培训运营", "组织协同"],
    onTimeRate: 93,
    activeTasks: 3,
    workload: 62,
    averageResponseHours: 4,
    recentDelayCount: 1,
    updatedAt: "2026-08-08",
    tags: [
      { label: "制度执行严谨", tone: "strength", evidence: "最近 5 次制度发布均完成评审、宣导与回执" },
      { label: "协作主动", tone: "strength", evidence: "近 30 天主动发起 7 次跨部门协同" },
      { label: "负荷可控", tone: "capacity", evidence: "当前 3 项进行中，综合负荷 62%" },
    ],
  },
] satisfies readonly DecisionTalentProfile[];

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function safeDate(value: string, fallback: Date) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.valueOf()) ? fallback : date;
}

function clampDate(base: Date, deadline: Date, offset: number) {
  const value = addDays(base, offset);
  return toIsoDate(value > deadline ? deadline : value);
}

function memberById(memberId: string) {
  return mockMembers.find(({ id }) => id === memberId) ?? mockMembers[0];
}

const departmentCandidateIds: Record<string, readonly string[]> = {
  pmo: [mockMembers[0].id],
  product: [mockMembers[0].id, mockMembers[3].id],
  design: [mockMembers[2].id],
  market: [mockMembers[1].id],
  sales: [mockMembers[4].id],
  hr: [mockMembers[5].id],
};

export function getDecisionTalentProfile(memberId: string) {
  return decisionTalentProfiles.find(({ memberId: profileMemberId }) => profileMemberId === memberId)
    ?? decisionTalentProfiles[0];
}

export function getDecisionCandidateRanking(
  task: Pick<DecisionTask, "departmentId" | "requiredSkills" | "priority">,
): readonly AssigneeRecommendation[] {
  const departmentIds = departmentCandidateIds[task.departmentId] ?? [];
  const requiredSkills = task.requiredSkills ?? [];

  return mockMembers.map((member) => {
    const profile = getDecisionTalentProfile(member.id);
    const matchedSkills = requiredSkills.filter((skill) => profile.skills.includes(skill));
    const isDepartmentMatch = departmentIds.includes(member.id);
    const skillScore = requiredSkills.length
      ? Math.round((matchedSkills.length / requiredSkills.length) * 40)
      : 20;
    const deliveryScore = Math.round(profile.onTimeRate * 0.18);
    const capacityScore = Math.round((100 - profile.workload) * 0.12);
    const responseScore = profile.averageResponseHours <= 3 ? 8 : profile.averageResponseHours <= 6 ? 6 : 4;
    const delayPenalty = Math.min(6, profile.recentDelayCount * 2);
    const score = Math.max(0, Math.min(99, skillScore + (isDepartmentMatch ? 24 : 0) + deliveryScore + capacityScore + responseScore - delayPenalty));
    const reasons = [
      matchedSkills.length ? `匹配 ${matchedSkills.join("、")} ${matchedSkills.length} 项关键能力` : "可提供跨部门协作支持",
      `近 90 天按时交付率 ${profile.onTimeRate}%`,
      `当前负荷 ${profile.workload}%，${profile.activeTasks} 项任务进行中`,
    ];
    const risks = [
      ...(profile.recentDelayCount >= 2 ? [`近 30 天有 ${profile.recentDelayCount} 项延期`] : []),
      ...(profile.workload >= 85 ? [`当前负荷 ${profile.workload}%，排期空间有限`] : []),
      ...(task.priority === "urgent" && profile.workload >= 75 ? ["紧急任务与现有工作存在叠加"] : []),
    ];
    const mitigation = profile.workload >= 85
      ? "下发前先调整现有任务优先级，并设置两天一次的短检查点。"
      : task.priority === "urgent" && profile.workload >= 75
        ? "建议拆成两个短周期里程碑，由部门负责人同步清理阻塞。"
        : profile.recentDelayCount >= 2
          ? "明确首个里程碑与升级时限，避免风险累积到截止日。"
          : "按既定周节奏检查结果，无需额外管理动作。";

    return {
      member,
      profile,
      score,
      matchedSkills,
      reasons,
      risks,
      mitigation,
      isDepartmentMatch,
    };
  }).sort((left, right) => right.score - left.score || left.member.displayName.localeCompare(right.member.displayName, "zh-CN"));
}

export function createDefaultDecisionInput(now = new Date("2026-08-08T00:00:00.000Z")): DecisionInput {
  return {
    goal: "在 30 天内完成企业 AI 工作站试点上线，让决策目标自动分发到部门与个人，并形成周度结果回流",
    deadline: toIsoDate(addDays(now, 30)),
    budget: "30",
    constraints: "核心团队不超过 8 人；每项任务必须有唯一负责人和可判定验收标准",
  };
}

export function createDraftDecision(): StoredDecision {
  return { version: 1, stage: "draft", input: createDefaultDecisionInput() };
}

export function createDecisionPlan(
  input: DecisionInput,
  now = new Date("2026-08-08T08:00:00.000Z"),
): DecisionPlan {
  const base = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const deadline = safeDate(input.deadline, addDays(base, 30));
  const expectedDays = Math.max(1, Math.round((deadline.valueOf() - base.valueOf()) / 86_400_000));
  const tasks = taskDefinitions.map<DecisionTask>((definition) => {
    const task = {
      id: definition.id,
      phase: definition.phase,
      departmentId: definition.departmentId,
      title: definition.title,
      description: definition.description,
      requiredSkills: definition.requiredSkills,
      priority: definition.priority,
      startDate: clampDate(base, deadline, definition.startOffset),
      dueDate: clampDate(base, deadline, definition.dueOffset),
      acceptance: definition.acceptance,
      dependencies: definition.dependencies,
      status: "pending" as const,
    };
    const recommendation = getDecisionCandidateRanking(task)[0];
    return { ...task, assignee: recommendation.member };
  });
  const departments = departmentDefinitions.map<DepartmentPlan>((department) => ({
    id: department.id,
    name: department.name,
    objective: department.objective,
    owner: memberById(department.ownerId),
    tasks: tasks.filter(({ departmentId }) => departmentId === department.id),
  }));

  return {
    id: `decision-${now.valueOf()}`,
    createdAt: now.toISOString(),
    expectedDays,
    departments,
  };
}

function toDecisionTaskStatus(status: TaskStatus): DecisionTaskStatus {
  if (status === "done") return "done";
  if (status === "in_review") return "in_review";
  if (status === "in_progress") return "in_progress";
  return "pending";
}

export function hydrateDecisionPlan(
  plan: DecisionPlan,
  project?: ProjectDetailData,
): DecisionPlan {
  if (!project) return plan;
  const taskStatuses = new Map(
    project.tasks.map((task) => [task.id.replace(`${project.project.id}-`, ""), toDecisionTaskStatus(task.status)]),
  );
  return {
    ...plan,
    departments: plan.departments.map((department) => ({
      ...department,
      tasks: department.tasks.map((task) => ({
        ...task,
        status: taskStatuses.get(task.id) ?? task.status,
      })),
    })),
  };
}

export function getDecisionProgress(plan?: DecisionPlan): DecisionProgress {
  const tasks = plan?.departments.flatMap(({ tasks: departmentTasks }) => departmentTasks) ?? [];
  const count = (status: DecisionTaskStatus) => tasks.filter((task) => task.status === status).length;
  const done = count("done");
  return {
    total: tasks.length,
    pending: count("pending"),
    inProgress: count("in_progress"),
    inReview: count("in_review"),
    done,
    completionRate: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
  };
}

function projectTaskDescription(task: DecisionTask, department: DepartmentPlan) {
  const dependencyText = task.dependencies.length ? task.dependencies.join("、") : "无";
  return [
    "AI 决策下发",
    `部门：${department.name}`,
    `任务说明：${task.description}`,
    `验收标准：${task.acceptance}`,
    `前置依赖：${dependencyText}`,
  ].join("\n");
}

export function dispatchDecisionPlan(
  context: OperationFixtureContext,
  input: DecisionInput,
  plan: DecisionPlan,
  now = new Date(),
): ProjectDetailData {
  if (!context.actor || context.actor.role !== "executive") {
    throw new Error("当前真实身份未绑定本地业务夹具");
  }
  const startDate = toIsoDate(now);
  const projectDescription = `${input.goal}\n关键约束：${input.constraints || "无"}\n预算上限：${input.budget || "未设置"} 万元`;
  const existing = readLocalProjects().find(({ project }) => (
    project.name.startsWith("AI 决策专项 ·")
    && project.description.split("\n", 1)[0] === input.goal
  ));
  const detail = existing ?? createLocalProject({
    name: `AI 决策专项 · ${input.goal.slice(0, 18)}`,
    description: projectDescription,
    ownerId: mockMembers[0].id,
    memberIds: mockMembers.map(({ id }) => id),
    startDate,
    dueDate: input.deadline,
    priority: "high",
    status: "active",
  });
  const timestamp = now.toISOString();
  const previousTasks = new Map(detail.tasks.map((task) => [task.id, task]));
  const tasks = plan.departments.flatMap((department) => department.tasks).map<ProjectTask>((task, index) => {
    const department = plan.departments.find(({ id }) => id === task.departmentId)!;
    const taskId = `${detail.project.id}-${task.id}`;
    const previous = previousTasks.get(taskId);
    return {
      id: taskId,
      organizationId: detail.project.organizationId,
      projectId: detail.project.id,
      title: task.title,
      description: projectTaskDescription(task, department),
      assigneeId: task.assignee.id,
      reporterId: detail.owner.id,
      status: previous?.status ?? "todo",
      priority: task.priority,
      startDate: task.startDate,
      dueDate: task.dueDate,
      progress: previous?.progress ?? 0,
      sortOrder: index,
      completedAt: previous?.completedAt,
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
  });
  const activity: ProjectActivity = {
    id: `${detail.project.id}-dispatch-${detail.activities.length + 1}`,
    organizationId: detail.project.organizationId,
    projectId: detail.project.id,
    userId: detail.owner.id,
    actionType: "task_updated",
    content: `AI 已将决策拆解为 ${tasks.length} 项任务，并分发给 ${new Set(tasks.map(({ assigneeId }) => assigneeId)).size} 位负责人。`,
    createdAt: timestamp,
  };
  const dispatched: ProjectDetailData = {
    ...detail,
    project: { ...detail.project, description: projectDescription, dueDate: input.deadline, updatedAt: timestamp },
    tasks,
    activities: [activity, ...detail.activities],
  };
  saveLocalProject(dispatched);
  syncDecisionToOperations(context, input, plan, dispatched.project.id);
  return dispatched;
}

export function findDecisionProject(context: OperationFixtureContext, projectId?: string) {
  return context.actor && projectId ? findLocalProject(projectId) : undefined;
}

export function readStoredDecision(
  context: OperationFixtureContext,
  storage?: Pick<Storage, "getItem">,
): StoredDecision | undefined {
  const storageKey = getDecisionStorageKey(context);
  if (!context.actor || !storageKey) return undefined;
  const resolved = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
  if (!resolved) return undefined;
  try {
    const value = JSON.parse(resolved.getItem(storageKey) ?? "null") as Partial<StoredDecision> | null;
    if (value?.version !== 1 || !value.input || !value.stage) return undefined;
    const stored = value as StoredDecision;
    if (!stored.plan) return stored;
    return {
      ...stored,
      plan: {
        ...stored.plan,
        departments: stored.plan.departments.map((department) => ({
          ...department,
          tasks: department.tasks.map((task) => ({
            ...task,
            requiredSkills: task.requiredSkills
              ?? taskDefinitions.find(({ id }) => id === task.id)?.requiredSkills
              ?? [],
          })),
        })),
      },
    };
  } catch {
    return undefined;
  }
}

export function saveStoredDecision(
  context: OperationFixtureContext,
  decision: StoredDecision,
  storage?: Pick<Storage, "setItem">,
) {
  const storageKey = requireDecisionFixtureContext(context);
  const resolved = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
  resolved?.setItem(storageKey, JSON.stringify(decision));
}

export function clearStoredDecision(
  context: OperationFixtureContext,
  storage?: Pick<Storage, "removeItem">,
) {
  const storageKey = requireDecisionFixtureContext(context);
  const resolved = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
  resolved?.removeItem(storageKey);
}
