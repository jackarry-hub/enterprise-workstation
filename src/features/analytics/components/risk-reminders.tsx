import { AlertTriangle, CalendarClock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
import type { AnalyticsRiskReminder } from "@/features/analytics/analytics-types";

export function RiskReminders({ reminders }: { reminders: readonly AnalyticsRiskReminder[] }) {
  return (
    <GlassCard className="p-4 sm:p-5">
      <div className="flex items-center gap-2"><AlertTriangle aria-hidden="true" className="size-4 text-warning" /><h2 className="text-base font-semibold">项目风险提醒</h2></div>
      <div className="mt-3 divide-y divide-border/70">
        {reminders.length ? reminders.slice(0, 5).map((reminder) => (
          <div key={reminder.id} className="py-3">
            <div className="flex items-start justify-between gap-2"><p className="text-sm font-medium leading-5">{reminder.title}</p><Badge variant={reminder.level === "high" || reminder.level === "critical" ? "destructive" : "warning"}>{reminder.level === "high" ? "高风险" : reminder.level === "critical" ? "严重" : "关注"}</Badge></div>
            <p className="mt-1 truncate text-xs text-muted-foreground">{reminder.projectName}</p>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground"><CalendarClock className="size-3" />{reminder.deadline}</p>
          </div>
        )) : <p className="py-8 text-center text-sm text-muted-foreground">当前没有风险提醒</p>}
      </div>
    </GlassCard>
  );
}
