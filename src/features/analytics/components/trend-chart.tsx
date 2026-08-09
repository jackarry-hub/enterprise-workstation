"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { GlassCard } from "@/components/ui/glass-card";
import type { AnalyticsTrendPoint } from "@/features/analytics/analytics-types";

const chartConfig = {
  projectProgress: { label: "项目推进率", color: "var(--chart-1)" },
  taskCompletion: { label: "任务完成率", color: "var(--chart-2)" },
} satisfies ChartConfig;

export function TrendChart({ trend }: { trend: readonly AnalyticsTrendPoint[] }) {
  return (
    <GlassCard className="min-w-0 p-4 sm:p-5">
      <h2 className="text-base font-semibold">项目推进趋势</h2>
      <p className="mt-1 text-xs text-muted-foreground">项目进度与任务完成率变化</p>
      <ChartContainer config={chartConfig} className="mt-3 h-58 w-full aspect-auto" initialDimension={{ width: 430, height: 232 }}>
        <AreaChart data={trend} margin={{ left: -18, right: 6, top: 10, bottom: 0 }} accessibilityLayer>
          <defs>
            <linearGradient id="analyticsProjectGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--color-projectProgress)" stopOpacity={0.22} /><stop offset="95%" stopColor="var(--color-projectProgress)" stopOpacity={0} /></linearGradient>
            <linearGradient id="analyticsTaskGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--color-taskCompletion)" stopOpacity={0.18} /><stop offset="95%" stopColor="var(--color-taskCompletion)" stopOpacity={0} /></linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="4 4" />
          <XAxis dataKey="label" axisLine={false} tickLine={false} tickMargin={8} />
          <YAxis domain={[0, 100]} axisLine={false} tickLine={false} width={36} />
          <ChartTooltip content={<ChartTooltipContent />} />
          <Area type="monotone" dataKey="projectProgress" stroke="var(--color-projectProgress)" fill="url(#analyticsProjectGradient)" strokeWidth={2.5} />
          <Area type="monotone" dataKey="taskCompletion" stroke="var(--color-taskCompletion)" fill="url(#analyticsTaskGradient)" strokeWidth={2.5} />
        </AreaChart>
      </ChartContainer>
    </GlassCard>
  );
}
