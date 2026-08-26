"use client";

import { AlertTriangle, CheckCircle2, RefreshCw } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import type {
  FeishuSyncEventSummary,
  FeishuSyncIssue,
  FeishuSyncRunSummary,
} from "@/features/feishu/sync-issues-data";

function label(entityType: FeishuSyncIssue["entityType"]) {
  return entityType === "user" ? "员工" : entityType === "department" ? "部门" : "目录";
}

export function FeishuSyncIssuesPanel({
  issues,
  runs = [],
  events = [],
  unavailable = false,
  onResolved = () => window.location.reload(),
}: {
  issues: readonly FeishuSyncIssue[];
  runs?: readonly FeishuSyncRunSummary[];
  events?: readonly FeishuSyncEventSummary[];
  unavailable?: boolean;
  onResolved?: () => void;
}) {
  const [active, setActive] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(new Set<string>());

  async function reconcile() {
    if (inFlight.current.has("reconcile")) return;
    inFlight.current.add("reconcile");
    setActive("reconcile");
    setError(null);
    try {
      const response = await fetch("/api/workstation/directory-sync", { method: "POST" });
      if (!response.ok) throw new Error("reconcile_failed");
      onResolved();
    } catch {
      setError("重新对账未完成，请稍后重试。");
    } finally {
      inFlight.current.delete("reconcile");
      setActive(null);
    }
  }

  async function resolve(issueId: string) {
    if (inFlight.current.has(issueId)) return;
    inFlight.current.add(issueId);
    setActive(issueId);
    setError(null);
    try {
      const response = await fetch(`/api/workstation/feishu/sync-issues/${issueId}/resolve`, { method: "POST" });
      if (!response.ok) throw new Error("resolve_failed");
      onResolved();
    } catch {
      setError("处理未完成，请刷新后重试。同步源字段不会被本地覆盖。");
    } finally {
      inFlight.current.delete(issueId);
      setActive(null);
    }
  }

  return (
    <section aria-label="飞书同步问题" className="grid gap-3">
      <div className="flex flex-col gap-3 rounded-2xl border bg-card p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="font-semibold">同步运行与事件</h2><p className="text-sm text-muted-foreground">最近 {runs.length} 次运行 · {events.length} 条已验签事件</p></div>
        <Button type="button" variant="outline" className="h-11 w-full rounded-xl sm:w-auto" disabled={active === "reconcile"} onClick={reconcile}>
          <RefreshCw data-icon="inline-start" aria-hidden="true" className={active === "reconcile" ? "animate-spin" : undefined} />立即重新对账
        </Button>
      </div>
      {(runs.length > 0 || events.length > 0) ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border bg-card p-4"><h3 className="font-medium">最近运行</h3><div className="mt-3 grid gap-2">{runs.map((run) => <div key={run.id} className="flex min-h-11 items-center justify-between rounded-xl bg-muted/50 px-3 text-sm"><span>{new Date(run.startedAt).toLocaleString("zh-CN")}</span><span className="font-medium">{run.status === "completed" ? "完成" : run.status === "failed" ? "失败" : "运行中"}</span></div>)}</div></div>
          <div className="rounded-2xl border bg-card p-4"><h3 className="font-medium">最近事件</h3><div className="mt-3 grid gap-2">{events.map((event) => <div key={event.id} className="min-h-11 rounded-xl bg-muted/50 px-3 py-2 text-sm"><p className="break-all font-medium">{event.eventType}</p><p className="text-xs text-muted-foreground">{label(event.entityType)} · {event.disposition === "reconcile" ? "需要对账" : "已接收"}</p></div>)}</div></div>
        </div>
      ) : null}
      {error ? <p role="status" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p> : null}
      {unavailable ? (
        <div role="status" className="flex flex-col gap-3 rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-950 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3"><AlertTriangle aria-hidden="true" /><div><h2 className="font-semibold">同步问题暂时无法读取</h2><p className="text-sm">服务器存储不可用，未把未知状态显示为空。</p></div></div>
          <Button type="button" variant="outline" className="h-11 w-full rounded-xl sm:w-auto" onClick={() => window.location.reload()}>重试读取</Button>
        </div>
      ) : null}
      {!unavailable && issues.length === 0 ? <div className="flex items-center gap-3 rounded-2xl border bg-card p-6 shadow-sm"><CheckCircle2 className="text-emerald-600" aria-hidden="true" /><div><h2 className="font-semibold">当前没有待处理问题</h2><p className="text-sm text-muted-foreground">目录运行、事件游标与差异记录均来自服务器。</p></div></div> : null}
      {issues.map((issue) => (
        <article key={issue.id} className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-amber-50 text-amber-700"><AlertTriangle aria-hidden="true" /></span>
              <div className="min-w-0"><h2 className="break-all font-semibold">{issue.code}</h2><p className="text-sm text-muted-foreground">{label(issue.entityType)} · {new Date(issue.createdAt).toLocaleString("zh-CN")}</p><p className="mt-1 text-xs text-muted-foreground">需要重新对账；飞书归属字段保持只读。</p></div>
            </div>
            <Button type="button" variant="outline" className="h-11 w-full rounded-xl sm:w-auto" disabled={active === issue.id} onClick={() => resolve(issue.id)}>
              <RefreshCw data-icon="inline-start" aria-hidden="true" className={active === issue.id ? "animate-spin" : undefined} />
              {active === issue.id ? "处理中…" : "标记已处理"}
            </Button>
          </div>
        </article>
      ))}
    </section>
  );
}
