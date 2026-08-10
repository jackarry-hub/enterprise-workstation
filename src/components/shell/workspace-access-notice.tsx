"use client";

import { ShieldAlert } from "lucide-react";
import { useSearchParams } from "next/navigation";

const NO_ACCESS_MESSAGE = "你没有权限查看刚才的页面，已返回可访问的工作台。";

export function WorkspaceAccessNotice() {
  const searchParams = useSearchParams();

  if (searchParams?.get("notice") !== "no_access") {
    return null;
  }

  return (
    <div
      className="mx-4 mt-4 flex items-center gap-3 rounded-2xl border border-amber-200/80 bg-amber-50/90 px-4 py-3 text-sm text-amber-950 shadow-sm backdrop-blur lg:mx-6"
      role="status"
    >
      <ShieldAlert aria-hidden="true" className="h-4 w-4 shrink-0 text-amber-600" />
      <span>{NO_ACCESS_MESSAGE}</span>
    </div>
  );
}
