"use client";

import { usePathname } from "next/navigation";

import { AppSidebar } from "@/components/shell/app-sidebar";

type WorkspaceSidebarProps = {
  className?: string;
};

export function WorkspaceSidebar({ className }: WorkspaceSidebarProps) {
  const pathname = usePathname();

  return <AppSidebar className={className} currentPath={pathname ?? "/dashboard"} />;
}
