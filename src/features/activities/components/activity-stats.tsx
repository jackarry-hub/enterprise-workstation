import { BadgeCheck, Megaphone, Radar, TrendingUp } from "lucide-react";

import { DataCard } from "@/components/ui/data-card";
import type { ActivityProjectView } from "@/features/activities/activity-types";

export function ActivityStats({ activities }: { activities: readonly ActivityProjectView[] }) {
  const activeCount = activities.filter(({ project }) => project.status === "active").length;
  const completedTaskCount = activities.reduce(
    (sum, activity) => sum + activity.tasks.filter((task) => task.status === "done").length,
    0,
  );
  const taskCount = activities.reduce((sum, activity) => sum + activity.tasks.length, 0);
  const averageProgress = activities.length === 0
    ? 0
    : Math.round(
        activities.reduce((sum, { project }) => sum + project.progress, 0) /
          activities.length,
      );

  const stats = [
    {
      label: "活动数量",
      value: String(activities.length),
      trendLabel: "当前可见范围",
      icon: Megaphone,
      tone: "blue",
    },
    {
      label: "进行中活动",
      value: String(activeCount),
      trendLabel: "当前可见范围",
      icon: Radar,
      tone: "green",
    },
    {
      label: "平均进度",
      value: `${averageProgress}%`,
      trendLabel: "按项目进度",
      icon: BadgeCheck,
      tone: "purple",
    },
    {
      label: "已完成任务",
      value: `${completedTaskCount}/${taskCount}`,
      trendLabel: "当前活动任务",
      icon: TrendingUp,
      tone: "orange",
    },
  ] as const;

  return (
    <section aria-label="活动统计" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {stats.map((stat) => (
        <DataCard key={stat.label} {...stat} compact />
      ))}
    </section>
  );
}
