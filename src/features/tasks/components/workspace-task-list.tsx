"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CalendarClock, FileCheck2, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusBadge } from "@/components/ui/status-badge";
import { getProjectHref } from "@/features/projects/project-navigation";
import type { TaskStatus } from "@/features/projects/types";
import type { WorkspaceTask } from "@/features/tasks/workspace-types";
import { cn } from "@/lib/utils";

const priorityMeta = {
  urgent: { label: "紧急", variant: "destructive" },
  high: { label: "高", variant: "destructive" },
  medium: { label: "中", variant: "warning" },
  low: { label: "低", variant: "success" },
} as const;

const statusMeta: Record<TaskStatus, { label: string; tone: "active" | "success" | "neutral" | "warning" }> = {
  backlog: { label: "待完成", tone: "neutral" },
  todo: { label: "待完成", tone: "active" },
  in_progress: { label: "进行中", tone: "success" },
  blocked: { label: "已阻塞", tone: "warning" },
  in_review: { label: "评审中", tone: "warning" },
  done: { label: "已完成", tone: "success" },
  cancelled: { label: "已取消", tone: "neutral" },
};

function formatDueDate(date?: string) {
  if (!date) return "未设置";
  if (date === "2026-08-04") return "今天";
  if (date === "2026-08-05") return "明天";
  return date.slice(5).replace("-", "/");
}

function WorkspaceTaskRow({ task, index }: { task: WorkspaceTask; index: number }) {
  const priority = priorityMeta[task.priority];
  const status = statusMeta[task.status];
  const iconTones = ["project-icon-blue", "project-icon-green", "project-icon-purple", "bg-linear-to-br from-warning to-chart-4", "project-icon-blue"];

  return (
    <article className="grid gap-3 border-b border-border/70 py-4 last:border-b-0 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
      <div className={cn("project-icon", iconTones[index % iconTones.length])}><FileCheck2 aria-hidden="true" /></div>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2"><h3 className="truncate text-sm font-semibold text-foreground"><Link href={getProjectHref(task.projectId, { tab: "tasks", task: task.id })} className="transition-colors hover:text-primary">{task.title}</Link></h3><StatusBadge status={status.tone}>{status.label}</StatusBadge></div>
        <p className="mt-1 truncate text-xs text-muted-foreground">{task.projectName}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><CalendarClock aria-hidden="true" className="size-3.5 text-primary" />截止 {formatDueDate(task.dueDate)}</span>
          <span className="flex items-center gap-1.5"><UserRound aria-hidden="true" className="size-3.5" />{task.assignee.displayName}</span>
          <Badge variant={priority.variant}>{priority.label}</Badge>
        </div>
      </div>
      <div className="flex min-w-30 items-center gap-3 sm:justify-end"><span className="w-9 text-right text-xs font-semibold text-foreground">{task.progress}%</span><ProgressBar aria-label={`${task.title}进度`} value={task.progress} className="h-1.5 max-w-28" /></div>
    </article>
  );
}

export function WorkspaceTaskList({ tasks }: { tasks: readonly WorkspaceTask[] }) {
  const [filter, setFilter] = useState<"all" | "active" | "todo">("all");
  const filteredTasks = useMemo(() => tasks.filter((task) => {
    if (filter === "active") return task.status === "in_progress" || task.status === "blocked" || task.status === "in_review";
    if (filter === "todo") return task.status === "todo" || task.status === "backlog";
    return true;
  }), [filter, tasks]);

  return (
    <GlassCard className="min-w-0 p-5 sm:p-6 xl:col-span-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="font-semibold text-foreground">我的任务</h2><p className="mt-1 text-xs text-muted-foreground">按项目优先级推进当前工作</p></div>
        <div className="flex rounded-xl bg-muted/75 p-1">{([['all', '全部'], ['active', '进行中'], ['todo', '待完成']] as const).map(([value, label]) => <Button key={value} type="button" variant="ghost" size="sm" onClick={() => setFilter(value)} className={cn("h-8 rounded-lg px-3", filter === value && "bg-background text-primary shadow-sm")}>{label}</Button>)}</div>
      </div>
      <div className="mt-3">{filteredTasks.length > 0 ? filteredTasks.map((task, index) => <WorkspaceTaskRow key={task.id} task={task} index={index} />) : <p className="rounded-2xl border border-dashed border-glass-border p-8 text-center text-sm text-muted-foreground">当前筛选下暂无任务</p>}</div>
    </GlassCard>
  );
}
