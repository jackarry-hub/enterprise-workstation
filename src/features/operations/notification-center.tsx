"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { AlertCircle, AlertTriangle, BellRing, CheckCheck, ChevronRight, CircleDot, Clock3, LoaderCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { getCommercialModuleForPath, getModuleCapabilities } from "@/features/commercial/module-capabilities";
import { getOperationNotifications, markAllOperationNotificationsRead, markOperationNotificationRead } from "@/features/operations/operations-data";
import { markBusinessNotificationRead, retryBusinessNotification, type NotificationInboxItem, type NotificationInboxResult } from "@/features/operations/notification-data";
import { useOperations } from "@/features/operations/use-operations";

const eventLabels: Record<string, { title: string; description: string }> = {
  "task.assigned": { title: "收到新任务", description: "任务已分配给你，请确认范围与截止时间。" },
  "task.submitted": { title: "任务待验收", description: "执行人已提交交付结果，等待你验收。" },
  "task.review_passed": { title: "任务已通过验收", description: "负责人已确认交付结果符合验收标准。" },
  "task.review_rejected": { title: "任务被退回修改", description: "验收未通过，请查看意见并重新提交。" },
  "task.reopened": { title: "任务已重新打开", description: "已完成任务被重新打开，请查看最新要求。" },
  "approval.submitted": { title: "审批待处理", description: "有新的审批进入你的处理队列。" },
  "approval.approved": { title: "审批已通过", description: "你发起的审批已经通过。" },
  "approval.rejected": { title: "审批被驳回", description: "你发起的审批需要修改后重新提交。" },
  "expense.approved": { title: "费用已批准", description: "费用申请已通过审核。" },
  "expense.rejected": { title: "费用被驳回", description: "费用申请未通过，请查看处理意见。" },
  "expense.paid": { title: "费用已支付", description: "费用款项已完成支付。" },
  "customer.opportunity_updated": { title: "商机状态更新", description: "你负责的客户商机状态发生变化。" },
  "knowledge.processing_completed": { title: "知识处理完成", description: "知识文档已完成安全处理并可使用。" },
  "knowledge.processing_failed": { title: "知识处理失败", description: "知识文档处理失败，请进入知识库查看。" },
  "agent.run_completed": { title: "Agent 运行完成", description: "Agent 已完成本次运行。" },
  "agent.run_failed": { title: "Agent 运行失败", description: "Agent 运行失败，请查看执行记录。" },
};

const stateLabels = {
  pending: { label: "待投递", variant: "warning" as const },
  sending: { label: "投递中", variant: "info" as const },
  sent: { label: "未读", variant: "warning" as const },
  failed: { label: "投递失败", variant: "destructive" as const },
  read: { label: "已读", variant: "success" as const },
};

function displayTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(value));
}

export function NotificationCenter({ result }: { result: NotificationInboxResult }) {
  const session = useWorkspaceSession();
  const { state, context, actor } = useOperations(session);
  const capabilities = getModuleCapabilities(session);
  const [filter, setFilter] = useState<"all" | "unread">("unread");
  const [formalItems, setFormalItems] = useState<readonly NotificationInboxItem[]>(result.items);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const retryAttemptRef = useRef<Map<string, { signature: string; key: string }>>(new Map());

  const mockNotifications = getOperationNotifications(state, actor.id).filter((item) => {
    const commercialModule = getCommercialModuleForPath(item.href);
    return commercialModule === null || capabilities[commercialModule];
  });
  const isFormal = result.source === "supabase" || result.source === "unavailable";
  const formalUnread = formalItems.filter(({ status, readAt }) => status !== "read" && !readAt);
  const mockUnread = mockNotifications.filter((item) => !item.read);
  const visibleFormal = filter === "unread" ? formalUnread : formalItems;
  const visibleMock = filter === "unread" ? mockUnread : mockNotifications;
  const unreadCount = isFormal ? formalUnread.length : mockUnread.length;

  async function markFormalRead(item: NotificationInboxItem) {
    if ((item.status !== "sent" && item.status !== "failed") || busyId) return;
    try {
      setBusyId(item.id);
      setFeedback(null);
      const { readAt, version } = await markBusinessNotificationRead(item.id, crypto.randomUUID());
      setFormalItems((current) => current.map((entry) => entry.id === item.id
        ? { ...entry, status: item.status === "failed" ? "failed" : "read", readAt, version } : entry));
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "标记已读失败，请稍后重试");
    } finally {
      setBusyId(null);
    }
  }

  async function markAllFormalRead() {
    for (const item of formalItems.filter(({ status, readAt }) => !readAt && (status === "sent" || status === "failed"))) {
      await markFormalRead(item);
    }
  }

  async function retryFormal(item: NotificationInboxItem) {
    if (busyId) return;
    try {
      setBusyId(item.id); setFeedback(null);
      const signature = `${item.id}:${item.version}`;
      const existing = retryAttemptRef.current.get(item.id);
      if (!existing || existing.signature !== signature) {
        retryAttemptRef.current.set(item.id, { signature, key: crypto.randomUUID() });
      }
      const retry = await retryBusinessNotification(
        item.id,
        item.version,
        retryAttemptRef.current.get(item.id)!.key,
      );
      retryAttemptRef.current.delete(item.id);
      setFormalItems((current) => current.map((entry) => entry.id === item.id
        ? { ...entry, status: retry.state, version: retry.version, readAt: undefined } : entry));
    } catch (error) { setFeedback(error instanceof Error ? error.message : "通知重试失败"); }
    finally { setBusyId(null); }
  }

  return (
    <main className="mx-auto flex w-full max-w-330 flex-col gap-3 px-3 pt-4 pb-26 sm:px-4 lg:px-5 lg:pt-6 lg:pb-8">
      <GlassCard className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="flex items-center gap-2"><BellRing className="size-5 text-primary" /><h1 className="text-2xl font-semibold tracking-tight">通知中心</h1></div>
            <p className="mt-1.5 text-sm text-muted-foreground">{isFormal ? "按当前企业身份展示真实任务通知与投递状态。" : `只显示与${actor.name}当前职责相关的执行动态。`}</p>
          </div>
          <Button type="button" variant="outline" disabled={busyId !== null || (isFormal ? !formalItems.some(({ status, readAt }) => !readAt && (status === "sent" || status === "failed")) : !mockUnread.length)} onClick={() => isFormal ? void markAllFormalRead() : markAllOperationNotificationsRead(context, actor.id)}>{busyId ? <LoaderCircle className="animate-spin" /> : <CheckCheck />}全部标为已读</Button>
        </div>
        <div className="mt-5 flex items-center gap-2" role="tablist" aria-label="通知筛选">
          <Button type="button" size="sm" variant={filter === "unread" ? "default" : "outline"} role="tab" aria-selected={filter === "unread"} onClick={() => setFilter("unread")}>未读 {unreadCount}</Button>
          <Button type="button" size="sm" variant={filter === "all" ? "default" : "outline"} role="tab" aria-selected={filter === "all"} onClick={() => setFilter("all")}>全部 {isFormal ? formalItems.length : mockNotifications.length}</Button>
        </div>
        {feedback ? <p role="alert" className="mt-3 flex items-center gap-1.5 text-xs font-medium text-destructive"><AlertCircle className="size-4" />{feedback}</p> : null}
      </GlassCard>

      <GlassCard className="p-3 sm:p-4">
        {result.source === "unavailable" ? (
          <div className="grid min-h-56 place-items-center text-center"><div><AlertTriangle className="mx-auto size-8 text-destructive" /><h2 className="mt-3 font-semibold">通知服务暂不可用</h2><p className="mt-1 text-sm text-muted-foreground">{result.error}</p></div></div>
        ) : isFormal && visibleFormal.length ? (
          <div className="grid gap-2">{visibleFormal.map((item) => {
            const meta = eventLabels[item.eventType] ?? { title: item.title, description: item.summary };
            const stateMeta = stateLabels[item.status];
            return (
              <article key={item.id} className={`rounded-2xl border p-4 ${item.readAt || item.status === "read" ? "border-border/60 bg-white/35" : "border-primary/20 bg-white/75"}`}>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-primary">{item.status === "sending" ? <LoaderCircle className="size-4 animate-spin" /> : <BellRing className="size-4" />}</span>
                  <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">{meta.title}{item.title && item.title !== meta.title ? ` · ${item.title}` : ""}</h2>{!item.readAt && item.status !== "read" ? <CircleDot className="size-3.5 text-primary" /> : null}<Badge variant={stateMeta.variant}>{stateMeta.label}</Badge>{item.status === "failed" && item.readAt ? <Badge variant="outline">已确认</Badge> : null}<Badge variant="outline">{item.category.toUpperCase()}</Badge></div><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.summary || meta.description}</p><p className="mt-2 text-[11px] text-muted-foreground">{displayTime(item.createdAt)}{item.nextRetryAt ? ` · 建议重试 ${displayTime(item.nextRetryAt)}` : ""}</p>{item.status === "failed" ? <p className="mt-1 text-xs text-destructive">{item.canRetry ? "投递失败，可在此安全重试。" : "投递失败，请联系业务管理员处理。"}</p> : null}</div>
                  <div className="grid shrink-0 grid-cols-2 gap-1 sm:flex sm:items-center">{item.category === "task" && item.status === "failed" && item.canRetry ? <Button type="button" size="sm" variant="outline" disabled={busyId !== null} onClick={() => void retryFormal(item)}>重试</Button> : null}{!item.readAt && (item.status === "sent" || item.status === "failed") ? <Button type="button" size="sm" variant="ghost" disabled={busyId !== null} onClick={() => void markFormalRead(item)}>{item.status === "failed" ? "确认" : "已读"}</Button> : null}<Button asChild size="sm" variant="ghost"><Link href={item.targetPath} onClick={() => { if (item.status === "sent" && !item.readAt) void markFormalRead(item); }}>处理<ChevronRight /></Link></Button></div>
                </div>
              </article>
            );
          })}</div>
        ) : !isFormal && visibleMock.length ? (
          <div className="grid gap-2">{visibleMock.map((item) => (
            <article key={item.id} className={`rounded-2xl border p-4 ${item.read ? "border-border/60 bg-white/35" : "border-primary/20 bg-white/75"}`}><div className="flex items-start gap-3"><span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-primary"><Clock3 className="size-4" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold">{item.title}</h2>{!item.read ? <CircleDot className="size-3.5 text-primary" /> : null}</div><p className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</p><p className="mt-2 text-[11px] text-muted-foreground">{displayTime(item.createdAt)}</p></div><div className="flex shrink-0 items-center gap-1">{!item.read ? <Button type="button" size="sm" variant="ghost" onClick={() => markOperationNotificationRead(context, item.id, actor.id)}>已读</Button> : null}<Button asChild size="sm" variant="ghost"><Link href={item.href} onClick={() => markOperationNotificationRead(context, item.id, actor.id)}>处理<ChevronRight /></Link></Button></div></div></article>
          ))}</div>
        ) : (
          <div className="grid min-h-56 place-items-center text-center"><div><span className="mx-auto grid size-12 place-items-center rounded-2xl bg-success-soft text-success"><CheckCheck /></span><h2 className="mt-3 font-semibold">{filter === "unread" ? "未读通知已清零" : "当前没有通知"}</h2><p className="mt-1 text-sm text-muted-foreground">任务、审批、费用、客户、知识库和 Agent 事件会进入这里。</p></div></div>
        )}
      </GlassCard>
    </main>
  );
}
