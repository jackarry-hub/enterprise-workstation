import { CalendarClock, ClipboardCheck, ListChecks, Sparkles, TrendingUp } from "lucide-react";

import { GlassCard } from "@/components/ui/glass-card";
import type { WorkspaceData } from "@/features/tasks/workspace-types";
import { cn } from "@/lib/utils";

export function WorkspaceOverview({ overview, loadError, approvalLoadError }: { overview: WorkspaceData["overview"]; loadError?: string; approvalLoadError?: string }) {
  const items = [
    { label: "今日任务", value: overview.todayTaskCount, suffix: "项", icon: ListChecks, tone: "text-primary bg-primary/10", unavailable: loadError },
    { label: "待审批", value: overview.pendingApprovalCount, suffix: "项", icon: ClipboardCheck, tone: "text-success bg-success/10", unavailable: approvalLoadError ?? loadError },
    { label: "截止提醒", value: overview.deadlineReminderCount, suffix: "项", icon: CalendarClock, tone: "text-warning bg-warning/10", unavailable: loadError },
    { label: "本周任务完成率", value: overview.weeklyCompletionRate, suffix: "%", icon: TrendingUp, tone: "text-chart-3 bg-chart-3/10", unavailable: loadError },
  ];

  return (
    <GlassCard className="overflow-hidden p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-2xl bg-primary/10 text-primary"><Sparkles aria-hidden="true" className="size-5" /></span>
        <div><h2 className="font-semibold text-foreground">今日工作概览</h2><p className="mt-0.5 text-xs text-muted-foreground">关键事项与本周节奏</p></div>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {items.map(({ label, value, suffix, icon: Icon, tone, unavailable }) => (
          <div key={label} className="flex items-center gap-3 rounded-2xl border border-glass-border bg-background/62 p-3 sm:p-4">
            <span className={cn("grid size-11 shrink-0 place-items-center rounded-2xl", tone)}><Icon aria-hidden="true" className="size-5" /></span>
            <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{unavailable ? "—" : value}<span className="ml-1 text-xs font-normal text-muted-foreground">{unavailable ? "" : suffix}</span></p>{unavailable ? <p role="status" className="mt-1 text-[11px] font-medium text-destructive">数据暂不可用</p> : null}</div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
