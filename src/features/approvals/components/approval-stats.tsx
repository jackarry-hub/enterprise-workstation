import { ArrowUp, CheckCircle2, CircleX, Clock3, Send } from "lucide-react";

import type { ApprovalStats as ApprovalStatsValue } from "@/features/approvals/approval-types";
import type { ApprovalQueue } from "@/features/approvals/approval-types";
import { cn } from "@/lib/utils";

const cards = [
  { queue: "pending", key: "pending", label: "待审批", trend: "+3", tone: "bg-chart-3/10 text-chart-3", icon: Clock3 },
  { queue: "mine", key: "initiated", label: "我发起", trend: "+2", tone: "bg-success/10 text-success", icon: Send },
  { queue: "approved", key: "approved", label: "已通过", trend: "+15", tone: "bg-primary/10 text-primary", icon: CheckCircle2 },
  { queue: "rejected", key: "rejected", label: "已拒绝", trend: "+1", tone: "bg-warning/10 text-warning", icon: CircleX },
] as const;

export function ApprovalStats({ stats, activeQueue, onSelect }: { stats: ApprovalStatsValue; activeQueue: ApprovalQueue; onSelect: (queue: ApprovalQueue) => void }) {
  return (
    <section aria-label="审批统计" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {cards.map(({ queue, key, label, trend, tone, icon: Icon }) => {
        const selected = activeQueue === queue;
        const value = stats[key];
        return (
          <button
            key={queue}
            type="button"
            aria-pressed={selected}
            aria-label={`筛选${label}审批，共 ${value} 条`}
            onClick={() => onSelect(selected ? "all" : queue)}
            className={cn(
              "group flex min-h-28 cursor-pointer items-center gap-3 rounded-2xl border border-glass-border bg-glass px-4 py-4 text-left shadow-[0_16px_45px_rgba(44,84,142,0.08)] backdrop-blur-xl transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_18px_42px_rgba(44,84,142,0.13)] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-primary/25 sm:gap-4 sm:px-5",
              selected && "border-primary/45 bg-primary/6 ring-2 ring-primary/15",
            )}
          >
            <span className={cn("grid size-12 shrink-0 place-items-center rounded-2xl sm:size-16 sm:rounded-full [&>svg]:size-7", tone)}>
              <Icon aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className={cn("block text-sm text-muted-foreground", selected && "font-medium text-primary")}>{label}</span>
              <span className="mt-0.5 block text-[clamp(1.15rem,1.8vw,1.75rem)] leading-tight font-semibold text-foreground tabular-nums">{value}</span>
              <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                <span>较昨日</span>
                <span className={cn("font-semibold", queue === "rejected" ? "text-warning" : "text-success")}>{trend}</span>
                <ArrowUp aria-hidden="true" className={cn("size-3.5", queue === "rejected" ? "text-warning" : "text-success")} />
              </span>
              {selected ? <span className="sr-only">当前已选中</span> : null}
            </span>
          </button>
        );
      })}
    </section>
  );
}
