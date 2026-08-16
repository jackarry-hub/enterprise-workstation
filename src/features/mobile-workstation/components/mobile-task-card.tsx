import Link from "next/link";
import { CalendarDays, ChevronRight, UserRound } from "lucide-react";

import { getMobilePriorityMeta, isMobileTaskOverdue } from "@/features/mobile-workstation/mobile-priority";
import type { MobileTaskItem } from "@/features/mobile-workstation/mobile-workstation-types";
import { MobileStatusPill } from "@/features/mobile-workstation/components/mobile-status-pill";
import { cn } from "@/lib/utils";

export function MobileTaskCard({ task, today = "2026-08-14" }: { task: MobileTaskItem; today?: string }) {
  const priority = getMobilePriorityMeta(task.priority, isMobileTaskOverdue(task, today), task.status);
  return (
    <Link data-testid="mobile-task-card" href={task.href} prefetch={false} aria-label={`直接办理：${task.title}`} className="mobile-task-card">
      <span className="flex items-start justify-between gap-3">
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span data-testid="mobile-priority" className={cn("mobile-priority-pill", `is-${priority.tone}`)}>{priority.label}</span>
            <MobileStatusPill status={task.status} />
          </span>
          <strong className="mt-2 block text-[16px] leading-6 text-[#16233d]">{task.title}</strong>
        </span>
        <ChevronRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-[#718099]" />
      </span>
      <span className="mt-3 flex items-center justify-between gap-3 text-xs text-[#718099]">
        <span className="flex min-w-0 items-center gap-1"><UserRound aria-hidden="true" className="size-3.5" /><span className="truncate">{task.assigneeName}</span></span>
        <span className="flex shrink-0 items-center gap-1"><CalendarDays aria-hidden="true" className="size-3.5" />截止 {task.dueDate.slice(5)}</span>
      </span>
      <span className="mt-3 flex items-center gap-2">
        <span role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={task.progress} aria-label={`${task.title}进度`} className="mobile-progress-track mt-0 flex-1"><span style={{ width: `${task.progress}%` }} /></span>
        <strong className="w-9 text-right text-xs text-primary">{task.progress}%</strong>
      </span>
    </Link>
  );
}
