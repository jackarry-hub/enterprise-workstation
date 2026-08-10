"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, BellRing, CheckCheck, ChevronRight, CircleDot, Clock3 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { getOperationNotifications, markAllOperationNotificationsRead, markOperationNotificationRead } from "@/features/operations/operations-data";
import { useOperations } from "@/features/operations/use-operations";

const severityMeta = {
  critical: { label: "紧急", variant: "destructive" as const, icon: AlertTriangle },
  warning: { label: "待处理", variant: "warning" as const, icon: Clock3 },
  info: { label: "动态", variant: "info" as const, icon: BellRing },
};

const categoryLabel = { task: "任务", approval: "审批", collaboration: "协同", system: "动态" } as const;

function displayTime(value: string) {
  return value.slice(0, 16).replace("T", " ");
}

export function NotificationCenter() {
  const session = useWorkspaceSession();
  const { state, context, actor } = useOperations(session);
  const [filter, setFilter] = useState<"all" | "unread">("unread");
  const notifications = getOperationNotifications(state, actor.id);
  const unread = notifications.filter((item) => !item.read);
  const visible = filter === "unread" ? unread : notifications;

  return (
    <main className="mx-auto flex w-full max-w-330 flex-col gap-3 px-3 pt-4 pb-26 sm:px-4 lg:px-5 lg:pt-6 lg:pb-8">
      <GlassCard className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div><div className="flex items-center gap-2"><BellRing className="size-5 text-primary" /><h1 className="text-2xl font-semibold tracking-tight">通知中心</h1></div><p className="mt-1.5 text-sm text-muted-foreground">只显示与{actor.name}当前职责相关的任务、审批、协同和执行动态。</p></div>
          <Button type="button" variant="outline" disabled={!unread.length} onClick={() => markAllOperationNotificationsRead(context, actor.id)}><CheckCheck />全部标为已读</Button>
        </div>
        <div className="mt-5 flex items-center gap-2" role="tablist" aria-label="通知筛选"><Button type="button" size="sm" variant={filter === "unread" ? "default" : "outline"} role="tab" aria-selected={filter === "unread"} onClick={() => setFilter("unread")}>未读 {unread.length}</Button><Button type="button" size="sm" variant={filter === "all" ? "default" : "outline"} role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>全部 {notifications.length}</Button></div>
      </GlassCard>

      <GlassCard className="p-3 sm:p-4">
        {visible.length ? <div className="grid gap-2">{visible.map((item) => {
          const meta = severityMeta[item.severity];
          const Icon = meta.icon;
          return <article key={item.id} className={`rounded-2xl border p-4 ${item.read ? "border-border/60 bg-white/35" : "border-primary/20 bg-white/75"}`}>
            <div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-primary"><Icon className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">{item.title}</h2>{!item.read ? <CircleDot className="size-3.5 text-primary" /> : null}<Badge variant={meta.variant}>{meta.label}</Badge><Badge variant="outline">{categoryLabel[item.category]}</Badge></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</p><p className="mt-2 text-[11px] text-muted-foreground">{displayTime(item.createdAt)}</p></div><div className="flex shrink-0 items-center gap-1">{!item.read ? <Button type="button" size="sm" variant="ghost" onClick={() => markOperationNotificationRead(context, item.id, actor.id)}>已读</Button> : null}<Button asChild size="sm" variant="ghost"><Link href={item.href} onClick={() => markOperationNotificationRead(context, item.id, actor.id)}>处理<ChevronRight /></Link></Button></div></div>
          </article>;
        })}</div> : <div className="grid min-h-56 place-items-center text-center"><div><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-success-soft text-success"><CheckCheck /></span><h2 className="mt-3 font-semibold">{filter === "unread" ? "未读通知已清零" : "当前没有通知"}</h2><p className="mt-1 text-sm text-muted-foreground">新的任务、审批或风险出现后会自动进入这里。</p></div></div>}
      </GlassCard>
    </main>
  );
}
