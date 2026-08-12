"use client";

import Link from "next/link";
import { useState } from "react";
import { Banknote, Calculator, Check, CircleDot, LockKeyhole, Send, ShieldCheck, WalletCards } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { updatePayrollRun } from "@/features/operations/operations-data";
import type { PayrollRunStatus } from "@/features/operations/operations-types";
import { useOperations } from "@/features/operations/use-operations";
import { cn } from "@/lib/utils";

const statusLabel: Record<PayrollRunStatus, string> = { draft: "待核算", calculated: "待人事复核", verified: "待领导批准", approved: "待财务发放", paid: "已发放" };
const steps: Array<{ status: PayrollRunStatus; label: string; owner: string }> = [
  { status: "calculated", label: "薪资核算", owner: "财务" },
  { status: "verified", label: "人事复核", owner: "人事" },
  { status: "approved", label: "发放批准", owner: "决策人" },
  { status: "paid", label: "银行发放", owner: "财务" },
];

function currency(value: number) { return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 0 }).format(value); }

export function PayrollControlPanel() {
  const session = useWorkspaceSession();
  const { state, context, actor } = useOperations(session);
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean } | null>(null);
  const run = state.payrollRun;
  const statusIndex = steps.findIndex(({ status }) => status === run.status);
  const next = run.status === "draft" && actor.role === "finance" && run.attendanceLocked ? { status: "calculated" as const, label: "完成薪资核算并生成工资单", icon: Calculator }
    : run.status === "calculated" && actor.role === "hr" ? { status: "verified" as const, label: "完成人员、考勤与工资单复核", icon: ShieldCheck }
      : run.status === "verified" && actor.role === "executive" ? { status: "approved" as const, label: "批准本月薪资发放", icon: Check }
        : run.status === "approved" && actor.role === "finance" ? { status: "paid" as const, label: "确认银行发放并归档凭证", icon: Send } : null;

  function advance() {
    if (!next) return;
    try { updatePayrollRun(context, next.status, actor.id); setFeedback({ message: `${next.label}成功，已通知下一责任角色` }); }
    catch (error) { setFeedback({ message: error instanceof Error ? error.message : "薪资周期更新失败", error: true }); }
  }

  return <GlassCard id="payroll-control" className="scroll-mt-24 overflow-hidden border-primary/20">
    <div className="flex flex-col gap-3 border-b border-border/70 bg-brand-soft/55 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div><div className="flex flex-wrap items-center gap-2"><WalletCards className="size-5 text-primary" /><h2 className="text-lg font-semibold">2026 年 08 月薪资周期</h2><Badge variant={run.status === "paid" ? "success" : run.attendanceLocked ? "info" : "warning"}>{statusLabel[run.status]}</Badge></div><p className="mt-1 text-sm text-muted-foreground">考勤封账后由财务核算、人事复核、领导批准，最后由财务发放。</p></div>{next ? <Button onClick={advance}><next.icon />{next.label}</Button> : run.status === "draft" && !run.attendanceLocked ? <Button asChild variant="outline"><Link href="/attendance"><LockKeyhole />等待人事封账</Link></Button> : <Badge variant="outline">当前节点责任人：{run.status === "calculated" ? "人事" : run.status === "verified" ? "决策人" : run.status === "approved" ? "财务" : "已完成"}</Badge>}</div>
    {feedback ? <p role="status" className={cn("mx-4 mt-3 rounded-xl px-3 py-2 text-xs font-medium sm:mx-5", feedback.error ? "bg-danger-soft text-destructive" : "bg-success-soft text-success")}>{feedback.message}</p> : null}
    <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-[1.15fr_1fr]">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[{ label: "计薪人数", value: `${run.headcount} 人`, icon: CircleDot }, { label: "应发合计", value: currency(run.grossAmount), icon: Banknote }, { label: "扣款合计", value: currency(run.deductionAmount), icon: Calculator }, { label: "实发合计", value: currency(run.netAmount), icon: WalletCards }].map(({ label, value, icon: Icon }) => <div key={label} className="rounded-xl bg-muted/55 p-3"><Icon className="size-4 text-primary" /><p className="mt-2 text-sm font-semibold">{value}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p></div>)}</div>
      <div><div className={cn("mb-3 flex items-center gap-2 text-xs", run.attendanceLocked ? "text-muted-foreground" : "text-warning")}><LockKeyhole className={cn("size-3.5", run.attendanceLocked && "text-success")} />{run.attendanceLocked ? `考勤周期已封账 · ${run.exceptionCount} 项异常已处理` : `考勤尚未封账 · ${run.exceptionCount} 项异常待处理，不能开始核算`}</div><ol className="grid grid-cols-4 gap-1">{steps.map((step, index) => { const done = statusIndex >= index; const active = run.status === step.status; return <li key={step.status} className="relative text-center">{index < steps.length - 1 ? <span className={cn("absolute top-3 left-1/2 h-px w-full bg-border", done && "bg-success/45")} /> : null}<span className={cn("relative z-10 mx-auto grid size-6 place-items-center rounded-full border bg-background text-[10px]", done && "border-success bg-success text-white", active && run.status !== "paid" && "border-primary bg-primary text-white")}>{done ? <Check className="size-3" /> : index + 1}</span><p className="mt-1.5 text-[10px] font-medium">{step.label}</p><p className="text-[9px] text-muted-foreground">{step.owner}</p></li>; })}</ol></div>
    </div>
  </GlassCard>;
}
