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

export function OperationActionInbox({ state, actor, limit = 4 }: { state: OperationsState; actor: WorkspaceActor; limit?: number }) {
  const items = getOperationActionItems(state, actor.id).slice(0, limit);

  return (
    <GlassCard className="p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="font-semibold">今日必须处理</h2><p className="mt-1 text-xs text-muted-foreground">系统已按逾期、阻塞、验收与审批时限自动排序。</p></div>
        <Badge variant={items.some(({ priority }) => priority === "critical") ? "destructive" : items.length ? "warning" : "success"}>{items.length ? `${items.length} 项行动` : "当前已清零"}</Badge>
      </div>
      {items.length ? <div className="mt-3 overflow-hidden rounded-2xl border border-border/70 bg-white/65" role="list" aria-label="岗位行动列表">
        {items.map((item) => {
          const meta = priorityMeta[item.priority];
          const Icon = meta.icon;
          return <article key={item.id} role="listitem" data-testid="operation-action-item" className={`operation-action-item operation-action-item--${item.priority}`}>
            <Link
              href={item.href}
              aria-label={`处理：${item.title}`}
              className="group grid min-h-18 min-w-0 grid-cols-[auto_1fr_auto] items-center gap-3 px-3.5 py-3 outline-none transition hover:bg-brand-soft/25 focus-visible:bg-brand-soft/30 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/25"
            >
              <span className="grid size-9 place-items-center rounded-xl bg-brand-soft text-primary"><Icon className="size-4" /></span>
              <span className="min-w-0">
                <span className="flex min-w-0 items-center gap-2"><Badge variant={meta.variant}>{meta.label}</Badge><h3 className="truncate text-sm font-semibold">{item.title}</h3></span>
                <span className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground"><span className="truncate">{item.description}</span>{item.dueAt ? <span className="shrink-0">{item.dueAt.slice(5, 10)}</span> : null}</span>
              </span>
              <span className="inline-flex items-center gap-1 text-xs font-medium text-primary"><span className="hidden sm:inline">处理</span><ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" /></span>
            </Link>
          </article>;
        })}
      </div> : <div className="mt-4 flex items-center gap-3 rounded-2xl bg-success-soft/60 p-4 text-success"><CheckCircle2 className="size-5" /><div><p className="text-sm font-semibold">没有超时或待处理事项</p><p className="mt-0.5 text-xs">系统会在任务解锁、进入验收或发生阻塞时自动加入这里。</p></div></div>}
    </GlassCard>
  );
}
