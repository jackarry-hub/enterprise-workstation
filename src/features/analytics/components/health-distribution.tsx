"use client";

import { Cell, Pie, PieChart } from "recharts";

import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { GlassCard } from "@/components/ui/glass-card";
import type { AnalyticsHealthItem } from "@/features/analytics/analytics-types";

const chartConfig = {
  value: { label: "项目数量", color: "var(--chart-1)" },
} satisfies ChartConfig;

export function HealthDistribution({ items }: { items: readonly AnalyticsHealthItem[] }) {
  const total = items.reduce((sum, item) => sum + item.value, 0);
  return (
    <GlassCard className="p-4 sm:p-5">
      <h2 className="text-base font-semibold">项目健康度分布</h2>
      <div className="mt-2 grid items-center gap-2 sm:grid-cols-[11rem_1fr]">
        <div className="relative">
          <ChartContainer config={chartConfig} className="h-44 w-full aspect-auto" initialDimension={{ width: 176, height: 176 }}>
            <PieChart accessibilityLayer><Pie data={items} dataKey="value" nameKey="label" innerRadius={48} outerRadius={72} paddingAngle={3}>{items.map((item) => <Cell key={item.health} fill={item.color} />)}</Pie></PieChart>
          </ChartContainer>
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><strong className="text-2xl">{total}</strong><p className="text-xs text-muted-foreground">全部项目</p></div></div>
        </div>
        <div className="space-y-3">
          {items.map((item) => (
            <div key={item.health} className="flex items-center gap-2 text-sm"><span className="size-2.5 rounded-full" style={{ backgroundColor: item.color }} /><span className="flex-1 text-muted-foreground">{item.label}</span><strong>{item.value}</strong></div>
          ))}
        </div>
      </div>
    </GlassCard>
  );
}
