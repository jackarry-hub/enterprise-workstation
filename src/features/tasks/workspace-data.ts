import { loadProjectCollection } from "@/features/projects/data/project-collection-data";
import { createTaskCenterItems } from "@/features/tasks/task-center-selectors";
import { workspaceMockResult } from "@/features/tasks/workspace-mock-data";
import type { WorkspaceActivity, WorkspaceResult, WorkspaceTodo } from "@/features/tasks/workspace-types";
import { formatDateInputInTimeZone } from "@/lib/date";
import { shouldAllowMockBusinessData } from "@/lib/runtime/workstation-mode";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof getSupabaseServerClient>>;
export type WorkspaceClientFactory = () => Promise<SupabaseServerClient>;

type ApprovalRow = {
  public_id: string;
  title: string;
  current_step: string | null;
  submitted_at: string | null;
  total_count: number | string;
};

type DailyReportRow = {
  project_id: string;
  summary: string;
  next_plan: string;
  blockers: string;
};

type OptionalLoad<T> =
  | { status: "available"; value: T }
  | { status: "unavailable" };

type WorkspaceRpcClient = {
  rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function emptySupabaseResult(message?: string): WorkspaceResult {
  const unavailableMessage = message ?? "工作数据暂时不可用，请稍后重试。";
  return {
    source: "supabase",
    data: {
      viewerName: "当前用户",
      overview: { todayTaskCount: 0, pendingApprovalCount: 0, deadlineReminderCount: 0, weeklyCompletionRate: 0 },
      tasks: [],
      todos: [],
      activities: [],
      dailyReport: { projectId: "", todayCompleted: "", blockers: "", tomorrowPlan: "", submitted: false },
      projects: [],
      loadError: message,
      approvalLoadError: unavailableMessage,
      dailyReportLoadError: "今日日报状态暂时无法确认，请勿重复提交，稍后刷新核对。",
    },
  };
}

function daysBetween(left: string, right: string) {
  return Math.ceil((Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) / 86_400_000);
}

function currentWeekRange(today: string) {
  const date = new Date(`${today}T00:00:00Z`);
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  const start = new Date(date);
  start.setUTCDate(date.getUTCDate() - mondayOffset);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function activityTone(actionType: string): WorkspaceActivity["tone"] {
  if (actionType === "task_updated" || actionType === "milestone_updated") return "green";
  if (actionType === "file_uploaded") return "purple";
  if (actionType === "risk_updated") return "orange";
  return "blue";
}

async function loadActionableApprovals(
  client: SupabaseServerClient,
): Promise<OptionalLoad<{ rows: ApprovalRow[]; count: number }>> {
  try {
    const response = await (client as unknown as WorkspaceRpcClient)
      .rpc("current_actionable_approval_inbox");
    if (response.error || !Array.isArray(response.data)) return { status: "unavailable" };
    const rows = response.data as ApprovalRow[];
    if (rows.some((row) => !UUID_PATTERN.test(row.public_id)
      || typeof row.title !== "string" || !row.title.trim()
      || typeof row.current_step !== "string" || !row.current_step.trim()
      || (row.submitted_at !== null
        && (typeof row.submitted_at !== "string" || !Number.isFinite(Date.parse(row.submitted_at)))))) {
      return { status: "unavailable" };
    }
    const total = rows.length === 0 ? 0 : Number(rows[0].total_count);
    if (!Number.isSafeInteger(total) || total < rows.length) return { status: "unavailable" };
    return { status: "available", value: { rows, count: total } };
  } catch {
    return { status: "unavailable" };
  }
}

async function loadSubmittedDailyReport(
  client: SupabaseServerClient,
  today: string,
): Promise<OptionalLoad<WorkspaceResult["data"]["dailyReport"] | undefined>> {
  try {
    const response = await (client as unknown as WorkspaceRpcClient)
      .rpc("current_submitted_daily_report", { p_report_date: today });
    if (response.error || !Array.isArray(response.data)) return { status: "unavailable" };
    if (response.data.length === 0) return { status: "available", value: undefined };
    const row = response.data[0] as DailyReportRow;
    if (!UUID_PATTERN.test(row.project_id) || typeof row.summary !== "string"
      || typeof row.next_plan !== "string" || typeof row.blockers !== "string") {
      return { status: "unavailable" };
    }
    return {
      status: "available",
      value: {
        projectId: row.project_id,
        todayCompleted: row.summary,
        blockers: row.blockers,
        tomorrowPlan: row.next_plan,
        submitted: true,
      },
    };
  } catch {
    return { status: "unavailable" };
  }
}

export async function loadWorkspaceData(
  clientFactory: WorkspaceClientFactory = getSupabaseServerClient,
  options: { allowMockFallback?: boolean } = {},
): Promise<WorkspaceResult> {
  const runtimeAllowsMock = shouldAllowMockBusinessData();
  const allowMockFallback = (options.allowMockFallback ?? runtimeAllowsMock) && runtimeAllowsMock;
  if (allowMockFallback) return workspaceMockResult;

  try {
    const client = await clientFactory();
    const collection = await loadProjectCollection(async () => client, { allowMockFallback: false });

    const viewerMemberId = collection.viewer.memberId;
    const allItems = createTaskCenterItems(collection.details);
    const myItems = viewerMemberId
      ? allItems.filter(({ task }) => task.assigneeId === viewerMemberId)
      : [];
    const today = formatDateInputInTimeZone();
    const [approvalState, dailyReportState] = await Promise.all([
      loadActionableApprovals(client),
      loadSubmittedDailyReport(client, today),
    ]);
    const activeItems = myItems.filter(({ task }) => !["done", "cancelled"].includes(task.status));
    const tasks = myItems.flatMap(({ project, task, assignee }) => {
      const member = assignee ?? collection.viewer.member ?? collection.availableMembers[0];
      return member ? [{
        id: task.id,
        projectId: project.id,
        projectName: project.name,
        title: task.title,
        assignee: member,
        dueDate: task.dueDate,
        priority: task.priority,
        status: task.status,
        progress: task.progress,
      }] : [];
    });
    const taskTodos: WorkspaceTodo[] = activeItems.slice(0, 6).map(({ project, task }) => ({
      id: `task-${task.id}`,
      type: "task",
      title: task.title,
      meta: project.name,
      time: task.dueDate ? `截止 ${task.dueDate}` : "未设置截止时间",
      href: `/projects/${project.id}?tab=tasks&task=${task.id}`,
    }));
    const approvalRows = approvalState.status === "available" ? approvalState.value.rows : [];
    const approvalTodos: WorkspaceTodo[] = approvalRows.slice(0, 4).map((approval) => ({
      id: `approval-${approval.public_id}`,
      type: "approval",
      title: approval.title,
      meta: approval.current_step ? `当前步骤：${approval.current_step}` : "等待处理",
      time: approval.submitted_at ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(approval.submitted_at)) : "刚刚提交",
      href: `/approvals/${approval.public_id}`,
    }));
    const projectNames = new Map(collection.details.map(({ project }) => [project.id, project.name]));
    const activities = collection.details
      .flatMap(({ activities: entries }) => entries)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, 8)
      .map<WorkspaceActivity>((activity) => ({
        id: activity.id,
        projectName: projectNames.get(activity.projectId) ?? "项目协作",
        content: activity.content,
        createdAt: activity.createdAt,
        tone: activityTone(activity.actionType),
      }));
    const week = currentWeekRange(today);
    const weeklyItems = myItems.filter(({ task }) => task.status !== "cancelled"
      && Boolean(task.dueDate && task.dueDate >= week.start && task.dueDate <= week.end));
    const weeklyCompleted = weeklyItems.filter(({ task }) => task.status === "done").length;
    const projects = collection.details.map(({ project }) => ({ id: project.id, name: project.name }));
    const restoredDailyReport = dailyReportState.status === "available"
      && dailyReportState.value
      && projects.some(({ id }) => id === dailyReportState.value?.projectId)
      ? dailyReportState.value
      : undefined;
    const dailyReportUnavailable = dailyReportState.status === "unavailable"
      || Boolean(dailyReportState.status === "available" && dailyReportState.value && !restoredDailyReport);

    return {
      source: "supabase",
      data: {
        viewerName: collection.viewer.member?.displayName ?? "当前用户",
        overview: {
          todayTaskCount: activeItems.filter(({ task }) => task.dueDate === today).length,
          pendingApprovalCount: approvalState.status === "available" ? approvalState.value.count : 0,
          deadlineReminderCount: activeItems.filter(({ task }) => task.dueDate && daysBetween(today, task.dueDate) >= 0 && daysBetween(today, task.dueDate) <= 7).length,
          weeklyCompletionRate: weeklyItems.length > 0 ? Math.round((weeklyCompleted / weeklyItems.length) * 100) : 0,
        },
        tasks,
        todos: [...taskTodos, ...approvalTodos].slice(0, 8),
        activities,
        dailyReport: restoredDailyReport ?? { projectId: projects[0]?.id ?? "", todayCompleted: "", blockers: "", tomorrowPlan: "", submitted: false },
        projects,
        approvalLoadError: approvalState.status === "unavailable"
          ? "待审批数据暂时不可用，请稍后刷新。"
          : undefined,
        dailyReportLoadError: dailyReportUnavailable
          ? "今日日报状态暂时无法确认，请勿重复提交，稍后刷新核对。"
          : undefined,
      },
    };
  } catch {
    return emptySupabaseResult("工作数据加载失败，请稍后重试。");
  }
}
