"use client";

import Link from "next/link";
import { CalendarCheck2, ChevronRight, FileText, LogOut, Settings, WalletCards } from "lucide-react";

import { useCustomerDemoSession, useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { MobileIdentitySheet } from "@/features/mobile-workstation/components/mobile-identity-sheet";

const entries = [
  { href: "/attendance?view=self", label: "我的考勤", icon: CalendarCheck2 },
  { href: "/payroll", label: "我的工资", icon: WalletCards },
  { href: "/execution", label: "我的日报", icon: FileText },
  { href: "/settings", label: "设置", icon: Settings },
] as const;

export function MobileProfilePage() {
  const { actor } = useWorkspaceSession();
  const demo = useCustomerDemoSession();
  return (
    <main className="mobile-page">
      <header className="mobile-page-header"><div><h1>我的</h1><p>个人工作与账户信息</p></div></header>
      <section className="mobile-profile-card"><span className="mobile-profile-avatar">{actor.name.slice(0, 1)}</span><div><strong className="text-[20px] text-[#14213a]">{actor.name}</strong><p className="mt-1 text-sm text-[#718099]">{actor.department} · {actor.title}</p></div></section>
      <nav aria-label="个人功能" className="mobile-list-surface mt-4">
        {entries.map(({ href, label, icon: Icon }) => <Link key={href} href={href} prefetch={false} aria-label={label} className="mobile-profile-entry"><span className="mobile-profile-entry__icon"><Icon aria-hidden="true" className="size-4.5" /></span><span className="flex-1 font-semibold text-[#21304a]">{label}</span><ChevronRight aria-hidden="true" className="size-4 text-[#8290a6]" /></Link>)}
      </nav>
      <MobileIdentitySheet />
      {demo.enabled ? (
        <button type="button" aria-label="重置演示身份" onClick={() => {
          window.localStorage.removeItem("enterprise-workstation.customer-demo.actor.v1");
          window.location.assign("/dashboard");
        }} className="mobile-logout-button"><LogOut aria-hidden="true" className="size-4" />重置演示身份</button>
      ) : (
        <button type="button" aria-label="退出登录" onClick={() => window.location.assign("/login")} className="mobile-logout-button"><LogOut aria-hidden="true" className="size-4" />退出登录</button>
      )}
    </main>
  );
}
