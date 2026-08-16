"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCircle2, ChevronRight, FolderKanban, LogOut, Settings, WalletCards } from "lucide-react";

import { useCustomerDemoSession, useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { MobileIdentitySheet } from "@/features/mobile-workstation/components/mobile-identity-sheet";
import { DashboardAvatar } from "@/features/dashboard/components/dashboard-avatar";

const entries = [
  { href: "/payroll", label: "我的工资", icon: WalletCards },
  { href: "/projects", label: "我的项目", icon: FolderKanban },
  { href: "/tasks?status=done", label: "我的成果", icon: CheckCircle2 },
  { href: "/notifications", label: "通知", icon: Bell },
  { href: "/settings", label: "设置", icon: Settings },
] as const;

export function MobileProfilePage() {
  const router = useRouter();
  const session = useWorkspaceSession();
  const { actor } = session;
  const demo = useCustomerDemoSession();
  return (
    <main className="mobile-page">
      <header className="mobile-page-header"><div><h1>我的</h1><p>个人工作与账户信息</p></div></header>
      <section className="mobile-profile-card"><DashboardAvatar session={session} className="size-[60px] sm:size-[60px]" /><div><strong className="text-[20px] text-[#14213a]">{actor.name}</strong><p className="mt-1 text-sm text-[#718099]">{actor.department} · {actor.title}</p><span className="mt-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-success"><span className="size-1.5 rounded-full bg-success" />可接受任务</span></div></section>
      <nav aria-label="个人功能" className="mobile-list-surface mt-4">
        {entries.map(({ href, label, icon: Icon }) => <Link key={href} href={href} prefetch={false} aria-label={label} className="mobile-profile-entry"><span className="mobile-profile-entry__icon"><Icon aria-hidden="true" className="size-4.5" /></span><span className="flex-1 font-semibold text-[#21304a]">{label}</span><ChevronRight aria-hidden="true" className="size-4 text-[#8290a6]" /></Link>)}
      </nav>
      <MobileIdentitySheet />
      {demo.enabled ? (
        <button type="button" aria-label="重置演示身份" onClick={() => {
          window.localStorage.removeItem("enterprise-workstation.customer-demo.actor.v1");
          router.push("/dashboard");
        }} className="mobile-logout-button"><LogOut aria-hidden="true" className="size-4" />重置演示身份</button>
      ) : (
        <button type="button" aria-label="退出登录" onClick={() => window.location.assign("/login")} className="mobile-logout-button"><LogOut aria-hidden="true" className="size-4" />退出登录</button>
      )}
    </main>
  );
}
