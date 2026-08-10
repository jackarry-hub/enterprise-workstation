"use client";

import { useMemo, useState } from "react";
import { Database, WalletCards } from "lucide-react";

import { MobileWorkspaceNav } from "@/components/shell/mobile-workspace-nav";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
import { PageHeader } from "@/components/ui/page-header";
import { PayrollAside } from "@/features/salary/components/payroll-aside";
import { PayrollFilters } from "@/features/salary/components/payroll-filters";
import { PayrollList } from "@/features/salary/components/payroll-list";
import { PayrollStats } from "@/features/salary/components/payroll-stats";
import { filterSalaryRecords } from "@/features/salary/salary-selectors";
import type { SalaryFilters, SalaryResult } from "@/features/salary/salary-types";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { PayrollControlPanel } from "@/features/operations/payroll-control-panel";
import { useOperations } from "@/features/operations/use-operations";
import type { SalaryStatus } from "@/features/salary/salary-types";

const defaultFilters: SalaryFilters = { query: "", departmentId: "all", month: "2026-08", status: "all" };

export function PayrollWorkspace({ result }: { result: SalaryResult }) {
  const session = useWorkspaceSession();
  const { actor } = session;
  const { state } = useOperations(session);
  const [filters, setFilters] = useState(defaultFilters);
  const cycleStatus: SalaryStatus = state.payrollRun.status === "draft" ? "draft" : state.payrollRun.status === "paid" ? "paid" : "processing";
  const cycleRecords = useMemo(() => result.data.records.map((record) => record.month === state.payrollRun.month ? { ...record, status: cycleStatus, paidAt: cycleStatus === "paid" ? state.payrollRun.paidAt ? new Date(state.payrollRun.paidAt).toLocaleString("zh-CN") : record.paidAt : undefined, history: record.history.map((item) => item.month === state.payrollRun.month ? { ...item, status: cycleStatus } : item) } : record), [cycleStatus, result.data.records, state.payrollRun.month, state.payrollRun.paidAt]);
  const visibleRecords = useMemo(() => actor.role === "employee" ? cycleRecords.filter(({ employee }) => employee.displayName === actor.name) : cycleRecords, [actor.name, actor.role, cycleRecords]);
  const records = useMemo(() => filterSalaryRecords(visibleRecords, filters), [filters, visibleRecords]);
  const visibleStats = useMemo(() => actor.role === "employee" ? { totalSalary: visibleRecords.reduce((sum, record) => sum + record.netSalary, 0), employeeCount: visibleRecords.length, averageSalary: visibleRecords.length ? Math.round(visibleRecords.reduce((sum, record) => sum + record.netSalary, 0) / visibleRecords.length) : 0 } : { totalSalary: state.payrollRun.grossAmount, employeeCount: state.payrollRun.headcount, averageSalary: Math.round(state.payrollRun.grossAmount / state.payrollRun.headcount) }, [actor.role, state.payrollRun.grossAmount, state.payrollRun.headcount, visibleRecords]);
  return (
    <main className="mx-auto flex w-full max-w-420 flex-col gap-4 px-3 pt-5 pb-26 sm:px-4 lg:px-5 lg:pt-9 lg:pb-6">
      <section className="relative overflow-hidden rounded-3xl border border-glass-border bg-background px-5 py-6 shadow-[0_18px_50px_rgba(60,105,170,0.08)] sm:px-7">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[url('/dashboard/welcome-space-bg.png')] bg-cover bg-[position:76%_center] opacity-75" />
        <div className="relative max-w-4xl"><PageHeader title="薪资管理" description="统一查看员工薪资结果、发放状态与历史工资单。" actions={<Badge variant="info" className="h-8 gap-1.5 rounded-xl px-3"><WalletCards aria-hidden="true" className="size-3.5" />2026年08月工资</Badge>} /></div>
      </section>
      {actor.role !== "employee" ? <PayrollControlPanel /> : <GlassCard className="p-4 text-sm text-muted-foreground"><strong className="text-foreground">个人工资单模式：</strong>仅展示 {actor.name} 本人的工资记录，其他员工数据已按权限隐藏。</GlassCard>}
      <PayrollStats stats={visibleStats} />
      <section className="grid min-w-0 gap-4 xl:grid-cols-12">
        <GlassCard className="min-w-0 overflow-hidden p-3 sm:p-4 xl:col-span-9">
          <div className="flex flex-col gap-1 px-1 pb-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-lg font-semibold text-foreground">工资发放记录</h2><p className="mt-0.5 text-xs text-muted-foreground">按员工、月份和状态核对工资单</p></div><span className="text-xs text-muted-foreground">共 128 名员工</span></div>
          {actor.role !== "employee" ? <PayrollFilters departments={result.data.departments} filters={filters} onChange={setFilters} onReset={() => setFilters(defaultFilters)} /> : null}
          <section aria-label="工资列表" className="mt-3 border-t border-border/60 pt-1"><PayrollList records={records} /></section>
          <footer className="flex items-center justify-between border-t border-border/60 px-2 pt-3 text-xs text-muted-foreground"><span>当前显示 {records.length} 条工资记录</span><span className="flex items-center gap-1"><Database aria-hidden="true" className="size-3.5" />本地业务记录</span></footer>
        </GlassCard>
        <GlassCard className="min-w-0 p-4 sm:p-5 xl:col-span-3"><PayrollAside /></GlassCard>
      </section>
      <MobileWorkspaceNav active="work" />
    </main>
  );
}
