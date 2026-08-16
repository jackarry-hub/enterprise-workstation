import Link from "next/link";
import { CalendarDays, ChevronRight, FolderKanban } from "lucide-react";

import type { ProjectListItem } from "@/features/projects/types";

const statusLabels = {
  planning: "规划中",
  active: "进行中",
  on_hold: "已暂停",
  completed: "已完成",
  cancelled: "已取消",
} as const;

export function MobileProjectCard({ project }: { project: ProjectListItem }) {
  return (
    <Link
      data-testid="mobile-project-card"
      href={`/projects/${project.id}`}
      prefetch={false}
      aria-label={`查看${project.name}详情`}
      className="mobile-project-card"
    >
      <span className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-brand-soft text-primary">
          <FolderKanban aria-hidden="true" className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <strong className="block truncate text-[16px] text-[#16233d]">{project.name}</strong>
            <span className="mobile-status-pill shrink-0">{statusLabels[project.status]}</span>
          </span>
          <span className="mt-1 block truncate text-xs text-[#75849b]">负责人 · {project.owner.displayName}</span>
        </span>
        <ChevronRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-[#718099]" />
      </span>
      <span className="mt-4 flex items-center justify-between text-xs text-[#718099]">
        <span className="flex items-center gap-1"><CalendarDays aria-hidden="true" className="size-3.5" />截止 {project.dueDate.slice(5)}</span>
        <strong className="text-primary">{project.progress}%</strong>
      </span>
      <span role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={project.progress} aria-label={`${project.name}进度`} className="mobile-progress-track"><span style={{ width: `${project.progress}%` }} /></span>
    </Link>
  );
}
