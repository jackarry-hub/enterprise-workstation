import { CalendarDays } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { AnalyticsDeliveryItem } from "@/features/analytics/analytics-types";

export function DeliveryCalendar({ items }: { items: readonly AnalyticsDeliveryItem[] }) {
  return (
    <GlassCard className="p-4 sm:p-5">
      <div className="flex items-center gap-2"><CalendarDays aria-hidden="true" className="size-4 text-primary" /><h2 className="text-base font-semibold">项目交付日历</h2></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {items.slice(0, 4).map((item) => (
          <div key={item.id} className="rounded-2xl border border-border/70 bg-white/55 p-3">
            <div className="flex items-start justify-between gap-2"><div><p className="font-medium">{item.projectName}</p><p className="mt-1 text-xs text-muted-foreground">交付日期 {item.dueDate}</p></div><Badge variant={item.progress === 100 ? "success" : "info"}>{item.progress}%</Badge></div>
            <ProgressBar value={item.progress} className="mt-3 h-1.5" />
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
