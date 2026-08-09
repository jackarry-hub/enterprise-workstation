"use client";

import { CalendarDays, CheckCircle2, Clock3 } from "lucide-react";

import { ProgressBar } from "@/components/ui/progress-bar";
import { useOperations } from "@/features/operations/use-operations";

export function PayrollAside() {
  const { state } = useOperations();
  const run = state.payrollRun;
  const steps = [
    { label: "考勤封账", done: run.attendanceLocked },
    { label: "薪资核算", done: ["calculated", "verified", "approved", "paid"].includes(run.status) },
    { label: "工资单复核", done: ["verified", "approved", "paid"].includes(run.status) },
    { label: "完成发放", done: run.status === "paid" },
  ];
  const completed = steps.filter(({ done }) => done).length;
  const pending = steps.length - completed;

  return (
    <aside className="grid content-start gap-4">
      <section><div className="flex items-center gap-2"><span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary"><CalendarDays aria-hidden="true" className="size-4" /></span><div><h2 className="font-semibold text-foreground">发薪日提醒</h2><p className="text-xs text-muted-foreground">2026年08月25日</p></div></div><div className="mt-4 flex items-end justify-between"><div><p className="text-xs text-muted-foreground">距离本月发薪</p><p className="mt-1 text-3xl font-semibold text-foreground">21<span className="ml-1 text-sm text-muted-foreground">天</span></p></div><span className="rounded-xl bg-warning/10 px-3 py-1.5 text-xs font-medium text-warning">{pending} 个节点待处理</span></div><ProgressBar value={completed / steps.length * 100} className="mt-4" /></section>
      <section className="border-t border-border/60 pt-4"><h2 className="font-semibold text-foreground">本月发放准备</h2><div className="mt-3 grid gap-3 text-sm">{steps.map(({ label, done }) => <div key={label} className="flex items-center gap-2"><span className={`grid size-6 place-items-center rounded-full ${done ? "bg-success/10 text-success" : "bg-muted text-muted-foreground"}`}>{done ? <CheckCircle2 aria-hidden="true" className="size-3.5" /> : <Clock3 aria-hidden="true" className="size-3.5" />}</span><span className="text-foreground">{label}</span><span className="ml-auto text-xs text-muted-foreground">{done ? "已完成" : "待处理"}</span></div>)}</div></section>
    </aside>
  );
}
