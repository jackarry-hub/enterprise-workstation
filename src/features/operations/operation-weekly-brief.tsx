"use client";

import Link from "next/link";
import { useState } from "react";
import { AlertTriangle, ArrowRight, Check, ClipboardCopy, FileText, Target } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { getOperationWeeklySummary } from "@/features/operations/operations-data";
import type { WorkspaceActor } from "@/features/auth/workspace-session-types";
import type { OperationsState } from "@/features/operations/operations-types";

function summaryText(summary: ReturnType<typeof getOperationWeeklySummary>) {
  return [
    `【${summary.scopeLabel}周度执行摘要】${summary.periodLabel}`,
    summary.narrative,
    `需决策：${summary.decisions.length ? summary.decisions.join("；") : "暂无"}`,
    `下周重点：${summary.nextFocus.length ? summary.nextFocus.join("；") : "按既定计划推进"}`,
  ].join("\n");
}

export function OperationWeeklyBrief({ state, actor }: { state: OperationsState; actor: WorkspaceActor }) {
  const summary = getOperationWeeklySummary(state, actor.id);
  const [copied, setCopied] = useState(false);

  async function copyBrief() {
    await navigator.clipboard.writeText(summaryText(summary));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  const metrics = [
    { label: "任务完成", value: `${summary.completed}/${summary.total}` },
    { label: "推进中", value: summary.inProgress },
    { label: "待验收", value: summary.reviewing },
    { label: "阻塞/逾期", value: summary.blocked + summary.overdue },
    { label: "依赖风险", value: summary.dependencyRisks },
    { label: "待审批", value: summary.pendingApprovals },
  ];

  return (
    <GlassCard className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-border/70 bg-white/50 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <div className="flex flex-wrap items-center gap-2"><FileText className="size-4 text-primary" /><h2 className="font-semibold">本周执行摘要</h2><Badge variant="outline">{summary.periodLabel}</Badge></div>
          <p className="mt-1 text-xs text-muted-foreground">系统根据真实任务、审批、协同和时限状态自动汇总。</p>
        </div>
        <div className="flex gap-2"><Button type="button" size="sm" variant="outline" onClick={copyBrief}>{copied ? <Check /> : <ClipboardCopy />}{copied ? "已复制" : "复制周报"}</Button><Button asChild size="sm" variant="ghost"><Link href="/analytics">查看分析<ArrowRight /></Link></Button></div>
      </div>
      <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-[0.85fr_1.15fr]">
        <div>
          <div className="flex items-end justify-between gap-3"><div><p className="text-3xl font-semibold">{summary.completionRate}%</p><p className="mt-1 text-xs text-muted-foreground">{summary.scopeLabel}完成率</p></div><Badge variant={summary.decisions.length ? "destructive" : "success"}>{summary.decisions.length ? `${summary.decisions.length} 项需决策` : "风险可控"}</Badge></div>
          <ProgressBar value={summary.completionRate} className="mt-3 h-2" />
          <p className="mt-4 rounded-xl bg-muted/55 p-3 text-xs leading-5 text-muted-foreground">{summary.narrative}</p>
          <div className="mt-3 grid grid-cols-3 gap-2">{metrics.map((item) => <div key={item.label} className="rounded-xl border border-border/70 bg-white/55 p-2.5"><p className="text-lg font-semibold">{item.value}</p><p className="text-[11px] text-muted-foreground">{item.label}</p></div>)}</div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <section className="rounded-2xl border border-destructive/20 bg-destructive/5 p-4"><div className="flex items-center gap-2 text-destructive"><AlertTriangle className="size-4" /><h3 className="text-sm font-semibold">需要决策</h3></div>{summary.decisions.length ? <ul className="mt-3 grid gap-2">{summary.decisions.map((item) => <li key={item} className="text-xs leading-5 text-foreground">• {item}</li>)}</ul> : <p className="mt-3 text-xs text-muted-foreground">本周没有需要升级到当前角色的事项。</p>}</section>
          <section className="rounded-2xl border border-primary/20 bg-brand-soft/45 p-4"><div className="flex items-center gap-2 text-primary"><Target className="size-4" /><h3 className="text-sm font-semibold">下一步重点</h3></div>{summary.nextFocus.length ? <ul className="mt-3 grid gap-2">{summary.nextFocus.map((item) => <li key={item} className="text-xs leading-5 text-foreground">• {item}</li>)}</ul> : <p className="mt-3 text-xs text-muted-foreground">当前没有额外待办，按计划继续推进。</p>}</section>
        </div>
      </div>
    </GlassCard>
  );
}
