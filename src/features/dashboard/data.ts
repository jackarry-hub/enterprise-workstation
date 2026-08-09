export const projectHealth = [
  { name: "企业官网升级项目", owner: "张伟", progress: 78, dueDate: "06-15", status: "active" },
  { name: "新产品发布活动", owner: "王芳", progress: 62, dueDate: "05-28", status: "active" },
  { name: "年度市场推广计划", owner: "刘洋", progress: 45, dueDate: "06-30", status: "warning" },
  { name: "客户管理系统优化", owner: "陈晨", progress: 90, dueDate: "05-20", status: "active" },
  { name: "办公环境升级改造", owner: "赵敏", progress: 100, dueDate: "05-10", status: "success" },
] as const;

export const taskTrend = [
  { date: "05-11", created: 72, completed: 38 },
  { date: "05-12", created: 98, completed: 58 },
  { date: "05-13", created: 86, completed: 44 },
  { date: "05-14", created: 112, completed: 70 },
  { date: "05-15", created: 128, completed: 87 },
  { date: "05-16", created: 118, completed: 78 },
  { date: "05-17", created: 128, completed: 86 },
] as const;

export const todoItems = [
  { title: "审批《市场推广预算方案》", meta: "发起人：市场部-王芳", time: "今天 10:30", level: "紧急" },
  { title: "完成产品需求评审会", meta: "项目：产品设计计划", time: "今天 14:00", level: "重要" },
  { title: "确认客户合同签署", meta: "客户：杭州云创科技", time: "明天 09:30", level: "普通" },
  { title: "提交周报", meta: "发起人：人事部-李琪", time: "明天 18:00", level: "普通" },
] as const;

export const announcements = [
  { title: "关于五一劳动节放假安排的通知", date: "04-28", tone: "blue" },
  { title: "公司年度战略规划研讨会成功召开", date: "04-25", tone: "orange" },
  { title: "新版《员工手册》已更新，请查阅", date: "04-22", tone: "green" },
] as const;

export const schedules = [
  { time: "10:00", title: "产品迭代评审会", place: "会议室 A · 参与人：8 人", remaining: "2小时后" },
  { time: "14:30", title: "市场推广方案讨论", place: "会议室 B · 参与人：5 人", remaining: "6小时后" },
  { time: "16:00", title: "月度经营分析会", place: "会议室 C · 参与人：12 人", remaining: "7小时后" },
] as const;

export const activityStages = [
  { label: "策划", progress: "100%", state: "success" },
  { label: "执行", progress: "75%", state: "active" },
  { label: "推广", progress: "40%", state: "active" },
  { label: "复盘", progress: "0%", state: "neutral" },
] as const;

export const projectActivity = [
  { person: "张伟", action: "更新了项目文档《需求规格说明书》", time: "10:20" },
  { person: "王芳", action: "完成了任务“市场调研分析”", time: "09:45" },
  { person: "刘洋", action: "上传了活动投放数据报告", time: "昨天" },
] as const;
