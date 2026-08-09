import { AlertCircle } from "lucide-react";

import { GlassCard } from "@/components/ui/glass-card";
import type { WorkspaceActivity } from "@/features/tasks/workspace-types";
import { cn } from "@/lib/utils";

export function WorkspaceActivityList({ activities, loadError }: { activities: readonly WorkspaceActivity[]; loadError?: string }) {
  return (
    <GlassCard className="p-5 sm:p-6 xl:col-span-5">
      <div><h2 className="font-semibold text-foreground">最近动态</h2><p className="mt-1 text-xs text-muted-foreground">来自项目协同的最新进展</p></div>
      <div className="mt-5 flex flex-col">{activities.map((activity, index) => <article key={activity.id} className="relative flex gap-3 pb-5 last:pb-0">{index < activities.length - 1 ? <span aria-hidden="true" className="absolute top-6 bottom-0 left-2.5 w-px bg-border" /> : null}<span className={cn("relative z-10 mt-1 size-5 shrink-0 rounded-full border-4 border-background", activity.tone === "green" ? "bg-success" : activity.tone === "purple" ? "bg-chart-3" : activity.tone === "orange" ? "bg-warning" : "bg-primary")} /><div className="min-w-0"><p className="text-xs font-medium text-primary">{activity.projectName}</p><p className="mt-1 text-sm leading-6 text-foreground/85">{activity.content}</p><p className="mt-1 text-[11px] text-muted-foreground">{new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(activity.createdAt))}</p></div></article>)}</div>
      {loadError ? <p className="mt-4 flex items-center gap-2 rounded-xl bg-danger-soft px-3 py-2 text-xs text-destructive"><AlertCircle aria-hidden="true" className="size-4" />{loadError}</p> : null}
    </GlassCard>
  );
}
