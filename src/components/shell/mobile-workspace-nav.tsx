"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BriefcaseBusiness, House, MessageCircle, UserRound } from "lucide-react";

import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { getCommercialModuleForPath, getModuleCapabilities } from "@/features/commercial/module-capabilities";
import { cn } from "@/lib/utils";

export function MobileWorkspaceNav({ active }: { active?: "home" | "work" | "messages" | "profile" }) {
  const session = useWorkspaceSession();
  const pathname = usePathname();
  const { actor } = session;
  const capabilities = getModuleCapabilities(session);
  const landingModule = getCommercialModuleForPath(actor.landingPath);
  const fallbackHref = landingModule && capabilities[landingModule] ? actor.landingPath : capabilities.assistant ? "/assistant" : "/help";
  const workHref = capabilities.projects ? "/projects" : capabilities.tasks ? "/tasks" : capabilities.agents ? "/agents" : fallbackHref;
  const profileHref = capabilities.settings ? "/settings?tab=personal" : capabilities.people ? "/people" : fallbackHref;
  const items = [
    { href: fallbackHref, label: "首页", icon: House, value: "home" as const },
    { href: workHref, label: "工作", icon: BriefcaseBusiness, value: "work" as const },
    { href: capabilities.notifications ? "/notifications" : capabilities.approvals ? "/approvals" : fallbackHref, label: "通知", icon: MessageCircle, value: "messages" as const },
    { href: profileHref, label: "我的", icon: UserRound, value: "profile" as const },
  ];
  const activeValue = active ?? items.find(({ href }) => pathname.startsWith(href.split("?")[0]))?.value;
  return (
    <nav aria-label="移动端导航" data-testid="mobile-primary-nav" className="fixed inset-x-3 bottom-[calc(.75rem+env(safe-area-inset-bottom))] z-40 grid grid-cols-4 rounded-3xl border border-glass-border bg-glass px-2 py-2 shadow-[0_18px_45px_rgba(44,84,142,0.16)] backdrop-blur-xl md:hidden">
      {items.map(({ href, label, icon: Icon, value }) => (
        <Link key={value} href={href} prefetch={false} aria-current={activeValue === value ? "page" : undefined} className={cn("flex min-h-12 flex-col items-center justify-center gap-1 rounded-2xl text-xs font-medium", activeValue === value ? "text-primary" : "text-muted-foreground")}>
          <Icon aria-hidden="true" className="size-5" />
          {label}
        </Link>
      ))}
    </nav>
  );
}
