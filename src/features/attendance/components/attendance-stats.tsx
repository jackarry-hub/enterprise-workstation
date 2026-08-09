import { CalendarCheck2, ClockAlert, Plane, TrendingUp } from "lucide-react";

import { DataCard } from "@/components/ui/data-card";
import type { AttendanceStats as AttendanceStatsValue } from "@/features/attendance/attendance-types";

export function AttendanceStats({ stats }: { stats: AttendanceStatsValue }) {
  return (
    <section aria-label="考勤统计" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <DataCard compact icon={CalendarCheck2} label="今日出勤人数" value={String(stats.presentToday)} trend="+3" trendLabel="较昨日" tone="blue" />
      <DataCard compact icon={ClockAlert} label="迟到人数" value={String(stats.lateToday)} trend="-2" trendLabel="较昨日" tone="orange" trendTone="warning" />
      <DataCard compact icon={Plane} label="请假人数" value={String(stats.leaveToday)} trend="1 人" trendLabel="年假" tone="purple" />
      <DataCard compact icon={TrendingUp} label="本月出勤率" value={`${stats.monthlyAttendanceRate}%`} trend="+1.4%" trendLabel="较上月" tone="green" />
    </section>
  );
}
