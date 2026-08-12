"use client";

import Link from "next/link";
import { useMemo, useState, type ChangeEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  Check,
  CheckCircle2,
  Clock3,
  Download,
  FileClock,
  FileUp,
  Fingerprint,
  LoaderCircle,
  LockKeyhole,
  MapPin,
  RotateCcw,
  ShieldCheck,
  TimerReset,
  Wifi,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { downloadOperationFile, storeOperationFile } from "@/features/operations/file-storage";
import {
  addOperationFile,
  clockAttendance,
  getActor,
  lockAttendancePeriod,
  resetOperationsState,
  reviewAttendanceCorrection,
  reviewOvertimeRequest,
  submitAttendanceCorrection,
  submitOvertimeRequest,
  updateAttendancePolicy,
} from "@/features/operations/operations-data";
import type {
  AttendanceCorrectionRequest,
  AttendanceIssueType,
  AttendanceOvertimeRequest,
  AttendanceReviewStatus,
} from "@/features/operations/operations-types";
import { useOperations } from "@/features/operations/use-operations";
import { cn } from "@/lib/utils";

type Feedback = { message: string; error?: boolean } | null;

const reviewStatusMeta: Record<AttendanceReviewStatus, { label: string; variant: "warning" | "info" | "success" | "destructive" }> = {
  pending_manager: { label: "待负责人", variant: "warning" },
  pending_hr: { label: "待人事复核", variant: "info" },
  approved: { label: "已生效", variant: "success" },
  rejected: { label: "已驳回", variant: "destructive" },
};

const issueLabel: Record<AttendanceIssueType, string> = {
  late: "迟到修正",
  early_leave: "早退修正",
  missing_in: "缺上班卡",
  missing_out: "缺下班卡",
};

function FeedbackBanner({ feedback }: { feedback: Feedback }) {
  return feedback ? <p role="status" className={cn("rounded-xl px-3 py-2 text-sm font-medium", feedback.error ? "bg-danger-soft text-destructive" : "bg-success-soft text-success")}>{feedback.message}</p> : null;
}

export function AttendanceWorkflowStrip() {
  const steps = ["排班与制度", "员工打卡", "异常 / 请假", "负责人审批", "人事复核封账", "进入薪资"];
  return <GlassCard className="overflow-hidden p-3 sm:p-4">
    <ol aria-label="考勤闭环流程" className="grid min-w-150 grid-cols-6 gap-1 overflow-x-auto pb-1 sm:min-w-0">{steps.map((label, index) => <li key={label} className="relative text-center">{index < steps.length - 1 ? <span className="absolute top-3 left-1/2 h-px w-full bg-primary/25" /> : null}<span className="relative z-10 mx-auto grid size-6 place-items-center rounded-full border border-primary/30 bg-brand-soft text-[10px] font-semibold text-primary">{index + 1}</span><p className="mt-1.5 text-[10px] font-medium text-muted-foreground sm:text-xs">{label}</p></li>)}</ol>
  </GlassCard>;
}

export function TodayClockPanel() {
  const session = useWorkspaceSession();
  const { state, context, actor } = useOperations(session);
  const [method, setMethod] = useState<"web" | "mobile_gps" | "office_wifi">("office_wifi");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const { policy, demoDate, punches } = state.attendance;
  const ownPunches = punches.filter((item) => item.employeeId === actor.id && item.date === demoDate);
  const checkIn = ownPunches.find(({ kind }) => kind === "check_in");
  const checkOut = ownPunches.find(({ kind }) => kind === "check_out");
  const canClock = actor.role !== "executive";

  function punch(kind: "check_in" | "check_out") {
    try {
      clockAttendance(context, actor.id, kind, method);
      setFeedback({ message: kind === "check_in" ? "签到成功，位置与设备校验已通过" : "签退成功，今日工时已进入计算" });
    } catch (error) {
      setFeedback({ message: error instanceof Error ? error.message : "打卡失败", error: true });
    }
  }

  if (!canClock) return <GlassCard className="p-4 sm:p-5"><div className="flex items-start gap-3"><span className="grid size-11 place-items-center rounded-xl bg-brand-soft text-primary"><Fingerprint /></span><div><h2 className="font-semibold">考勤执行状态</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">决策人不参与日常打卡，仅查看公司出勤、异常和封账状态。当前制度为“{policy.name}”。</p></div></div></GlassCard>;

  return <GlassCard className="overflow-hidden border-primary/20">
    <div className="flex flex-col gap-3 border-b border-border/70 bg-brand-soft/50 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div><div className="flex items-center gap-2"><Fingerprint className="size-5 text-primary" /><h2 className="font-semibold">今日打卡</h2><Badge variant="neutral">演示工作日 {demoDate}</Badge></div><p className="mt-1 text-xs text-muted-foreground">标准班次 {policy.workStart}–{policy.workEnd} · 午休 {policy.breakStart}–{policy.breakEnd} · 宽限 {policy.graceMinutes} 分钟</p></div>
      <select aria-label="选择打卡方式" value={method} onChange={(event) => setMethod(event.target.value as typeof method)} className="h-9 rounded-xl border border-input bg-background px-3 text-xs"><option value="office_wifi">办公 Wi-Fi</option><option value="mobile_gps">手机定位</option><option value="web">工作站网页</option></select>
    </div>
    <div className="grid gap-3 p-4 sm:grid-cols-[1fr_auto] sm:items-center sm:p-5">
      <div className="grid grid-cols-2 gap-2"><div className="rounded-xl bg-muted/55 p-3"><p className="text-[11px] text-muted-foreground">上班签到</p><p className="mt-1 text-lg font-semibold">{checkIn?.time ?? "--:--"}</p><p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground"><MapPin className="size-3" />{checkIn ? "位置已校验" : policy.locationName}</p></div><div className="rounded-xl bg-muted/55 p-3"><p className="text-[11px] text-muted-foreground">下班签退</p><p className="mt-1 text-lg font-semibold">{checkOut?.time ?? "--:--"}</p><p className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground"><Wifi className="size-3" />{checkOut ? "设备已校验" : policy.wifiName}</p></div></div>
      <div className="flex gap-2 sm:flex-col"><Button size="sm" className="flex-1" disabled={Boolean(checkIn)} onClick={() => punch("check_in")}><Clock3 />{checkIn ? "已签到" : "上班签到"}</Button><Button size="sm" variant="outline" className="flex-1" disabled={!checkIn || Boolean(checkOut)} onClick={() => punch("check_out")}><CheckCircle2 />{checkOut ? "已签退" : "下班签退"}</Button></div>
    </div>
    <div className="px-4 pb-4 sm:px-5"><FeedbackBanner feedback={feedback} /></div>
  </GlassCard>;
}

function AttachmentLinks({ requestId, fileIds }: { requestId: string; fileIds: string[] }) {
  const session = useWorkspaceSession();
  const { state, context } = useOperations(session);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const files = state.files.filter((file) => file.entityType === "attendance" && file.entityId === requestId && fileIds.includes(file.id));
  if (!files.length) return null;
  return <div className="mt-2 grid gap-1">{files.map((file) => <button key={file.id} type="button" className="flex items-center gap-2 rounded-lg bg-muted/60 px-2.5 py-2 text-left text-xs hover:bg-brand-soft" onClick={() => downloadOperationFile(context, file).catch((error) => setFeedback({ message: error instanceof Error ? error.message : "下载失败", error: true }))}><Download className="size-3.5 text-primary" /><span className="min-w-0 flex-1 truncate">{file.name}</span><span className="text-muted-foreground">v{file.version}</span></button>)}<FeedbackBanner feedback={feedback} /></div>;
}

export function AttendanceSelfService() {
  const session = useWorkspaceSession();
  const { state, context, actor } = useOperations(session);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [busy, setBusy] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [correction, setCorrection] = useState({ date: "2026-08-06", issueType: "missing_out" as AttendanceIssueType, correctedTime: "18:06", reason: "下班打卡时网络异常，可核验门禁与任务日志。" });
  const [overtime, setOvertime] = useState({ date: "2026-08-12", startTime: "18:30", endTime: "20:30", reason: "完成关键版本联调与回归验证。" });
  const canApply = actor.role !== "executive" && actor.role !== "hr";
  const ownCorrections = state.attendance.corrections.filter(({ employeeId }) => employeeId === actor.id);
  const ownOvertime = state.attendance.overtimeRequests.filter(({ employeeId }) => employeeId === actor.id);

  async function submitCorrection() {
    setBusy(true);
    try {
      const nextState = submitAttendanceCorrection(context, correction, actor.id);
      const request = nextState.attendance.corrections[0];
      if (attachment) {
        const file = await storeOperationFile({ context, file: attachment, commandId: state.command.id, entityType: "attendance", entityId: request.id, uploadedById: actor.id, version: 1 });
        addOperationFile(context, file);
      }
      setAttachment(null);
      setFeedback({ message: "补卡申请已提交，证明材料已关联，等待负责人审批" });
    } catch (error) {
      setFeedback({ message: error instanceof Error ? error.message : "补卡提交失败", error: true });
    } finally { setBusy(false); }
  }

  function submitOvertime() {
    try {
      submitOvertimeRequest(context, overtime, actor.id);
      setFeedback({ message: "加班申请已提交，审批通过后才计入有效加班时长" });
    } catch (error) { setFeedback({ message: error instanceof Error ? error.message : "加班申请失败", error: true }); }
  }

  if (!canApply) return null;

  return <section className="grid gap-3 xl:grid-cols-2">
    <GlassCard className="p-4 sm:p-5"><div className="flex items-center gap-2"><TimerReset className="size-5 text-primary" /><h2 className="font-semibold">异常补卡</h2></div><p className="mt-1 text-xs text-muted-foreground">提交后依次经过负责人确认和人事规则复核，批准后自动修正考勤。</p><div className="mt-4 grid gap-3"><div className="grid grid-cols-2 gap-2"><label className="grid gap-1.5 text-xs font-medium">异常日期<Input type="date" value={correction.date} onChange={(event) => setCorrection({ ...correction, date: event.target.value })} /></label><label className="grid gap-1.5 text-xs font-medium">异常类型<select value={correction.issueType} onChange={(event) => setCorrection({ ...correction, issueType: event.target.value as AttendanceIssueType })} className="h-10 rounded-xl border border-input bg-background px-3 text-sm"><option value="missing_in">缺上班卡</option><option value="missing_out">缺下班卡</option><option value="late">迟到修正</option><option value="early_leave">早退修正</option></select></label></div><label className="grid gap-1.5 text-xs font-medium">修正时间<Input type="time" value={correction.correctedTime} onChange={(event) => setCorrection({ ...correction, correctedTime: event.target.value })} /></label><label className="grid gap-1.5 text-xs font-medium">补卡原因<Textarea value={correction.reason} onChange={(event) => setCorrection({ ...correction, reason: event.target.value })} /></label><div className="flex flex-wrap items-center gap-2"><Button asChild type="button" size="sm" variant="outline" className="cursor-pointer"><label><FileUp />{attachment ? "更换证明" : "上传证明"}<input className="sr-only" type="file" accept="image/*,.pdf,.doc,.docx" onChange={(event: ChangeEvent<HTMLInputElement>) => setAttachment(event.target.files?.[0] ?? null)} /></label></Button>{attachment ? <span className="max-w-50 truncate text-xs text-muted-foreground">{attachment.name}</span> : <span className="text-[11px] text-muted-foreground">支持图片、PDF、Word，单文件 ≤ 30MB</span>}</div><Button onClick={submitCorrection} disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}{busy ? "正在提交" : "提交补卡申请"}</Button></div></GlassCard>
    <GlassCard className="p-4 sm:p-5"><div className="flex items-center gap-2"><FileClock className="size-5 text-primary" /><h2 className="font-semibold">加班申请</h2></div><p className="mt-1 text-xs text-muted-foreground">工作日 {state.attendance.policy.overtimeStartsAfter} 后、至少 {state.attendance.policy.overtimeMinimumMinutes} 分钟；先审批、后计入。</p><div className="mt-4 grid gap-3"><label className="grid gap-1.5 text-xs font-medium">加班日期<Input type="date" value={overtime.date} onChange={(event) => setOvertime({ ...overtime, date: event.target.value })} /></label><div className="grid grid-cols-2 gap-2"><label className="grid gap-1.5 text-xs font-medium">开始时间<Input type="time" value={overtime.startTime} onChange={(event) => setOvertime({ ...overtime, startTime: event.target.value })} /></label><label className="grid gap-1.5 text-xs font-medium">结束时间<Input type="time" value={overtime.endTime} onChange={(event) => setOvertime({ ...overtime, endTime: event.target.value })} /></label></div><label className="grid gap-1.5 text-xs font-medium">业务原因<Textarea value={overtime.reason} onChange={(event) => setOvertime({ ...overtime, reason: event.target.value })} /></label><div className="rounded-xl bg-warning-soft/60 px-3 py-2 text-xs text-warning">审批通过的加班时长进入调休 / 加班费计算；仅打卡不自动认定加班。</div><Button onClick={submitOvertime}><ArrowRight />提交加班申请</Button></div></GlassCard>
    <GlassCard className="p-4 sm:p-5 xl:col-span-2"><h2 className="font-semibold">我的申请记录</h2><div className="mt-3 grid gap-2 sm:grid-cols-2">{ownCorrections.map((request) => <div key={request.id} className="rounded-xl border border-border/70 p-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">{issueLabel[request.issueType]} · {request.date}</p><Badge variant={reviewStatusMeta[request.status].variant}>{reviewStatusMeta[request.status].label}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{request.code} · 修正为 {request.correctedTime}</p><AttachmentLinks requestId={request.id} fileIds={request.attachmentFileIds} /></div>)}{ownOvertime.map((request) => <div key={request.id} className="rounded-xl border border-border/70 p-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">加班 {request.hours} 小时 · {request.date}</p><Badge variant={reviewStatusMeta[request.status].variant}>{reviewStatusMeta[request.status].label}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{request.code} · {request.startTime}–{request.endTime}</p></div>)}{!ownCorrections.length && !ownOvertime.length ? <p className="text-xs text-muted-foreground">暂无补卡或加班申请。</p> : null}</div></GlassCard>
    <div className="xl:col-span-2"><FeedbackBanner feedback={feedback} /></div>
  </section>;
}

function ApprovalCard({ kind, request }: { kind: "correction"; request: AttendanceCorrectionRequest } | { kind: "overtime"; request: AttendanceOvertimeRequest }) {
  const session = useWorkspaceSession();
  const { context, actor } = useOperations(session);
  const [comment, setComment] = useState("");
  const [feedback, setFeedback] = useState<Feedback>(null);
  const employee = getActor(request.employeeId);
  const canReview = (request.status === "pending_manager" && (request.managerId === actor.id || actor.role === "executive")) || (request.status === "pending_hr" && actor.role === "hr");

  function review(action: "approve" | "reject") {
    try {
      if (kind === "correction") reviewAttendanceCorrection(context, request.id, action, actor.id, comment);
      else reviewOvertimeRequest(context, request.id, action, actor.id, comment);
      setComment("");
      setFeedback({ message: action === "approve" ? "已通过并推送到下一责任节点" : "已驳回并通知申请人" });
    } catch (error) { setFeedback({ message: error instanceof Error ? error.message : "审批失败", error: true }); }
  }

  return <article id={`attendance-${request.id}`} className="scroll-mt-24 rounded-2xl border border-border/70 bg-white/55 p-4 transition target:border-primary target:ring-2 target:ring-primary/20"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold">{employee.name} · {kind === "correction" ? issueLabel[request.issueType] : `加班 ${request.hours} 小时`}</h3><Badge variant={reviewStatusMeta[request.status].variant}>{reviewStatusMeta[request.status].label}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{request.code} · {request.date}{kind === "correction" ? ` · 修正 ${request.correctedTime}` : ` · ${request.startTime}–${request.endTime}`}</p></div><Badge variant="outline">{employee.department}</Badge></div><p className="mt-3 rounded-xl bg-muted/55 px-3 py-2 text-xs leading-5">{request.reason}</p>{kind === "correction" ? <AttachmentLinks requestId={request.id} fileIds={request.attachmentFileIds} /> : null}{request.managerComment ? <p className="mt-2 text-xs text-muted-foreground"><strong className="text-foreground">负责人：</strong>{request.managerComment}</p> : null}{request.hrComment ? <p className="mt-1 text-xs text-muted-foreground"><strong className="text-foreground">人事：</strong>{request.hrComment}</p> : null}{canReview ? <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-border/70 pt-3"><Textarea aria-label={`${request.code}审批意见`} value={comment} onChange={(event) => setComment(event.target.value)} placeholder="审批意见；驳回时必填" className="min-h-9 w-full resize-none sm:w-72" /><Button size="sm" onClick={() => review("approve")}><Check />同意</Button><Button size="sm" variant="outline" onClick={() => review("reject")}><X />驳回</Button></div> : null}<div className="mt-2"><FeedbackBanner feedback={feedback} /></div></article>;
}

export function AttendanceApprovalQueue() {
  const session = useWorkspaceSession();
  const { state, actor } = useOperations(session);
  const corrections = useMemo(() => state.attendance.corrections.filter((request) => actor.role === "hr" ? request.status === "pending_hr" : actor.role === "executive" ? request.status === "pending_manager" && request.managerId === actor.id : actor.role === "department_head" ? request.status === "pending_manager" && request.managerId === actor.id : request.employeeId === actor.id), [actor.id, actor.role, state.attendance.corrections]);
  const overtime = useMemo(() => state.attendance.overtimeRequests.filter((request) => actor.role === "hr" ? request.status === "pending_hr" : actor.role === "executive" ? request.status === "pending_manager" && request.managerId === actor.id : actor.role === "department_head" ? request.status === "pending_manager" && request.managerId === actor.id : request.employeeId === actor.id), [actor.id, actor.role, state.attendance.overtimeRequests]);
  return <GlassCard className="p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold">{actor.role === "department_head" || actor.role === "hr" || actor.role === "executive" ? "考勤审批队列" : "我的考勤申请"}</h2><p className="mt-1 text-xs text-muted-foreground">补卡：员工 → 负责人 → 人事；加班：先审批，批准后计入有效工时。</p></div><Badge variant="info">{corrections.length + overtime.length} 项</Badge></div><div className="mt-4 grid gap-3">{corrections.map((request) => <ApprovalCard key={request.id} kind="correction" request={request} />)}{overtime.map((request) => <ApprovalCard key={request.id} kind="overtime" request={request} />)}{!corrections.length && !overtime.length ? <div className="rounded-2xl border border-dashed border-border p-8 text-center"><CheckCircle2 className="mx-auto text-success" /><p className="mt-2 font-medium">当前没有待处理事项</p><p className="mt-1 text-xs text-muted-foreground">新的异常或加班申请会按责任人自动进入这里。</p></div> : null}</div></GlassCard>;
}

export function AttendancePolicyAndPeriod() {
  const session = useWorkspaceSession();
  const { state, context, actor } = useOperations(session);
  const policy = state.attendance.policy;
  const period = state.attendance.period;
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [form, setForm] = useState({ workStart: policy.workStart, workEnd: policy.workEnd, breakStart: policy.breakStart, breakEnd: policy.breakEnd, graceMinutes: String(policy.graceMinutes), overtimeStartsAfter: policy.overtimeStartsAfter, overtimeMinimumMinutes: String(policy.overtimeMinimumMinutes), correctionDeadlineDays: String(policy.correctionDeadlineDays) });
  const unresolvedCorrections = state.attendance.corrections.filter((item) => item.date.startsWith(period.month) && ["pending_manager", "pending_hr"].includes(item.status));
  const unresolvedOvertime = state.attendance.overtimeRequests.filter((item) => item.date.startsWith(period.month) && ["pending_manager", "pending_hr"].includes(item.status));
  const unresolvedCount = unresolvedCorrections.length + unresolvedOvertime.length;
  const approvedLeaveDays = state.leaveRequests.filter((item) => item.status === "approved" && item.startDate.startsWith(period.month)).reduce((sum, item) => sum + item.days, 0);
  const approvedOvertimeHours = state.attendance.overtimeRequests.filter((item) => item.status === "approved" && item.date.startsWith(period.month)).reduce((sum, item) => sum + item.hours, 0);
  const canEdit = actor.role === "hr";

  function savePolicy() {
    try {
      updateAttendancePolicy(context, { ...form, graceMinutes: Number(form.graceMinutes), overtimeMinimumMinutes: Number(form.overtimeMinimumMinutes), correctionDeadlineDays: Number(form.correctionDeadlineDays) }, actor.id);
      setFeedback({ message: "考勤制度已保存，所有角色工作台已同步新规则" });
    } catch (error) { setFeedback({ message: error instanceof Error ? error.message : "制度保存失败", error: true }); }
  }

  function lockPeriod() {
    try { lockAttendancePeriod(context, actor.id); setFeedback({ message: `${period.month} 考勤已封账，薪资输入已生成并交给财务` }); }
    catch (error) { setFeedback({ message: error instanceof Error ? error.message : "封账失败", error: true }); }
  }

  function exportPayrollInput() {
    const rows = ["月份,计薪人数,标准工作日,已批准请假天数,有效加班小时,考勤调整数,待处理事项", `${period.month},${period.headcount},${period.scheduledWorkdays},${approvedLeaveDays},${approvedOvertimeHours},${period.adjustmentCount},${unresolvedCount}`];
    const url = URL.createObjectURL(new Blob([`\uFEFF${rows.join("\n")}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${period.month}-考勤薪资输入.csv`;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    setFeedback({ message: "薪资输入 CSV 已导出" });
  }

  return <section className="grid gap-3 xl:grid-cols-[1.35fr_1fr]">
    <GlassCard className="p-4 sm:p-5"><div className="flex flex-wrap items-start justify-between gap-2"><div><div className="flex items-center gap-2"><ShieldCheck className="size-5 text-primary" /><h2 className="font-semibold">考勤制度</h2><Badge variant="success">生效中</Badge></div><p className="mt-1 text-xs text-muted-foreground">{policy.name} · {policy.effectiveDate} 起生效 · 由{getActor(policy.updatedById).name}维护</p></div>{canEdit ? <Button size="sm" onClick={savePolicy}><Check />保存制度</Button> : <Badge variant="outline">仅人事可修改</Badge>}</div><div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-xs font-medium">上班时间<Input type="time" value={form.workStart} disabled={!canEdit} onChange={(event) => setForm({ ...form, workStart: event.target.value })} /></label><label className="grid gap-1.5 text-xs font-medium">下班时间<Input type="time" value={form.workEnd} disabled={!canEdit} onChange={(event) => setForm({ ...form, workEnd: event.target.value })} /></label><label className="grid gap-1.5 text-xs font-medium">午休开始<Input type="time" value={form.breakStart} disabled={!canEdit} onChange={(event) => setForm({ ...form, breakStart: event.target.value })} /></label><label className="grid gap-1.5 text-xs font-medium">午休结束<Input type="time" value={form.breakEnd} disabled={!canEdit} onChange={(event) => setForm({ ...form, breakEnd: event.target.value })} /></label><label className="grid gap-1.5 text-xs font-medium">迟到宽限（分钟）<Input type="number" min="0" max="30" value={form.graceMinutes} disabled={!canEdit} onChange={(event) => setForm({ ...form, graceMinutes: event.target.value })} /></label><label className="grid gap-1.5 text-xs font-medium">补卡期限（天）<Input type="number" min="1" max="15" value={form.correctionDeadlineDays} disabled={!canEdit} onChange={(event) => setForm({ ...form, correctionDeadlineDays: event.target.value })} /></label><label className="grid gap-1.5 text-xs font-medium">加班起算时间<Input type="time" value={form.overtimeStartsAfter} disabled={!canEdit} onChange={(event) => setForm({ ...form, overtimeStartsAfter: event.target.value })} /></label><label className="grid gap-1.5 text-xs font-medium">最短加班（分钟）<Input type="number" min="30" step="30" value={form.overtimeMinimumMinutes} disabled={!canEdit} onChange={(event) => setForm({ ...form, overtimeMinimumMinutes: event.target.value })} /></label></div><div className="mt-4 grid gap-2 sm:grid-cols-2"><div className="rounded-xl bg-muted/55 p-3 text-xs"><p className="font-medium">打卡范围与方式</p><p className="mt-1 leading-5 text-muted-foreground">{policy.locationName} · {policy.geofenceMeters} 米围栏<br />{policy.wifiName} · 手机定位 / 办公 Wi-Fi / 网页</p></div><div className="rounded-xl bg-muted/55 p-3 text-xs"><p className="font-medium">标准工时与异常</p><p className="mt-1 leading-5 text-muted-foreground">周一至周五 · 每日 {policy.dailyHours} 小时<br />缺卡、迟到、早退须在 {policy.correctionDeadlineDays} 天内申请修正</p></div></div></GlassCard>
    <GlassCard className="p-4 sm:p-5"><div className="flex items-center justify-between gap-2"><div><div className="flex items-center gap-2"><LockKeyhole className="size-5 text-primary" /><h2 className="font-semibold">{period.month} 月度封账</h2></div><p className="mt-1 text-xs text-muted-foreground">封账后生成薪资输入；记录不可直接改动并保留审计日志。</p></div><Badge variant={period.status === "locked" ? "success" : period.status === "review" ? "warning" : "neutral"}>{period.status === "locked" ? "已封账" : period.status === "review" ? "复核中" : "开放中"}</Badge></div><div className="mt-4 grid grid-cols-2 gap-2">{[{ label: "计薪人数", value: `${period.headcount} 人` }, { label: "标准工作日", value: `${period.scheduledWorkdays} 天` }, { label: "已批请假", value: `${approvedLeaveDays} 天` }, { label: "有效加班", value: `${approvedOvertimeHours} 小时` }, { label: "考勤调整", value: `${period.adjustmentCount} 项` }, { label: "待处理事项", value: `${unresolvedCount} 项` }].map((item) => <div key={item.label} className="rounded-xl bg-muted/55 p-3"><p className="text-base font-semibold">{item.value}</p><p className="mt-0.5 text-[11px] text-muted-foreground">{item.label}</p></div>)}</div>{unresolvedCount ? <div className="mt-3 flex items-start gap-2 rounded-xl bg-warning-soft/65 p-3 text-xs text-warning"><AlertTriangle className="mt-0.5 size-4 shrink-0" /><p>仍有 {unresolvedCount} 项补卡或加班事项未完成负责人 / 人事审批，处理完后才能封账。</p></div> : <div className="mt-3 flex items-start gap-2 rounded-xl bg-success-soft/65 p-3 text-xs text-success"><CheckCircle2 className="mt-0.5 size-4 shrink-0" /><p>补卡与加班事项已清零，符合封账条件。</p></div>}<div className="mt-4 grid gap-2 sm:grid-cols-2">{canEdit && period.status !== "locked" ? <Button onClick={lockPeriod} disabled={unresolvedCount > 0}><LockKeyhole />完成考勤封账</Button> : null}{period.status === "locked" ? <Button variant="outline" onClick={exportPayrollInput}><Download />导出薪资输入</Button> : null}<Button asChild variant="outline"><Link href="/payroll"><Banknote />查看薪资周期</Link></Button></div>{period.lockedAt ? <p className="mt-3 text-[11px] text-muted-foreground">{getActor(period.lockedById ?? "actor-hr").name}于 {new Date(period.lockedAt).toLocaleString("zh-CN")} 完成封账</p> : null}</GlassCard>
    <div className="xl:col-span-2"><FeedbackBanner feedback={feedback} /></div>
  </section>;
}

export function AttendanceResetNotice() {
  const session = useWorkspaceSession();
  const { context, isFixtureBound } = useOperations(session);
  const [resetDone, setResetDone] = useState(false);
  if (!isFixtureBound) return null;
  return <div className="flex items-center gap-2"><Button type="button" size="sm" variant="ghost" className="h-8 text-xs text-muted-foreground" onClick={() => { resetOperationsState(context); setResetDone(true); }}><RotateCcw />重置考勤演示</Button>{resetDone ? <span role="status" className="text-[11px] text-success">已恢复初始流程</span> : null}</div>;
}
