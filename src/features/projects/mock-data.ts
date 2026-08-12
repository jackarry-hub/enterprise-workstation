import type {
  DailyReport,
  FileRelation,
  MemberSummary,
  Milestone,
  Objective,
  Project,
  ProjectActivity,
  ProjectDeadlineFilter,
  ProjectDetailData,
  ProjectFile,
  ProjectListFilters,
  ProjectListItem,
  ProjectMember,
  ProjectMilestoneReminder,
  ProjectPortfolioStat,
  ProjectRisk,
  ProjectTask,
  TaskComment,
} from "@/features/projects/types";
import {
  CUSTOMER_DEMO_ORGANIZATION_ID,
  customerDemoPeople,
  customerDemoProjectMembers,
} from "@/features/demo/customer-demo-data";

const organizationId = CUSTOMER_DEMO_ORGANIZATION_ID;

const memberOrder = [
  "demo-product-head",
  "demo-market-head",
  "demo-design-head",
  "demo-engineer",
  "demo-customer-head",
  "demo-hr",
  "demo-executive",
  "demo-qa",
  "demo-operations",
  "demo-finance",
] as const;

export const mockMembers = memberOrder.map((personId) => {
  const person = customerDemoPeople.find(({ id }) => id === personId)!;
  return customerDemoProjectMembers.find(({ id }) => id === person.memberId)!;
}) satisfies readonly MemberSummary[];

export const mockObjectives = [
  {
    id: "30000000-0000-4000-8000-000000000001",
    organizationId,
    ownerId: mockMembers[0].id,
    createdById: mockMembers[0].id,
    title: "提升企业数字化客户体验",
    description: "统一线上品牌触点，降低客户获取与服务链路中的信息摩擦。",
    scope: "company",
    status: "active",
    periodStart: "2026-07-01",
    periodEnd: "2026-12-31",
    progress: 46,
    createdAt: "2026-06-20T02:00:00.000Z",
    updatedAt: "2026-08-04T01:30:00.000Z",
  },
  {
    id: "30000000-0000-4000-8000-000000000002",
    organizationId,
    ownerId: mockMembers[1].id,
    createdById: mockMembers[0].id,
    title: "建立可持续品牌增长引擎",
    description: "以产品发布和年度市场计划为抓手，提升品牌影响力与有效线索。",
    scope: "company",
    status: "active",
    periodStart: "2026-07-01",
    periodEnd: "2026-12-31",
    progress: 31,
    createdAt: "2026-06-20T02:10:00.000Z",
    updatedAt: "2026-08-04T01:40:00.000Z",
  },
] satisfies readonly Objective[];

export const mockProjects = [
  {
    id: "40000000-0000-4000-8000-000000000001",
    organizationId,
    objectiveId: mockObjectives[0].id,
    code: "PRJ-2026-018",
    name: "企业官网升级项目",
    description: "重构企业官网的信息架构、视觉体验与内容发布能力。",
    ownerId: mockMembers[0].id,
    createdById: mockMembers[0].id,
    status: "active",
    health: "on_track",
    priority: "high",
    startDate: "2026-07-01",
    dueDate: "2026-09-30",
    progress: 68,
    createdAt: "2026-06-25T03:00:00.000Z",
    updatedAt: "2026-08-04T02:20:00.000Z",
  },
  {
    id: "40000000-0000-4000-8000-000000000002",
    organizationId,
    objectiveId: mockObjectives[1].id,
    code: "PRJ-2026-021",
    name: "新产品发布活动",
    description: "完成新品定位、发布会筹备、媒体传播和客户转化。",
    ownerId: mockMembers[1].id,
    createdById: mockMembers[0].id,
    status: "active",
    health: "at_risk",
    priority: "critical",
    startDate: "2026-07-15",
    dueDate: "2026-10-20",
    progress: 42,
    createdAt: "2026-07-05T04:00:00.000Z",
    updatedAt: "2026-08-04T02:30:00.000Z",
  },
  {
    id: "40000000-0000-4000-8000-000000000003",
    organizationId,
    objectiveId: mockObjectives[1].id,
    code: "PRJ-2026-024",
    name: "年度市场推广计划",
    description: "统筹下半年内容、渠道、展会与客户案例推广节奏。",
    ownerId: mockMembers[2].id,
    createdById: mockMembers[0].id,
    status: "planning",
    health: "on_track",
    priority: "medium",
    startDate: "2026-08-01",
    dueDate: "2026-12-15",
    progress: 15,
    createdAt: "2026-07-20T05:00:00.000Z",
    updatedAt: "2026-08-03T08:00:00.000Z",
  },
  {
    id: "40000000-0000-4000-8000-000000000004",
    organizationId,
    objectiveId: mockObjectives[0].id,
    code: "PRJ-2026-009",
    name: "客户成功知识库建设",
    description: "沉淀客户交付方法、常见问题和标准化服务内容。",
    ownerId: mockMembers[4].id,
    createdById: mockMembers[0].id,
    status: "completed",
    health: "on_track",
    priority: "low",
    startDate: "2026-04-08",
    dueDate: "2026-07-28",
    actualEndDate: "2026-07-25",
    progress: 100,
    createdAt: "2026-04-01T03:00:00.000Z",
    updatedAt: "2026-07-25T09:30:00.000Z",
  },
] satisfies readonly Project[];

export const mockProjectMembers: readonly ProjectMember[] = [
  {
    id: "50000000-0000-4000-8000-000000000001",
    organizationId,
    projectId: mockProjects[0].id,
    member: mockMembers[0],
    role: "owner",
    allocationPercent: 60,
    joinedAt: "2026-07-01T01:00:00.000Z",
  },
  {
    id: "50000000-0000-4000-8000-000000000002",
    organizationId,
    projectId: mockProjects[0].id,
    member: mockMembers[2],
    role: "member",
    allocationPercent: 70,
    joinedAt: "2026-07-01T01:05:00.000Z",
  },
  {
    id: "50000000-0000-4000-8000-000000000003",
    organizationId,
    projectId: mockProjects[0].id,
    member: mockMembers[3],
    role: "manager",
    allocationPercent: 80,
    joinedAt: "2026-07-01T01:10:00.000Z",
  },
  {
    id: "50000000-0000-4000-8000-000000000004",
    organizationId,
    projectId: mockProjects[0].id,
    member: mockMembers[4],
    role: "viewer",
    allocationPercent: 20,
    joinedAt: "2026-07-03T01:00:00.000Z",
  },
  {
    id: "50000000-0000-4000-8000-000000000005",
    organizationId,
    projectId: mockProjects[1].id,
    member: mockMembers[1],
    role: "owner",
    allocationPercent: 80,
    joinedAt: "2026-07-15T01:00:00.000Z",
  },
  {
    id: "50000000-0000-4000-8000-000000000006",
    organizationId,
    projectId: mockProjects[1].id,
    member: mockMembers[0],
    role: "manager",
    allocationPercent: 30,
    joinedAt: "2026-07-15T01:05:00.000Z",
  },
  {
    id: "50000000-0000-4000-8000-000000000007",
    organizationId,
    projectId: mockProjects[1].id,
    member: mockMembers[2],
    role: "member",
    allocationPercent: 50,
    joinedAt: "2026-07-15T01:10:00.000Z",
  },
  {
    id: "50000000-0000-4000-8000-000000000008",
    organizationId,
    projectId: mockProjects[2].id,
    member: mockMembers[2],
    role: "owner",
    allocationPercent: 40,
    joinedAt: "2026-08-01T01:00:00.000Z",
  },
  {
    id: "50000000-0000-4000-8000-000000000009",
    organizationId,
    projectId: mockProjects[2].id,
    member: mockMembers[1],
    role: "manager",
    allocationPercent: 30,
    joinedAt: "2026-08-01T01:05:00.000Z",
  },
  {
    id: "50000000-0000-4000-8000-000000000010",
    organizationId,
    projectId: mockProjects[2].id,
    member: mockMembers[4],
    role: "member",
    allocationPercent: 25,
    joinedAt: "2026-08-01T01:10:00.000Z",
  },
  {
    id: "50000000-0000-4000-8000-000000000011",
    organizationId,
    projectId: mockProjects[3].id,
    member: mockMembers[4],
    role: "owner",
    allocationPercent: 40,
    joinedAt: "2026-04-08T01:00:00.000Z",
  },
  {
    id: "50000000-0000-4000-8000-000000000012",
    organizationId,
    projectId: mockProjects[3].id,
    member: mockMembers[0],
    role: "viewer",
    allocationPercent: 10,
    joinedAt: "2026-04-08T01:05:00.000Z",
  },
];

export const mockMilestones = [
  {
    id: "60000000-0000-4000-8000-000000000001",
    organizationId,
    projectId: mockProjects[0].id,
    ownerId: mockMembers[2].id,
    name: "体验设计定稿",
    description: "完成信息架构、视觉规范与核心页面评审。",
    status: "completed",
    startDate: "2026-07-01",
    dueDate: "2026-07-31",
    completedAt: "2026-07-30T09:20:00.000Z",
    progress: 100,
    sortOrder: 0,
    createdAt: "2026-07-01T02:00:00.000Z",
    updatedAt: "2026-07-30T09:20:00.000Z",
  },
  {
    id: "60000000-0000-4000-8000-000000000002",
    organizationId,
    projectId: mockProjects[0].id,
    ownerId: mockMembers[3].id,
    name: "前端开发完成",
    description: "交付响应式核心页面和内容管理接入。",
    status: "in_progress",
    startDate: "2026-07-25",
    dueDate: "2026-09-05",
    progress: 58,
    sortOrder: 1,
    createdAt: "2026-07-01T02:10:00.000Z",
    updatedAt: "2026-08-04T02:20:00.000Z",
  },
  {
    id: "60000000-0000-4000-8000-000000000003",
    organizationId,
    projectId: mockProjects[1].id,
    ownerId: mockMembers[1].id,
    name: "发布策略确认",
    description: "确认产品定位、核心卖点与发布节奏。",
    status: "in_progress",
    startDate: "2026-07-15",
    dueDate: "2026-08-12",
    progress: 75,
    sortOrder: 0,
    createdAt: "2026-07-15T02:00:00.000Z",
    updatedAt: "2026-08-04T02:30:00.000Z",
  },
  {
    id: "60000000-0000-4000-8000-000000000004",
    organizationId,
    projectId: mockProjects[1].id,
    ownerId: mockMembers[2].id,
    name: "发布会物料完成",
    description: "完成主视觉、演示材料、媒体包和会场物料。",
    status: "pending",
    startDate: "2026-08-10",
    dueDate: "2026-09-25",
    progress: 10,
    sortOrder: 1,
    createdAt: "2026-07-15T02:10:00.000Z",
    updatedAt: "2026-08-03T03:00:00.000Z",
  },
  {
    id: "60000000-0000-4000-8000-000000000005",
    organizationId,
    projectId: mockProjects[2].id,
    ownerId: mockMembers[2].id,
    name: "年度内容日历确认",
    description: "明确重点主题、渠道组合与内容负责人。",
    status: "in_progress",
    startDate: "2026-08-01",
    dueDate: "2026-08-25",
    progress: 35,
    sortOrder: 0,
    createdAt: "2026-08-01T02:00:00.000Z",
    updatedAt: "2026-08-04T03:00:00.000Z",
  },
] satisfies readonly Milestone[];

export const mockTasks = [
  {
    id: "70000000-0000-4000-8000-000000000001",
    organizationId,
    projectId: mockProjects[0].id,
    milestoneId: mockMilestones[1].id,
    title: "搭建官网前端工程与组件基线",
    description: "完成工程配置、设计变量和公共内容组件。",
    assigneeId: mockMembers[3].id,
    reporterId: mockMembers[0].id,
    status: "in_progress",
    priority: "high",
    startDate: "2026-07-25",
    dueDate: "2026-08-08",
    progress: 80,
    estimatedHours: 32,
    sortOrder: 0,
    createdAt: "2026-07-20T03:00:00.000Z",
    updatedAt: "2026-08-04T02:20:00.000Z",
  },
  {
    id: "70000000-0000-4000-8000-000000000002",
    organizationId,
    projectId: mockProjects[0].id,
    milestoneId: mockMilestones[1].id,
    parentTaskId: "70000000-0000-4000-8000-000000000001",
    title: "实现首页响应式模块",
    description: "完成桌面与移动端首页，并接入内容占位数据。",
    assigneeId: mockMembers[3].id,
    reporterId: mockMembers[0].id,
    status: "in_review",
    priority: "urgent",
    startDate: "2026-07-29",
    dueDate: "2026-08-06",
    progress: 95,
    estimatedHours: 20,
    sortOrder: 1,
    createdAt: "2026-07-25T03:00:00.000Z",
    updatedAt: "2026-08-04T02:15:00.000Z",
  },
  {
    id: "70000000-0000-4000-8000-000000000003",
    organizationId,
    projectId: mockProjects[0].id,
    milestoneId: mockMilestones[1].id,
    title: "整理并迁移品牌内容",
    description: "校对公司介绍、解决方案和客户案例内容。",
    assigneeId: mockMembers[2].id,
    reporterId: mockMembers[0].id,
    status: "todo",
    priority: "medium",
    startDate: "2026-08-05",
    dueDate: "2026-08-20",
    progress: 10,
    estimatedHours: 24,
    sortOrder: 2,
    createdAt: "2026-07-28T03:00:00.000Z",
    updatedAt: "2026-08-03T06:00:00.000Z",
  },
  {
    id: "70000000-0000-4000-8000-000000000004",
    organizationId,
    projectId: mockProjects[1].id,
    milestoneId: mockMilestones[2].id,
    title: "完成新品受众与竞品研究",
    description: "输出核心受众画像与差异化定位依据。",
    assigneeId: mockMembers[1].id,
    reporterId: mockMembers[0].id,
    status: "done",
    priority: "high",
    startDate: "2026-07-16",
    dueDate: "2026-07-30",
    completedAt: "2026-07-29T08:30:00.000Z",
    progress: 100,
    estimatedHours: 28,
    sortOrder: 0,
    createdAt: "2026-07-15T03:00:00.000Z",
    updatedAt: "2026-07-29T08:30:00.000Z",
  },
  {
    id: "70000000-0000-4000-8000-000000000005",
    organizationId,
    projectId: mockProjects[1].id,
    milestoneId: mockMilestones[2].id,
    title: "确认发布会主题与主叙事",
    description: "形成发布会主题提案并完成管理层评审。",
    assigneeId: mockMembers[1].id,
    reporterId: mockMembers[0].id,
    status: "in_review",
    priority: "urgent",
    startDate: "2026-07-28",
    dueDate: "2026-08-08",
    progress: 85,
    estimatedHours: 18,
    sortOrder: 1,
    createdAt: "2026-07-25T03:00:00.000Z",
    updatedAt: "2026-08-04T02:30:00.000Z",
  },
  {
    id: "70000000-0000-4000-8000-000000000006",
    organizationId,
    projectId: mockProjects[2].id,
    milestoneId: mockMilestones[4].id,
    title: "盘点下半年重点传播节点",
    description: "整合产品、销售与雇主品牌的关键传播时间。",
    assigneeId: mockMembers[4].id,
    reporterId: mockMembers[2].id,
    status: "in_progress",
    priority: "medium",
    startDate: "2026-08-01",
    dueDate: "2026-08-10",
    progress: 45,
    estimatedHours: 12,
    sortOrder: 0,
    createdAt: "2026-08-01T03:00:00.000Z",
    updatedAt: "2026-08-04T03:00:00.000Z",
  },
] satisfies readonly ProjectTask[];

export const mockTaskComments = [
  {
    id: "80000000-0000-4000-8000-000000000001",
    organizationId,
    projectId: mockProjects[0].id,
    taskId: mockTasks[1].id,
    authorId: mockMembers[2].id,
    body: "移动端首屏层级已经核对，建议保留当前留白比例。",
    createdAt: "2026-08-03T08:10:00.000Z",
    updatedAt: "2026-08-03T08:10:00.000Z",
  },
  {
    id: "80000000-0000-4000-8000-000000000002",
    organizationId,
    projectId: mockProjects[0].id,
    taskId: mockTasks[1].id,
    authorId: mockMembers[0].id,
    body: "通过，补齐案例模块空状态后即可合并。",
    createdAt: "2026-08-04T01:40:00.000Z",
    updatedAt: "2026-08-04T01:40:00.000Z",
  },
  {
    id: "80000000-0000-4000-8000-000000000003",
    organizationId,
    projectId: mockProjects[1].id,
    taskId: mockTasks[4].id,
    authorId: mockMembers[0].id,
    body: "主叙事需要补充两个可量化的客户价值证明。",
    createdAt: "2026-08-04T01:50:00.000Z",
    updatedAt: "2026-08-04T01:50:00.000Z",
  },
] satisfies readonly TaskComment[];

export const mockProjectFiles = [
  {
    id: "90000000-0000-4000-8000-000000000001",
    organizationId,
    projectId: mockProjects[0].id,
    bucket: "project-files",
    objectPath: `${mockProjects[0].id}/website-information-architecture-v3.pdf`,
    originalName: "官网信息架构_v3.pdf",
    mimeType: "application/pdf",
    sizeBytes: 2_480_128,
    accessScope: "restricted",
    uploadedById: mockMembers[2].id,
    createdAt: "2026-07-28T06:20:00.000Z",
  },
  {
    id: "90000000-0000-4000-8000-000000000002",
    organizationId,
    projectId: mockProjects[0].id,
    taskId: mockTasks[1].id,
    bucket: "project-files",
    objectPath: `${mockProjects[0].id}/homepage-review-notes.docx`,
    originalName: "首页评审意见.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    sizeBytes: 486_240,
    accessScope: "restricted",
    uploadedById: mockMembers[0].id,
    createdAt: "2026-08-04T01:45:00.000Z",
  },
  {
    id: "90000000-0000-4000-8000-000000000003",
    organizationId,
    projectId: mockProjects[1].id,
    taskId: mockTasks[4].id,
    bucket: "project-files",
    objectPath: `${mockProjects[1].id}/launch-narrative-v2.pptx`,
    originalName: "新品发布主叙事_v2.pptx",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    sizeBytes: 8_526_112,
    accessScope: "restricted",
    uploadedById: mockMembers[1].id,
    createdAt: "2026-08-03T09:10:00.000Z",
  },
  {
    id: "90000000-0000-4000-8000-000000000004",
    organizationId,
    projectId: mockProjects[2].id,
    bucket: "project-files",
    objectPath: `${mockProjects[2].id}/campaign-calendar.xlsx`,
    originalName: "下半年市场传播日历.xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sizeBytes: 356_864,
    accessScope: "organization",
    uploadedById: mockMembers[2].id,
    createdAt: "2026-08-04T02:50:00.000Z",
  },
] satisfies readonly ProjectFile[];

export const mockDailyReports = [
  {
    id: "a0000000-0000-4000-8000-000000000001",
    organizationId,
    projectId: mockProjects[0].id,
    authorId: mockMembers[3].id,
    reportDate: "2026-08-04",
    status: "submitted",
    summary: "完成首页响应式适配和主要浏览器自测，提交设计复核。",
    nextPlan: "处理评审意见并开始解决方案详情页开发。",
    blockers: "案例素材仍缺两张高清原图。",
    supportNeeded: "请市场团队在 8 月 5 日中午前补齐素材。",
    submittedAt: "2026-08-04T09:05:00.000Z",
    createdAt: "2026-08-04T08:50:00.000Z",
    updatedAt: "2026-08-04T09:05:00.000Z",
  },
  {
    id: "a0000000-0000-4000-8000-000000000002",
    organizationId,
    projectId: mockProjects[0].id,
    authorId: mockMembers[2].id,
    reportDate: "2026-08-04",
    status: "submitted",
    summary: "复核首页视觉实现，标注三处间距与动效调整。",
    nextPlan: "完成解决方案页关键模块的视觉标注。",
    submittedAt: "2026-08-04T09:15:00.000Z",
    createdAt: "2026-08-04T09:00:00.000Z",
    updatedAt: "2026-08-04T09:15:00.000Z",
  },
  {
    id: "a0000000-0000-4000-8000-000000000003",
    organizationId,
    projectId: mockProjects[1].id,
    authorId: mockMembers[1].id,
    reportDate: "2026-08-04",
    status: "submitted",
    summary: "完成发布会主题第二轮评审，已收敛为两个方向。",
    nextPlan: "补充客户价值证据，明日下午完成最终决策。",
    blockers: "两项客户成效数据仍待销售团队确认。",
    submittedAt: "2026-08-04T09:20:00.000Z",
    createdAt: "2026-08-04T09:10:00.000Z",
    updatedAt: "2026-08-04T09:20:00.000Z",
  },
  {
    id: "a0000000-0000-4000-8000-000000000004",
    organizationId,
    projectId: mockProjects[2].id,
    authorId: mockMembers[4].id,
    reportDate: "2026-08-04",
    status: "draft",
    summary: "已完成销售侧重点传播节点初步盘点。",
    nextPlan: "与市场团队合并渠道日历。",
    createdAt: "2026-08-04T08:40:00.000Z",
    updatedAt: "2026-08-04T08:40:00.000Z",
  },
] satisfies readonly DailyReport[];

export const mockProjectActivities = [
  {
    id: "b0000000-0000-4000-8000-000000000001",
    organizationId,
    projectId: mockProjects[0].id,
    userId: "d0000000-0000-4000-8000-000000000001",
    actionType: "milestone_updated",
    content: "张伟将“前端开发完成”里程碑进度更新为 58%。",
    createdAt: "2026-08-04T02:20:00.000Z",
  },
  {
    id: "b0000000-0000-4000-8000-000000000002",
    organizationId,
    projectId: mockProjects[0].id,
    userId: "d0000000-0000-4000-8000-000000000003",
    actionType: "file_uploaded",
    content: "刘洋上传了《官网信息架构_v3.pdf》。",
    createdAt: "2026-08-03T06:20:00.000Z",
  },
  {
    id: "b0000000-0000-4000-8000-000000000003",
    organizationId,
    projectId: mockProjects[1].id,
    userId: "d0000000-0000-4000-8000-000000000002",
    actionType: "risk_updated",
    content: "王芳将客户成效数据风险调整为重点监控。",
    createdAt: "2026-08-04T02:30:00.000Z",
  },
] satisfies readonly ProjectActivity[];

export const mockProjectRisks = [
  {
    id: "c0000000-0000-4000-8000-000000000001",
    organizationId,
    projectId: mockProjects[0].id,
    title: "案例素材交付可能延迟",
    level: "medium",
    ownerId: mockMembers[2].id,
    status: "monitoring",
    deadline: "2026-08-08",
    createdAt: "2026-08-02T02:00:00.000Z",
    updatedAt: "2026-08-04T02:20:00.000Z",
  },
  {
    id: "c0000000-0000-4000-8000-000000000002",
    organizationId,
    projectId: mockProjects[1].id,
    title: "客户成效数据尚未确认",
    level: "high",
    ownerId: mockMembers[1].id,
    status: "open",
    deadline: "2026-08-07",
    createdAt: "2026-08-01T02:00:00.000Z",
    updatedAt: "2026-08-04T02:30:00.000Z",
  },
] satisfies readonly ProjectRisk[];

export const mockFileRelations = mockProjectFiles.map((file, index) => ({
  id: `e0000000-0000-4000-8000-00000000000${index + 1}`,
  organizationId,
  projectId: file.projectId,
  fileId: file.id,
  relationType: file.taskId ? "task" : "project",
  taskId: file.taskId,
  createdById: file.uploadedById,
  createdAt: file.createdAt,
})) satisfies readonly FileRelation[];

export const mockProjectPortfolioStats = [
  {
    id: "all",
    label: "全部项目",
    value: 24,
    trendLabel: "较上月",
    trend: "+3",
    tone: "blue",
  },
  {
    id: "active",
    label: "进行中",
    value: 16,
    trendLabel: "本月新增",
    trend: "+2",
    tone: "purple",
  },
  {
    id: "completed",
    label: "已完成",
    value: 6,
    trendLabel: "按时交付",
    trend: "100%",
    tone: "green",
  },
  {
    id: "risk",
    label: "延期风险",
    value: 2,
    trendLabel: "需要关注",
    trend: "-1",
    tone: "red",
  },
] satisfies readonly ProjectPortfolioStat[];

export const mockProjectMilestoneReminders = [
  {
    id: "f0000000-0000-4000-8000-000000000001",
    projectName: "企业官网升级项目",
    milestoneName: "首页开发完成",
    dueDate: "2026-08-08",
    status: "urgent",
  },
  {
    id: "f0000000-0000-4000-8000-000000000002",
    projectName: "新产品发布活动",
    milestoneName: "发布策略确认",
    dueDate: "2026-08-12",
    status: "upcoming",
  },
  {
    id: "f0000000-0000-4000-8000-000000000003",
    projectName: "年度市场推广计划",
    milestoneName: "内容日历确认",
    dueDate: "2026-08-25",
    status: "upcoming",
  },
] satisfies readonly ProjectMilestoneReminder[];

const mockToday = "2026-08-04";
const viewerMemberId = mockMembers[0].id;

const projectStatusOrder: Record<Project["status"], number> = {
  active: 0,
  planning: 1,
  on_hold: 2,
  completed: 3,
  cancelled: 4,
};

function findProjectOwner(project: Project, memberships: readonly ProjectMember[]) {
  const owner = memberships.find(({ member }) => member.id === project.ownerId)?.member;

  if (!owner) {
    throw new Error(`Project ${project.id} does not have its owner in project members.`);
  }

  return owner;
}

export function getProjectListMock(): ProjectListItem[] {
  return mockProjects
    .map<ProjectListItem>((project) => {
      const memberships = mockProjectMembers.filter(
        (membership) => membership.projectId === project.id && !membership.leftAt,
      );
      const objective = mockObjectives.find(({ id }) => id === project.objectiveId);
      const viewerMembership = memberships.find(
        ({ member }) => member.id === viewerMemberId,
      );

      return {
        id: project.id,
        code: project.code,
        name: project.name,
        objectiveTitle: objective?.title,
        owner: findProjectOwner(project, memberships),
        members: memberships.map(({ member }) => member),
        memberCount: memberships.length,
        progress: project.progress,
        status: project.status,
        health: project.health,
        priority: project.priority,
        startDate: project.startDate,
        dueDate: project.dueDate,
        viewerRole: viewerMembership?.role ?? "none",
        isFollowed: project.id === mockProjects[1].id || project.id === mockProjects[2].id,
      };
    })
    .sort(
      (left, right) =>
        projectStatusOrder[left.status] - projectStatusOrder[right.status]
        || left.dueDate.localeCompare(right.dueDate),
    );
}

function matchesDeadline(
  project: ProjectListItem,
  deadline: ProjectDeadlineFilter,
) {
  if (deadline === "all") {
    return true;
  }

  if (deadline === "overdue") {
    return project.status !== "completed" && project.dueDate < mockToday;
  }

  const month = deadline === "this_month" ? "2026-08" : "2026-09";
  return project.dueDate.startsWith(month);
}

export function filterProjectList(
  projects: readonly ProjectListItem[],
  filters: ProjectListFilters,
) {
  const normalizedQuery = filters.query.trim().toLocaleLowerCase("zh-CN");

  return projects.filter((project) => {
    const matchesGroup =
      filters.group === "all"
      || (filters.group === "responsible"
        && (project.viewerRole === "owner" || project.viewerRole === "manager"))
      || (filters.group === "involved"
        && project.viewerRole !== "none"
        && project.viewerRole !== "viewer")
      || (filters.group === "following" && project.isFollowed)
      || (filters.group === "completed" && project.status === "completed");
    const matchesQuery =
      normalizedQuery === ""
      || project.name.toLocaleLowerCase("zh-CN").includes(normalizedQuery)
      || project.code.toLocaleLowerCase("zh-CN").includes(normalizedQuery)
      || project.owner.displayName.toLocaleLowerCase("zh-CN").includes(normalizedQuery);

    return matchesGroup
      && matchesQuery
      && (filters.status === "all" || project.status === filters.status)
      && (filters.priority === "all" || project.priority === filters.priority)
      && (filters.ownerId === "all" || project.owner.id === filters.ownerId)
      && matchesDeadline(project, filters.deadline);
  });
}

export function getProjectDetailMock(projectId: string): ProjectDetailData | undefined {
  const project = mockProjects.find(({ id }) => id === projectId);

  if (!project) {
    return undefined;
  }

  const members = mockProjectMembers.filter(
    (membership) => membership.projectId === project.id && !membership.leftAt,
  );

  return {
    project,
    objective: mockObjectives.find(({ id }) => id === project.objectiveId),
    owner: findProjectOwner(project, members),
    members,
    milestones: mockMilestones
      .filter((milestone) => milestone.projectId === project.id)
      .sort((left, right) => left.sortOrder - right.sortOrder),
    tasks: mockTasks
      .filter((task) => task.projectId === project.id)
      .sort((left, right) => left.sortOrder - right.sortOrder),
    comments: mockTaskComments
      .filter((comment) => comment.projectId === project.id)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt)),
    files: mockProjectFiles
      .filter((file) => file.projectId === project.id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    dailyReports: mockDailyReports
      .filter((report) => report.projectId === project.id)
      .sort(
        (left, right) =>
          right.reportDate.localeCompare(left.reportDate)
          || right.createdAt.localeCompare(left.createdAt),
      ),
    activities: mockProjectActivities
      .filter((activity) => activity.projectId === project.id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    risks: mockProjectRisks
      .filter((risk) => risk.projectId === project.id)
      .sort((left, right) => left.deadline.localeCompare(right.deadline)),
    fileRelations: mockFileRelations.filter(
      (relation) => relation.projectId === project.id,
    ),
  };
}
