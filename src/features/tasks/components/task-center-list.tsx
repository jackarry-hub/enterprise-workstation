import { CalendarDays, ChevronRight, ListTodo, Sparkles } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { GlassCard } from "@/components/ui/glass-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusBadge } from "@/components/ui/status-badge";
import type { TaskCenterItem, TaskCenterSummary, TaskCenterTab } from "@/features/tasks/task-center-types";
import { toTaskCenterStatus } from "@/features/tasks/task-center-selectors";

type TaskCenterListProps = {
  items: readonly TaskCenterItem[];
  summary: TaskCenterSummary;
  tab: TaskCenterTab;
  onTabChange: (tab: TaskCenterTab) => void;
  onOpenTask: (item: TaskCenterItem) => void;
  onReset: () => void;
};

const statusLabels = {
  pending: "待开始",
  in_progress: "进行中",
  done: "已完成",
  cancelled: "已取消",
} as const;

const statusTones = {
  pending: "neutral",
  in_progress: "active",
  done: "success",
  cancelled: "warning",
} as const;

const priorityLabels = { low: "低", medium: "中", high: "高", urgent: "紧急" } as const;

export function TaskCenterList({ items, summary, tab, onTabChange, onOpenTask, onReset }: TaskCenterListProps) {
  const tabs: Array<{ id: TaskCenterTab; label: string; count: number }> = [
    { id: "all", label: "全部任务", count: summary.total },
    { id: "mine", label: "我的任务", count: summary.mine },
    { id: "pending", label: "待开始", count: summary.pending },
    { id: "in_progress", label: "进行中", count: summary.inProgress },
    { id: "done", label: "已完成", count: summary.done },
  ];

  return (
    <GlassCard className="min-h-76 overflow-hidden p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-base font-semibold">我的任务</h2>
        <span className="text-xs text-muted-foreground">当前显示 {items.length} 项</span>
      </div>
      <div role="tablist" aria-label="任务状态" className="scrollbar-none mt-3 flex gap-1 overflow-x-auto border-b border-border/80">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            onClick={() => onTabChange(item.id)}
            className="relative flex h-9 shrink-0 items-center gap-1.5 px-3 text-sm text-muted-foreground transition-colors aria-selected:text-primary aria-selected:after:absolute aria-selected:after:inset-x-3 aria-selected:after:-bottom-px aria-selected:after:h-0.5 aria-selected:after:rounded-full aria-selected:after:bg-primary"
          >
            {item.label}
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px]">{item.count}</span>
          </button>
        ))}
      </div>
      {items.length === 0 ? (
        <Empty className="min-h-48">
          <EmptyHeader>
            <EmptyMedia variant="icon"><ListTodo aria-hidden="true" /></EmptyMedia>
            <EmptyTitle>没有找到匹配的任务</EmptyTitle>
            <EmptyDescription>调整搜索关键词或筛选条件后再试。</EmptyDescription>
          </EmptyHeader>
          <Button type="button" variant="outline" onClick={onReset}>重置筛选</Button>
        </Empty>
      ) : (
        <div className="mt-1 divide-y divide-border/70">
          {items.slice(0, 6).map((item) => {
            const status = toTaskCenterStatus(item.task.status);
            const isAiDispatched = item.task.description.startsWith("AI 决策下发");
            return (
              <button
                key={item.task.id}
                type="button"
                aria-label={`查看任务详情：${item.task.title}`}
                onClick={() => onOpenTask(item)}
                className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 py-3 text-left sm:grid-cols-[minmax(0,1fr)_7rem_7rem_auto]"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar className="size-9 bg-linear-to-br from-primary/18 to-chart-3/12">
                    <AvatarFallback className="bg-transparent font-medium text-primary">{item.assignee?.displayName.slice(0, 1) ?? "待"}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <p className="truncate text-sm font-medium group-hover:text-primary">{item.task.title}</p>
                      {isAiDispatched ? <Badge variant="info" className="shrink-0"><Sparkles aria-hidden="true" />AI 下发</Badge> : null}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{item.project.name} · {item.assignee?.displayName ?? "待分配"}</p>
                  </div>
                </div>
                <div className="hidden sm:block">
                  <StatusBadge status={statusTones[status]}>{statusLabels[status]}</StatusBadge>
                </div>
                <div className="hidden min-w-0 sm:block">
                  <div className="mb-1 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{item.task.progress}%</span>
                    <Badge variant="outline">{priorityLabels[item.task.priority]}</Badge>
                  </div>
                  <ProgressBar value={item.task.progress} className="h-1.5" />
                </div>
                <div className="flex items-center gap-2">
                  <span className="hidden items-center gap-1 whitespace-nowrap text-xs text-muted-foreground lg:flex">
                    <CalendarDays aria-hidden="true" className="size-3.5" />
                    {item.task.dueDate?.slice(5) ?? "待定"}
                  </span>
                  <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                </div>
              </button>
            );
          })}
        </div>
      )}
    </GlassCard>
  );
}
