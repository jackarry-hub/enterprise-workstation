import { Activity, CircleGauge, FolderKanban, UsersRound } from "lucide-react";

import { DataCard } from "@/components/ui/data-card";
import type { AnalyticsSummary as Summary } from "@/features/analytics/analytics-types";

export function AnalyticsSummary({ summary }: { summary: Summary }) {
  return (
    <section aria-label="企业执行统计" className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
      <DataCard compact icon={FolderKanban} label="项目总数" value={String(summary.projectCount)} trend="+2" trendLabel="较上月" tone="blue" />
      <DataCard compact icon={Activity} label="进行中项目" value={String(summary.activeProjectCount)} trend="+1" trendLabel="较上月" tone="purple" />
      <DataCard compact icon={CircleGauge} label="任务完成率" value={`${summary.taskCompletionRate}%`} trend="+6.4%" trendLabel="较上月" tone="green" />
      <DataCard compact icon={UsersRound} label="活跃员工" value={String(summary.activeEmployeeCount)} trend="+3" trendLabel="本周期" tone="orange" />
    </section>
  );
}
