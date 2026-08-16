"use client";

import Link from "next/link";
import {
  BarChart3,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  FileCheck2,
  PlayCircle,
  TriangleAlert,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import { Progress } from "@/components/ui/progress";
import type {
  DashboardDispatchStage,
  DashboardViewModel,
} from "@/features/dashboard/dashboard-view-model";
import { cn } from "@/lib/utils";

type CurrentDispatch = NonNullable<DashboardViewModel["dispatch"]["current"]>;

const stageOptions: Array<{
  key: DashboardDispatchStage;
  label: string;
  icon: typeof Circle;
  tone: string;
}> = [
  { key: "not_started", label: "未开始", icon: Circle, tone: "text-slate-500" },
  { key: "started", label: "已开始", icon: PlayCircle, tone: "text-primary" },
  { key: "review", label: "待验收", icon: FileCheck2, tone: "text-warning" },
  { key: "done", label: "已完成", icon: CheckCircle2, tone: "text-success" },
];

export function DashboardDispatchProgress({
  current,
  children,
}: {
  current: CurrentDispatch;
  children?: ReactNode;
}) {
  const [activeStage, setActiveStage] = useState<DashboardDispatchStage | null>(null);
  const visibleTasks = activeStage
    ? current.tasks.filter((task) => task.stage === activeStage)
    : [];
  const actionableTask = current.tasks.find((task) => task.stage === "review" && task.href)
    ?? current.tasks.find((task) => task.stage !== "done" && task.href);

  return (
    <section
      id="ai-dispatch-progress"
      aria-labelledby="ai-dispatch-progress-title"
      className="mt-4 scroll-mt-24 rounded-2xl border border-primary/15 bg-white/75 p-3.5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p
            id="ai-dispatch-progress-title"
            className="flex items-center gap-1.5 text-xs font-semibold text-primary"
          >
            <BarChart3 aria-hidden="true" className="size-3.5" />
            当前调度进度
          </p>
          <p className="mt-1 truncate text-sm font-semibold">{current.title}</p>
        </div>
        <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
          {current.progress}%
        </span>
      </div>

      <Progress value={current.progress} className="mt-3 h-2" />

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stageOptions.map(({ key, label, icon: Icon, tone }) => {
          const count = current.stageCounts[key];
          const selected = activeStage === key;
          return (
            <button
              key={key}
              type="button"
              aria-label={`${label} ${count}`}
              aria-pressed={selected}
              onClick={() => setActiveStage(selected ? null : key)}
              className={cn(
                "flex min-w-0 items-center gap-2 rounded-xl border px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30",
                selected
                  ? "border-primary/30 bg-primary/8 shadow-[0_8px_24px_rgba(47,128,237,0.10)]"
                  : "border-border/65 bg-white/70 hover:border-primary/20 hover:bg-white",
              )}
            >
              <Icon aria-hidden="true" className={cn("size-4 shrink-0", tone)} />
              <span className="min-w-0">
                <strong className="block text-base leading-none text-foreground">{count}</strong>
                <span className="mt-1 block text-[11px] text-muted-foreground">{label}</span>
              </span>
            </button>
          );
        })}
      </div>

      {activeStage ? (
        <div
          role="region"
          aria-label="调度任务明细"
          className="mt-3 space-y-2 border-t border-border/60 pt-3"
        >
          {visibleTasks.length ? visibleTasks.map((task) => {
            const content = (
              <>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-xs font-semibold text-foreground">{task.title}</p>
                    <span className={cn(
                      "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                      task.blocked
                        ? "bg-destructive/10 text-destructive"
                        : task.stage === "done"
                          ? "bg-success-soft text-success"
                          : task.stage === "review"
                            ? "bg-warning-soft text-warning"
                            : "bg-primary/8 text-primary",
                    )}>
                      {task.statusLabel}
                    </span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted-foreground">
                    <span>{task.assignee}</span>
                    <span className="flex items-center gap-1"><Clock3 aria-hidden="true" className="size-3" />截止 {task.dueDate}</span>
                  </div>
                  <div className="mt-2 flex items-center gap-2">
                    <Progress value={task.progress} className="h-1.5 flex-1" />
                    <span className="w-8 text-right text-[10px] font-semibold text-primary">{task.progress}%</span>
                  </div>
                </div>
                {task.href ? <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" /> : null}
              </>
            );

            return task.href ? (
              <Link
                key={task.id}
                href={task.href}
                className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/70 p-3 transition hover:border-primary/20 hover:bg-brand-soft/25"
              >
                {content}
              </Link>
            ) : (
              <div key={task.id} className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/55 p-3">
                {content}
              </div>
            );
          }) : (
            <p className="rounded-xl bg-muted/40 px-3 py-4 text-center text-xs text-muted-foreground">
              当前阶段暂无任务
            </p>
          )}
          <p className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <TriangleAlert aria-hidden="true" className="size-3" />
            仅可进入本人任务或本人负责验收的任务
          </p>
        </div>
      ) : null}

      <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border/60 pt-3 text-center text-[11px] text-muted-foreground">
        <span><strong className="block text-sm text-foreground">{current.completed}/{current.total}</strong>已完成</span>
        <span><strong className="block text-sm text-foreground">{current.participantCount}</strong>参与人员</span>
        <span><strong className="block text-sm text-foreground">{current.rejectionCount}</strong>退回次数</span>
      </div>

      {current.isOwner && current.progress < 100 ? (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-primary/15 bg-brand-soft/35 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold text-foreground">这项待办如何完成</p>
            <p className="mt-1 text-[11px] leading-5 text-muted-foreground">所有子任务通过验收后，生成执行总结并完成归档；该待办会自动关闭。</p>
          </div>
          {actionableTask?.href ? (
            <Link
              href={actionableTask.href}
              aria-label={`${actionableTask.stage === "review" ? "去验收" : "去办理"}：${actionableTask.title}`}
              className="inline-flex h-9 shrink-0 items-center justify-center gap-1 rounded-xl bg-primary px-3 text-xs font-semibold text-primary-foreground transition hover:bg-primary/90"
            >
              {actionableTask.stage === "review" ? "去验收" : "去办理"}<ChevronRight aria-hidden="true" className="size-4" />
            </Link>
          ) : (
            <span className="shrink-0 rounded-full bg-white/80 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">等待执行人推进</span>
          )}
        </div>
      ) : null}

      {children}
    </section>
  );
}
