"use client";

import Link from "next/link";
import { ArrowLeft, Banknote, CalendarCheck2, CircleMinus, CirclePlus, History, ReceiptText, UserRound } from "lucide-react";

import { MobileWorkspaceNav } from "@/components/shell/mobile-workspace-nav";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { GlassCard } from "@/components/ui/glass-card";
import { PageHeader } from "@/components/ui/page-header";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusBadge } from "@/components/ui/status-badge";
import { RealDataUnavailable } from "@/components/ui/real-data-boundary";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatSalaryCurrency, salaryStatusMeta } from "@/features/salary/salary-meta";
import type { SalaryRecord, SalaryStatus } from "@/features/salary/salary-types";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { PayrollControlPanel } from "@/features/operations/payroll-control-panel";
import { useOperations } from "@/features/operations/use-operations";

export function PayrollDetailPage({ record: sourceRecord }: { record: SalaryRecord }) {
  const session = useWorkspaceSession();
  const { state, actor, isFixtureBound } = useOperations(session);
  if (!isFixtureBound) {
    return <RealDataUnavailable title="薪资数据暂不可用" description="当前账号不会显示演示工资单。真实薪资数据接入后，只会展示你有权查看的记录。" backHref="/payroll" backLabel="返回薪资管理" />;
  }
  const canManagePayroll = ["executive", "finance", "hr"].includes(actor.role);
  if (!canManagePayroll && sourceRecord.employee.displayName !== actor.name) {
    return <RealDataUnavailable title="无权查看此工资单" description="个人工资单仅限本人查看；请返回薪资管理查看自己的工资记录。" backHref="/payroll" backLabel="返回我的工资单" />;
  }
  const cycleStatus: SalaryStatus = state.payrollRun.status === "draft" ? "draft" : state.payrollRun.status === "paid" ? "paid" : "processing";
  const record = sourceRecord.month === state.payrollRun.month ? { ...sourceRecord, status: cycleStatus, paidAt: cycleStatus === "paid" ? state.payrollRun.paidAt ? new Date(state.payrollRun.paidAt).toLocaleString("zh-CN") : sourceRecord.paidAt : undefined, history: sourceRecord.history.map((item) => item.month === state.payrollRun.month ? { ...item, status: cycleStatus } : item) } : sourceRecord;
  const status = salaryStatusMeta[record.status];
  const incomeTotal = record.baseSalary + record.bonus;
  return (
    <main className="mx-auto flex w-full max-w-420 flex-col gap-4 px-3 pt-5 pb-26 sm:px-4 lg:px-5 lg:pt-7 lg:pb-6">
      <Link href="/payroll" className="inline-flex w-fit items-center gap-2 rounded-xl px-2 py-1.5 text-sm text-muted-foreground hover:bg-background/70 hover:text-primary"><ArrowLeft aria-hidden="true" className="size-4" />返回薪资管理</Link>
      <GlassCard className="relative overflow-hidden p-5 sm:p-6">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[url('/dashboard/welcome-space-bg.png')] bg-cover bg-[position:80%_center] opacity-55" />
        <div className="relative"><PageHeader title={`${record.employee.displayName}的工资单`} description={`${record.month.replace("-", "年")}月 · ${record.employee.employeeNo}`} actions={<StatusBadge status={status.tone}>{status.label}</StatusBadge>} />
          <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_1.2fr]">
            <div className="flex items-center gap-3 rounded-2xl border border-white/75 bg-background/65 p-4"><Avatar className="size-12">{record.employee.avatarUrl ? <AvatarImage src={record.employee.avatarUrl} alt={record.employee.displayName} /> : null}<AvatarFallback className="bg-primary text-primary-foreground">{record.employee.displayName.slice(-2)}</AvatarFallback></Avatar><div><p className="font-semibold text-foreground">{record.employee.displayName}</p><p className="text-xs text-muted-foreground">{record.department.name} · {record.employee.jobTitle}</p></div></div>
            <div className="rounded-2xl border border-white/75 bg-background/65 p-4"><p className="text-xs text-muted-foreground">发放时间</p><p className="mt-2 font-medium text-foreground">{record.paidAt ?? "待发放"}</p><p className="mt-1 text-xs text-muted-foreground">工资月份 {record.month}</p></div>
            <div className="rounded-2xl border border-primary/15 bg-primary/8 p-4"><p className="text-xs text-primary">本月实发工资</p><p className="mt-1 text-3xl font-semibold tracking-tight text-foreground">{formatSalaryCurrency(record.netSalary)}</p><p className="mt-1 text-xs text-muted-foreground">税后及扣款后金额</p></div>
          </div>
        </div>
      </GlassCard>

      {actor.role !== "employee" && sourceRecord.month === state.payrollRun.month && state.payrollRun.status !== "paid" ? <PayrollControlPanel /> : null}

      <section className="grid min-w-0 gap-4 xl:grid-cols-12">
        <GlassCard className="p-4 sm:p-5 xl:col-span-8">
          <div className="flex items-center gap-2"><span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><ReceiptText aria-hidden="true" className="size-4" /></span><div><h2 className="text-lg font-semibold text-foreground">工资组成</h2><p className="text-xs text-muted-foreground">收入与扣款明细</p></div></div>
          <section aria-label="工资组成" className="mt-4 grid gap-3 sm:grid-cols-2">
            {record.breakdown.map((item) => {
              const ratio = Math.round((item.amount / incomeTotal) * 100);
              return <article key={item.label} className="rounded-2xl border border-glass-border bg-background/65 p-4"><div className="flex items-start justify-between gap-3"><span className={`grid size-9 place-items-center rounded-xl ${item.kind === "income" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"}`}>{item.kind === "income" ? <CirclePlus aria-hidden="true" className="size-4" /> : <CircleMinus aria-hidden="true" className="size-4" />}</span><div className="text-right"><p className="text-xs text-muted-foreground">{item.label}</p><p className={`mt-1 font-semibold ${item.kind === "income" ? "text-foreground" : "text-warning"}`}>{item.kind === "deduction" ? "-" : "+"}{formatSalaryCurrency(item.amount)}</p></div></div><ProgressBar value={ratio} className="mt-4" /><p className="mt-2 text-xs text-muted-foreground">占应发工资 {ratio}%</p></article>;
            })}
          </section>
          <div className="mt-4 grid gap-3 rounded-2xl border border-primary/15 bg-primary/6 p-4 sm:grid-cols-3"><div><p className="text-xs text-muted-foreground">应发工资</p><p className="mt-1 font-semibold text-foreground">{formatSalaryCurrency(incomeTotal)}</p></div><div><p className="text-xs text-muted-foreground">扣款合计</p><p className="mt-1 font-semibold text-warning">-{formatSalaryCurrency(record.deductions)}</p></div><div><p className="text-xs text-muted-foreground">实发工资</p><p className="mt-1 text-lg font-semibold text-primary">{formatSalaryCurrency(record.netSalary)}</p></div></div>
        </GlassCard>

        <div className="grid content-start gap-4 xl:col-span-4">
          <GlassCard className="p-4 sm:p-5"><div className="flex items-center gap-2"><Banknote aria-hidden="true" className="size-4 text-primary" /><h2 className="text-lg font-semibold text-foreground">工资单信息</h2></div><dl className="mt-4 grid gap-3 text-sm"><div className="flex justify-between"><dt className="text-muted-foreground">所属员工</dt><dd className="font-medium text-foreground">{record.employee.displayName}</dd></div><div className="flex justify-between"><dt className="text-muted-foreground">所属部门</dt><dd className="font-medium text-foreground">{record.department.name}</dd></div><div className="flex justify-between"><dt className="text-muted-foreground">工资月份</dt><dd className="font-medium text-foreground">{record.month}</dd></div><div className="flex justify-between"><dt className="text-muted-foreground">发放状态</dt><dd><StatusBadge status={status.tone}>{status.label}</StatusBadge></dd></div></dl></GlassCard>
          <GlassCard className="p-4 sm:p-5"><div className="flex items-center gap-2"><UserRound aria-hidden="true" className="size-4 text-primary" /><h2 className="text-lg font-semibold text-foreground">隐私说明</h2></div><p className="mt-3 text-sm leading-6 text-muted-foreground">工资单仅员工本人和授权的老板、管理员、HR、财务可查看。V0.9 不执行自动算税或薪资规则计算。</p></GlassCard>
        </div>
      </section>

      <GlassCard className="min-w-0 overflow-hidden p-4 sm:p-5"><div className="flex items-center gap-2"><History aria-hidden="true" className="size-4 text-primary" /><div><h2 className="text-lg font-semibold text-foreground">历史记录</h2><p className="text-xs text-muted-foreground">近 6 个月实发工资</p></div></div><section aria-label="历史记录" className="mt-4"><Table><TableHeader><TableRow><TableHead>月份</TableHead><TableHead>员工</TableHead><TableHead>实发工资</TableHead><TableHead>状态</TableHead><TableHead>说明</TableHead></TableRow></TableHeader><TableBody>{record.history.map((item) => <TableRow key={item.month}><TableCell className="font-medium">{item.month}</TableCell><TableCell>{record.employee.displayName}</TableCell><TableCell className="font-semibold text-foreground">{formatSalaryCurrency(item.netSalary)}</TableCell><TableCell><StatusBadge status={salaryStatusMeta[item.status].tone}>{salaryStatusMeta[item.status].label}</StatusBadge></TableCell><TableCell className="text-muted-foreground"><span className="inline-flex items-center gap-1"><CalendarCheck2 aria-hidden="true" className="size-3.5" />按期发放</span></TableCell></TableRow>)}</TableBody></Table></section></GlassCard>
      <MobileWorkspaceNav active="work" />
    </main>
  );
}
