"use client";

import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import type { AttendanceTrendPoint } from "@/features/attendance/attendance-types";

const chartConfig = {
  attendanceRate: { label: "出勤率", color: "var(--primary)" },
} satisfies ChartConfig;

export function AttendanceTrend({ trend }: { trend: AttendanceTrendPoint[] }) {
  return (
    <section aria-label="月度出勤趋势">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">月度出勤趋势</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">近 8 个工作日出勤率</p>
        </div>
        <p className="text-2xl font-semibold text-foreground">92.6<span className="text-sm text-muted-foreground">%</span></p>
      </div>
      <ChartContainer config={chartConfig} className="mt-3 h-44 w-full aspect-auto" initialDimension={{ width: 380, height: 176 }}>
        <AreaChart data={trend} margin={{ left: -18, right: 4, top: 8, bottom: 0 }} accessibilityLayer>
          <defs>
            <linearGradient id="attendance-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-attendanceRate)" stopOpacity={0.28} />
              <stop offset="95%" stopColor="var(--color-attendanceRate)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 4" />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
          <YAxis domain={[88, 100]} tickLine={false} axisLine={false} tickMargin={6} fontSize={10} tickFormatter={(value) => `${value}%`} />
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <Area type="monotone" dataKey="attendanceRate" stroke="var(--color-attendanceRate)" strokeWidth={2.5} fill="url(#attendance-fill)" />
        </AreaChart>
      </ChartContainer>
    </section>
  );
}
