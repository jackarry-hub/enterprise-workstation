"use client";

import { useEffect, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  CircleDashed,
  ClipboardList,
  LoaderCircle,
  Plus,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { ProjectTaskDetailDialog } from "@/features/projects/components/project-task-detail-dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatusBadge } from "@/components/ui/status-badge";
import type { TaskExecutionStatus } from "@/features/projects/data/project-task-operations";
import type { ProjectDetailData, ProjectTask } from "@/features/projects/types";

type ProjectTasksTabProps = {
  detail: ProjectDetailData;
  onCreate: () => void;
  onStatusChange: (taskId: string, status: TaskExecutionStatus) => void;
  onComment: (taskId: string, body: string) => void;
  initialTaskId?: string;
  canManage?: boolean;
  workflowManaged?: boolean;
};

const workflowStatusMeta = {
  backlog: { label: "待开始", tone: "neutral" },
  todo: { label: "待开始", tone: "active" },
  in_progress: { label: "进行中", tone: "active" },
  blocked: { label: "已阻塞", tone: "warning" },
  in_review: { label: "待验收", tone: "warning" },
  done: { label: "已完成", tone: "success" },
  cancelled: { label: "已取消", tone: "neutral" },
} as const;

const priorityLabels = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
} as const;

const priorityVariants = {
  low: "neutral",
  medium: "info",
  high: "warning",
  urgent: "destructive",
} as const;

const statusLabels = {
  todo: "待开始",
  in_progress: "进行中",
  done: "已完成",
} as const;

function normalizeStatus(status: ProjectTask["status"]): TaskExecutionStatus {
  if (status === "done") {
    return "done";
  }
  if (status === "in_progress" || status === "blocked" || status === "in_review") {
    return "in_progress";
  }
  return "todo";
}

function initials(name: string) {
  return name.slice(-2);
}

function formatDate(date?: string) {
  return date ? date.replaceAll("-", "/") : "待确认";
}

export function ProjectTasksTab({ detail, onCreate, onStatusChange, onComment, initialTaskId, canManage = true, workflowManaged = false }: ProjectTasksTabProps) {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId ?? null);
  useEffect(() => { if (initialTaskId) setSelectedTaskId(initialTaskId); }, [initialTaskId]);
  const selectedTask = detail.tasks.find(({ id }) => id === selectedTaskId) ?? null;
  const summary = detail.tasks.reduce((counts, task) => {
    const status = normalizeStatus(task.status);
    counts[status] += 1;
    return counts;
  }, { todo: 0, in_progress: 0, done: 0 });
  const stats = [
    { label: "任务总数", value: detail.tasks.length, icon: ClipboardList, tone: "blue" },
    { label: "待开始", value: summary.todo, icon: CircleDashed, tone: "orange" },
    { label: "进行中", value: summary.in_progress, icon: LoaderCircle, tone: "purple" },
    { label: "已完成", value: summary.done, icon: CheckCircle2, tone: "green" },
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <GlassCard className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">项目任务</h2>
            <p className="mt-1 text-sm text-muted-foreground">分配执行责任，通过任务完成情况自动更新项目进度</p>
          </div>
          {canManage ? <Button type="button" onClick={onCreate} className="h-9 rounded-xl px-3 shadow-[0_10px_24px_rgba(47,125,246,0.18)]">
            <Plus data-icon="inline-start" aria-hidden="true" />
            新建任务
          </Button> : null}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map(({ label, value, icon: Icon, tone }) => (
            <div key={label} className="flex min-w-0 items-center gap-3 rounded-2xl border border-glass-border bg-background/62 p-3.5 sm:p-4">
              <span className={tone === "green" ? "grid size-10 shrink-0 place-items-center rounded-2xl bg-success-soft text-success" : tone === "purple" ? "grid size-10 shrink-0 place-items-center rounded-2xl bg-chart-3/10 text-chart-3" : tone === "orange" ? "grid size-10 shrink-0 place-items-center rounded-2xl bg-warning-soft text-warning" : "grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"}>
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      <GlassCard className="overflow-hidden p-4 sm:p-6">
        {detail.tasks.length > 0 ? (
          <div className="flex flex-col gap-3">
            {detail.tasks.map((task) => {
              const assignee = detail.members.find(({ member }) => member.id === task.assigneeId)?.member;
              const status = normalizeStatus(task.status);

              return (
                <article key={task.id} className="grid min-w-0 gap-4 rounded-2xl border border-glass-border bg-background/62 p-4 transition-colors hover:bg-background/82 lg:grid-cols-[minmax(17rem,1.6fr)_minmax(8rem,0.7fr)_minmax(7rem,0.55fr)_5rem_minmax(8rem,0.65fr)] lg:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => setSelectedTaskId(task.id)} className="truncate text-left font-semibold text-foreground transition-colors hover:text-primary" aria-label={`查看任务详情：${task.title}`}>{task.title}</button>
                      {task.status === "cancelled" ? <StatusBadge status="neutral">已取消</StatusBadge> : null}
                    </div>
                    <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{task.description || "等待补充任务说明与验收标准。"}</p>
                  </div>

                  <div className="flex items-center gap-2">
                    <Avatar size="sm" aria-label={assignee?.displayName ?? "待分配"}>
                      <AvatarFallback className="bg-brand-soft text-[10px] font-semibold text-primary">
                        {assignee ? initials(assignee.displayName) : "待定"}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <p className="truncate text-xs font-medium text-foreground">{assignee?.displayName ?? "待分配"}</p>
                      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{assignee?.department ?? "项目成员"}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <CalendarDays aria-hidden="true" className="size-3.5 shrink-0 text-primary" />
                    <span>{formatDate(task.dueDate)}</span>
                  </div>

                  <Badge variant={priorityVariants[task.priority]}>{priorityLabels[task.priority]}</Badge>

                  {workflowManaged ? (
                    <StatusBadge status={workflowStatusMeta[task.status].tone}>{workflowStatusMeta[task.status].label}</StatusBadge>
                  ) : task.status === "cancelled" ? (
                    <StatusBadge status="neutral">不可更新</StatusBadge>
                  ) : canManage ? (
                    <Select value={status} onValueChange={(value) => onStatusChange(task.id, value as TaskExecutionStatus)}>
                      <SelectTrigger className="h-9 w-full bg-white/75" aria-label={`${task.title}状态`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="todo">{statusLabels.todo}</SelectItem>
                          <SelectItem value="in_progress">{statusLabels.in_progress}</SelectItem>
                          <SelectItem value="done">{statusLabels.done}</SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  ) : <StatusBadge status={workflowStatusMeta[task.status].tone}>{workflowStatusMeta[task.status].label}</StatusBadge>}
                </article>
              );
            })}
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-glass-border bg-background/45 p-6 text-center">
            <div>
              <ClipboardList aria-hidden="true" className="mx-auto size-8 text-primary" />
              <h3 className="mt-3 font-semibold text-foreground">还没有项目任务</h3>
              <p className="mt-1 text-sm text-muted-foreground">创建第一项任务，把项目目标转化为具体行动。</p>
              {canManage ? <Button type="button" onClick={onCreate} className="mt-4 h-9 rounded-xl">新建任务</Button> : null}
            </div>
          </div>
        )}
      </GlassCard>
      <ProjectTaskDetailDialog task={selectedTask} detail={detail} open={Boolean(selectedTask)} onOpenChange={(open) => !open && setSelectedTaskId(null)} onComment={onComment} />
    </div>
  );
}
