import { AlertCircle, ArrowRight, CheckCircle2, CircleDot } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { TaskCenterItem, TaskCenterSummary as Summary } from "@/features/tasks/task-center-types";

type TaskCenterSummaryProps = {
  items: readonly TaskCenterItem[];
  summary: Summary;
  onShowPending: () => void;
  getTaskHref: (item: TaskCenterItem) => string;
};

const priorityLabels = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "急",
} as const;

const priorityVariants = {
  low: "success",
  medium: "warning",
  high: "destructive",
  urgent: "destructive",
} as const;

export function TaskCenterSummary({ items, summary, onShowPending, getTaskHref }: TaskCenterSummaryProps) {
  const pending = items
    .filter(({ task }) => !["done", "cancelled"].includes(task.status))
    .sort((left, right) => (left.task.dueDate ?? "9999-12-31").localeCompare(right.task.dueDate ?? "9999-12-31"))
    .slice(0, 3);

  return (
    <GlassCard className="flex min-h-76 flex-col p-4 sm:p-5">
      <h2 className="text-base font-semibold">今日待办</h2>
      <div className="mt-4 flex items-end gap-3">
        <strong className="text-4xl leading-none font-semibold text-primary">{summary.pending + summary.inProgress}</strong>
        <span className="pb-1 text-sm text-muted-foreground">项待推进</span>
        <span className="ml-auto pb-1 text-xs font-medium text-success">完成率 {summary.completionRate}%</span>
      </div>
      <ProgressBar value={summary.completionRate} className="mt-3 h-1.5" />
      <div className="mt-4 divide-y divide-border/70">
        {pending.map((item) => (
          <Link
            key={item.task.id}
            aria-label={`立即办理：${item.task.title}`}
            href={getTaskHref(item)}
            className="group flex w-full items-center gap-2 py-2.5 text-left text-sm outline-none transition-colors hover:text-primary focus-visible:text-primary"
          >
            {item.task.priority === "urgent" || item.task.priority === "high" ? (
              <AlertCircle aria-hidden="true" className="size-4 shrink-0 text-warning" />
            ) : item.task.status === "in_progress" || item.task.status === "blocked" || item.task.status === "in_review" ? (
              <CircleDot aria-hidden="true" className="size-4 shrink-0 text-primary" />
            ) : (
              <CheckCircle2 aria-hidden="true" className="size-4 shrink-0 text-success" />
            )}
            <span className="min-w-0 flex-1 truncate font-medium">{item.task.title}</span>
            <Badge variant={priorityVariants[item.task.priority]}>{priorityLabels[item.task.priority]}</Badge>
            <span className="hidden whitespace-nowrap text-xs text-muted-foreground sm:block">{item.task.dueDate?.slice(5) ?? "待定"}</span>
            <ArrowRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          </Link>
        ))}
      </div>
      <Button type="button" variant="link" className="mt-auto self-center" onClick={onShowPending}>
        查看全部待办
        <ArrowRight data-icon="inline-end" aria-hidden="true" />
      </Button>
    </GlassCard>
  );
}
