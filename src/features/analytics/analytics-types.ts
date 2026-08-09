import type { MemberSummary, ProjectHealth, ProjectRiskLevel } from "@/features/projects/types";

export type AnalyticsRange = "month" | "quarter" | "half_year";

export interface AnalyticsFilters {
  range: AnalyticsRange;
  department: string;
}

export interface AnalyticsSummary {
  projectCount: number;
  activeProjectCount: number;
  taskCompletionRate: number;
  activeEmployeeCount: number;
}

export interface AnalyticsExecutionRow {
  member: MemberSummary;
  department: string;
  taskCount: number;
  completedCount: number;
  inProgressCount: number;
  overdueCount: number;
  completionRate: number;
}

export interface AnalyticsTrendPoint {
  label: string;
  projectProgress: number;
  taskCompletion: number;
}

export interface AnalyticsRiskReminder {
  id: string;
  projectName: string;
  title: string;
  level: ProjectRiskLevel;
  deadline: string;
}

export interface AnalyticsDeliveryItem {
  id: string;
  projectName: string;
  dueDate: string;
  progress: number;
  status: string;
}

export interface AnalyticsHealthItem {
  health: ProjectHealth;
  label: string;
  value: number;
  color: string;
}

export interface AnalyticsViewModel {
  summary: AnalyticsSummary;
  executionRows: AnalyticsExecutionRow[];
  trend: AnalyticsTrendPoint[];
  riskReminders: AnalyticsRiskReminder[];
  deliveryCalendar: AnalyticsDeliveryItem[];
  healthDistribution: AnalyticsHealthItem[];
}
