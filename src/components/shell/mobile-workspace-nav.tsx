"use client";

import Link from "next/link";
import { BriefcaseBusiness, House, MessageCircle, UserRound } from "lucide-react";

import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { cn } from "@/lib/utils";

export function MobileWorkspaceNav({ active = "work" }: { active?: "home" | "work" | "messages" | "profile" }) {
  const { actor } = useWorkspaceSession();
  const workHref = actor.role === "executive" ? "/projects" : actor.role === "department_head" || actor.role === "employee" ? "/tasks" : actor.landingPath;
  const profileHref = actor.role === "hr" || actor.role === "department_head" || actor.role === "executive" ? "/people" : actor.role === "finance" ? "/payroll" : "/leave";
  const items = [
    { href: actor.landingPath, label: "首页", icon: House, value: "home" as const },
    { href: workHref, label: "工作", icon: BriefcaseBusiness, value: "work" as const },
    { href: "/approvals", label: "待办", icon: MessageCircle, value: "messages" as const },
    { href: profileHref, label: "我的", icon: UserRound, value: "profile" as const },
  ];
  return (
    <nav aria-label="移动端导航" className="fixed inset-x-3 bottom-3 z-40 grid grid-cols-4 rounded-3xl border border-glass-border bg-glass px-2 py-2 shadow-[0_18px_45px_rgba(44,84,142,0.16)] backdrop-blur-xl md:hidden">
      {items.map(({ href, label, icon: Icon, value }) => (
        <Link key={value} href={href} prefetch={false} aria-current={active === value ? "page" : undefined} className={cn("flex min-h-12 flex-col items-center justify-center gap-1 rounded-2xl text-xs font-medium", active === value ? "text-primary" : "text-muted-foreground")}>
          <Icon aria-hidden="true" className="size-5" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
