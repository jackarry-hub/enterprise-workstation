import { customerDemoActors } from "@/features/demo/customer-demo-data";
import type {
  OperationCommand,
  OperationTask,
  OperationWorkstream,
} from "@/features/operations/operations-types";

const DEMO_TIMESTAMP = "2026-08-14T09:00:00.000Z";

const WORKSTREAMS = [
  { id: "dept-web-delivery", title: "客户官网升级交付", projectId: "project-dept-web-delivery" },
  { id: "dept-payroll-cycle", title: "月度经营与薪资结算", projectId: "project-dept-payroll-cycle" },
  { id: "dept-knowledge-base", title: "客户成功知识库建设", projectId: "project-dept-knowledge-base" },
] as const;

type DepartmentTaskDefinition = {
  id: string;
  code: string;
  workstreamId: (typeof WORKSTREAMS)[number]["id"];
  assigneeId: string;
  departmentOwnerId: string;
  responsiblePersonId: string;
  title: string;
  summary: string;
  acceptance: string;
  dueDate: string;
  priority: OperationTask["priority"];
};

const TASKS: readonly DepartmentTaskDefinition[] = [
  {
    id: "dept-task-executive",
    code: "DEPT-01",
    workstreamId: "dept-web-delivery",
    assigneeId: "actor-executive",
    departmentOwnerId: "actor-executive",
    responsiblePersonId: "actor-executive",
    title: "确认官网升级经营目标",
    summary: "确认官网升级的经营目标、交付边界和最终验收口径。",
    acceptance: "形成经确认的目标与验收清单。",
    dueDate: "2026-08-18",
    priority: "urgent",
  },
  {
    id: "dept-task-product-head",
    code: "DEPT-02",
    workstreamId: "dept-web-delivery",
    assigneeId: "actor-manager",
    departmentOwnerId: "actor-manager",
    responsiblePersonId: "actor-executive",
    title: "制定官网升级交付方案",
    summary: "拆分技术范围、里程碑和跨部门协作事项。",
    acceptance: "交付方案覆盖范围、里程碑、负责人和风险。",
    dueDate: "2026-08-20",
    priority: "urgent",
  },
  {
    id: "dept-task-engineer",
    code: "DEPT-03",
    workstreamId: "dept-web-delivery",
    assigneeId: "actor-employee",
    departmentOwnerId: "actor-manager",
    responsiblePersonId: "actor-manager",
    title: "实现官网核心页面",
    summary: "完成官网核心页面开发与数据接入。",
    acceptance: "核心页面可访问且关键数据展示正确。",
    dueDate: "2026-08-25",
    priority: "urgent",
  },
  {
    id: "dept-task-qa",
    code: "DEPT-04",
    workstreamId: "dept-web-delivery",
    assigneeId: "actor-qa",
    departmentOwnerId: "actor-manager",
    responsiblePersonId: "actor-manager",
    title: "验证官网升级质量",
    summary: "执行关键路径、响应式布局与上线前回归测试。",
    acceptance: "提交测试报告且阻断级问题为零。",
    dueDate: "2026-08-27",
    priority: "high",
  },
  {
    id: "dept-task-market",
    code: "DEPT-05",
    workstreamId: "dept-web-delivery",
    assigneeId: "actor-market",
    departmentOwnerId: "actor-market",
    responsiblePersonId: "actor-executive",
    title: "确认官网市场表达",
    summary: "整理客户场景、价值主张和发布传播要点。",
    acceptance: "核心页面文案与目标客户价值主张一致。",
    dueDate: "2026-08-21",
    priority: "high",
  },
  {
    id: "dept-task-design",
    code: "DEPT-06",
    workstreamId: "dept-web-delivery",
    assigneeId: "actor-designer",
    departmentOwnerId: "actor-designer",
    responsiblePersonId: "actor-executive",
    title: "完成官网体验设计",
    summary: "输出核心页面视觉、交互和响应式设计方案。",
    acceptance: "设计稿覆盖核心页面及桌面、移动端关键状态。",
    dueDate: "2026-08-22",
    priority: "high",
  },
  {
    id: "dept-task-customer-head",
    code: "DEPT-07",
    workstreamId: "dept-knowledge-base",
    assigneeId: "actor-sales",
    departmentOwnerId: "actor-sales",
    responsiblePersonId: "actor-executive",
    title: "规划客户成功知识库",
    summary: "确定知识库目录、客户旅程和内容验收标准。",
    acceptance: "目录覆盖上线、培训、运营和问题处理场景。",
    dueDate: "2026-08-21",
    priority: "high",
  },
  {
    id: "dept-task-operations",
    code: "DEPT-08",
    workstreamId: "dept-knowledge-base",
    assigneeId: "actor-operations",
    departmentOwnerId: "actor-sales",
    responsiblePersonId: "actor-sales",
    title: "整理客户交付知识条目",
    summary: "沉淀培训、上线检查和常见问题处理资料。",
    acceptance: "知识条目可检索并覆盖首轮客户交付问题。",
    dueDate: "2026-08-26",
    priority: "medium",
  },
  {
    id: "dept-task-finance",
    code: "DEPT-09",
    workstreamId: "dept-payroll-cycle",
    assigneeId: "actor-finance",
    departmentOwnerId: "actor-finance",
    responsiblePersonId: "actor-executive",
    title: "完成月度薪资核算",
    summary: "核对薪资、扣减、预算和付款数据。",
    acceptance: "薪资核算结果与预算、考勤数据一致。",
    dueDate: "2026-08-28",
    priority: "urgent",
  },
  {
    id: "dept-task-hr",
    code: "DEPT-10",
    workstreamId: "dept-payroll-cycle",
    assigneeId: "actor-hr",
    departmentOwnerId: "actor-hr",
    responsiblePersonId: "actor-executive",
    title: "复核月度人员与考勤数据",
    summary: "复核在册人员、考勤异常和薪资调整依据。",
    acceptance: "人员与考勤数据完成复核且异常有处理结论。",
    dueDate: "2026-08-27",
    priority: "high",
  },
];

function requireDemoActor(actorId: string) {
  const actor = customerDemoActors.find((candidate) => candidate.id === actorId);
  if (!actor) throw new Error(`部门演示任务引用了名单外人员：${actorId}`);
  return actor;
}

export function createDepartmentDemoWorkstreams(): OperationWorkstream[] {
  return WORKSTREAMS.map((item, index) => ({
    ...item,
    source: "department_mock",
    ownerId: index === 1 ? "actor-finance" : "actor-executive",
    status: "active",
    createdAt: DEMO_TIMESTAMP,
    updatedAt: DEMO_TIMESTAMP,
  }));
}

export function createDepartmentDemoTasks(): OperationTask[] {
  return TASKS.map((item) => {
    const workstream = WORKSTREAMS.find(({ id }) => id === item.workstreamId);
    if (!workstream) throw new Error(`部门演示任务引用了未知工作流：${item.workstreamId}`);

    const assignee = requireDemoActor(item.assigneeId);
    requireDemoActor(item.departmentOwnerId);
    requireDemoActor(item.responsiblePersonId);

    return {
      ...item,
      commandId: "command-idle",
      projectId: workstream.projectId,
      runtimeSource: "department_mock",
      department: assignee.department,
      status: "assigned",
      progress: 0,
      deliverableRequired: true,
      dependencyIds: [],
      escalationLevel: "none",
      updatedAt: DEMO_TIMESTAMP,
    };
  });
}

export function createDemoIdleCommand(): OperationCommand {
  return {
    id: "command-idle",
    title: "等待新的 AI 调度",
    summary: "当前没有活动中的 AI 调度工作流。",
    ownerId: "actor-executive",
    status: "archived",
    deadline: "2026-12-31",
    budgetWan: 0,
    createdAt: DEMO_TIMESTAMP,
    updatedAt: DEMO_TIMESTAMP,
  };
}
