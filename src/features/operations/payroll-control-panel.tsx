"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, Banknote, Calculator, Check, CircleDot, History, LockKeyhole, Send, ShieldCheck, WalletCards } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { getActor, updatePayrollRun } from "@/features/operations/operations-data";
import { getPayrollWorkflowProgress } from "@/features/operations/payroll-progress";
import type { PayrollRunStatus } from "@/features/operations/operations-types";
import { useOperations } from "@/features/operations/use-operations";
import { cn } from "@/lib/utils";

const statusLabel: Record<PayrollRunStatus, string> = {
  draft: "待核算",
  calculated: "待人事复核",
  verified: "待领导批准",
  approved: "待财务发放",
  paid: "已发放",
};

function currency(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 0,
  }).format(value);
}

export function PayrollControlPanel() {
  const session = useWorkspaceSession();
  const { state, context, actor } = useOperations(session);
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean } | null>(null);
  const run = state.payrollRun;
  const progress = getPayrollWorkflowProgress(run);
  const currentOwner = progress.current ? getActor(progress.current.ownerActorId) : null;
  const payrollEvents = state.events
    .filter(({ action }) => /考勤封账|薪资核算|人员与考勤复核|批准薪资发放|工资发放/.test(action))
    .slice(0, 5);
  const next = run.status === "draft" && actor.role === "finance" && run.attendanceLocked
    ? { status: "calculated" as const, label: "完成薪资核算并生成工资单", icon: Calculator }
    : run.status === "calculated" && actor.role === "hr"
      ? { status: "verified" as const, label: "完成人员、考勤与工资单复核", icon: ShieldCheck }
      : run.status === "verified" && actor.role === "executive"
        ? { status: "approved" as const, label: "批准本月薪资发放", icon: Check }
        : run.status === "approved" && actor.role === "finance"
          ? { status: "paid" as const, label: "确认银行发放并归档凭证", icon: Send }
          : null;

  function advance() {
    if (!next) return;
    try {
      updatePayrollRun(context, next.status, actor.id);
      setFeedback({
        message: next.status === "paid"
          ? "工资发放与凭证归档成功，已通知全员查看工资单"
          : `${next.label}成功，已通知下一责任角色`,
      });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "薪资周期更新失败",
        error: true,
      });
    }
  }

  return (
    <GlassCard id="payroll-control" className="scroll-mt-24 overflow-hidden border-primary/20">
      <div className="flex flex-col gap-3 border-b border-border/70 bg-brand-soft/55 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <WalletCards className="size-5 text-primary" />
            <h2 className="text-lg font-semibold">2026 年 08 月薪资周期</h2>
            <Badge variant={run.status === "paid" ? "success" : run.attendanceLocked ? "info" : "warning"}>
              {!run.attendanceLocked ? "待考勤封账" : statusLabel[run.status]}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">考勤封账后由财务核算、人事复核、领导批准，最后由财务发放。</p>
        </div>
        {next ? (
          <Button onClick={advance}><next.icon />{next.label}</Button>
        ) : run.status === "draft" && !run.attendanceLocked && actor.role === "hr" && run.exceptionCount > 0 ? (
          <Button asChild variant="outline"><Link href="/attendance#attendance-approvals"><AlertTriangle />先处理 {run.exceptionCount} 项考勤异常</Link></Button>
        ) : run.status === "draft" && !run.attendanceLocked && actor.role === "hr" ? (
          <Button asChild variant="outline"><Link href="/attendance#monthly-close"><LockKeyhole />去完成考勤封账</Link></Button>
        ) : (
          <Badge variant="outline">
            {progress.current && currentOwner ? `当前责任节点：${currentOwner.name}（${progress.current.owner}）· ${progress.current.label}` : "本月发薪流程已闭环"}
          </Badge>
        )}
      </div>

      {feedback ? (
        <p role="status" className={cn("mx-4 mt-3 rounded-xl px-3 py-2 text-xs font-medium sm:mx-5", feedback.error ? "bg-danger-soft text-destructive" : "bg-success-soft text-success")}>
          {feedback.message}
        </p>
      ) : null}

      <div className="grid gap-4 p-4 sm:p-5">
        <section role="region" aria-label="薪资发放进度" className="rounded-2xl bg-white/65 p-4 ring-1 ring-border/70">
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">全过程演示进度</p>
              <p className="mt-1 text-xs text-muted-foreground">已完成 {progress.completed}/{progress.total} 个业务节点{progress.current && currentOwner ? `，下一步请从右上角切换为 ${currentOwner.name}（${progress.current.owner}）完成${progress.current.label}` : "，工资已发放并完成归档"}</p>
            </div>
            <strong className="text-3xl font-semibold text-primary">{progress.percentage}%</strong>
          </div>
          <ProgressBar aria-label="薪资流程完成度" value={progress.percentage} className="mt-3 h-2" />
        </section>

        <div className="grid gap-4 xl:grid-cols-[1.15fr_1fr]">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              { label: "计薪人数", value: `${run.headcount} 人`, icon: CircleDot },
              { label: "应发合计", value: currency(run.grossAmount), icon: Banknote },
              { label: "扣款合计", value: currency(run.deductionAmount), icon: Calculator },
              { label: "实发合计", value: currency(run.netAmount), icon: WalletCards },
            ].map(({ label, value, icon: Icon }) => (
              <div key={label} className="rounded-xl bg-muted/55 p-3">
                <Icon className="size-4 text-primary" />
                <p className="mt-2 text-sm font-semibold">{value}</p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
          <div>
            <div className={cn("mb-3 flex items-center gap-2 text-xs", run.attendanceLocked ? "text-muted-foreground" : "text-warning")}>
              <LockKeyhole className={cn("size-3.5", run.attendanceLocked && "text-success")} />
              {run.attendanceLocked
                ? `考勤周期已封账 · ${run.exceptionCount} 项异常已处理`
                : `考勤尚未封账 · ${run.exceptionCount} 项异常待处理，不能开始核算`}
            </div>
            <ol className="grid grid-cols-5 gap-1" aria-label="薪资发放步骤">
              {progress.steps.map((step, index) => {
                const active = progress.current?.id === step.id;
                return (
                  <li key={step.id} className="relative text-center">
                    {index < progress.steps.length - 1 ? <span className={cn("absolute top-3 left-1/2 h-px w-full bg-border", step.done && "bg-success/45")} /> : null}
                    <span className={cn("relative z-10 mx-auto grid size-6 place-items-center rounded-full border bg-background text-[10px]", step.done && "border-success bg-success text-white", active && "border-primary bg-primary text-white")}>
                      {step.done ? <Check className="size-3" /> : index + 1}
                    </span>
                    <p className="mt-1.5 text-[10px] font-medium">{step.label}</p>
                    <p className="text-[9px] text-muted-foreground">{getActor(step.ownerActorId).name} · {step.owner}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        <section role="region" aria-label="薪资流程记录" className="border-t border-border/70 pt-4">
          <div className="flex items-center gap-2"><History className="size-4 text-primary" /><h3 className="text-sm font-semibold">流转记录</h3></div>
          {payrollEvents.length > 0 ? (
            <ol className="mt-3 grid gap-2 sm:grid-cols-2">
              {payrollEvents.map((item) => (
                <li key={item.id} className="rounded-xl bg-muted/45 px-3 py-2 text-xs">
                  <div className="flex items-center justify-between gap-2"><strong>{item.action}</strong><span className="text-muted-foreground">{item.createdAt.slice(5, 16).replace("T", " ")}</span></div>
                  <p className="mt-1 text-muted-foreground">{item.detail}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground">流程尚未开始。人事完成考勤封账后，每一步会自动记录办理人、动作与时间。</p>
          )}
        </section>
      </div>
    </GlassCard>
  );
}
