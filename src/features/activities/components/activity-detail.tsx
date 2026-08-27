import {
  CalendarClock,
  CheckCircle2,
  CircleDot,
  Flag,
  ListChecks,
  Target,
  UserRound,
} from "lucide-react";
import Link from "next/link";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ActivityProjectView } from "@/features/activities/activity-types";
import type { ProjectTask } from "@/features/projects/types";
import { cn } from "@/lib/utils";

const taskStatusMeta = {
  backlog: { label: "待完成", tone: "neutral" },
  todo: { label: "待完成", tone: "active" },
  in_progress: { label: "进行中", tone: "success" },
  blocked: { label: "已阻塞", tone: "warning" },
  in_review: { label: "评审中", tone: "warning" },
  done: { label: "已完成", tone: "success" },
  cancelled: { label: "已取消", tone: "neutral" },
} as const;

const priorityMeta = {
  urgent: { label: "紧急", variant: "destructive" },
  high: { label: "高", variant: "destructive" },
  medium: { label: "中", variant: "warning" },
  low: { label: "低", variant: "success" },
} as const;

function taskOwner(activity: ActivityProjectView, task: ProjectTask) {
  return (
    activity.members.find(({ member }) => member.id === task.assigneeId)?.member ??
    activity.owner
  );
}

export function ActivityDetail({ activity, className }: { activity: ActivityProjectView; className?: string }) {
  return (
    <div className={cn("grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_17rem] xl:col-span-8", className)}>
      <GlassCard className="min-w-0 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-2xl bg-success/10 text-success">
              <ListChecks aria-hidden="true" className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold text-foreground">阶段任务</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                当前活动共 {activity.tasks.length} 项执行任务
              </p>
            </div>
          </div>
          <Link href={`/projects/${activity.project.id}?tab=tasks`} className="hidden text-xs font-medium text-primary hover:underline sm:block">查看全部</Link>
        </div>

        <div className="mt-4">
          {activity.tasks.map((task) => {
            const owner = taskOwner(activity, task);
            const status = taskStatusMeta[task.status];
            const priority = priorityMeta[task.priority];

            return (
              <article
                key={task.id}
                className="grid gap-3 border-b border-border/70 py-4 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_8.5rem] sm:items-center"
              >
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-semibold text-foreground">
                      {task.title}
                    </h3>
                    <StatusBadge status={status.tone}>{status.label}</StatusBadge>
                    <Badge variant={priority.variant}>{priority.label}</Badge>
                  </div>
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                    {task.description}
                  </p>
                  <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <UserRound aria-hidden="true" className="size-3.5" />
                      {owner.displayName}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <CalendarClock aria-hidden="true" className="size-3.5" />
                      截止 {task.dueDate?.replaceAll("-", "/") ?? "未设置"}
                    </span>
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold text-foreground">{task.progress}%</span>
                  <ProgressBar
                    aria-label={`${task.title}任务进度`}
                    value={task.progress}
                    className="h-1.5"
                  />
                </div>
              </article>
            );
          })}
        </div>
      </GlassCard>

      <div className="flex min-w-0 flex-col gap-4">
        <GlassCard className="p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-warning-soft text-warning">
              <Flag aria-hidden="true" className="size-4" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-foreground">关键节点</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">阶段时间与状态</p>
            </div>
          </div>
          <div className="mt-4 space-y-4">
            {activity.stages.map((stage) => {
              const completed = stage.status === "completed";
              const active = stage.status === "in_progress";

              return (
                <div key={stage.id} className="flex gap-3">
                  <span
                    className={cn(
                      "mt-0.5 grid size-6 shrink-0 place-items-center rounded-full",
                      completed
                        ? "bg-success-soft text-success"
                        : active
                          ? "bg-brand-soft text-primary"
                          : "bg-muted text-muted-foreground",
                    )}
                  >
                    {completed ? (
                      <CheckCircle2 aria-hidden="true" className="size-3.5" />
                    ) : (
                      <CircleDot aria-hidden="true" className="size-3.5" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-foreground">{stage.name}</p>
                      <span
                        className={cn(
                          "text-[11px] font-semibold",
                          completed
                            ? "text-success"
                            : active
                              ? "text-primary"
                              : "text-muted-foreground",
                        )}
                      >
                        {completed ? "已完成" : active ? "进行中" : "待开始"}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {stage.dueDate.replaceAll("-", "/")}
                      {active ? ` · ${stage.progress}%` : ""}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </GlassCard>

        <GlassCard className="p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl bg-brand-soft text-primary">
              <Target aria-hidden="true" className="size-4" />
            </span>
            <h2 className="text-sm font-semibold text-foreground">活动目标</h2>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            {activity.objective?.title ?? activity.project.description}
          </p>
          <div className="mt-4 flex items-center gap-3 rounded-xl bg-background/60 p-3">
            <Avatar size="sm">
              <AvatarFallback className="bg-primary text-[10px] text-white">
                {activity.owner.displayName.slice(-2)}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="text-xs text-muted-foreground">负责人</p>
              <p className="text-sm font-medium text-foreground">{activity.owner.displayName}</p>
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
