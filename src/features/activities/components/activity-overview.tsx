import {
  CalendarRange,
  CheckCircle2,
  CircleDot,
  ClipboardPenLine,
  Megaphone,
  RotateCcw,
  Send,
  Target,
  UserRound,
} from "lucide-react";

import { GlassCard } from "@/components/ui/glass-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ActivityProjectView } from "@/features/activities/activity-types";
import { cn } from "@/lib/utils";

const statusMeta = {
  planning: { label: "规划中", tone: "neutral" },
  active: { label: "进行中", tone: "active" },
  on_hold: { label: "已暂停", tone: "warning" },
  completed: { label: "已完成", tone: "success" },
  cancelled: { label: "已取消", tone: "neutral" },
} as const;

const stageIcons = [ClipboardPenLine, Send, Megaphone, RotateCcw] as const;

export function ActivityOverview({ activity }: { activity: ActivityProjectView }) {
  const status = statusMeta[activity.project.status];

  return (
    <GlassCard className="relative overflow-hidden p-5 sm:p-6">
      <div
        aria-hidden="true"
        className="absolute -top-28 right-8 size-72 rounded-full bg-primary/10 blur-3xl"
      />

      <div className="relative grid gap-6 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.55fr)] xl:items-center xl:gap-8">
        <div className="min-w-0">
          <div className="flex min-w-0 gap-4">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-primary to-chart-5 text-white shadow-[0_14px_30px_rgba(47,125,246,0.2)]">
              <Target aria-hidden="true" className="size-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-medium tracking-wide text-primary">
                  重点活动 · {activity.project.code}
                </p>
                <StatusBadge status={status.tone}>{status.label}</StatusBadge>
              </div>
              <h2 className="mt-1 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
                {activity.project.name}
              </h2>
              <p className="mt-1.5 line-clamp-1 text-sm text-muted-foreground">
                {activity.objective?.description ?? activity.project.description}
              </p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-3 border-t border-border/65 pt-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-primary">
                <UserRound aria-hidden="true" className="size-3.5" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground">活动负责人</p>
                <p className="truncate text-sm font-medium text-foreground">{activity.owner.displayName}</p>
              </div>
            </div>
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-success-soft text-success">
                <CalendarRange aria-hidden="true" className="size-3.5" />
              </span>
              <div className="min-w-0">
                <p className="text-[11px] text-muted-foreground">活动周期</p>
                <p className="truncate text-sm font-medium text-foreground">
                  {activity.project.startDate.slice(5).replace("-", "/")} - {activity.project.dueDate.slice(5).replace("-", "/")}
                </p>
              </div>
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-muted-foreground">活动目标</p>
              <p className="mt-0.5 truncate text-sm font-medium text-foreground">
                {activity.objective?.title ?? activity.project.description}
              </p>
            </div>
            <div className="min-w-0">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[11px] text-muted-foreground">整体进度</p>
                <span className="text-sm font-semibold text-primary">{activity.project.progress}%</span>
              </div>
              <ProgressBar
                aria-label="活动总进度"
                value={activity.project.progress}
                className="mt-1.5 h-1.5"
              />
            </div>
          </div>
        </div>

        <div className="min-w-0 xl:border-l xl:border-border/65 xl:pl-8">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-foreground">阶段推进</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">按项目里程碑跟踪关键交付阶段</p>
            </div>
            <span className="hidden text-xs text-muted-foreground sm:block">同步项目里程碑</span>
          </div>

          {activity.stages.length > 0 ? <div className="mt-4 grid grid-cols-2 gap-2 xl:grid-cols-4 xl:items-stretch">
            {activity.stages.map((stage, index) => {
              const completed = stage.status === "completed";
              const active = stage.status === "in_progress";
              const Icon = stageIcons[index] ?? CircleDot;

              return (
                <article key={stage.id} className="flex min-w-0 flex-col items-center rounded-2xl bg-background/45 px-2 py-3 text-center">
                    <span
                      className={cn(
                        "grid size-10 place-items-center rounded-full",
                        active
                          ? "bg-primary text-white shadow-[0_8px_18px_rgba(47,125,246,0.22)]"
                          : completed
                            ? "bg-success text-white"
                            : "bg-muted text-muted-foreground",
                      )}
                    >
                      {completed ? (
                        <CheckCircle2 aria-hidden="true" className="size-5" />
                      ) : (
                        <Icon aria-hidden="true" className="size-5" />
                      )}
                    </span>
                    <h3 className="mt-2 text-sm font-semibold text-foreground">{stage.name}</h3>
                    <p
                      className={cn(
                        "mt-1 text-xs font-semibold",
                        completed
                          ? "text-success"
                          : active
                            ? "text-primary"
                            : "text-muted-foreground",
                      )}
                    >
                      {completed ? "已完成" : active ? "进行中" : "待开始"}
                    </p>
                    <p className="mt-0.5 whitespace-nowrap text-[11px] text-muted-foreground">
                      {completed
                        ? `完成于 ${stage.dueDate.slice(5).replace("-", "/")}`
                        : active
                          ? `当前进度 ${stage.progress}%`
                          : `计划 ${stage.dueDate.slice(5).replace("-", "/")}`}
                    </p>
                </article>
              );
            })}
          </div> : <div className="mt-4 rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">尚未配置里程碑，可进入项目详情添加。</div>}
        </div>
      </div>
    </GlassCard>
  );
}
