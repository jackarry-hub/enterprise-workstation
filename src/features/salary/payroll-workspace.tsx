"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Banknote, Building2, Database, ReceiptText, WalletCards } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { PageHeader } from "@/components/ui/page-header";
import { RealDataNotice } from "@/components/ui/real-data-boundary";
import { StatusBadge } from "@/components/ui/status-badge";
import { PayrollAside } from "@/features/salary/components/payroll-aside";
import { PayrollFilters } from "@/features/salary/components/payroll-filters";
import { PayrollList } from "@/features/salary/components/payroll-list";
import { PayrollStats } from "@/features/salary/components/payroll-stats";
import { formatSalaryCurrency, salaryStatusMeta } from "@/features/salary/salary-meta";
import { filterSalaryRecords } from "@/features/salary/salary-selectors";
import type { SalaryFilters, SalaryRecord, SalaryResult } from "@/features/salary/salary-types";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { PayrollControlPanel } from "@/features/operations/payroll-control-panel";
import { useOperations } from "@/features/operations/use-operations";
import type { SalaryStatus } from "@/features/salary/salary-types";
import { cn } from "@/lib/utils";

const defaultFilters: SalaryFilters = { query: "", departmentId: "all", month: "2026-08", status: "all" };

function ExecutivePayslipSummary({ record }: { record: SalaryRecord }) {
  const status = salaryStatusMeta[record.status];
  const grossSalary = record.baseSalary + record.bonus;

  return (
    <GlassCard id="executive-personal-payroll" role="region" aria-labelledby="executive-personal-payroll-title" className="scroll-mt-24 overflow-hidden border-primary/25">
      <div className="flex flex-col gap-3 border-b border-primary/10 bg-brand-soft/55 p-4 sm:flex-row sm:items-start sm:justify-between sm:p-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="grid size-9 place-items-center rounded-xl bg-primary text-primary-foreground"><ReceiptText aria-hidden="true" className="size-4" /></span>
            <div><Badge variant="info">CEO 个人工资</Badge><h2 id="executive-personal-payroll-title" className="mt-1 text-lg font-semibold">我的工资</h2></div>
          </div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">这里仅展示林远本人的工资单，与下方全公司薪资复核和批准流程分开。</p>
        </div>
        <StatusBadge status={status.tone}>{status.label}</StatusBadge>
      </div>
      <div className="grid grid-cols-2 gap-3 p-4 sm:p-5 lg:grid-cols-[1.25fr_1fr_1fr_auto] lg:items-center">
        <div className="col-span-2 rounded-2xl border border-primary/15 bg-primary/7 p-4 lg:col-span-1">
          <p className="text-xs text-primary">{record.month.replace("-", " 年 ")} 月实发工资</p>
          <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{formatSalaryCurrency(record.netSalary)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{record.employee.displayName} · {record.employee.jobTitle}</p>
        </div>
        <div className="rounded-xl bg-muted/45 p-3"><Banknote aria-hidden="true" className="size-4 text-success" /><p className="mt-2 text-sm font-semibold">{formatSalaryCurrency(grossSalary)}</p><p className="mt-0.5 text-[11px] text-muted-foreground">应发工资</p></div>
        <div className="rounded-xl bg-muted/45 p-3"><WalletCards aria-hidden="true" className="size-4 text-warning" /><p className="mt-2 text-sm font-semibold">-{formatSalaryCurrency(record.deductions)}</p><p className="mt-0.5 text-[11px] text-muted-foreground">扣款合计</p></div>
        <Button asChild className="col-span-2 w-full lg:col-span-1 lg:w-auto"><Link href={`/payroll/${record.id}`}>查看我的工资单<ArrowRight aria-hidden="true" /></Link></Button>
      </div>
    </GlassCard>
  );
}

export function PayrollWorkspace({ result }: { result: SalaryResult }) {
  const session = useWorkspaceSession();
  const { actor } = session;
  const { state, isFixtureBound } = useOperations(session);
  const canManagePayroll = ["executive", "finance", "hr"].includes(actor.role);
  const [filters, setFilters] = useState(defaultFilters);
  const cycleStatus: SalaryStatus = state.payrollRun.status === "draft" ? "draft" : state.payrollRun.status === "paid" ? "paid" : "processing";
  const cycleRecords = useMemo(() => result.data.records.map((record) => record.month === state.payrollRun.month ? { ...record, status: cycleStatus, paidAt: cycleStatus === "paid" ? state.payrollRun.paidAt ? new Date(state.payrollRun.paidAt).toLocaleString("zh-CN") : record.paidAt : undefined, history: record.history.map((item) => item.month === state.payrollRun.month ? { ...item, status: cycleStatus } : item) } : record), [cycleStatus, result.data.records, state.payrollRun.month, state.payrollRun.paidAt]);
  const personalRecord = useMemo(() => cycleRecords.find(({ employee }) => employee.displayName === actor.name), [actor.name, cycleRecords]);
  const visibleRecords = useMemo(() => !isFixtureBound ? [] : canManagePayroll ? cycleRecords : cycleRecords.filter(({ employee }) => employee.displayName === actor.name), [actor.name, canManagePayroll, cycleRecords, isFixtureBound]);
  const records = useMemo(() => filterSalaryRecords(visibleRecords, filters), [filters, visibleRecords]);
  const visibleStats = useMemo(() => !isFixtureBound ? { totalSalary: 0, employeeCount: 0, averageSalary: 0 } : !canManagePayroll ? { totalSalary: visibleRecords.reduce((sum, record) => sum + record.netSalary, 0), employeeCount: visibleRecords.length, averageSalary: visibleRecords.length ? Math.round(visibleRecords.reduce((sum, record) => sum + record.netSalary, 0) / visibleRecords.length) : 0 } : { totalSalary: state.payrollRun.grossAmount, employeeCount: state.payrollRun.headcount, averageSalary: state.payrollRun.headcount ? Math.round(state.payrollRun.grossAmount / state.payrollRun.headcount) : 0 }, [canManagePayroll, isFixtureBound, state.payrollRun.grossAmount, state.payrollRun.headcount, visibleRecords]);
  return (
    <main className="mx-auto flex w-full max-w-420 flex-col gap-4 px-3 pt-5 pb-26 sm:px-4 lg:px-5 lg:pt-9 lg:pb-6">
      <section className="relative overflow-hidden rounded-3xl border border-glass-border bg-background px-5 py-6 shadow-[0_18px_50px_rgba(60,105,170,0.08)] sm:px-7">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[url('/dashboard/welcome-space-bg.png')] bg-cover bg-[position:76%_center] opacity-75" />
        <div className="relative max-w-4xl"><PageHeader title={canManagePayroll ? "薪资管理" : "我的工资单"} description={actor.role === "executive" ? "CEO 本人工资单与全公司薪资复核分区展示。" : canManagePayroll ? "统一查看员工薪资结果、发放状态与历史工资单。" : "查看本人每月实发工资、工资组成与历史记录。"} actions={<Badge variant="info" className="h-8 gap-1.5 rounded-xl px-3"><WalletCards aria-hidden="true" className="size-3.5" />2026年08月工资</Badge>} /></div>
      </section>
      {!isFixtureBound ? <RealDataNotice message="当前账号没有可显示的真实薪资数据。" /> : null}
      {isFixtureBound && actor.role === "executive" && personalRecord ? <ExecutivePayslipSummary record={personalRecord} /> : null}
      {isFixtureBound && canManagePayroll ? (
        <section id="company-payroll-review" role="region" aria-labelledby="company-payroll-review-title" className="scroll-mt-24 grid gap-3">
          <GlassCard className="flex flex-col gap-3 border-border/80 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
            <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-primary"><Building2 aria-hidden="true" className="size-5" /></span><div><div className="flex flex-wrap items-center gap-2"><h2 id="company-payroll-review-title" className="text-lg font-semibold">全公司薪资复核</h2><Badge variant="neutral">{state.payrollRun.headcount} 人总盘</Badge></div><p className="mt-1 text-xs leading-5 text-muted-foreground">这里只处理全员薪资总额、复核、批准与发放流程；CEO 本人工资在上方独立查看。</p></div></div>
          </GlassCard>
          <PayrollControlPanel />
          <PayrollStats stats={visibleStats} />
        </section>
      ) : isFixtureBound ? (
        <><GlassCard className="p-4 text-sm text-muted-foreground"><strong className="text-foreground">个人工资单模式：</strong>仅展示 {actor.name} 本人的工资记录，其他员工数据已按权限隐藏。</GlassCard><PayrollStats stats={visibleStats} /></>
      ) : null}
      <section className={cn("grid min-w-0 gap-4", canManagePayroll && "xl:grid-cols-12")}>
        <GlassCard className={cn("min-w-0 overflow-hidden p-3 sm:p-4", canManagePayroll && "xl:col-span-9")}>
          <div className="flex flex-col gap-1 px-1 pb-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-lg font-semibold text-foreground">{canManagePayroll ? "全员工资单明细" : "我的工资记录"}</h2><p className="mt-0.5 text-xs text-muted-foreground">{canManagePayroll ? "CEO 工资计入公司总盘，但个人查看与公司审批分区展示" : "按月份和状态查看本人工资单"}</p></div><span className="text-xs text-muted-foreground">{canManagePayroll ? `总盘 ${state.payrollRun.headcount} 人 · 演示记录 ${visibleRecords.length} 条` : `共 ${visibleRecords.length} 条记录`}</span></div>
          {isFixtureBound && canManagePayroll ? <PayrollFilters departments={result.data.departments} filters={filters} onChange={setFilters} onReset={() => setFilters(defaultFilters)} /> : null}
          <section aria-label="工资列表" className="mt-3 border-t border-border/60 pt-1"><PayrollList records={records} /></section>
          <footer className="flex items-center justify-between border-t border-border/60 px-2 pt-3 text-xs text-muted-foreground"><span>当前显示 {records.length} 条工资记录</span><span className="flex items-center gap-1"><Database aria-hidden="true" className="size-3.5" />本地业务记录</span></footer>
        </GlassCard>
        {canManagePayroll ? <GlassCard className="min-w-0 p-4 sm:p-5 xl:col-span-3"><PayrollAside /></GlassCard> : null}
      </section>
    </main>
  );
}
