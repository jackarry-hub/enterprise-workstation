import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { DashboardAvatar } from "@/features/dashboard/components/dashboard-avatar";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import type { EmployeeDirectoryItem } from "@/features/hr/employee-types";

export function MobileMemberRow({
  employee,
  session,
  status,
  activeTaskCount,
}: {
  employee: EmployeeDirectoryItem;
  session?: WorkspaceSession;
  status: "可接受任务" | "执行中" | "满负荷" | "暂不可用";
  activeTaskCount: number;
}) {
  const { profile, department } = employee;
  return (
    <Link data-testid="mobile-member-row" href={`/people/${profile.id}`} prefetch={false} className="mobile-member-row">
      {session ? <DashboardAvatar session={session} className="size-11 sm:size-11" /> : <span className="mobile-member-row__avatar">{profile.displayName.slice(0, 1)}</span>}
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <strong className="truncate text-[15px] text-[#17243d]">{profile.displayName}</strong>
          <span className="ml-auto flex shrink-0 items-center gap-1 text-[11px] text-success"><span className="size-1.5 rounded-full bg-success" />{status}</span>
        </span>
        <span className="mt-1 block truncate text-xs text-[#74839a]">{profile.jobTitle} · {department?.name ?? "未分配部门"}</span>
        <span className="mt-1 block text-[11px] text-[#8a97aa]">{activeTaskCount ? `${activeTaskCount} 项任务进行中` : "当前没有进行中任务"}</span>
      </span>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-[#8794a8]" />
    </Link>
  );
}
