import { CalendarRange, ChevronRight, UserRound } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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

function dateRange(activity: ActivityProjectView) {
  return `${activity.project.startDate.slice(5).replace("-", "/")} - ${activity.project.dueDate.slice(5).replace("-", "/")}`;
}

export function ActivityList({
  activities,
  selectedId,
  onSelect,
}: {
  activities: readonly ActivityProjectView[];
  selectedId: string;
  onSelect: (projectId: string) => void;
}) {
  return (
    <GlassCard className="min-w-0 p-4 sm:p-5 xl:col-span-4">
      <div className="flex items-start justify-between gap-3 px-1">
        <div>
          <h2 className="font-semibold text-foreground">活动列表</h2>
          <p className="mt-1 text-xs text-muted-foreground">选择活动查看执行进展</p>
        </div>
        <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-medium text-primary">
          {activities.length} 项
        </span>
      </div>

      <div className="mt-3 flex flex-col gap-1.5">
        {activities.map((activity) => {
          const selected = activity.project.id === selectedId;
          const status = statusMeta[activity.project.status];

          return (
            <Button
              key={activity.project.id}
              type="button"
              variant="ghost"
              aria-label={`查看${activity.project.name}`}
              aria-pressed={selected}
              onClick={() => onSelect(activity.project.id)}
              className={cn(
                "h-auto w-full items-stretch justify-start rounded-2xl border border-transparent p-0 text-left hover:bg-background/75",
                selected &&
                  "border-primary/20 bg-brand-soft/70 shadow-[0_12px_28px_rgba(47,125,246,0.08)]",
              )}
            >
              <article className="w-full p-3">
                <div className="flex items-start gap-3">
                  <Avatar size="sm">
                    <AvatarFallback
                      className={cn(
                        "text-xs font-semibold",
                        selected ? "bg-primary text-white" : "bg-brand-soft text-primary",
                      )}
                    >
                      {activity.owner.displayName.slice(-2)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h3 className="truncate text-sm font-semibold text-foreground">
                        {activity.project.name}
                      </h3>
                      <ChevronRight
                        aria-hidden="true"
                        className={cn(
                          "ml-auto size-4 shrink-0 text-muted-foreground",
                          selected && "text-primary",
                        )}
                      />
                    </div>
                    <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <UserRound aria-hidden="true" className="size-3.5" />
                      {activity.owner.displayName}
                    </p>
                  </div>
                </div>

                <div className="mt-2.5 flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <CalendarRange aria-hidden="true" className="size-3.5 text-primary" />
                    {dateRange(activity)}
                  </span>
                  <StatusBadge status={status.tone}>{status.label}</StatusBadge>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <ProgressBar
                    aria-label={`${activity.project.name}进度`}
                    value={activity.project.progress}
                    className="h-1.5"
                  />
                  <span className="text-xs font-semibold text-primary">
                    {activity.project.progress}%
                  </span>
                </div>
              </article>
            </Button>
          );
        })}
      </div>
    </GlassCard>
  );
}
