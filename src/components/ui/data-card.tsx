import type { LucideIcon } from "lucide-react";
import { ArrowUp } from "lucide-react";

import { GlassCard } from "@/components/ui/glass-card";
import { cn } from "@/lib/utils";

type DataCardTone = "blue" | "indigo" | "cyan" | "green" | "purple" | "orange" | "red";

const toneClasses: Record<DataCardTone, string> = {
  blue: "from-primary/20 to-primary/5 text-primary",
  indigo: "from-chart-3/20 to-chart-3/5 text-chart-3",
  cyan: "from-chart-5/25 to-chart-5/5 text-primary",
  green: "from-success/20 to-success/5 text-success",
  purple: "from-chart-3/20 to-chart-3/5 text-chart-3",
  orange: "from-warning/20 to-warning/5 text-warning",
  red: "from-destructive/20 to-destructive/5 text-destructive",
};

const vibrantToneClasses: Record<DataCardTone, string> = {
  blue: "from-primary to-chart-5 text-primary-foreground",
  indigo: "from-chart-3 to-primary text-primary-foreground",
  cyan: "from-chart-5 to-primary text-primary-foreground",
  green: "from-success to-chart-2 text-primary-foreground",
  purple: "from-chart-3 to-primary text-primary-foreground",
  orange: "from-warning to-chart-4 text-primary-foreground",
  red: "from-destructive to-warning text-primary-foreground",
};

type DataCardProps = {
  icon: LucideIcon;
  label: string;
  value: string;
  trend: string;
  trendLabel: string;
  tone?: DataCardTone;
  trendTone?: "success" | "warning";
  compact?: boolean;
  vibrant?: boolean;
};

export function DataCard({
  icon: Icon,
  label,
  value,
  trend,
  trendLabel,
  tone = "blue",
  trendTone = "success",
  compact = false,
  vibrant = false,
}: DataCardProps) {
  return (
    <GlassCard className={cn("flex min-h-28 items-center gap-4 px-5 py-4", compact && "gap-3 px-4 sm:gap-4 sm:px-5")}>
      <div
        className={cn(
          "grid size-16 shrink-0 place-items-center rounded-full bg-linear-to-br shadow-[inset_0_0_0_1px_rgba(255,255,255,0.7)] [&>svg]:size-7",
          compact && "size-12 rounded-2xl sm:size-16 sm:rounded-full",
          vibrant ? vibrantToneClasses[tone] : toneClasses[tone],
        )}
      >
        <Icon aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={cn("mt-0.5 max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[clamp(1.2rem,2vw,1.875rem)] leading-tight font-semibold tracking-tight text-foreground tabular-nums", compact && "text-[clamp(1.15rem,1.8vw,1.75rem)]")}>
          {value}
        </p>
        <div className="mt-1 flex items-center gap-1 text-xs whitespace-nowrap text-muted-foreground">
          <span>{trendLabel}</span>
          <span className={cn("font-semibold", trendTone === "warning" ? "text-warning" : "text-success")}>{trend}</span>
          <ArrowUp aria-hidden="true" className={trendTone === "warning" ? "text-warning" : "text-success"} />
        </div>
      </div>
    </GlassCard>
  );
}
