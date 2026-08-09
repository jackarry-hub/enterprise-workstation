import { analyticsTrendLabels, analyticsTrendOffsets } from "@/features/analytics/analytics-mock-data";
import type {
  AnalyticsExecutionRow,
  AnalyticsFilters,
  AnalyticsRange,
  AnalyticsTrendPoint,
  AnalyticsViewModel,
} from "@/features/analytics/analytics-types";
import type { MemberSummary, ProjectDetailData, ProjectTask } from "@/features/projects/types";
import { calculateTaskCenterCompletionRate } from "@/features/tasks/task-center-selectors";

const today = "2026-08-05";

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function matchesRange(updatedAt: string, range: AnalyticsRange) {
  const date = updatedAt.slice(0, 10);
  const start = range === "month" ? "2026-08-01" : range === "quarter" ? "2026-06-01" : "2026-03-01";
  return date >= start;
}

function projectMatchesDepartment(detail: ProjectDetailData, department: string) {
  return department === "all" || detail.members.some(({ member }) => member.department === department);
}

function taskMatchesDepartment(detail: ProjectDetailData, task: ProjectTask, department: string) {
  if (department === "all") {
    return true;
  }
  return detail.members.some(({ member }) => member.id === task.assigneeId && member.department === department);
}

export function buildAnalyticsTrend(
  projects: readonly ProjectDetailData[],
  range: AnalyticsRange,
): AnalyticsTrendPoint[] {
  const projectProgress = projects.length
    ? projects.reduce((sum, detail) => sum + detail.project.progress, 0) / projects.length
    : 0;
  const tasks = projects.flatMap(({ tasks: detailTasks }) => detailTasks);
  const taskCompletion = calculateTaskCenterCompletionRate(tasks);

  return analyticsTrendLabels[range].map((label, index) => ({
    label,
    projectProgress: clamp(projectProgress + analyticsTrendOffsets[range][index]),
    taskCompletion: clamp(taskCompletion + analyticsTrendOffsets[range][index] * 0.8),
  }));
}

function buildExecutionRows(
  projects: readonly ProjectDetailData[],
  members: readonly MemberSummary[],
  filters: AnalyticsFilters,
): AnalyticsExecutionRow[] {
  const scopedMembers = members.filter((member) => filters.department === "all" || member.department === filters.department);

  return scopedMembers.flatMap((member): AnalyticsExecutionRow[] => {
    const tasks = projects.flatMap((detail) => detail.tasks.filter((task) => (
      task.assigneeId === member.id && matchesRange(task.updatedAt, filters.range)
    )));
    if (tasks.length === 0) {
      return [];
    }
    return [{
      member,
      department: member.department,
      taskCount: tasks.length,
      completedCount: tasks.filter(({ status }) => status === "done").length,
      inProgressCount: tasks.filter(({ status }) => status === "in_progress" || status === "in_review").length,
      overdueCount: tasks.filter(({ dueDate, status }) => Boolean(dueDate && dueDate < today && !["done", "cancelled"].includes(status))).length,
      completionRate: calculateTaskCenterCompletionRate(tasks),
    }];
  }).sort((left, right) => right.completionRate - left.completionRate || right.taskCount - left.taskCount);
}

export function buildAnalyticsViewModel(
  projects: readonly ProjectDetailData[],
  members: readonly MemberSummary[],
  filters: AnalyticsFilters,
): AnalyticsViewModel {
  const scopedProjects = projects.filter((detail) => projectMatchesDepartment(detail, filters.department));
  const scopedTasks = scopedProjects.flatMap((detail) => detail.tasks.filter((task) => (
    matchesRange(task.updatedAt, filters.range) && taskMatchesDepartment(detail, task, filters.department)
  )));
  const executionRows = buildExecutionRows(scopedProjects, members, filters);
  const healthLabels = {
    on_track: "健康推进",
    at_risk: "需要关注",
    off_track: "已偏离",
  } as const;
  const healthColors = {
    on_track: "#21c39b",
    at_risk: "#ffab52",
    off_track: "#ef5d67",
  } as const;

  return {
    summary: {
      projectCount: scopedProjects.length,
      activeProjectCount: scopedProjects.filter(({ project }) => project.status === "active").length,
      taskCompletionRate: calculateTaskCenterCompletionRate(scopedTasks),
      activeEmployeeCount: executionRows.length,
    },
    executionRows,
    trend: buildAnalyticsTrend(scopedProjects, filters.range),
    riskReminders: scopedProjects
      .flatMap((detail) => detail.risks.map((risk) => ({
        id: risk.id,
        projectName: detail.project.name,
        title: risk.title,
        level: risk.level,
        deadline: risk.deadline,
      })))
      .sort((left, right) => left.deadline.localeCompare(right.deadline)),
    deliveryCalendar: scopedProjects
      .map(({ project }) => ({
        id: project.id,
        projectName: project.name,
        dueDate: project.dueDate,
        progress: project.progress,
        status: project.status,
      }))
      .sort((left, right) => left.dueDate.localeCompare(right.dueDate)),
    healthDistribution: (["on_track", "at_risk", "off_track"] as const).map((health) => ({
      health,
      label: healthLabels[health],
      value: scopedProjects.filter(({ project }) => project.health === health).length,
      color: healthColors[health],
    })),
  };
}
