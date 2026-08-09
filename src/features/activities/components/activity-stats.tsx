import { BadgeCheck, Megaphone, Radar, TrendingUp } from "lucide-react";

import { DataCard } from "@/components/ui/data-card";
import type { ActivityProjectView } from "@/features/activities/activity-types";

export function ActivityStats({ activities }: { activities: readonly ActivityProjectView[] }) {
  const activeCount = activities.filter(({ project }) => project.status === "active").length;
  const averageProgress = activities.length === 0
    ? 0
    : Math.round(
        activities.reduce((sum, { project }) => sum + project.progress, 0) /
          activities.length,
      );

  const stats = [
    {
      label: "活动数量",
      value: "32",
      trendLabel: "较上月",
      trend: "+4",
      icon: Megaphone,
      tone: "blue",
    },
    {
      label: "进行中活动",
      value: "14",
      trendLabel: "当前样例",
      trend: `${activeCount} 项`,
      icon: Radar,
      tone: "green",
    },
    {
      label: "完成率",
      value: "68%",
      trendLabel: "样例均值",
      trend: `${averageProgress}%`,
      icon: BadgeCheck,
      tone: "purple",
    },
    {
      label: "转化指标（ROI）",
      value: "3.62",
      trendLabel: "较上月",
      trend: "+0.35",
      icon: TrendingUp,
      tone: "orange",
    },
  ] as const;

  return (
    <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {stats.map((stat) => (
        <DataCard key={stat.label} {...stat} compact />
      ))}
    </section>
  );
}
