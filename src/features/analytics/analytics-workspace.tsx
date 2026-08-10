"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3 } from "lucide-react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AnalyticsSummary } from "@/features/analytics/components/analytics-summary";
import { DeliveryCalendar } from "@/features/analytics/components/delivery-calendar";
import { ExecutionTable } from "@/features/analytics/components/execution-table";
import { HealthDistribution } from "@/features/analytics/components/health-distribution";
import { RiskReminders } from "@/features/analytics/components/risk-reminders";
import { TrendChart } from "@/features/analytics/components/trend-chart";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { toOperationFixtureActor } from "@/features/operations/operation-actor-compat";
import { OperationWeeklyBrief } from "@/features/operations/operation-weekly-brief";
import { useOperations } from "@/features/operations/use-operations";
import { buildAnalyticsViewModel } from "@/features/analytics/analytics-selectors";
import type { AnalyticsFilters, AnalyticsRange } from "@/features/analytics/analytics-types";
import { getEffectiveProjectDetails } from "@/features/projects/data/effective-project-details";
import { PROJECTS_CHANGED_EVENT, readLocalProjects } from "@/features/projects/data/mock-project-repository";
import { mockMembers } from "@/features/projects/mock-data";
import type { ProjectDetailData } from "@/features/projects/types";

const rangeLabels: Record<AnalyticsRange, string> = {
  month: "本月",
  quarter: "本季度",
  half_year: "近半年",
};

export function AnalyticsWorkspace() {
  const { actor: workspaceActor } = useWorkspaceSession();
  const actor = toOperationFixtureActor(workspaceActor);
  const { state: operationsState } = useOperations();
  const [projects, setProjects] = useState<ProjectDetailData[]>(() => getEffectiveProjectDetails([]));
  const [filters, setFilters] = useState<AnalyticsFilters>({ range: "month", department: "all" });
  const effectiveFilters = useMemo(
    () => actor.role === "department_head" ? { ...filters, department: actor.department } : filters,
    [actor.department, actor.role, filters],
  );

  const refreshProjects = useCallback(() => {
    setProjects(getEffectiveProjectDetails(readLocalProjects()));
  }, []);

  useEffect(() => {
    refreshProjects();
    window.addEventListener(PROJECTS_CHANGED_EVENT, refreshProjects);
    return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, refreshProjects);
  }, [refreshProjects]);

  const departments = useMemo(
    () => Array.from(new Set(mockMembers.map(({ department }) => department))),
    [],
  );
  const viewModel = useMemo(
    () => buildAnalyticsViewModel(projects, mockMembers, effectiveFilters),
    [effectiveFilters, projects],
  );

  return (
    <main className="mx-auto flex w-full max-w-420 flex-col gap-3 px-3 pt-4 pb-26 sm:px-4 lg:px-5 lg:pt-6 lg:pb-8">
      <header className="relative min-h-40 overflow-hidden rounded-3xl border border-white/75 bg-white/55 px-5 py-5 shadow-[0_18px_48px_rgba(43,91,155,0.08)] sm:px-7 sm:py-6">
        <Image src="/dashboard/welcome-space-bg.png" alt="" fill priority className="pointer-events-none object-cover object-right opacity-60" sizes="(max-width: 768px) 100vw, 1200px" />
        <div className="relative z-10 flex min-h-28 flex-col justify-between gap-5 xl:flex-row xl:items-start">
          <div><div className="flex items-center gap-2"><BarChart3 aria-hidden="true" className="size-5 text-primary" /><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">数据分析</h1></div><p className="mt-1.5 text-sm leading-6 text-muted-foreground sm:text-base">{actor.role === "department_head" ? "只展示本部门项目、任务与人员执行数据。" : "洞察项目推进与员工执行情况，帮助管理层快速识别趋势与风险。"}</p><p data-testid="analytics-filter-summary" className="mt-3 text-xs font-medium text-primary">{rangeLabels[filters.range]} · {effectiveFilters.department === "all" ? "全部部门" : effectiveFilters.department}</p></div>
          <div className="grid gap-2 sm:grid-cols-2">
            <Select value={filters.range} onValueChange={(range) => setFilters((current) => ({ ...current, range: range as AnalyticsRange }))}>
              <SelectTrigger aria-label="时间范围" className="w-full min-w-32 bg-white/78"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="month">本月</SelectItem><SelectItem value="quarter">本季度</SelectItem><SelectItem value="half_year">近半年</SelectItem></SelectContent>
            </Select>
            {actor.role === "executive" ? <Select value={filters.department} onValueChange={(department) => setFilters((current) => ({ ...current, department }))}>
              <SelectTrigger aria-label="部门" className="w-full min-w-40 bg-white/78"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="all">全部部门</SelectItem>{departments.map((department) => <SelectItem key={department} value={department}>{department}</SelectItem>)}</SelectContent>
            </Select> : null}
          </div>
        </div>
      </header>

      <AnalyticsSummary summary={viewModel.summary} />

      <OperationWeeklyBrief state={operationsState} actor={actor} />

      <section className="grid min-w-0 gap-3 2xl:grid-cols-12">
        <div className="2xl:col-span-6"><ExecutionTable rows={viewModel.executionRows} /></div>
        <div className="2xl:col-span-4"><TrendChart trend={viewModel.trend} /></div>
        <div className="2xl:col-span-2"><RiskReminders reminders={viewModel.riskReminders} /></div>
      </section>

      <section className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(19rem,0.8fr)]">
        <DeliveryCalendar items={viewModel.deliveryCalendar} />
        <HealthDistribution items={viewModel.healthDistribution} />
      </section>
    </main>
  );
}
