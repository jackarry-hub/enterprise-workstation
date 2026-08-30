"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { ArrowLeft, Banknote, Check, CircleDot, Clock3, FileText, LoaderCircle, MessageSquareText, UserRoundCheck, X } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { RealDataUnavailable } from "@/components/ui/real-data-boundary";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { approvalStatusMeta, approvalTypeMeta } from "@/features/approvals/approval-meta";
import type { Approval, ApprovalAction } from "@/features/approvals/approval-types";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { useWorkspaceRouter } from "@/lib/navigation/use-workspace-router";
import { cn } from "@/lib/utils";

type ApprovalDecision = "approve" | "reject" | "return";

export type ApprovalActionInput = {
  approvalId: string;
  version: number;
  command: ApprovalDecision;
  comment: string | null;
  idempotencyKey: string;
};

export type ApprovalPaymentInput = {
  expenseId: string;
  version: number;
  paymentReference: string;
  idempotencyKey: string;
};

export type ApprovalActionTransport = (input: ApprovalActionInput) => Promise<Response>;
export type ApprovalPaymentTransport = (input: ApprovalPaymentInput) => Promise<Response>;
const COMMAND_TIMEOUT_MS = 15_000;

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), COMMAND_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

const defaultActionTransport: ApprovalActionTransport = ({ approvalId, version, command, comment, idempotencyKey }) => fetchWithTimeout(
  `/api/workstation/approvals/${encodeURIComponent(approvalId)}/actions`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ command, expectedVersion: version, comment }),
  },
);

const defaultPaymentTransport: ApprovalPaymentTransport = ({ expenseId, version, paymentReference, idempotencyKey }) => fetchWithTimeout(
  `/api/workstation/expenses/${encodeURIComponent(expenseId)}/payment`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify({ expectedVersion: version, paymentReference }),
  },
);

function Person({ person }: { person: Approval["applicant"] }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar className="size-10">
        {person.avatarUrl ? <AvatarImage src={person.avatarUrl} alt={person.displayName} /> : null}
        <AvatarFallback className="bg-primary/10 text-primary">{person.displayName.slice(-2)}</AvatarFallback>
      </Avatar>
      <div>
        <p className="font-medium text-foreground">{person.displayName}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{person.department}{person.jobTitle ? ` · ${person.jobTitle}` : ""}</p>
      </div>
    </div>
  );
}

function approvalActionLabel(actionType: ApprovalAction["actionType"]) {
  const labels: Record<ApprovalAction["actionType"], string> = {
    submit: "提交申请",
    approve: "同意申请",
    reject: "拒绝申请",
    return: "退回补充",
    cancel: "撤销申请",
    comment: "审批备注",
  };
  return labels[actionType];
}

function decisionLabel(command: ApprovalDecision) {
  return command === "approve" ? "同意" : command === "reject" ? "拒绝" : "退回";
}

function commandKey() {
  return crypto.randomUUID();
}

async function confirmsServerState(
  response: Response,
  resource: "approval" | "expense",
  expectedId: string,
  expectedVersion: number,
  statuses: readonly string[],
) {
  if (!response.ok) return false;
  try {
    const body = await response.json() as Record<string, unknown>;
    const entity = body[resource] as Record<string, unknown> | undefined;
    return body.outcome === "success"
      && body.resource === resource
      && entity?.id === expectedId
      && Number.isSafeInteger(entity.version)
      && entity.version === expectedVersion
      && typeof entity.status === "string"
      && statuses.includes(entity.status);
  } catch {
    return false;
  }
}

export function ApprovalDetailPage({
  approval,
  dataSource = "supabase",
  actionTransport = defaultActionTransport,
  paymentTransport = defaultPaymentTransport,
  onReload,
}: {
  approval: Approval;
  dataSource?: "mock" | "supabase";
  actionTransport?: ApprovalActionTransport;
  paymentTransport?: ApprovalPaymentTransport;
  onReload?: () => void;
}) {
  const session = useWorkspaceSession();
  const router = useWorkspaceRouter();
  const [decision, setDecision] = useState<ApprovalDecision | null>(null);
  const [comment, setComment] = useState("");
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentReference, setPaymentReference] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const keys = useRef(new Map<string, string>());
  const statusMeta = approvalStatusMeta[approval.status];
  const isSupabaseData = dataSource === "supabase";
  const canAct = isSupabaseData
    && approval.status === "pending"
    && approval.owner.id === session.member.employeeProfileId
    && session.permissionCodes.includes("approval.act");
  const canPay = isSupabaseData
    && approval.status === "approved"
    && approval.expense?.status === "approved"
    && session.permissionCodes.includes("expense.manage");

  function keyFor(signature: string) {
    const existing = keys.current.get(signature);
    if (existing) return existing;
    const created = commandKey();
    keys.current.set(signature, created);
    return created;
  }

  function reload() {
    if (onReload) onReload();
    else router.refresh();
  }

  async function submitDecision() {
    if (!decision) return;
    const normalizedComment = comment.trim();
    if (decision !== "approve" && !normalizedComment) {
      setFeedback("拒绝或退回时必须填写处理意见。");
      return;
    }
    setPending(true);
    setFeedback("");
    const signature = `${approval.id}:${approval.version}:${decision}:${normalizedComment}`;
    try {
      const response = await actionTransport({
        approvalId: approval.id,
        version: approval.version,
        command: decision,
        comment: normalizedComment || null,
        idempotencyKey: keyFor(signature),
      });
      if (response.status === 409) {
        setFeedback("审批状态已变化，请刷新后重试。");
        return;
      }
      const acceptedStatuses = decision === "approve"
        ? ["pending", "approved"]
        : [decision === "reject" ? "rejected" : "returned"];
      if (!await confirmsServerState(response, "approval", approval.id, approval.version + 1, acceptedStatuses)) {
        setFeedback(response.status === 403 ? "你没有处理该审批的权限。" : "审批操作未被服务器确认，请稍后重试。");
        return;
      }
      setDecision(null);
      reload();
    } catch {
      setFeedback("审批服务暂不可用，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  async function submitPayment() {
    if (!approval.expense) return;
    const reference = paymentReference.trim();
    if (!reference) {
      setFeedback("请填写付款凭证号。");
      return;
    }
    setPending(true);
    setFeedback("");
    const signature = `${approval.expense.id}:${approval.expense.version}:pay:${reference}`;
    try {
      const response = await paymentTransport({
        expenseId: approval.expense.id,
        version: approval.expense.version,
        paymentReference: reference,
        idempotencyKey: keyFor(signature),
      });
      if (response.status === 409) {
        setFeedback("费用状态已变化，请刷新后重试。");
        return;
      }
      if (!await confirmsServerState(response, "expense", approval.expense.id, approval.expense.version + 1, ["paid"])) {
        setFeedback(response.status === 403 ? "你没有登记付款的权限。" : "付款状态未被服务器确认，请稍后重试。");
        return;
      }
      setPaymentOpen(false);
      reload();
    } catch {
      setFeedback("付款服务暂不可用，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  if (!isSupabaseData) {
    return (
      <RealDataUnavailable
        title="审批数据暂不可用"
        description="当前账号不会显示演示审批记录。真实审批数据接入后，可在权限范围内查看。"
        backHref="/approvals"
        backLabel="返回审批中心"
      />
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-420 flex-col gap-4 px-3 pt-5 pb-26 sm:px-4 lg:px-5 lg:pt-7 lg:pb-6">
      <Link href="/approvals" className="inline-flex w-fit items-center gap-2 rounded-xl px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:bg-background/70 hover:text-primary"><ArrowLeft aria-hidden="true" className="size-4" />返回审批中心</Link>
      <GlassCard className="relative overflow-hidden p-5 sm:p-6">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[url('/dashboard/welcome-space-bg.png')] bg-cover bg-[position:80%_center] opacity-55" />
        <div className="relative">
          <PageHeader title={approval.title} description={`${approvalTypeMeta[approval.type].label} · ${approval.code}`} actions={<StatusBadge status={statusMeta.tone}>{statusMeta.label}</StatusBadge>} />
          <div className="mt-5 grid gap-3 rounded-2xl border border-white/75 bg-background/65 p-4 sm:grid-cols-3">
            <div><p className="text-xs text-muted-foreground">申请人</p><div className="mt-2"><Person person={approval.applicant} /></div></div>
            <div className="border-border/60 sm:border-l sm:pl-4"><p className="text-xs text-muted-foreground">当前负责人</p><div className="mt-2"><Person person={approval.owner} /></div></div>
            <div className="border-border/60 sm:border-l sm:pl-4"><p className="text-xs text-muted-foreground">提交时间 / 当前状态</p><p className="mt-2 font-medium text-foreground">{approval.submittedAt}</p><div className="mt-2"><StatusBadge status={statusMeta.tone}>{statusMeta.label}</StatusBadge></div></div>
          </div>
        </div>
      </GlassCard>

      {canAct ? (
        <section aria-label="审批操作" className="flex flex-col gap-3 rounded-2xl border border-primary/15 bg-primary/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="font-medium text-foreground">该审批当前由你处理</p><p className="mt-1 text-xs text-muted-foreground">提交后以服务器审批版本和审计记录为准。</p></div>
          <div className="grid grid-cols-3 gap-2 sm:flex">
            <Button type="button" variant="outline" onClick={() => { setDecision("return"); setComment(""); setFeedback(""); }}>退回补充</Button>
            <Button type="button" variant="destructive" onClick={() => { setDecision("reject"); setComment(""); setFeedback(""); }}>拒绝申请</Button>
            <Button type="button" onClick={() => { setDecision("approve"); setComment(""); setFeedback(""); }}>同意申请</Button>
          </div>
        </section>
      ) : isSupabaseData && approval.status === "pending" ? (
        <div role="status" className="rounded-2xl border border-info/20 bg-info/10 px-4 py-3 text-sm text-info">当前审批由指定负责人处理，你可以查看流程进度。</div>
      ) : !isSupabaseData ? (
        <div role="status" className="rounded-2xl border border-info/20 bg-info/10 px-4 py-3 text-sm text-info">本地预览仅展示流程，不执行正式审批。</div>
      ) : null}

      {canPay ? (
        <section aria-label="付款操作" className="flex flex-col gap-3 rounded-2xl border border-success/20 bg-success/5 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="font-medium text-foreground">费用审批已通过</p><p className="mt-1 text-xs text-muted-foreground">登记真实付款凭证后，费用台账才会进入已支付状态。</p></div>
          <Button type="button" onClick={() => { setPaymentOpen(true); setPaymentReference(""); setFeedback(""); }}><Banknote aria-hidden="true" />登记付款</Button>
        </section>
      ) : null}

      {feedback && decision === null && !paymentOpen ? <div role="alert" className="rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">{feedback}</div> : null}

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
              {approval.expense ? <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">费用台账</dt><dd className="font-medium text-foreground">{approval.expense.status === "paid" ? "已支付" : approval.expense.status === "approved" ? "待付款" : approval.expense.status === "submitted" ? "审批中" : "已同步"}</dd></div> : null}
            </dl>
          </GlassCard>
          <GlassCard className="p-4 sm:p-5">
            <div className="flex items-center gap-2"><MessageSquareText aria-hidden="true" className="size-4 text-primary" /><h2 className="text-lg font-semibold text-foreground">审批记录</h2></div>
            <section aria-label="审批记录" className="mt-4 grid gap-4">
              {approval.actions.length ? approval.actions.map((action) => <article key={action.id} className="relative border-l border-border pl-4"><span className="absolute top-0 -left-1.5 size-3 rounded-full border-2 border-background bg-primary" /><p className="text-sm font-medium text-foreground">{action.actor.displayName} · {approvalActionLabel(action.actionType)}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{action.content}</p><p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground"><Clock3 aria-hidden="true" className="size-3" />{action.createdAt}</p></article>) : <p className="text-sm text-muted-foreground">暂无审批记录</p>}
            </section>
          </GlassCard>
        </div>
      </section>

      <Dialog open={decision !== null} onOpenChange={(open) => { if (!open && !pending) setDecision(null); }}>
        <DialogContent className="max-sm:top-0 max-sm:left-0 max-sm:h-[100dvh] max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{decision ? `确认${decisionLabel(decision)}` : "审批确认"}</DialogTitle>
            <DialogDescription>操作将写入审批审计记录，并校验当前版本与负责人。</DialogDescription>
          </DialogHeader>
          <label className="grid gap-2 text-sm font-medium">处理意见
            <Textarea aria-label="处理意见" maxLength={500} rows={5} value={comment} onChange={(event) => setComment(event.target.value)} placeholder={decision === "approve" ? "可选" : "必填，说明处理原因"} disabled={pending} />
          </label>
          {feedback ? <p role="alert" className="rounded-xl bg-destructive/5 px-3 py-2 text-sm text-destructive">{feedback}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDecision(null)} disabled={pending}>取消</Button>
            <Button type="button" variant={decision === "reject" ? "destructive" : "default"} onClick={submitDecision} disabled={pending}>
              {pending ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}{decision ? `确认${decisionLabel(decision)}` : "确认"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentOpen} onOpenChange={(open) => { if (!pending) setPaymentOpen(open); }}>
        <DialogContent className="max-sm:top-0 max-sm:left-0 max-sm:h-[100dvh] max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-w-md">
          <DialogHeader>
            <DialogTitle>登记付款</DialogTitle>
            <DialogDescription>付款凭证号将永久写入费用台账审计记录。</DialogDescription>
          </DialogHeader>
          <label className="grid gap-2 text-sm font-medium">付款凭证号
            <Input aria-label="付款凭证号" maxLength={120} value={paymentReference} onChange={(event) => setPaymentReference(event.target.value)} placeholder="银行流水号或支付凭证编号" disabled={pending} />
          </label>
          {feedback ? <p role="alert" className="rounded-xl bg-destructive/5 px-3 py-2 text-sm text-destructive">{feedback}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPaymentOpen(false)} disabled={pending}>取消</Button>
            <Button type="button" onClick={submitPayment} disabled={pending}>{pending ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}确认付款</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </main>
  );
}
