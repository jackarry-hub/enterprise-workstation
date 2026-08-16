"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";

import { getNavigationItemLabel, navigationItems } from "@/config/navigation";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { cn } from "@/lib/utils";

type AppSidebarProps = {
  className?: string;
  currentPath?: string;
};

export function AppSidebar({
  className,
  currentPath = "/dashboard",
}: AppSidebarProps) {
  const [isProjectOverview, setIsProjectOverview] = useState(false);
  const { actor } = useWorkspaceSession();
  const visibleItems = navigationItems.filter((item) => !item.roles || item.roles.includes(actor.role));

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setIsProjectOverview(currentPath === "/projects" && params.get("view") === "overview");
  }, [currentPath]);

  return (
    <aside
      className={cn(
        "flex h-full w-56 shrink-0 flex-col border-r border-sidebar-border bg-sidebar/90 backdrop-blur-xl",
        className,
      )}
    >
      <div className="flex h-18 items-center gap-3 px-7">
        <Image
          src="/brand/quantxy-mark.png"
          alt="量子星河 QuantXY"
          width={573}
          height={381}
          priority
          className="h-10 w-14 shrink-0 object-contain"
        />
        <div className="min-w-0">
          <p className="text-lg font-semibold tracking-tight text-foreground">
            量子智枢
          </p>
          <p className="text-[10px] font-medium tracking-[0.12em] text-muted-foreground">QuantNexus</p>
        </div>
      </div>

      <nav aria-label="主导航" className="flex flex-1 flex-col gap-1 px-4 py-4">
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const label = getNavigationItemLabel(item, actor.role);
          const isCurrent = currentPath === item.href || currentPath.startsWith(`${item.href}/`);
          const itemClassName = cn(
            "flex h-11 items-center gap-3 rounded-xl px-4 text-sm font-medium transition-colors [&>svg]:size-5",
            isCurrent
              ? "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_rgba(47,125,246,0.08)]"
              : "text-muted-foreground hover:bg-sidebar-accent/60 hover:text-foreground",
          );

          if (item.available) {
            return (
              <div key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isCurrent ? "page" : undefined}
                  className={itemClassName}
                >
                  <Icon aria-hidden="true" />
                  <span>{label}</span>
                  {isCurrent ? (
                    item.href === "/projects" ? <ChevronDown aria-hidden="true" className="ml-auto" /> : <ArrowRight aria-hidden="true" className="ml-auto" />
                  ) : null}
                </Link>
                {isCurrent && item.href === "/projects" ? (
                  <div className="mt-1 ml-8 flex flex-col gap-1 border-l border-sidebar-border pl-3 text-xs">
                    <Link
                      href="/projects?view=overview#project-overview"
                      aria-current={isProjectOverview ? "location" : undefined}
                      onClick={() => setIsProjectOverview(true)}
                      className={cn(
                        "rounded-lg px-3 py-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        isProjectOverview
                          ? "bg-primary font-medium text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground",
                      )}
                    >
                      项目总览
                    </Link>
                    <span className={cn(
                      "rounded-lg px-3 py-2",
                      isProjectOverview && currentPath === "/projects"
                        ? "text-muted-foreground"
                        : "bg-primary font-medium text-primary-foreground shadow-sm",
                    )}>
                      {currentPath === "/projects" ? "项目管理中心" : "项目详情"}
                    </span>
                  </div>
                ) : null}
              </div>
            );
          }

          return (
            <span
              key={item.href}
              aria-disabled="true"
              className={itemClassName}
              title="即将开放"
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </span>
          );
        })}
      </nav>

      <div className="m-4 rounded-2xl border border-sidebar-border bg-linear-to-br from-brand-soft to-background p-4">
        <p className="text-sm font-semibold text-foreground">{actor.roleLabel}工作空间</p>
        <p className="mt-1 text-xs text-muted-foreground">{actor.department} · {actor.name}</p>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-background">
          <div className="h-full w-3/4 rounded-full bg-linear-to-r from-primary to-chart-2" />
        </div>
      </div>
    </aside>
  );
}
