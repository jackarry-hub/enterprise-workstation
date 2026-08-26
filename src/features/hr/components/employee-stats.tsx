import { BadgeCheck, Building2, UserCheck, UsersRound } from "lucide-react";

import { DataCard } from "@/components/ui/data-card";
import type { EmployeeDirectoryStats } from "@/features/hr/employee-types";

export function EmployeeStats({ stats }: { stats: EmployeeDirectoryStats }) {
  const activeRate = stats.total === 0 ? 0 : Math.round((stats.active / stats.total) * 100);

  return (
    <section aria-label="员工统计" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <DataCard compact icon={UsersRound} label="员工总数" value={String(stats.total)} trend={`${stats.total}人`} trendLabel="当前目录" tone="blue" />
      <DataCard compact icon={UserCheck} label="在职人数" value={String(stats.active)} trend={`${activeRate}%`} trendLabel="在职率" tone="green" />
      <DataCard compact icon={BadgeCheck} label="试用期员工" value={String(stats.probation)} trend={`${stats.probation}人`} trendLabel="重点跟进" tone="orange" trendTone="warning" />
      <DataCard compact icon={Building2} label="部门数量" value={String(stats.departments)} trend={`${stats.departments}个`} trendLabel="当前部门" tone="purple" />
    </section>
  );
}
