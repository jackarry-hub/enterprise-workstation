"use client";

import { CalendarDays, CheckCircle2, Clock3 } from "lucide-react";

import { ProgressBar } from "@/components/ui/progress-bar";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { getActor } from "@/features/operations/operations-data";
import { getPayrollWorkflowProgress } from "@/features/operations/payroll-progress";
import { useOperations } from "@/features/operations/use-operations";

export function PayrollAside() {
  const session = useWorkspaceSession();
  const { state } = useOperations(session);
  const progress = getPayrollWorkflowProgress(state.payrollRun);
  const pending = progress.total - progress.completed;

  return (
    <aside className="grid content-start gap-4">
      <section>
        <div className="flex items-center gap-2">
          <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary"><CalendarDays aria-hidden="true" className="size-4" /></span>
          <div><h2 className="font-semibold text-foreground">发薪日提醒</h2><p className="text-xs text-muted-foreground">2026年08月25日</p></div>
        </div>
        <div className="mt-4 flex items-end justify-between">
          <div><p className="text-xs text-muted-foreground">距离本月发薪</p><p className="mt-1 text-3xl font-semibold text-foreground">21<span className="ml-1 text-sm text-muted-foreground">天</span></p></div>
          <span className="rounded-xl bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning">{pending} 个节点待处理</span>
        </div>
        <div className="mt-4 flex items-center justify-between text-xs"><span className="text-muted-foreground">本月发放进度</span><strong className="text-primary">{progress.percentage}%</strong></div>
        <ProgressBar aria-label="本月发放进度" value={progress.percentage} className="mt-2" />
      </section>
      <section className="border-t border-border/60 pt-4">
        <h2 className="font-semibold text-foreground">本月发放准备</h2>
        <p className="mt-1 text-xs text-muted-foreground">待办请使用上方当前责任节点办理；这里展示从 0 到 100 的完整发薪流程。</p>
        <div className="mt-3 grid gap-2 text-sm">
          {progress.steps.map(({ id, label, owner, ownerActorId, done }) => (
            <div key={id} className="flex items-center gap-2 rounded-xl px-2 py-2">
              <span className={`grid size-6 place-items-center rounded-full ${done ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>
                {done ? <CheckCircle2 aria-hidden="true" className="size-3.5" /> : <Clock3 aria-hidden="true" className="size-3.5" />}
              </span>
              <span className="text-foreground">{label}</span>
              <span className="text-xs text-muted-foreground">· {getActor(ownerActorId).name}（{owner}）</span>
              <span className="ml-auto text-xs font-medium text-muted-foreground">{done ? "已完成" : "待处理"}</span>
            </div>
          ))}
        </div>
      </section>
    </aside>
  );
}
