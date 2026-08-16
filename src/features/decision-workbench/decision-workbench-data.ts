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
import { customerDemoPeople } from "@/features/demo/customer-demo-data";
import type { AiDispatchPlan } from "@/features/ai-dispatch/dispatch-contract";

export const DECISION_STORAGE_KEY = "enterprise-workspace.decision-workbench.v1";

export function getDecisionStorageKey(context: OperationFixtureContext) {
  return context.storageNamespace
    ? `${DECISION_STORAGE_KEY}:${context.storageNamespace}`
    : null;
}

function requireDecisionFixtureContext(context: OperationFixtureContext) {
  const storageKey = getDecisionStorageKey(context);
  if (!context.actor || !storageKey) {
    throw new Error("当前真实身份未绑定本地业务夹具");
  }
  return storageKey;
}

function demoMemberId(personId: string) {
  return customerDemoPeople.find(({ id }) => id === personId)!.memberId;
}

const departmentDefinitions = [
  {
    id: "pmo",
    name: "决策推进办公室",
    objective: "把决策目标转成可度量、可验收的推进章程",
    ownerId: demoMemberId("demo-product-head"),
  },
  {
    id: "product",
    name: "产品研发中心",
    objective: "完成 AI 拆解、任务分发与结果回流能力",
    ownerId: demoMemberId("demo-product-head"),
  },
  {
    id: "design",
    name: "设计体验中心",
    objective: "让决策人、部门负责人和执行者都能快速上手",
    ownerId: demoMemberId("demo-design-head"),
  },
  {
    id: "market",
    name: "市场增长中心",
    objective: "组织试点沟通并沉淀可复用的推广材料",
    ownerId: demoMemberId("demo-market-head"),
  },
  {
    id: "delivery",
    name: "运营交付中心",
    objective: "完成客户试点、培训、反馈回收和上线验收",
    ownerId: demoMemberId("demo-customer-head"),
  },
  {
    id: "finance",
    name: "财务中心",
    objective: "控制试点预算并保证采购和付款凭证可追溯",
    ownerId: demoMemberId("demo-finance"),
  },
  {
    id: "hr",
    name: "人力资源中心",
    objective: "明确角色边界、协作规则和培训机制",
    ownerId: demoMemberId("demo-hr"),
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
  assigneeId: string;
};

const taskDefinitions: readonly TaskDefinition[] = [
  { id: "T01", phase: "目标澄清", departmentId: "pmo", title: "确认试点范围与成功标准", description: "把客户目标转成范围、指标和验收口径。", requiredSkills: ["目标拆解", "产品策略", "项目治理"], priority: "urgent", startOffset: 0, dueOffset: 2, acceptance: "形成一页式试点章程，并由决策人确认目标值和不做事项。", dependencies: [], assigneeId: demoMemberId("demo-product-head") },
  { id: "T02", phase: "客户调研", departmentId: "market", title: "完成客户场景调研与启动沟通", description: "访谈客户关键岗位并建立试点沟通节奏。", requiredSkills: ["活动策划", "跨部门协同", "内容传播"], priority: "high", startOffset: 1, dueOffset: 5, acceptance: "提交客户场景清单和启动会纪要，客户确认参与人和沟通节奏。", dependencies: ["T01"], assigneeId: demoMemberId("demo-market-head") },
  { id: "T03", phase: "方案设计", departmentId: "design", title: "设计三角色工作流原型", description: "覆盖决策人、部门负责人和员工执行三个视角。", requiredSkills: ["流程设计", "原型设计", "用户研究"], priority: "high", startOffset: 2, dueOffset: 7, acceptance: "原型覆盖下发、执行、成果提交、退回、验收和归档。", dependencies: ["T01"], assigneeId: demoMemberId("demo-design-head") },
  { id: "T04", phase: "能力构建", departmentId: "product", title: "实现人员切换与任务执行链路", description: "实现演示身份切换、任务状态和结果回流。", requiredSkills: ["前端开发", "系统集成", "AI 工作流"], priority: "urgent", startOffset: 5, dueOffset: 15, acceptance: "10 个身份可切换且共享同一任务状态，核心页面无控制台错误。", dependencies: ["T03"], assigneeId: demoMemberId("demo-engineer") },
  { id: "T05", phase: "质量验证", departmentId: "product", title: "完成关键流程回归测试", description: "验证切换、下发、执行、退回、验收和重置。", requiredSkills: ["回归测试", "质量保障", "验收记录"], priority: "urgent", startOffset: 14, dueOffset: 21, acceptance: "提交覆盖 10 个身份和完整闭环的测试报告，阻断级问题为零。", dependencies: ["T04"], assigneeId: demoMemberId("demo-qa") },
  { id: "T06", phase: "客户交付", departmentId: "delivery", title: "制定客户试点与上线计划", description: "确定客户环境、里程碑、联系人和上线检查点。", requiredSkills: ["客户访谈", "价值评估", "客户沟通"], priority: "high", startOffset: 3, dueOffset: 10, acceptance: "客户确认试点计划、上线窗口和业务验收负责人。", dependencies: ["T01"], assigneeId: demoMemberId("demo-customer-head") },
  { id: "T07", phase: "客户交付", departmentId: "delivery", title: "完成角色培训与反馈回收", description: "组织客户关键用户完成一次全流程演练。", requiredSkills: ["培训运营", "交付运营", "客户反馈"], priority: "high", startOffset: 18, dueOffset: 25, acceptance: "完成三类角色培训，回收反馈并形成问题关闭清单。", dependencies: ["T04", "T06"], assigneeId: demoMemberId("demo-operations") },
  { id: "T08", phase: "经营保障", departmentId: "finance", title: "完成试点预算审核与凭证归档", description: "审核云资源和实施费用，归集付款凭证。", requiredSkills: ["预算审核", "采购协同", "凭证归档"], priority: "high", startOffset: 1, dueOffset: 8, acceptance: "费用不超过 30 万元，审批记录和付款凭证完整可追溯。", dependencies: ["T01"], assigneeId: demoMemberId("demo-finance") },
  { id: "T09", phase: "组织保障", departmentId: "hr", title: "确认角色权限与 RACI", description: "明确决策人、负责人、执行人和协同人的责任边界。", requiredSkills: ["RACI", "权限治理", "组织协同"], priority: "high", startOffset: 1, dueOffset: 7, acceptance: "发布 RACI 表，所有核心任务只有一位最终负责人。", dependencies: ["T01"], assigneeId: demoMemberId("demo-hr") },
  { id: "T10", phase: "验收复盘", departmentId: "pmo", title: "汇总试点结果与推广建议", description: "汇总完成率、客户反馈、风险和下一阶段建议。", requiredSkills: ["数据复盘", "项目治理", "跨部门协同"], priority: "high", startOffset: 25, dueOffset: 30, acceptance: "提交试点复盘，明确继续推广、调整或停止的建议及依据。", dependencies: ["T02", "T05", "T07", "T08", "T09"], assigneeId: demoMemberId("demo-product-head") },
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
  {
    memberId: mockMembers[6].id,
    skills: ["战略决策", "经营判断", "总体验收"],
    onTimeRate: 99,
    activeTasks: 1,
    workload: 45,
    averageResponseHours: 1,
    recentDelayCount: 0,
    updatedAt: "2026-08-12",
    tags: [
      { label: "决策及时", tone: "strength", evidence: "关键升级事项平均 1 小时内给出明确结论" },
      { label: "边界清晰", tone: "strength", evidence: "试点目标、预算和不做事项均完成确认" },
      { label: "决策负荷可控", tone: "capacity", evidence: "当前仅保留总验收与升级决策事项" },
    ],
  },
  {
    memberId: mockMembers[7].id,
    skills: ["回归测试", "质量保障", "验收记录"],
    onTimeRate: 97,
    activeTasks: 2,
    workload: 61,
    averageResponseHours: 2,
    recentDelayCount: 0,
    updatedAt: "2026-08-12",
    tags: [
      { label: "缺陷定位快", tone: "strength", evidence: "最近 3 次回归均在当天完成阻断问题定位" },
      { label: "证据完整", tone: "strength", evidence: "验收记录包含步骤、结果和截图证据" },
      { label: "测试负荷可控", tone: "capacity", evidence: "当前 2 项进行中，综合负荷 61%" },
    ],
  },
  {
    memberId: mockMembers[8].id,
    skills: ["培训运营", "交付运营", "客户反馈"],
    onTimeRate: 94,
    activeTasks: 2,
    workload: 56,
    averageResponseHours: 3,
    recentDelayCount: 0,
    updatedAt: "2026-08-12",
    tags: [
      { label: "培训组织稳", tone: "strength", evidence: "最近 4 场客户培训均按计划完成" },
      { label: "反馈闭环快", tone: "strength", evidence: "客户问题平均 1 个工作日内进入责任清单" },
      { label: "交付有余量", tone: "capacity", evidence: "当前 2 项进行中，综合负荷 56%" },
    ],
  },
  {
    memberId: mockMembers[9].id,
    skills: ["预算审核", "采购协同", "凭证归档"],
    onTimeRate: 98,
    activeTasks: 2,
    workload: 59,
    averageResponseHours: 2,
    recentDelayCount: 0,
    updatedAt: "2026-08-12",
    tags: [
      { label: "预算控制稳", tone: "strength", evidence: "最近 6 个项目均未突破审批预算" },
      { label: "凭证完整", tone: "strength", evidence: "采购与付款记录均可追溯到原申请" },
      { label: "财务负荷可控", tone: "capacity", evidence: "当前 2 项进行中，综合负荷 59%" },
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
  pmo: [demoMemberId("demo-product-head")],
  product: [demoMemberId("demo-product-head"), demoMemberId("demo-engineer"), demoMemberId("demo-qa")],
  design: [demoMemberId("demo-design-head")],
  market: [demoMemberId("demo-market-head")],
  delivery: [demoMemberId("demo-customer-head"), demoMemberId("demo-operations")],
  finance: [demoMemberId("demo-finance")],
  hr: [demoMemberId("demo-hr")],
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
  const executableMemberIds = new Set(
    customerDemoPeople.filter(({ role }) => role !== "executive").map(({ memberId }) => memberId),
  );

  return mockMembers.filter(({ id }) => executableMemberIds.has(id)).map((member) => {
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
    goal: "30 天完成星云智造量子智枢试点上线",
    deadline: toIsoDate(addDays(now, 30)),
    budget: "30",
    constraints: "10 人核心团队协同；每项任务必须有唯一负责人、明确依赖和可判定验收标准",
  };
}

export function createDraftDecision(): StoredDecision {
  return { version: 1, stage: "draft", input: createDefaultDecisionInput() };
}

export function createCustomerDemoDecision(): StoredDecision {
  const input = createDefaultDecisionInput();
  return {
    version: 1,
    stage: "review",
    input,
    plan: createDecisionPlan(input),
  };
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
    const recommendation = getDecisionCandidateRanking(task).find(
      ({ member }) => member.id === definition.assigneeId,
    ) ?? getDecisionCandidateRanking(task)[0];
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

export function createDecisionPlanFromDeepSeek(
  source: AiDispatchPlan,
  model: string,
  repaired = false,
  now = new Date(),
): DecisionPlan {
  const createdAt = now.toISOString();
  const startDate = toIsoDate(now);
  const taskIdByTitle = new Map(source.tasks.map((task, index) => [task.title, `DS${String(index + 1).padStart(2, "0")}`]));
  const departmentIdByName = new Map<string, string>(departmentDefinitions.map((department) => [department.name, department.id]));
  const peopleByName = new Map(customerDemoPeople.map((person) => [person.name, person]));
  const membersByName = new Map(mockMembers.map((member) => [member.displayName, member]));

  const tasks = source.tasks.map<DecisionTask>((task, index) => {
    const assignee = membersByName.get(task.assignee) ?? mockMembers[0];
    const person = peopleByName.get(task.assignee);
    const departmentId = person?.department === "总经办"
      ? "pmo"
      : departmentIdByName.get(person?.department ?? "") ?? "pmo";
    return {
      id: taskIdByTitle.get(task.title) ?? `DS${String(index + 1).padStart(2, "0")}`,
      phase: `任务 ${index + 1}`,
      departmentId,
      title: task.title,
      description: task.description,
      requiredSkills: getDecisionTalentProfile(assignee.id).skills.slice(0, 3),
      assignee,
      priority: task.priority,
      startDate,
      dueDate: task.deadline,
      acceptance: `完成“${task.title}”，提交可核验成果并由${task.owner}验收。`,
      dependencies: task.dependencies.map((title) => taskIdByTitle.get(title)).filter((id): id is string => Boolean(id)),
      status: "pending",
    };
  });

  const departments = departmentDefinitions.flatMap<DepartmentPlan>((department) => {
    const departmentTasks = tasks.filter(({ departmentId }) => departmentId === department.id);
    if (!departmentTasks.length) return [];
    const sourceTask = source.tasks.find((task) => taskIdByTitle.get(task.title) === departmentTasks[0].id);
    const owner = sourceTask ? membersByName.get(sourceTask.owner) ?? memberById(department.ownerId) : memberById(department.ownerId);
    return [{
      id: department.id,
      name: department.name,
      objective: `完成 ${departmentTasks.map(({ title }) => `“${title}”`).join("、")}，并按期提交可验收结果。`,
      owner,
      tasks: departmentTasks,
    }];
  });

  return {
    id: `decision-deepseek-${now.valueOf()}`,
    createdAt,
    expectedDays: source.estimated_days,
    departments,
    ai: {
      provider: "deepseek",
      model,
      summary: source.summary,
      risks: source.risks,
      managerDecisions: source.manager_decisions,
      repaired,
    },
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
  const existing = readLocalProjects(context).find(({ project }) => (
    project.name.startsWith("AI 决策专项 ·")
    && project.description.split("\n", 1)[0] === input.goal
  ));
  const detail = existing ?? createLocalProject(context, {
    name: `AI 决策专项 · ${input.goal.slice(0, 18)}`,
    description: projectDescription,
    ownerId: mockMembers[0].id,
    memberIds: mockMembers.map(({ id }) => id),
    startDate,
    dueDate: input.deadline,
    priority: "high",
    status: "active",
  }, context.authenticatedActor);
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
    userId: context.authenticatedActor.id,
    actionType: "task_updated",
    content: `${context.authenticatedActor.name}确认 AI 将决策拆解为 ${tasks.length} 项任务，并分发给 ${new Set(tasks.map(({ assigneeId }) => assigneeId)).size} 位负责人。`,
    createdAt: timestamp,
  };
  const dispatched: ProjectDetailData = {
    ...detail,
    project: { ...detail.project, description: projectDescription, dueDate: input.deadline, updatedAt: timestamp },
    tasks,
    activities: [activity, ...detail.activities],
  };
  saveLocalProject(context, dispatched);
  syncDecisionToOperations(context, input, plan, dispatched.project.id);
  return dispatched;
}

export function findDecisionProject(context: OperationFixtureContext, projectId?: string) {
  return context.actor && projectId ? findLocalProject(context, projectId) : undefined;
}

export function reassignDispatchedDecisionTask(
  context: OperationFixtureContext,
  projectId: string,
  taskCode: string,
  memberId: string,
  now = new Date(),
) {
  requireDecisionFixtureContext(context);
  if (context.actor?.role !== "executive") throw new Error("只有决策人可以调整已下发任务负责人");
  const detail = findLocalProject(context, projectId);
  if (!detail) throw new Error("未找到已下发的专项项目");
  const member = detail.members.find(({ member: candidate, leftAt }) => candidate.id === memberId && !leftAt)?.member;
  if (!member) throw new Error("候选人不在当前项目成员中");
  const projectTaskId = `${projectId}-${taskCode}`;
  const currentTask = detail.tasks.find(({ id }) => id === projectTaskId);
  if (!currentTask) throw new Error("未找到需要调整的任务");
  if (["review", "done", "cancelled"].includes(currentTask.status)) {
    throw new Error("任务已提交验收，不能再调整负责人");
  }
  const timestamp = now.toISOString();
  const tasks = detail.tasks.map((task) => task.id === projectTaskId ? {
    ...task,
    assigneeId: member.id,
    updatedAt: timestamp,
  } : task);
  const activity: ProjectActivity = {
    id: `${projectId}-reassign-${taskCode}-${Date.now()}`,
    organizationId: detail.project.organizationId,
    projectId,
    userId: context.authenticatedActor.id,
    actionType: "task_updated",
    content: `${context.authenticatedActor.name}将任务“${currentTask.title}”的负责人调整为${member.displayName}，个人工作台已同步。`,
    createdAt: timestamp,
  };
  const updated = {
    ...detail,
    project: { ...detail.project, updatedAt: timestamp },
    tasks,
    activities: [activity, ...detail.activities],
  };
  saveLocalProject(context, updated);
  return updated;
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
