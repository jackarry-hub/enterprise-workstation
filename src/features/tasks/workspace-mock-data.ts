import type { WorkspaceResult } from "@/features/tasks/workspace-types";

const assignees = {
  chen: { id: "member-chen", displayName: "陈晨", department: "产品研发中心", title: "前端工程师" },
  liu: { id: "member-liu", displayName: "刘洋", department: "设计中心", title: "高级设计师" },
  zhang: { id: "member-zhang", displayName: "张伟", department: "产品研发中心", title: "产品总监" },
};

export const workspaceMockResult: WorkspaceResult = {
  source: "mock",
  data: {
    viewerName: "林远",
    overview: {
      todayTaskCount: 6,
      pendingApprovalCount: 2,
      deadlineReminderCount: 3,
      weeklyCompletionRate: 82,
    },
    tasks: [
      { id: "work-task-1", projectId: "project-ai", projectName: "AI 数据智能分析平台", title: "完善用户增长分析报告", assignee: assignees.chen, dueDate: "2026-08-04", priority: "high", status: "in_progress", progress: 72 },
      { id: "work-task-2", projectId: "project-weekly", projectName: "量子星河科技园 A 座", title: "准备周报数据汇总", assignee: assignees.liu, dueDate: "2026-08-05", priority: "medium", status: "in_progress", progress: 58 },
      { id: "work-task-3", projectId: "project-service", projectName: "智能服务系统", title: "产品需求评审会", assignee: assignees.zhang, dueDate: "2026-08-04", priority: "high", status: "todo", progress: 0 },
      { id: "work-task-4", projectId: "project-customer", projectName: "客户成功平台", title: "与客户方案沟通", assignee: assignees.chen, dueDate: "2026-08-06", priority: "medium", status: "todo", progress: 0 },
      { id: "work-task-5", projectId: "project-bi", projectName: "BI 可视化平台", title: "修复数据看板展示问题", assignee: assignees.chen, dueDate: "2026-08-03", priority: "low", status: "done", progress: 100 },
    ],
    todos: [
      { id: "todo-1", type: "task", title: "10:30 前完成增长分析报告", meta: "AI 数据智能分析平台", time: "今天 10:30" },
      { id: "todo-2", type: "approval", title: "差旅报销申请待审批", meta: "申请人：张伟 · ¥1,260.00", time: "今天 09:18" },
      { id: "todo-3", type: "approval", title: "采购申请待审批", meta: "行政部 · 办公设备", time: "今天 09:15" },
      { id: "todo-4", type: "notice", title: "周五全员会议地点调整", meta: "会议室由 A3 调整至多功能厅", time: "20 分钟前" },
    ],
    activities: [
      { id: "activity-1", projectName: "企业官网升级项目", content: "张伟将“前端开发完成”进度更新为 68%", createdAt: "2026-08-04T10:20:00+08:00", tone: "blue" },
      { id: "activity-2", projectName: "新产品发布活动", content: "刘洋上传了新品发布主视觉终稿", createdAt: "2026-08-04T09:45:00+08:00", tone: "green" },
      { id: "activity-3", projectName: "客户成功平台", content: "赵敏完成客户方案沟通纪要", createdAt: "2026-08-04T09:10:00+08:00", tone: "purple" },
      { id: "activity-4", projectName: "年度市场推广计划", content: "王芳新增里程碑“内容日历确认”", createdAt: "2026-08-03T17:35:00+08:00", tone: "orange" },
    ],
    dailyReport: {
      projectId: "project-ai",
      todayCompleted: "完成用户增长看板指标核对，输出第一版分析结论。",
      blockers: "新用户渠道归因数据仍缺少两个来源字段。",
      tomorrowPlan: "补齐渠道对比图表，并与产品负责人完成结论确认。",
    },
    projects: [
      { id: "project-ai", name: "AI 数据智能分析平台" },
      { id: "project-weekly", name: "量子星河科技园 A 座" },
      { id: "project-service", name: "智能服务系统" },
    ],
  },
};
