import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { StatusBadge } from "@/components/ui/status-badge";
import { projectHealth } from "@/features/dashboard/data";

const statusMeta = {
  active: { label: "进行中", status: "active" },
  warning: { label: "风险预警", status: "warning" },
  success: { label: "已完成", status: "success" },
} as const;

export function ProjectHealth() {
  return (
    <GlassCard className="min-w-0 p-5 xl:col-span-5">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-base font-semibold text-foreground">项目健康度</h2>
        <Button asChild variant="link" size="sm" className="px-0"><Link href="/projects">查看全部<ArrowRight data-icon="inline-end" aria-hidden="true" /></Link></Button>
      </div>
      <div className="mt-3 overflow-x-auto">
        <div className="min-w-120">
          <div className="grid grid-cols-[1.5fr_0.7fr_1fr_0.65fr_0.65fr] gap-3 border-b border-border px-2 pb-2 text-xs text-muted-foreground">
            <span>项目名称</span><span>负责人</span><span>进度</span><span>截止日期</span><span>状态</span>
          </div>
          <div className="flex flex-col">
            {projectHealth.map((project) => {
              const status = statusMeta[project.status];
              return (
                <div key={project.name} className="grid grid-cols-[1.5fr_0.7fr_1fr_0.65fr_0.65fr] items-center gap-3 border-b border-border/70 px-2 py-3 text-xs last:border-b-0">
                  <span className="truncate font-medium text-foreground">{project.name}</span>
                  <span className="text-muted-foreground">{project.owner}</span>
                  <div className="flex items-center gap-2">
                    <ProgressBar aria-label={`${project.name}进度`} value={project.progress} />
                    <span className="w-8 text-right font-medium text-foreground">{project.progress}%</span>
                  </div>
                  <span className="text-muted-foreground">{project.dueDate}</span>
                  <StatusBadge status={status.status}>{status.label}</StatusBadge>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </GlassCard>
  );
}
