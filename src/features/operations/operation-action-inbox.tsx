"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, CheckCircle2, Clock3, ListTodo } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
import { getOperationActionItems } from "@/features/operations/operations-data";
import type { WorkspaceActor } from "@/features/auth/workspace-session-types";
import type { OperationsState } from "@/features/operations/operations-types";

const priorityMeta = {
  critical: { label: "必须处理", variant: "destructive" as const, icon: AlertTriangle },
  warning: { label: "待处理", variant: "warning" as const, icon: Clock3 },
  normal: { label: "可推进", variant: "info" as const, icon: ListTodo },
};

export function OperationActionInbox({ state, actor, limit = 6 }: { state: OperationsState; actor: WorkspaceActor; limit?: number }) {
  const items = getOperationActionItems(state, actor.id).slice(0, limit);

  return (
    <GlassCard className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="font-semibold">今日必须处理</h2><p className="mt-1 text-xs text-muted-foreground">系统已按逾期、阻塞、验收与审批时限自动排序。</p></div>
        <Badge variant={items.some(({ priority }) => priority === "critical") ? "destructive" : items.length ? "warning" : "success"}>{items.length ? `${items.length} 项行动` : "当前已清零"}</Badge>
      </div>
      {items.length ? <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => {
          const meta = priorityMeta[item.priority];
          const Icon = meta.icon;
          return <article key={item.id} className="min-w-0">
            <Link
              href={item.href}
              aria-label={`处理：${item.title}`}
              className="group flex h-full min-w-0 flex-col rounded-2xl border border-border/70 bg-white/55 p-3.5 outline-none transition hover:border-primary/35 hover:bg-brand-soft/25 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/25"
            >
              <div className="flex items-center justify-between gap-2"><span className="grid size-8 place-items-center rounded-xl bg-brand-soft text-primary"><Icon className="size-4" /></span><Badge variant={meta.variant}>{meta.label}</Badge></div>
              <h3 className="mt-3 truncate text-sm font-semibold">{item.title}</h3>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{item.description}</p>
              <div className="mt-auto flex items-end justify-between gap-2 pt-3">{item.dueAt ? <span className="text-[11px] text-muted-foreground">时限 {item.dueAt.slice(0, 16).replace("T", " ")}</span> : <span />}<span className="inline-flex items-center gap-1 text-xs font-medium text-foreground">处理<ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" /></span></div>
            </Link>
          </article>;
        })}
      </div> : <div className="mt-4 flex items-center gap-3 rounded-2xl bg-success-soft/60 p-4 text-success"><CheckCircle2 className="size-5" /><div><p className="text-sm font-semibold">没有超时或待处理事项</p><p className="mt-0.5 text-xs">系统会在任务解锁、进入验收或发生阻塞时自动加入这里。</p></div></div>}
    </GlassCard>
  );
}
