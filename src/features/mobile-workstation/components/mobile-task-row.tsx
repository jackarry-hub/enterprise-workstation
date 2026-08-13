import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { getMobilePriorityMeta, isMobileTaskOverdue } from "@/features/mobile-workstation/mobile-priority";
import type { MobileTaskItem } from "@/features/mobile-workstation/mobile-workstation-types";
import { MobileStatusPill } from "@/features/mobile-workstation/components/mobile-status-pill";
import { cn } from "@/lib/utils";

export function MobileTaskRow({ task, today = "2026-08-13" }: { task: MobileTaskItem; today?: string }) {
  const priority = getMobilePriorityMeta(task.priority, isMobileTaskOverdue(task, today), task.status);
  return (
    <Link data-testid="mobile-task-row" href={task.href} prefetch={false} aria-label={`直接办理：${task.title}`} className="mobile-task-row">
      <span aria-hidden="true" className="mobile-task-row__dot" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-[#16233d]">{task.title}</span>
        <span className="mt-1.5 flex min-w-0 items-center gap-1.5 text-[11px] text-[#7b899f]">
          <span data-testid="mobile-priority" className={cn("mobile-priority-pill", `is-${priority.tone}`)}>{priority.label}</span>
          <MobileStatusPill status={task.status} />
          <span className="truncate">截止 {task.dueDate.slice(5)}</span>
        </span>
      </span>
      <span className="shrink-0 text-sm font-semibold text-[#65758f]">{task.progress}%</span>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-[#718099]" />
    </Link>
  );
}

