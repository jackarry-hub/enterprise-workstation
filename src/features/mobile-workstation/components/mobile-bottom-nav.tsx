"use client";

import Link from "next/link";
import { CheckSquare2, FolderKanban, House, UserRound, UsersRound } from "lucide-react";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const items = [
  { href: "/dashboard", label: "首页", icon: House },
  { href: "/projects", label: "项目", icon: FolderKanban },
  { href: "/tasks", label: "任务", icon: CheckSquare2 },
  { href: "/people", label: "团队", icon: UsersRound },
  { href: "/me", label: "我的", icon: UserRound },
] as const;

export function MobileBottomNav() {
  const pathname = usePathname() ?? "/dashboard";
  return (
    <nav aria-label="移动端主导航" className="mobile-bottom-nav">
      {items.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link key={href} href={href} prefetch={false} aria-current={active ? "page" : undefined} className={cn("mobile-bottom-nav__item", active && "is-active")}>
            <Icon aria-hidden="true" className="size-5" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
