"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, CalendarCheck2, Check, CheckCircle2, Clock3, FileCheck2, Plane, RotateCcw, ShieldCheck, UserRoundCheck, X } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { toOperationFixtureActor } from "@/features/operations/operation-actor-compat";
import { getActor, reviewLeaveRequest, submitLeaveRequest } from "@/features/operations/operations-data";
import type { LeaveRequest, LeaveRequestStatus } from "@/features/operations/operations-types";
import { useOperations } from "@/features/operations/use-operations";
import { cn } from "@/lib/utils";

const statusMeta: Record<LeaveRequestStatus, { label: string; variant: "warning" | "info" | "success" | "destructive" | "neutral" }> = {
  pending_manager: { label: "负责人审批", variant: "warning" },
  pending_hr: { label: "人事复核", variant: "info" },
  approved: { label: "已生效", variant: "success" },
  rejected: { label: "已驳回", variant: "destructive" },
  cancelled: { label: "已撤回", variant: "neutral" },
};

const leaveTypeLabel = { annual: "年假", sick: "病假", personal: "事假", compensatory: "调休" } as const;

function LeaveFlow({ request }: { request: LeaveRequest }) {
  const steps = [
    { label: "提交申请", done: true },
    { label: "负责人审批", done: ["pending_hr", "approved"].includes(request.status), active: request.status === "pending_manager" },
    { label: "人事复核", done: request.status === "approved", active: request.status === "pending_hr" },
    { label: "同步考勤", done: request.status === "approved" },
  ];
  return <ol aria-label={`${request.code}审批流程`} className="mt-3 grid grid-cols-4 gap-1">{steps.map((step, index) => <li key={step.label} className="relative text-center">{index < steps.length - 1 ? <span className={cn("absolute top-3 left-1/2 h-px w-full bg-border", step.done && "bg-success/45")} /> : null}<span className={cn("relative z-10 mx-auto grid size-6 place-items-center rounded-full border bg-background text-[10px]", step.done && "border-success bg-success text-white", step.active && "border-primary bg-primary text-white")}>{step.done ? <Check className="size-3" /> : index + 1}</span><p className={cn("mt-1.5 text-[10px] text-muted-foreground", (step.done || step.active) && "font-medium text-foreground")}>{step.label}</p></li>)}</ol>;
}

function LeaveCard({ request, onFeedback }: { request: LeaveRequest; onFeedback: (message: string, error?: boolean) => void }) {
  const { actor: workspaceActor } = useWorkspaceSession();
  const actor = toOperationFixtureActor(workspaceActor);
  const [comment, setComment] = useState("");
  const employee = getActor(request.employeeId);
  const canManagerReview = request.status === "pending_manager" && (actor.role === "department_head" || actor.role === "executive") && (request.managerId === actor.id || actor.role === "executive");
  const canHrReview = request.status === "pending_hr" && actor.role === "hr";
  const canCancel = request.employeeId === actor.id && request.status === "pending_manager";

  function review(action: "approve" | "reject" | "cancel") {
    try {
      reviewLeaveRequest(request.id, action, actor.id, comment);
      setComment("");
      onFeedback(action === "approve" ? "审批已提交到下一节点" : action === "reject" ? "申请已驳回并通知员工" : "申请已撤回");
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : "请假状态更新失败", true);
    }
  }

  return <article className="rounded-2xl border border-border/70 bg-white/60 p-4">
    <div className="flex flex-wrap items-start gap-3"><Avatar><AvatarFallback className="bg-brand-soft text-primary">{employee.name.slice(0, 1)}</AvatarFallback></Avatar><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{employee.name} · {leaveTypeLabel[request.leaveType]} {request.days} 天</h3><Badge variant={statusMeta[request.status].variant}>{statusMeta[request.status].label}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{request.code} · {request.startDate} 至 {request.endDate}</p></div><span className="rounded-lg bg-muted px-2 py-1 text-xs text-muted-foreground">{employee.department}</span></div>
    <div className="mt-3 grid gap-2 sm:grid-cols-2"><div className="rounded-xl bg-muted/55 p-3"><p className="text-[11px] text-muted-foreground">请假事由</p><p className="mt-1 text-xs leading-5">{request.reason}</p></div><div className="rounded-xl bg-success-soft/55 p-3"><p className="text-[11px] text-success">工作交接</p><p className="mt-1 text-xs leading-5">{request.handover}</p></div></div>
    <LeaveFlow request={request} />
    {request.managerComment || request.hrComment ? <div className="mt-3 grid gap-1.5 text-xs">{request.managerComment ? <p className="rounded-lg bg-muted/55 px-2.5 py-2"><strong>负责人：</strong>{request.managerComment}</p> : null}{request.hrComment ? <p className="rounded-lg bg-brand-soft px-2.5 py-2 text-primary"><strong>人事：</strong>{request.hrComment}</p> : null}</div> : null}
    {canManagerReview || canHrReview || canCancel ? <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border/70 pt-3"><Textarea aria-label={`${request.code}审批意见`} value={comment} onChange={(event) => setComment(event.target.value)} className="min-h-9 w-full resize-none sm:w-72" placeholder="审批意见；驳回时必填" />{canManagerReview || canHrReview ? <><Button size="sm" onClick={() => review("approve")}><CheckCircle2 />同意</Button><Button size="sm" variant="outline" onClick={() => review("reject")}><X />驳回</Button></> : null}{canCancel ? <Button size="sm" variant="ghost" onClick={() => review("cancel")}><RotateCcw />撤回</Button> : null}</div> : null}
  </article>;
}

export function LeaveWorkbench() {
  const { actor: workspaceActor } = useWorkspaceSession();
  const actor = toOperationFixtureActor(workspaceActor);
  const { state } = useOperations();
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean } | null>(null);
  const [form, setForm] = useState({ leaveType: "annual" as LeaveRequest["leaveType"], startDate: "2026-08-17", endDate: "2026-08-17", days: "1", reason: "家庭事务安排", handover: "当前任务由刘洋临时跟进，资料已同步到项目空间。" });
  const requests = useMemo(() => {
    if (actor.role === "employee" || actor.role === "finance") return state.leaveRequests.filter(({ employeeId }) => employeeId === actor.id);
    if (actor.role === "department_head") return state.leaveRequests.filter(({ managerId, employeeId }) => managerId === actor.id || employeeId === actor.id);
    return state.leaveRequests;
  }, [actor.id, actor.role, state.leaveRequests]);
  const canApply = actor.role !== "executive" && actor.role !== "hr";

  function notify(message: string, error = false) { setFeedback({ message, error }); }
  function submit() {
    try {
      submitLeaveRequest({ ...form, days: Number(form.days) }, actor.id);
      notify("请假申请已提交给部门负责人");
    } catch (error) { notify(error instanceof Error ? error.message : "请假申请提交失败", true); }
  }

  return <main className="mx-auto flex w-full max-w-420 flex-col gap-3 px-3 pt-4 pb-26 sm:px-4 lg:px-5 lg:pt-6 lg:pb-8">
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-semibold tracking-[0.18em] text-primary">申请 → 负责人 → 人事 → 考勤</p><h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">请假管理</h1><p className="mt-1.5 text-sm text-muted-foreground">请假不是独立表单：审批通过后同步考勤，并作为薪资核算的输入。</p></div><div className="flex gap-2"><Button asChild variant="outline"><Link href="/approvals">审批中心<ArrowRight /></Link></Button><Button asChild variant="outline"><Link href="/attendance">考勤记录<ArrowRight /></Link></Button></div></header>

    <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{[{ label: "待负责人", value: state.leaveRequests.filter(({ status }) => status === "pending_manager").length, icon: UserRoundCheck }, { label: "待人事复核", value: state.leaveRequests.filter(({ status }) => status === "pending_hr").length, icon: ShieldCheck }, { label: "本月已生效", value: state.leaveRequests.filter(({ status }) => status === "approved").length, icon: CalendarCheck2 }, { label: "考勤已同步", value: state.leaveRequests.filter(({ status }) => status === "approved").length, icon: FileCheck2 }].map(({ label, value, icon: Icon }) => <GlassCard key={label} className="flex items-center gap-3 p-3.5"><span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-primary"><Icon /></span><div><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-0.5 text-lg font-semibold">{value} 项</p></div></GlassCard>)}</section>
    {feedback ? <p role="status" className={cn("rounded-xl px-3 py-2 text-sm font-medium", feedback.error ? "bg-danger-soft text-destructive" : "bg-success-soft text-success")}>{feedback.message}</p> : null}

    <section className={cn("grid gap-3", canApply && "xl:grid-cols-[22rem_minmax(0,1fr)]")}>
      {canApply ? <GlassCard className="h-fit p-4 sm:p-5 xl:sticky xl:top-22"><div className="flex items-center gap-2"><Plane className="size-5 text-primary" /><h2 className="font-semibold">发起请假</h2></div><div className="mt-4 grid gap-3"><label className="grid gap-1.5 text-xs font-medium">请假类型<select value={form.leaveType} onChange={(event) => setForm({ ...form, leaveType: event.target.value as LeaveRequest["leaveType"] })} className="h-10 rounded-xl border border-input bg-background px-3 text-sm"><option value="annual">年假</option><option value="sick">病假</option><option value="personal">事假</option><option value="compensatory">调休</option></select></label><div className="grid grid-cols-2 gap-2"><label className="grid gap-1.5 text-xs font-medium">开始日期<Input type="date" value={form.startDate} onChange={(event) => setForm({ ...form, startDate: event.target.value })} /></label><label className="grid gap-1.5 text-xs font-medium">结束日期<Input type="date" value={form.endDate} onChange={(event) => setForm({ ...form, endDate: event.target.value })} /></label></div><label className="grid gap-1.5 text-xs font-medium">请假天数<Input type="number" min="0.5" step="0.5" value={form.days} onChange={(event) => setForm({ ...form, days: event.target.value })} /></label><label className="grid gap-1.5 text-xs font-medium">请假事由<Textarea value={form.reason} onChange={(event) => setForm({ ...form, reason: event.target.value })} /></label><label className="grid gap-1.5 text-xs font-medium">工作交接<Textarea value={form.handover} onChange={(event) => setForm({ ...form, handover: event.target.value })} /></label><Button onClick={submit}>提交请假申请</Button></div></GlassCard> : null}
      <GlassCard className="p-4 sm:p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold">{actor.role === "employee" || actor.role === "finance" ? "我的请假" : "请假审批队列"}</h2><p className="mt-1 text-xs text-muted-foreground">当前身份：{actor.name} · {actor.roleLabel}</p></div><Badge variant="info">{requests.length} 条</Badge></div><div className="mt-4 grid gap-3">{requests.map((request) => <LeaveCard key={request.id} request={request} onFeedback={notify} />)}{!requests.length ? <div className="rounded-2xl border border-dashed border-border p-10 text-center"><Clock3 className="mx-auto text-muted-foreground" /><p className="mt-2 font-medium">当前没有请假记录</p></div> : null}</div></GlassCard>
    </section>
  </main>;
}
