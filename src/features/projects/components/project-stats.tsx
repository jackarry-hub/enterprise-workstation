import {
  CircleCheckBig,
  FolderKanban,
  LoaderCircle,
  TriangleAlert,
} from "lucide-react";

import { DataCard } from "@/components/ui/data-card";
import type { ProjectPortfolioStat } from "@/features/projects/types";

const statIcons = {
  all: FolderKanban,
  active: LoaderCircle,
  completed: CircleCheckBig,
  risk: TriangleAlert,
} as const;

type ProjectStatsProps = {
  stats: readonly ProjectPortfolioStat[];
};

export function ProjectStats({ stats }: ProjectStatsProps) {
  return (
    <section id="project-overview" aria-label="项目统计" className="scroll-mt-24 grid grid-cols-2 gap-3 xl:grid-cols-4">
      {stats.map((stat) => (
        <DataCard
          key={stat.id}
          icon={statIcons[stat.id]}
          label={stat.label}
          value={String(stat.value)}
          trendLabel={stat.trendLabel}
          trend={stat.trend}
          tone={stat.tone}
          trendTone={stat.id === "risk" ? "warning" : "success"}
          compact
          vibrant
        />
      ))}
    </section>
  );
}
