"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowLeft, Check, CheckCircle2, CircleDot, Clock3, FileText, MessageSquareText, UserRoundCheck, X } from "lucide-react";

import { MobileWorkspaceNav } from "@/components/shell/mobile-workspace-nav";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GlassCard } from "@/components/ui/glass-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { approvalStatusMeta, approvalTypeMeta } from "@/features/approvals/approval-meta";
import type { Approval, ApprovalStatus } from "@/features/approvals/approval-types";
import { cn } from "@/lib/utils";

type Decision = "approve" | "reject";

function Person({ person }: { person: Approval["applicant"] }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar className="size-10">
        {person.avatarUrl ? <AvatarImage src={person.avatarUrl} alt={person.displayName} /> : null}
        <AvatarFallback className="bg-primary/10 text-primary">{person.displayName.slice(-2)}</AvatarFallback>
      </Avatar>
      <div><p className="font-medium text-foreground">{person.displayName}</p><p className="mt-0.5 text-xs text-muted-foreground">{person.department} · {person.jobTitle}</p></div>
    </div>
  );
}

export function ApprovalDetailPage({ approval }: { approval: Approval }) {
  const [status, setStatus] = useState<ApprovalStatus>(approval.status);
  const [decision, setDecision] = useState<Decision | null>(null);
  const [feedback, setFeedback] = useState("");
  const statusMeta = approvalStatusMeta[status];
  const isPending = status === "pending";

  function confirmDecision() {
    if (!decision) return;
    setStatus(decision === "approve" ? "approved" : "rejected");
    setDecision(null);
  }

  return (
    <main className="mx-auto flex w-full max-w-420 flex-col gap-4 px-3 pt-5 pb-26 sm:px-4 lg:px-5 lg:pt-7 lg:pb-6">
      <Link href="/approvals" className="inline-flex w-fit items-center gap-2 rounded-xl px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-background/70 hover:text-primary"><ArrowLeft aria-hidden="true" className="size-4" />返回审批中心</Link>
      <GlassCard className="relative overflow-hidden p-5 sm:p-6">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[url('/dashboard/welcome-space-bg.png')] bg-cover bg-[position:80%_center] opacity-55" />
        <div className="relative">
          <PageHeader
            title={approval.title}
            description={`${approvalTypeMeta[approval.type].label} · ${approval.code}`}
            actions={isPending ? (
              <div className="flex gap-2">
                <Button type="button" variant="outline" onClick={() => setDecision("reject")} className="rounded-xl"><X data-icon="inline-start" aria-hidden="true" />拒绝申请</Button>
                <Button type="button" onClick={() => setDecision("approve")} className="rounded-xl"><Check data-icon="inline-start" aria-hidden="true" />同意申请</Button>
              </div>
            ) : <StatusBadge status={statusMeta.tone}>{statusMeta.label}</StatusBadge>}
          />
          <div className="mt-5 grid gap-3 rounded-2xl border border-white/75 bg-background/65 p-4 sm:grid-cols-3">
            <div><p className="text-xs text-muted-foreground">申请人</p><div className="mt-2"><Person person={approval.applicant} /></div></div>
            <div className="border-border/60 sm:border-l sm:pl-4"><p className="text-xs text-muted-foreground">当前负责人</p><div className="mt-2"><Person person={approval.owner} /></div></div>
            <div className="border-border/60 sm:border-l sm:pl-4"><p className="text-xs text-muted-foreground">提交时间 / 当前状态</p><p className="mt-2 font-medium text-foreground">{approval.submittedAt}</p><div className="mt-2"><StatusBadge status={statusMeta.tone}>{statusMeta.label}</StatusBadge></div></div>
          </div>
        </div>
      </GlassCard>

      {status === "approved" ? <div role="status" className="flex items-center gap-2 rounded-2xl border border-success/20 bg-success/10 px-4 py-3 text-sm font-medium text-success"><CheckCircle2 aria-hidden="true" className="size-4" />审批已通过</div> : null}
      {status === "rejected" ? <div role="status" className="flex items-center gap-2 rounded-2xl border border-destructive/20 bg-destructive/8 px-4 py-3 text-sm font-medium text-destructive"><X aria-hidden="true" className="size-4" />审批已拒绝</div> : null}

      <section className="grid min-w-0 gap-4 xl:grid-cols-12">
        <div className="grid min-w-0 content-start gap-4 xl:col-span-8">
          <GlassCard className="p-4 sm:p-5">
            <div className="flex items-center gap-2"><span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><FileText aria-hidden="true" className="size-4" /></span><div><h2 className="text-lg font-semibold text-foreground">申请信息</h2><p className="text-xs text-muted-foreground">申请内容与业务说明</p></div></div>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2">
              {approval.fields.map((field) => <div key={field.label} className="rounded-2xl border border-glass-border bg-background/65 px-4 py-3"><dt className="text-xs text-muted-foreground">{field.label}</dt><dd className="mt-1.5 text-sm font-medium leading-6 text-foreground">{field.value}</dd></div>)}
            </dl>
          </GlassCard>

          <GlassCard className="p-4 sm:p-5">
            <div className="flex items-center gap-2"><span className="grid size-9 place-items-center rounded-xl bg-chart-3/10 text-chart-3"><UserRoundCheck aria-hidden="true" className="size-4" /></span><div><h2 className="text-lg font-semibold text-foreground">审批流程</h2><p className="text-xs text-muted-foreground">固定审批节点与当前进度</p></div></div>
            <section aria-label="审批流程" className="mt-5 grid gap-0 sm:grid-cols-4">
              {approval.steps.map((step, index) => {
                const isDone = step.status === "approved";
                const isRejected = step.status === "rejected";
                return (
                  <article key={step.id} className="relative flex gap-3 pb-5 sm:block sm:pb-0 sm:text-center">
                    {index < approval.steps.length - 1 ? <span aria-hidden="true" className={cn("absolute top-5 bottom-0 left-5 w-px bg-border sm:top-5 sm:right-0 sm:bottom-auto sm:left-1/2 sm:h-px sm:w-auto", isDone && "bg-primary/45")} /> : null}
                    <span className={cn("relative z-10 grid size-10 shrink-0 place-items-center rounded-full border bg-background text-muted-foreground", isDone && "border-primary/25 bg-primary text-primary-foreground", isRejected && "border-destructive/25 bg-destructive text-primary-foreground")}>
                      {isDone ? <Check aria-hidden="true" className="size-4" /> : isRejected ? <X aria-hidden="true" className="size-4" /> : <CircleDot aria-hidden="true" className="size-4" />}
                    </span>
                    <div className="pt-1 sm:mt-3 sm:pt-0"><h3 className="text-sm font-medium text-foreground">{step.name}</h3><p className="mt-1 text-xs text-muted-foreground">{step.approver?.displayName ?? "系统"}</p><p className="mt-1 text-[11px] text-muted-foreground">{step.actedAt ?? (step.status === "pending" ? "等待处理" : "已跳过")}</p></div>
                  </article>
                );
              })}
            </section>
          </GlassCard>
        </div>

        <div className="grid min-w-0 content-start gap-4 xl:col-span-4">
          <GlassCard className="p-4 sm:p-5">
            <h2 className="text-lg font-semibold text-foreground">审批摘要</h2>
            <dl className="mt-4 grid gap-3 text-sm">
              <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">申请类型</dt><dd className="font-medium text-foreground">{approvalTypeMeta[approval.type].label}</dd></div>
              <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">业务摘要</dt><dd className="text-right font-medium text-foreground">{approval.summary}</dd></div>
              <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">当前节点</dt><dd className="font-medium text-primary">{approval.currentStep}</dd></div>
              <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">流程状态</dt><dd><StatusBadge status={statusMeta.tone}>{statusMeta.label}</StatusBadge></dd></div>
            </dl>
          </GlassCard>
          <GlassCard className="p-4 sm:p-5">
            <div className="flex items-center gap-2"><MessageSquareText aria-hidden="true" className="size-4 text-primary" /><h2 className="text-lg font-semibold text-foreground">审批记录</h2></div>
            <section aria-label="审批记录" className="mt-4 grid gap-4">
              {approval.actions.map((action) => <article key={action.id} className="relative border-l border-border pl-4"><span className="absolute top-0 -left-1.5 size-3 rounded-full border-2 border-background bg-primary" /><p className="text-sm font-medium text-foreground">{action.actor.displayName} · {action.actionType === "submit" ? "提交申请" : action.actionType === "approve" ? "同意申请" : "拒绝申请"}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{action.content}</p><p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground"><Clock3 aria-hidden="true" className="size-3" />{action.createdAt}</p></article>)}
            </section>
          </GlassCard>
        </div>
      </section>

      <Dialog open={decision !== null} onOpenChange={(open) => { if (!open) setDecision(null); }}>
        <DialogContent aria-label={decision === "approve" ? "确认同意申请" : "确认拒绝申请"}>
          <DialogHeader>
            <DialogTitle>{decision === "approve" ? "确认同意申请" : "确认拒绝申请"}</DialogTitle>
            <DialogDescription>{decision === "approve" ? "确认后，申请将进入下一个审批节点。" : "请填写拒绝原因，申请将退回发起人。"}</DialogDescription>
          </DialogHeader>
          <Textarea aria-label="审批意见" placeholder={decision === "approve" ? "审批意见（可选）" : "请输入拒绝原因"} value={feedback} onChange={(event) => setFeedback(event.target.value)} className="min-h-24 rounded-2xl bg-background/70" />
          <DialogFooter>
            <DialogClose asChild><Button type="button" variant="outline">取消</Button></DialogClose>
            <Button type="button" variant={decision === "reject" ? "destructive" : "default"} onClick={confirmDecision}>{decision === "approve" ? "确认同意" : "确认拒绝"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <MobileWorkspaceNav active="messages" />
    </main>
  );
}
