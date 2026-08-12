"use client";

import Link from "next/link";
import { useMemo, useState, type ChangeEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Banknote,
  CheckCircle2,
  CircleDot,
  Clock3,
  Download,
  FileCheck2,
  FileUp,
  FolderClock,
  GitPullRequestArrow,
  LoaderCircle,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Textarea } from "@/components/ui/textarea";
import { useCustomerDemoSession, useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import type { WorkspaceRole } from "@/features/auth/workspace-session-types";
import { createCustomerDemoDeliverableFile } from "@/features/demo/customer-demo-deliverable";
import { downloadOperationFile, storeOperationFile } from "@/features/operations/file-storage";
import { OperationActionInbox } from "@/features/operations/operation-action-inbox";
import {
  addOperationFile,
  createSupportRequest,
  operationFixtureActors,
  getActor,
  getTaskReviewerId,
  resetOperationsState,
  updateOperationTask,
  updateSupportRequest,
} from "@/features/operations/operations-data";
import type { OperationFile, OperationTask, OperationTaskStatus, SupportRequest } from "@/features/operations/operations-types";
import { useOperations } from "@/features/operations/use-operations";
import { cn } from "@/lib/utils";

const taskStatusMeta: Record<OperationTaskStatus, { label: string; variant: "neutral" | "info" | "warning" | "success" | "destructive" }> = {
  todo: { label: "待执行", variant: "neutral" },
  in_progress: { label: "进行中", variant: "info" },
  blocked: { label: "已阻塞", variant: "destructive" },
  review: { label: "待验收", variant: "warning" },
  done: { label: "已完成", variant: "success" },
};

const taskStatusOrder: Record<OperationTaskStatus, number> = {
  blocked: 0,
  review: 1,
  in_progress: 2,
  todo: 3,
  done: 4,
};

const supportStatusMeta = {
  pending: { label: "待处理", variant: "warning" as const },
  approved: { label: "已批准", variant: "info" as const },
  in_progress: { label: "办理中", variant: "info" as const },
  completed: { label: "已完成", variant: "success" as const },
  rejected: { label: "已驳回", variant: "destructive" as const },
};

const roleCopy: Record<Exclude<WorkspaceRole, "executive">, { title: string; eyebrow: string; description: string; upstream: string; downstream: string }> = {
  department_head: { title: "负责人推进台", eyebrow: "部门目标 → 个人任务", description: "确认部门承接目标，明确唯一执行人，处理阻塞并验收员工成果。", upstream: "接收李总确认的部门目标", downstream: "验收后回流决策中心并形成成果记录" },
  employee: { title: "我的执行台", eyebrow: "个人任务 → 可验收成果", description: "只保留分配到本人的任务，执行过程中可反馈阻塞、申请协同并上传真实成果。", upstream: "接收负责人分配的任务", downstream: "提交成果给负责人验收" },
  finance: { title: "财务执行中心", eyebrow: "预算申请 → 审批付款", description: "处理命令推进过程中产生的预算、采购与付款事项，并归集凭证。", upstream: "接收任务发起的财务协同", downstream: "办理结果回写任务与领导驾驶舱" },
  hr: { title: "人事协同中心", eyebrow: "人员需求 → 调配培训", description: "处理人员调配、招聘与培训需求，确保任务有合适的人和清晰的责任边界。", upstream: "接收负责人发起的人事协同", downstream: "到岗与培训结果回写执行任务" },
};

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function OperationUpload({ entityType, entityId, label = "上传成果", onFeedback }: { entityType: OperationFile["entityType"]; entityId: string; label?: string; onFeedback: (message: string, tone?: "error" | "success") => void }) {
  const session = useWorkspaceSession();
  const demo = useCustomerDemoSession();
  const { state, context, actor } = useOperations(session);
  const [busy, setBusy] = useState(false);

  async function saveFile(file: File) {
    setBusy(true);
    try {
      const version = state.files.filter((item) => item.entityType === entityType && item.entityId === entityId && item.name === file.name).length + 1;
      const stored = await storeOperationFile({ context, file, commandId: state.command.id, entityType, entityId, uploadedById: actor.id, version });
      addOperationFile(context, stored);
      onFeedback(`${file.name} 已上传并关联到当前${entityType === "task" ? "任务" : entityType === "support" ? "协同事项" : "知识文档"}`);
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : "文件上传失败", "error");
    } finally {
      setBusy(false);
    }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) await saveFile(file);
  }

  return (
    <>
      <Button asChild type="button" variant="outline" size="sm" className="cursor-pointer">
        <label>{busy ? <LoaderCircle className="animate-spin" /> : <FileUp />}{busy ? "上传中…" : label}<input className="sr-only" type="file" onChange={upload} disabled={busy} /></label>
      </Button>
      {demo.enabled && entityType === "task" ? (
        <><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => saveFile(createCustomerDemoDeliverableFile())}>
          <Sparkles aria-hidden="true" />使用演示成果
        </Button><span className="basis-full text-[11px] leading-5 text-muted-foreground">演示快捷操作：自动添加一份可验收的示例成果，也可以使用左侧真实上传入口。</span></>
      ) : null}
    </>
  );
}

function TaskFiles({ taskId, files, onFeedback }: { taskId: string; files: OperationFile[]; onFeedback: (message: string, tone?: "error" | "success") => void }) {
  const session = useWorkspaceSession();
  const { context } = useOperations(session);
  const relevant = files.filter(({ entityType, entityId }) => entityType === "task" && entityId === taskId);
  if (!relevant.length) return <p className="text-xs text-muted-foreground">尚未上传成果，提交验收前至少上传一个文件。</p>;
  return (
    <div className="grid gap-1.5">
      {relevant.map((file) => (
        <button key={file.id} type="button" onClick={() => downloadOperationFile(context, file).catch((error) => onFeedback(error instanceof Error ? error.message : "下载失败", "error"))} className="flex items-center gap-2 rounded-lg bg-background/80 px-2.5 py-2 text-left text-xs transition-colors hover:bg-brand-soft">
          <FileCheck2 className="size-3.5 shrink-0 text-primary" /><span className="min-w-0 flex-1 truncate">{file.name}</span><span className="text-muted-foreground">v{file.version} · {formatBytes(file.sizeBytes)}</span><Download className="size-3.5" />
        </button>
      ))}
    </div>
  );
}

function TaskCard({ task, onFeedback }: { task: OperationTask; onFeedback: (message: string, tone?: "error" | "success") => void }) {
  const session = useWorkspaceSession();
  const demo = useCustomerDemoSession();
  const { state, context, actor } = useOperations(session);
  const [note, setNote] = useState("");
  const meta = taskStatusMeta[task.status];
  const assignee = getActor(task.assigneeId);
  const assigneeOptions = operationFixtureActors.filter((candidate) =>
    candidate.department === task.department
    && ["employee", "department_head", "finance", "hr"].includes(candidate.role),
  );
  const files = state.files.filter(({ entityType, entityId }) => entityType === "task" && entityId === task.id);
  const isAssignee = task.assigneeId === actor.id;
  const isReviewer = getTaskReviewerId(task) === actor.id;
  const reviewer = getActor(getTaskReviewerId(task));
  const canAssign = task.departmentOwnerId === actor.id && !["review", "done"].includes(task.status);
  const slaDueAt = task.status === "review" ? task.reviewDueAt : task.status === "blocked" ? task.blockerDueAt : undefined;
  const returnedForChanges = task.status === "in_progress" && Boolean(task.reviewNote);
  const progressHint = task.status === "review"
    ? isAssignee
      ? `你已完成个人提交，当前由${reviewer.name}验收；通过后进度会自动到 100%。`
      : isReviewer
        ? `${assignee.name}已完成个人提交；你验收通过后任务会自动到 100%。`
        : `执行人已完成提交，当前由${reviewer.name}验收；通过后进度会自动到 100%。`
    : task.status === "done"
      ? "已验收通过，任务达到 100% 并完成闭环。"
      : task.status === "todo"
        ? "这是你的独立任务，点击“开始执行”即可推进。"
        : "上传成果后点击“提交验收”，你的个人操作就完成了。";

  function update(status: OperationTaskStatus, message: string, extra?: Partial<OperationTask>) {
    try {
      updateOperationTask(context, task.id, { status, ...extra }, actor.id, session.actor);
      setNote("");
      onFeedback(message);
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : "任务保存失败", "error");
    }
  }

  return (
    <article id={`task-${task.id}`} className={cn("scroll-mt-24 rounded-2xl border bg-white/60 p-4 transition target:border-primary target:ring-2 target:ring-primary/20", task.status === "blocked" ? "border-destructive/30" : "border-border/70")}>
      <div className="flex flex-wrap items-start gap-3">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", task.status === "done" ? "bg-success-soft text-success" : task.status === "blocked" ? "bg-danger-soft text-destructive" : "bg-brand-soft text-primary")}>{task.status === "done" ? <CheckCircle2 /> : task.status === "blocked" ? <AlertTriangle /> : <CircleDot />}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-primary">{task.code}</span><Badge variant={meta.variant}>{meta.label}</Badge><Badge variant={task.priority === "urgent" ? "destructive" : "outline"}>{task.priority === "urgent" ? "紧急" : "高优先级"}</Badge></div>
          <h3 className="mt-1.5 text-base font-semibold">{task.title}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{task.summary}</p>
        </div>
        <div className="ml-auto flex shrink-0 flex-col items-end gap-2 text-right"><div><p className="text-[11px] text-muted-foreground">截止时间</p><p className="mt-1 text-sm font-semibold">{task.dueDate}</p></div>{isAssignee && task.status === "todo" ? <Button size="sm" aria-label={`开始执行：${task.title}`} onClick={() => update("in_progress", "任务已开始执行", { progress: 20 })}>开始执行<ArrowRight /></Button> : null}</div>
      </div>

      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1.25fr]">
        <div className="rounded-xl bg-muted/55 p-3">
          <p className="text-[11px] text-muted-foreground">唯一执行人</p>
          {canAssign ? (
            <select aria-label={`${task.title}执行人`} value={task.assigneeId} onChange={(event) => { updateOperationTask(context, task.id, { assigneeId: event.target.value }, actor.id, session.actor); onFeedback(`已将任务分配给 ${getActor(event.target.value).name}`); }} className="mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm font-medium">
              {assigneeOptions.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.title}</option>)}
            </select>
          ) : <div className="mt-1.5 flex items-center gap-2"><Avatar size="sm"><AvatarFallback className="bg-brand-soft text-primary">{assignee.name.slice(0, 1)}</AvatarFallback></Avatar><span className="text-sm font-medium">{assignee.name} · {assignee.title}</span></div>}
        </div>
        <div className="rounded-xl bg-success-soft/55 p-3"><p className="text-[11px] text-success">验收标准</p><p className="mt-1.5 text-xs leading-5">{task.acceptance}</p></div>
      </div>

      <div className="mt-3"><div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">任务闭环进度</span><span className="font-semibold text-primary">{task.progress}%</span></div><ProgressBar value={task.progress} className="mt-1.5 h-1.5" /><p className="mt-2 text-xs leading-5 text-muted-foreground">{progressHint}</p></div>
      {task.blocker ? <p className="mt-3 rounded-xl bg-danger-soft px-3 py-2 text-xs text-destructive"><strong>当前阻塞：</strong>{task.blocker}</p> : null}
      {task.reviewNote ? <div className="mt-3 rounded-xl bg-warning-soft px-3 py-2 text-xs text-warning"><p><strong>验收意见：</strong>{task.reviewNote}</p>{returnedForChanges && isAssignee ? <p className="mt-1 font-medium">补充说明后重新提交，完成后将再次通知张伟验收。</p> : null}</div> : null}
      {slaDueAt ? <p className={cn("mt-2 flex items-center gap-1.5 text-xs", task.escalationLevel === "executive" ? "font-semibold text-destructive" : "text-muted-foreground")}><Clock3 className="size-3.5" />处理时限 {new Date(slaDueAt).toLocaleString("zh-CN")}{task.escalationLevel === "executive" ? " · 已升级领导" : ""}</p> : null}

      <div className="mt-3 rounded-xl border border-dashed border-border/80 bg-muted/25 p-3"><p className="mb-2 text-[11px] font-medium text-muted-foreground">任务成果与版本</p><TaskFiles taskId={task.id} files={state.files} onFeedback={onFeedback} /></div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        {isAssignee ? (
          <>
            {task.status === "in_progress" || task.status === "blocked" ? <OperationUpload entityType="task" entityId={task.id} onFeedback={onFeedback} /> : null}
            {task.status === "in_progress" && files.length ? <Button size="sm" onClick={() => update("review", "成果已提交给负责人验收")}>提交验收</Button> : null}
            {task.status === "in_progress" ? <Button size="sm" variant="outline" onClick={() => update("blocked", "已上报任务阻塞", { blocker: note.trim() || "需要负责人协调资源或处理当前阻塞。" })}>上报阻塞</Button> : null}
            {task.status === "in_progress" || task.status === "blocked" ? <Button size="sm" variant="ghost" onClick={() => { createSupportRequest(context, task.id, "finance", actor.id); onFeedback("财务协同申请已发送"); }}><Banknote />申请预算</Button> : null}
            {task.status === "in_progress" || task.status === "blocked" ? <Button size="sm" variant="ghost" onClick={() => { createSupportRequest(context, task.id, "staffing", actor.id); onFeedback("人事协同申请已发送"); }}><UsersRound />申请人员</Button> : null}
          </>
        ) : null}
        {isReviewer ? (
          <>
            {task.status === "review" && demo.enabled ? <Button size="sm" variant="ghost" onClick={() => setNote("请补充角色切换说明和验收步骤截图后重新提交。")}>填入退回示例</Button> : null}
            {task.status === "review" && demo.enabled ? <Button size="sm" variant="ghost" onClick={() => setNote("验收通过，说明完整，流程可复现。")}>填入通过示例</Button> : null}
            {task.status === "review" ? <Button size="sm" disabled={(task.deliverableRequired && files.length === 0) || !note.trim()} onClick={() => update("done", "成果已通过验收，结果已同步给林远进行总验收", { reviewNote: note.trim() })}><ShieldCheck />通过验收</Button> : null}
            {task.status === "review" ? <Button size="sm" variant="outline" disabled={!note.trim()} onClick={() => update("in_progress", `成果已退回${assignee.name}修改，返工事项已同步到他的执行台`, { reviewNote: note.trim(), progress: 70 })}>退回修改</Button> : null}
            {task.status === "blocked" ? <Button size="sm" onClick={() => update("in_progress", "阻塞已解除，任务恢复执行", { blocker: undefined, progress: Math.max(task.progress, 30) })}>解除阻塞</Button> : null}
          </>
        ) : null}
        {(isAssignee && ["in_progress", "blocked"].includes(task.status)) || (isReviewer && task.status === "review") ? <Textarea aria-label="进度、阻塞或验收意见" value={note} onChange={(event) => setNote(event.target.value)} placeholder={isReviewer && task.status === "review" ? "填写验收意见（必填）" : "补充进度或阻塞说明（可选）"} className="ml-auto min-h-9 w-full resize-none sm:w-68" /> : null}
      </div>
    </article>
  );
}

function SupportCard({ request, role, onFeedback }: { request: SupportRequest; role: "finance" | "hr"; onFeedback: (message: string, tone?: "error" | "success") => void }) {
  const session = useWorkspaceSession();
  const { state, context, actor } = useOperations(session);
  const meta = supportStatusMeta[request.status];
  const sourceTask = state.tasks.find(({ id }) => id === request.sourceTaskId);
  const files = state.files.filter(({ entityType, entityId }) => entityType === "support" && entityId === request.id);
  const action = (status: SupportRequest["status"], message: string, result?: string) => { updateSupportRequest(context, request.id, status, actor.id, result); onFeedback(message); };
  return (
    <article id={`support-${request.id}`} className="scroll-mt-24 rounded-2xl border border-border/70 bg-white/60 p-4 transition target:border-primary target:ring-2 target:ring-primary/20">
      <div className="flex flex-wrap items-start gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-primary">{role === "finance" ? <Banknote /> : <UserRoundCheck />}</span>
        <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><Badge variant={meta.variant}>{meta.label}</Badge><span className="text-xs text-muted-foreground">来自 {sourceTask?.code ?? "任务"}</span></div><h3 className="mt-1.5 font-semibold">{request.title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{request.description}</p></div>
        {request.amountWan ? <div className="rounded-xl bg-warning-soft px-3 py-2 text-right"><p className="text-[11px] text-warning">申请金额</p><p className="font-semibold text-warning">{request.amountWan} 万元</p></div> : null}
      </div>
      {request.result ? <p className="mt-3 rounded-xl bg-success-soft px-3 py-2 text-xs text-success"><strong>办理结果：</strong>{request.result}</p> : null}
      {files.length ? <div className="mt-3"><TaskFiles taskId={request.id} files={state.files.map((file) => file.entityType === "support" ? { ...file, entityType: "task" as const } : file)} onFeedback={onFeedback} /></div> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {request.status === "pending" ? <Button size="sm" onClick={() => action("approved", "申请已批准")}>批准申请</Button> : null}
        {request.status === "approved" ? <Button size="sm" onClick={() => action("in_progress", "协同事项开始办理")}>开始办理</Button> : null}
        {request.status === "in_progress" ? <><OperationUpload entityType="support" entityId={request.id} label={role === "finance" ? "上传付款凭证" : "上传人员方案"} onFeedback={onFeedback} /><Button size="sm" disabled={!files.length} onClick={() => action("completed", "协同事项已办结并回写任务", role === "finance" ? "预算已核验，采购流程完成，付款凭证已归集。" : "人员与培训安排已经落实，可按计划投入执行。")}>完成并回写</Button></> : null}
      </div>
    </article>
  );
}

export function RoleWorkbench({ role }: { role: Exclude<WorkspaceRole, "executive"> }) {
  const session = useWorkspaceSession();
  const demo = useCustomerDemoSession();
  const { state, context, actor, isFixtureBound } = useOperations(session);
  const [feedback, setFeedback] = useState<{ message: string; tone: "error" | "success" } | null>(null);
  const copy = roleCopy[role];

  const tasks = useMemo(() => {
    const visibleTasks = role === "department_head"
      ? state.tasks.filter(({ departmentOwnerId }) => departmentOwnerId === actor.id)
      : state.tasks.filter(({ assigneeId }) => assigneeId === actor.id);
    return [...visibleTasks].sort((left, right) => taskStatusOrder[left.status] - taskStatusOrder[right.status]);
  }, [actor.id, role, state.tasks]);
  const supportRequests = useMemo(() => role === "finance"
    ? state.supportRequests.filter(({ type }) => type === "finance")
    : role === "hr" ? state.supportRequests.filter(({ type }) => type === "staffing" || type === "training") : [], [role, state.supportRequests]);
  const done = tasks.filter(({ status }) => status === "done").length;
  const attention = tasks.filter(({ status, reviewNote }) => status === "blocked" || status === "review" || (status === "in_progress" && Boolean(reviewNote))).length + supportRequests.filter(({ status }) => status === "pending").length;

  function notify(message: string, tone: "error" | "success" = "success") {
    setFeedback({ message, tone });
    window.setTimeout(() => setFeedback(null), 3_500);
  }

  return (
    <main className="mx-auto flex w-full max-w-420 flex-col gap-3 px-3 pt-4 pb-26 sm:px-4 lg:px-5 lg:pt-6 lg:pb-8">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div><p className="text-xs font-semibold tracking-[0.18em] text-primary">{copy.eyebrow}</p><h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{copy.title}</h1><p className="mt-1.5 max-w-3xl text-sm text-muted-foreground">{copy.description}</p></div>
        <div className="flex items-center gap-2 rounded-2xl border border-border/70 bg-white/60 px-3 py-2"><Avatar><AvatarFallback className="bg-brand-soft text-primary">{actor.name.slice(0, 1)}</AvatarFallback></Avatar><div><p className="text-sm font-semibold">{actor.name} · {actor.title}</p><p className="text-xs text-muted-foreground">{actor.department}</p></div></div>
      </header>

      <GlassCard className="grid gap-2 p-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:p-4"><div><p className="text-[11px] text-muted-foreground">上游输入</p><p className="mt-1 text-sm font-medium">{copy.upstream}</p></div><ArrowRight className="hidden text-border sm:block" /><div className="sm:text-right"><p className="text-[11px] text-muted-foreground">下游结果</p><p className="mt-1 text-sm font-medium">{copy.downstream}</p></div></GlassCard>

      <section className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {[{ label: "当前命令", value: state.command.status === "executing" ? "执行中" : "待总验收", icon: GitPullRequestArrow }, { label: role === "finance" || role === "hr" ? "任务与协同" : "我的任务", value: `${tasks.length + supportRequests.length} 项`, icon: FolderClock }, { label: "已完成", value: `${done} 项`, icon: CheckCircle2 }, { label: "需要关注", value: `${attention} 项`, icon: AlertTriangle }].map(({ label, value, icon: Icon }) => <GlassCard key={label} className="flex items-center gap-3 p-3.5"><span className="grid size-10 place-items-center rounded-xl bg-brand-soft text-primary"><Icon /></span><div><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-0.5 text-lg font-semibold">{value}</p></div></GlassCard>)}
      </section>

      {feedback ? <p role="status" className={cn("rounded-xl px-3 py-2 text-sm font-medium", feedback.tone === "error" ? "bg-danger-soft text-destructive" : "bg-success-soft text-success")}>{feedback.message}</p> : null}

      <OperationActionInbox state={state} actor={actor} />

      <section className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_19rem]">
        <GlassCard className="p-4 sm:p-5">
          <div className="flex items-center justify-between"><div><h2 className="font-semibold">{role === "finance" || role === "hr" ? "工作任务与协同" : "执行任务"}</h2><p className="mt-1 text-xs text-muted-foreground">所有操作会写入同一条命令时间线，并同步到相关角色。</p></div><Badge variant="info">实时共享</Badge></div>
          <div className="mt-4 grid gap-3">
            {tasks.map((task) => <TaskCard key={task.id} task={task} onFeedback={notify} />)}
            {(role === "finance" || role === "hr") ? supportRequests.map((request) => <SupportCard key={request.id} request={request} role={role} onFeedback={notify} />) : null}
            {!tasks.length && !supportRequests.length ? <div className="rounded-2xl border border-dashed border-border p-10 text-center"><CheckCircle2 className="mx-auto text-success" /><p className="mt-2 font-medium">当前没有待办事项</p><p className="mt-1 text-xs text-muted-foreground">新的任务或协同申请会自动出现在这里。</p></div> : null}
          </div>
        </GlassCard>

        <aside className="grid h-fit gap-3 xl:sticky xl:top-22">
          <GlassCard className="p-4"><div className="flex items-center gap-2"><Clock3 className="size-4 text-primary" /><h2 className="font-semibold">最近流转</h2></div><div className="mt-3 grid gap-3">{state.events.slice(0, 6).map((item) => <div key={item.id} className="border-l-2 border-brand-soft pl-3"><p className="text-xs font-medium">{item.action} · {item.actorName ?? getActor(item.actorId).name}</p><p className="mt-1 text-[11px] leading-4 text-muted-foreground">{item.detail}</p></div>)}</div></GlassCard>
          <GlassCard className="p-4"><h2 className="font-semibold">常用入口</h2><div className="mt-3 grid gap-2">{role === "department_head" || role === "employee" ? <Button asChild variant="outline" className="justify-between"><Link href="/tasks">查看我的任务<ArrowRight /></Link></Button> : null}{role === "finance" ? <Button asChild variant="outline" className="justify-between"><Link href="/payroll">薪资办理<ArrowRight /></Link></Button> : null}{role === "hr" ? <Button asChild variant="outline" className="justify-between"><Link href="/people">人员管理<ArrowRight /></Link></Button> : null}<Button asChild variant="outline" className="justify-between"><Link href="/approvals">我的审批待办<ArrowRight /></Link></Button>{isFixtureBound && !demo.enabled ? <Button type="button" variant="ghost" onClick={() => { resetOperationsState(context); notify("本地业务数据已恢复到初始状态"); }}><RotateCcw />重置本地试用数据</Button> : null}</div></GlassCard>
        </aside>
      </section>
    </main>
  );
}
