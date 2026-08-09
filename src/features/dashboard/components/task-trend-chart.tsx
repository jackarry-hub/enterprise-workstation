"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { GlassCard } from "@/components/ui/glass-card";
import { taskTrend } from "@/features/dashboard/data";

const chartConfig = {
  created: { label: "创建任务", color: "var(--color-chart-1)" },
  completed: { label: "完成任务", color: "var(--color-chart-2)" },
} satisfies ChartConfig;

export function TaskTrendChart() {
  return (
    <GlassCard className="min-w-0 p-5 xl:col-span-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-foreground">任务趋势</h2>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5 before:size-2 before:rounded-full before:bg-chart-1 before:content-['']">创建任务</span>
          <span className="flex items-center gap-1.5 before:size-2 before:rounded-full before:bg-chart-2 before:content-['']">完成任务</span>
        </div>
      </div>
      <ChartContainer config={chartConfig} className="mt-4 h-58 w-full aspect-auto" initialDimension={{ width: 430, height: 232 }}>
        <LineChart data={taskTrend} margin={{ left: 0, right: 8, top: 8 }} accessibilityLayer>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis dataKey="date" tickLine={false} axisLine={false} tickMargin={10} />
          <YAxis tickLine={false} axisLine={false} tickMargin={8} width={34} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
          <Line type="monotone" dataKey="created" stroke="var(--color-created)" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
          <Line type="monotone" dataKey="completed" stroke="var(--color-completed)" strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={false} />
        </LineChart>
      </ChartContainer>
    </GlassCard>
  );
}
