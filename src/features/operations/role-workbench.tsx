"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
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
import { Input } from "@/components/ui/input";
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
import { createDemoTaskRepository } from "@/features/tasks/repositories/demo-task-repository";
import { cn } from "@/lib/utils";

const taskStatusMeta: Record<OperationTaskStatus, { label: string; variant: "neutral" | "info" | "warning" | "success" | "destructive" }> = {
  assigned: { label: "新任务", variant: "warning" },
  accepted: { label: "已接受", variant: "info" },
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
  accepted: 3,
  assigned: 4,
  todo: 5,
  done: 6,
};

const supportStatusMeta = {
  pending: { label: "待处理", variant: "warning" as const },
  approved: { label: "已批准", variant: "info" as const },
  in_progress: { label: "办理中", variant: "info" as const },
  completed: { label: "已完成", variant: "success" as const },
  rejected: { label: "已驳回", variant: "destructive" as const },
};

const roleCopy: Record<Exclude<WorkspaceRole, "executive">, { title: string; eyebrow: string; description: string; upstream: string; downstream: string }> = {
  department_head: { title: "负责人推进台", eyebrow: "部门目标 → 个人任务", description: "确认部门承接目标，明确唯一执行人，处理阻塞并验收员工成果。", upstream: "接收决策发起人确认的部门目标", downstream: "验收后回流决策中心并形成成果记录" },
  employee: { title: "我的执行台", eyebrow: "个人任务 → 可验收成果", description: "只保留分配到本人的任务，执行过程中可反馈阻塞、申请协同并上传真实成果。", upstream: "接收负责人分配的任务", downstream: "提交成果给负责人验收" },
  finance: { title: "财务执行中心", eyebrow: "预算申请 → 审批付款", description: "处理命令推进过程中产生的预算、采购与付款事项，并归集凭证。", upstream: "接收任务发起的财务协同", downstream: "办理结果回写任务与领导驾驶舱" },
  hr: { title: "人事协同中心", eyebrow: "人员需求 → 调配培训", description: "处理人员调配、招聘与培训需求，确保任务有合适的人和清晰的责任边界。", upstream: "接收负责人发起的人事协同", downstream: "到岗与培训结果回写执行任务" },
};

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function OperationUpload({ entityType, entityId, label = "上传成果", onFeedback, onUploaded }: { entityType: OperationFile["entityType"]; entityId: string; label?: string; onFeedback: (message: string, tone?: "error" | "success") => void; onUploaded?: (file: File) => void }) {
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
      onUploaded?.(file);
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
  if (!relevant.length) return <p className="text-xs text-muted-foreground">尚未上传文件；也可以填写成果说明后直接提交。</p>;
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
  const [submission, setSubmission] = useState({ description: "", url: "", attachmentName: "", note: "" });
  const repository = useMemo(() => createDemoTaskRepository(context, session), [context, session]);
  const meta = taskStatusMeta[task.status];
  const assignee = getActor(task.assigneeId);
  const assigneeOptions = operationFixtureActors.filter((candidate) =>
    candidate.id === task.assigneeId
    || (candidate.department === task.department
      && ["executive", "employee", "department_head", "finance", "hr"].includes(candidate.role)),
  );
  const files = state.files.filter(({ entityType, entityId }) => entityType === "task" && entityId === task.id);
  const isAssignee = task.assigneeId === actor.id;
  const isReviewer = getTaskReviewerId(task) === actor.id;
  const [mobileTab, setMobileTab] = useState<"activity" | "files" | "comments">(
    isReviewer && task.status === "review" ? "comments" : "activity",
  );
  const reviewer = getActor(getTaskReviewerId(task));
  const canAssign = task.departmentOwnerId === actor.id && !["review", "done"].includes(task.status);
  const slaDueAt = task.status === "review" ? task.reviewDueAt : task.status === "blocked" ? task.blockerDueAt : undefined;
  const returnedForChanges = task.status === "in_progress" && (task.reviewStatus === "rejected" || Boolean(task.reviewNote));
  const progressHint = task.status === "review"
    ? isAssignee
      ? `你已完成个人提交，当前由${reviewer.name}验收；通过后进度会自动到 100%。`
      : isReviewer
        ? `${assignee.name}已完成个人提交；你验收通过后任务会自动到 100%。`
        : `执行人已完成提交，当前由${reviewer.name}验收；通过后进度会自动到 100%。`
    : task.status === "done"
      ? "已验收通过，任务达到 100% 并完成闭环。"
      : task.status === "assigned"
        ? "AI 企业大脑已将任务分配给你，接受后即可开始执行。"
        : task.status === "accepted"
          ? "任务已接受，点击“开始执行”记录正式开始时间。"
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

  async function runRuntime(action: () => Promise<unknown>, message: string) {
    try {
      await action();
      setNote("");
      onFeedback(message);
    } catch (error) {
      onFeedback(error instanceof Error ? error.message : "任务保存失败", "error");
    }
  }

  function openSubmission() {
    setMobileTab("files");
    window.requestAnimationFrame(() => {
      const target = document.getElementById(`submission-${task.id}`);
      target?.scrollIntoView?.({ behavior: "smooth", block: "center" });
      target?.focus({ preventScroll: true });
    });
  }

  const hasSubmissionContent = Boolean(
    submission.description.trim()
    || submission.url.trim()
    || submission.attachmentName.trim(),
  );

  function handleUploaded(file: File) {
    setSubmission((current) => ({
      ...current,
      description: current.description.trim() || `已上传成果文件：${file.name}，请按验收标准检查。`,
      attachmentName: current.attachmentName.trim() || file.name,
    }));
  }

  return (
    <article id={`task-${task.id}`} tabIndex={-1} className={cn("operation-task-card scroll-mt-24 rounded-2xl border bg-white/60 p-4 outline-none transition target:border-primary target:ring-2 target:ring-primary/20 focus-visible:ring-2 focus-visible:ring-primary/20", task.status === "blocked" ? "border-destructive/30" : "border-border/70")}>
      <div className="operation-task-card__header flex flex-wrap items-start gap-3">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", task.status === "done" ? "bg-success-soft text-success" : task.status === "blocked" ? "bg-danger-soft text-destructive" : "bg-brand-soft text-primary")}>{task.status === "done" ? <CheckCircle2 /> : task.status === "blocked" ? <AlertTriangle /> : <CircleDot />}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-primary">{task.code}</span><Badge variant="neutral">{task.runtimeSource === "ai_dispatch" ? "AI 调度" : "部门协作"}</Badge><Badge variant={meta.variant}>{meta.label}</Badge><Badge variant={task.priority === "urgent" ? "destructive" : "outline"}>{task.priority === "urgent" ? "紧急" : "高优先级"}</Badge></div>
          <h3 className="mt-1.5 text-base font-semibold">{task.title}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{task.summary}</p>
        </div>
        <div className="operation-task-card__deadline ml-auto flex shrink-0 flex-col items-end gap-2 text-right">
          <div><p className="text-[11px] text-muted-foreground">截止时间</p><p className="mt-1 text-sm font-semibold">{task.dueDate}</p></div>
          {isAssignee && task.status === "assigned" ? <Button size="sm" aria-label={`领取任务：${task.title}`} onClick={() => runRuntime(() => repository.acceptTask(task.id), "任务已领取，可以开始执行")}>领取任务<ArrowRight /></Button> : null}
          {isAssignee && task.status === "accepted" ? <Button size="sm" aria-label={`开始执行：${task.title}`} onClick={() => runRuntime(() => repository.startTask(task.id), "任务已开始执行")}>开始执行<ArrowRight /></Button> : null}
          {isAssignee && task.status === "todo" ? <Button size="sm" aria-label={`开始执行：${task.title}`} onClick={() => update("in_progress", "任务已开始执行", { progress: 20 })}>开始执行<ArrowRight /></Button> : null}
        </div>
      </div>

      <div role="tablist" aria-label={`${task.title}办理内容`} className="mobile-task-detail-tabs md:hidden">
        {([
          ["activity", "任务说明"],
          ["files", "成果提交"],
          ["comments", "沟通验收"],
        ] as const).map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={mobileTab === key} onClick={() => setMobileTab(key)}>{label}</button>
        ))}
      </div>

      <div className={cn("operation-task-essentials mt-3 grid gap-2 sm:grid-cols-[1fr_1.25fr]", mobileTab !== "activity" && "max-md:hidden")}>
        <div className="operation-task-assignee rounded-xl bg-muted/55 p-3">
          <p className="text-[11px] text-muted-foreground">唯一执行人</p>
          {canAssign && assigneeOptions.length > 1 ? (
            <select aria-label={`${task.title}执行人`} value={task.assigneeId} onChange={(event) => { updateOperationTask(context, task.id, { assigneeId: event.target.value }, actor.id, session.actor); onFeedback(`已将任务分配给 ${getActor(event.target.value).name}`); }} className="mt-1.5 h-9 w-full rounded-lg border border-input bg-background px-2 text-sm font-medium">
              {assigneeOptions.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.title}</option>)}
            </select>
          ) : <div className="mt-1.5 flex items-center gap-2"><Avatar size="sm"><AvatarFallback className="bg-brand-soft text-primary">{assignee.name.slice(0, 1)}</AvatarFallback></Avatar><span className="text-sm font-medium">{assignee.name} · {assignee.title}</span></div>}
          {canAssign && assigneeOptions.length === 1 ? <p className="mt-2 text-[11px] leading-4 text-muted-foreground">当前部门暂无其他可选执行人</p> : null}
        </div>
        <div className="operation-task-acceptance rounded-xl bg-success-soft/55 p-3"><p className="text-[11px] text-success">验收标准</p><p className="mt-1.5 text-xs leading-5">{task.acceptance}</p></div>
      </div>

      <div className={cn("operation-task-progress mt-3", mobileTab !== "activity" && "max-md:hidden")}>
        <div className="flex items-center justify-between text-xs"><span className="text-muted-foreground">任务闭环进度</span><span className="font-semibold text-primary">{task.progress}%</span></div>
        <ProgressBar value={task.progress} className="mt-1.5 h-1.5" />
        {isAssignee && task.status === "in_progress" ? (
          <div className="operation-task-next-step mt-3 flex flex-col gap-3 rounded-xl border border-primary/15 bg-brand-soft/40 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-xs font-semibold text-primary">下一步：提交成果并申请验收</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">至少填写一项成果内容；演示时可直接使用示例成果。</p>
            </div>
            <Button type="button" size="sm" className="operation-task-submit-entry w-full shrink-0 sm:w-auto" onClick={openSubmission}><FileUp />提交成果并申请验收</Button>
          </div>
        ) : <p className="mt-2 text-xs leading-5 text-muted-foreground">{progressHint}</p>}
      </div>
      {task.blocker ? <p className={cn("mt-3 rounded-xl bg-danger-soft px-3 py-2 text-xs text-destructive", mobileTab !== "activity" && "max-md:hidden")}><strong>当前阻塞：</strong>{task.blocker}</p> : null}
      {task.reviewNote ? <div className={cn("mt-3 rounded-xl bg-warning-soft px-3 py-2 text-xs text-warning", mobileTab !== "comments" && "max-md:hidden")}><p><strong>验收意见：</strong>{task.reviewNote}</p>{returnedForChanges && isAssignee ? <p className="mt-1 font-medium">补充说明后重新提交，完成后将再次通知{reviewer.name}验收。</p> : null}</div> : null}
      {slaDueAt ? <p className={cn("mt-2 flex items-center gap-1.5 text-xs", task.escalationLevel === "executive" ? "font-semibold text-destructive" : "text-muted-foreground", mobileTab !== "activity" && "max-md:hidden")}><Clock3 className="size-3.5" />处理时限 {new Date(slaDueAt).toLocaleString("zh-CN")}{task.escalationLevel === "executive" ? " · 已升级领导" : ""}</p> : null}

      {task.submission ? <div className={cn("mt-3 rounded-xl border border-primary/15 bg-brand-soft/35 p-3 text-xs", mobileTab !== "files" && "max-md:hidden")}><p className="font-medium text-primary">已提交成果</p><p className="mt-1.5 leading-5">{task.submission.description}</p>{task.submission.url ? <a className="mt-1 block break-all text-primary underline" href={task.submission.url} target="_blank" rel="noreferrer">{task.submission.url}</a> : null}{task.submission.attachmentName ? <p className="mt-1 text-muted-foreground">模拟附件：{task.submission.attachmentName}</p> : null}{task.submission.note ? <p className="mt-1 text-muted-foreground">备注：{task.submission.note}</p> : null}</div> : null}
      {isAssignee && task.status === "in_progress" ? (
        <div id={`submission-${task.id}`} role="region" aria-label="成果提交区" tabIndex={-1} className={cn("operation-task-submission mt-3 scroll-mt-24 rounded-2xl border-2 border-primary/20 bg-white/90 p-3 outline-none focus-visible:ring-2 focus-visible:ring-primary/25 sm:p-4", mobileTab !== "files" && "max-md:hidden")}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2"><span className="grid size-6 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">3</span><p className="text-sm font-semibold">提交成果并申请验收</p></div>
              <p className="mt-1.5 text-xs leading-5 text-muted-foreground">完成下方内容后，任务将交给{reviewer.name}验收。</p>
            </div>
            <Badge variant="info">最后一步</Badge>
          </div>

          <div className="mt-3 rounded-xl border border-dashed border-primary/20 bg-brand-soft/30 p-3">
            <p className="text-xs font-semibold text-foreground">① 上传成果文件</p>
            <div className="mt-2 flex flex-wrap items-center gap-2"><OperationUpload entityType="task" entityId={task.id} onFeedback={onFeedback} onUploaded={handleUploaded} /></div>
            <div className="mt-2"><TaskFiles taskId={task.id} files={state.files} onFeedback={onFeedback} /></div>
          </div>

          <div className="mt-3">
            <p className="text-xs font-semibold text-foreground">② 说明完成结果</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2"><Textarea aria-label="成果说明" value={submission.description} onChange={(event) => setSubmission((current) => ({ ...current, description: event.target.value }))} placeholder="一句话说明完成了什么，方便负责人验收" className="min-h-20 sm:col-span-2" /><Input aria-label="成果链接" value={submission.url} onChange={(event) => setSubmission((current) => ({ ...current, url: event.target.value }))} placeholder="成果链接 https://...（可选）" /><Input aria-label="模拟附件名" value={submission.attachmentName} onChange={(event) => setSubmission((current) => ({ ...current, attachmentName: event.target.value }))} placeholder="附件名（可选）" className="operation-submission-optional" /><Textarea aria-label="成果备注" value={submission.note} onChange={(event) => setSubmission((current) => ({ ...current, note: event.target.value }))} placeholder="补充说明（可选）" className="operation-submission-optional min-h-16 sm:col-span-2" /></div>
          </div>

          <div className="mt-3 rounded-xl bg-muted/40 p-3">
            <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-medium text-muted-foreground">更新当前进度</span>{[20, 50, 80].map((progress) => <Button key={progress} type="button" size="sm" variant="outline" aria-label={`更新进度 ${progress}%`} onClick={() => runRuntime(() => repository.updateProgress(task.id, progress), `任务进度已更新为 ${progress}%`)}>{progress}%</Button>)}</div>
            <div className="mt-3 flex flex-col gap-2 border-t border-border/70 pt-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs leading-5 text-muted-foreground">上传文件或填写成果说明后，即可提交给{reviewer.name}验收。</p>
              <Button type="button" className="operation-task-final-submit w-full sm:w-auto sm:min-w-48" aria-label="提交验收" disabled={!hasSubmissionContent} onClick={() => runRuntime(() => repository.submitTask(task.id, submission), `成果已提交给${reviewer.name}验收`)}><ShieldCheck />提交验收</Button>
            </div>
          </div>
        </div>
      ) : <div className={cn("mt-3 rounded-xl border border-dashed border-border/80 bg-muted/25 p-3", mobileTab !== "files" && "max-md:hidden")}><p className="mb-2 text-[11px] font-medium text-muted-foreground">任务成果与版本</p><TaskFiles taskId={task.id} files={state.files} onFeedback={onFeedback} /></div>}

      <div
        id={isReviewer && task.status === "review" ? `review-${task.id}` : undefined}
        tabIndex={isReviewer && task.status === "review" ? -1 : undefined}
        className={cn("mt-3 flex scroll-mt-24 flex-wrap items-end gap-2 rounded-xl outline-none target:ring-2 target:ring-primary/20 focus-visible:ring-2 focus-visible:ring-primary/20", mobileTab !== "comments" && "max-md:hidden")}
      >
        {isAssignee ? (
          <>
            {task.status === "blocked" ? <OperationUpload entityType="task" entityId={task.id} onFeedback={onFeedback} /> : null}
            {task.status === "in_progress" ? <Button size="sm" variant="outline" onClick={() => update("blocked", "已上报任务阻塞", { blocker: note.trim() || "需要负责人协调资源或处理当前阻塞。" })}>上报阻塞</Button> : null}
            {task.status === "in_progress" || task.status === "blocked" ? <Button size="sm" variant="ghost" onClick={() => { createSupportRequest(context, task.id, "finance", actor.id); onFeedback("财务协同申请已发送"); }}><Banknote />申请预算</Button> : null}
            {task.status === "in_progress" || task.status === "blocked" ? <Button size="sm" variant="ghost" onClick={() => { createSupportRequest(context, task.id, "staffing", actor.id); onFeedback("人事协同申请已发送"); }}><UsersRound />申请人员</Button> : null}
          </>
        ) : null}
        {isReviewer ? (
          <>
            {task.status === "review" && demo.enabled ? <Button size="sm" variant="ghost" onClick={() => setNote("请补充角色切换说明和验收步骤截图后重新提交。")}>填入退回示例</Button> : null}
            {task.status === "review" && demo.enabled ? <Button size="sm" variant="ghost" onClick={() => setNote("验收通过，说明完整，流程可复现。")}>填入通过示例</Button> : null}
            {task.status === "review" ? <Button size="sm" disabled={(task.deliverableRequired && files.length === 0 && !task.submission) || !note.trim()} onClick={() => runRuntime(() => repository.approveTask(task.id, note), `成果已通过验收，${assignee.name}的任务已完成`)}><ShieldCheck />通过验收</Button> : null}
            {task.status === "review" ? <Button size="sm" variant="outline" disabled={!note.trim()} onClick={() => runRuntime(() => repository.rejectTask(task.id, note), `成果已退回${assignee.name}修改，返工事项已同步到他的执行台`)}>退回修改</Button> : null}
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
  const [missingTaskAnchor, setMissingTaskAnchor] = useState<string | null>(null);
  const [taskAnchor, setTaskAnchor] = useState("");
  const handledTaskAnchorRef = useRef<string | null>(null);
  const copy = roleCopy[role];

  const tasks = useMemo(() => {
    const visibleTasks = state.tasks.filter(({ assigneeId }) => assigneeId === actor.id);
    return [...visibleTasks].sort((left, right) => taskStatusOrder[left.status] - taskStatusOrder[right.status]);
  }, [actor.id, state.tasks]);
  const reviewTasks = useMemo(() => state.tasks.filter((task) =>
    task.assigneeId !== actor.id
    && getTaskReviewerId(task) === actor.id
    && ["review", "blocked"].includes(task.status),
  ), [actor.id, state.tasks]);
  const supportRequests = useMemo(() => role === "finance"
    ? state.supportRequests.filter(({ type }) => type === "finance")
    : role === "hr" ? state.supportRequests.filter(({ type }) => type === "staffing" || type === "training") : [], [role, state.supportRequests]);
  const done = tasks.filter(({ status }) => status === "done").length;
  const attention = tasks.filter(({ status, reviewNote }) => status === "blocked" || status === "review" || (status === "in_progress" && Boolean(reviewNote))).length + reviewTasks.length + supportRequests.filter(({ status }) => status === "pending").length;

  useEffect(() => {
    const syncTaskAnchor = () => {
      setTaskAnchor(decodeURIComponent(window.location.hash.slice(1)));
    };

    syncTaskAnchor();
    window.addEventListener("hashchange", syncTaskAnchor);
    return () => window.removeEventListener("hashchange", syncTaskAnchor);
  }, []);

  useEffect(() => {
    const targetId = taskAnchor;
    if (!targetId.startsWith("task-") && !targetId.startsWith("review-")) {
      handledTaskAnchorRef.current = null;
      setMissingTaskAnchor(null);
      return;
    }

    // The hash is an entry target, not a permanent scroll command. Task
    // actions refresh state repeatedly; re-running the same anchor scroll on
    // every refresh pulls someone working on a later card back to the first.
    if (handledTaskAnchorRef.current === targetId) return;

    const target = document.getElementById(targetId);
    if (!target) {
      setMissingTaskAnchor(targetId);
      return;
    }

    setMissingTaskAnchor(null);
    handledTaskAnchorRef.current = targetId;
    target.scrollIntoView?.({ block: "center" });
    target.focus({ preventScroll: true });
    if (targetId.startsWith("review-")) {
      target.querySelector<HTMLElement>("textarea, input")?.focus({ preventScroll: true });
    }
  }, [state.tasks, taskAnchor]);

  function notify(message: string, tone: "error" | "success" = "success") {
    setFeedback({ message, tone });
    window.setTimeout(() => setFeedback(null), 8_000);
  }

  return (
    <main className="role-workbench mx-auto flex w-full max-w-420 flex-col gap-3 px-3 pt-4 pb-26 sm:px-4 lg:px-5 lg:pt-6 lg:pb-8">
      <header className="role-workbench__header flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="role-workbench__intro"><p className="role-workbench__eyebrow text-xs font-semibold tracking-[0.18em] text-primary">{copy.eyebrow}</p><h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">{copy.title}</h1><p className="role-workbench__description mt-1.5 max-w-3xl text-sm text-muted-foreground">{copy.description}</p></div>
        <div className="role-workbench__identity flex items-center gap-2 rounded-2xl border border-border/70 bg-white/60 px-3 py-2"><Avatar><AvatarFallback className="bg-brand-soft text-primary">{actor.name.slice(0, 1)}</AvatarFallback></Avatar><div><p className="text-sm font-semibold">{actor.name} · {actor.title}</p><p className="text-xs text-muted-foreground">{actor.department}</p></div></div>
      </header>

      <GlassCard className="role-workbench__flow grid gap-2 p-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:p-4"><div><p className="text-[11px] text-muted-foreground">上游输入</p><p className="mt-1 text-sm font-medium">{copy.upstream}</p></div><ArrowRight className="hidden text-border sm:block" /><div className="sm:text-right"><p className="text-[11px] text-muted-foreground">下游结果</p><p className="mt-1 text-sm font-medium">{copy.downstream}</p></div></GlassCard>

      <section className="role-workbench__stats grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {[{ label: "当前命令", value: state.command.status === "executing" ? "执行中" : "待总验收", icon: GitPullRequestArrow }, { label: role === "finance" || role === "hr" ? "任务与协同" : "我的任务", value: `${tasks.length + supportRequests.length} 项`, icon: FolderClock }, { label: "已完成", value: `${done} 项`, icon: CheckCircle2 }, { label: "需要关注", value: `${attention} 项`, icon: AlertTriangle }].map(({ label, value, icon: Icon }) => <GlassCard key={label} className="role-workbench__stat flex items-center gap-3 p-3.5"><span className="role-workbench__stat-icon grid size-10 place-items-center rounded-xl bg-brand-soft text-primary"><Icon /></span><div><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-0.5 text-lg font-semibold">{value}</p></div></GlassCard>)}
      </section>

      {feedback ? <p role="status" className={cn("rounded-xl px-3 py-2 text-sm font-medium", feedback.tone === "error" ? "bg-danger-soft text-destructive" : "bg-success-soft text-success")}>{feedback.message}</p> : null}

      {missingTaskAnchor ? (
        <GlassCard role="status" className="flex flex-wrap items-center justify-between gap-3 border-warning/25 bg-warning-soft/45 p-4">
          <div><p className="font-medium">未找到指定任务</p><p className="mt-1 text-xs text-muted-foreground">任务可能已完成、被重新分配或不属于当前身份。</p></div>
          <Button asChild variant="outline"><Link href="/tasks">返回任务列表</Link></Button>
        </GlassCard>
      ) : null}

      <OperationActionInbox state={state} actor={actor} />

      <GlassCard className="border-primary/20 bg-brand-soft/35 p-4">
        <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">常用入口</h2><p className="mt-1 text-xs text-muted-foreground">当前岗位高频操作，点击直接进入办理位置。</p></div><Badge variant="info">快捷办理</Badge></div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{role === "department_head" || role === "employee" ? <Button asChild variant="outline" className="justify-between bg-background/80"><Link href="/tasks">查看我的任务<ArrowRight /></Link></Button> : null}{role === "finance" ? <Button asChild variant="outline" className="justify-between bg-background/80"><Link href="/payroll#payroll-control">薪资核算与发放<ArrowRight /></Link></Button> : null}{role === "hr" ? <><Button asChild variant="outline" className="justify-between bg-background/80"><Link href="/attendance#monthly-close">考勤复核与封账<ArrowRight /></Link></Button><Button asChild variant="outline" className="justify-between bg-background/80"><Link href="/payroll#payroll-control">工资单复核<ArrowRight /></Link></Button><Button asChild variant="outline" className="justify-between bg-background/80"><Link href="/people">人员管理<ArrowRight /></Link></Button></> : null}<Button asChild variant="outline" className="justify-between bg-background/80"><Link href="/approvals">我的审批待办<ArrowRight /></Link></Button>{isFixtureBound && !demo.enabled ? <Button type="button" variant="ghost" onClick={() => { resetOperationsState(context); notify("本地业务数据已恢复到初始状态"); }}><RotateCcw />重置本地试用数据</Button> : null}</div>
      </GlassCard>

      <section className="grid min-w-0 gap-3">
        <div className="grid gap-3">
        <GlassCard className="p-4 sm:p-5" role="region" aria-label="我的执行任务">
          <div className="flex items-center justify-between"><div><h2 className="font-semibold">我的执行任务</h2><p className="mt-1 text-xs text-muted-foreground">这里只显示唯一执行人为你本人的任务；他人的任务不会混入。</p></div><Badge variant="info">{tasks.length} 项</Badge></div>
          <div className="mt-4 grid gap-3">
            {tasks.map((task) => <TaskCard key={task.id} task={task} onFeedback={notify} />)}
            {!tasks.length ? <div className="rounded-2xl border border-dashed border-border p-10 text-center"><CheckCircle2 className="mx-auto text-success" /><p className="mt-2 font-medium">当前没有本人执行任务</p><p className="mt-1 text-xs text-muted-foreground">新任务分配给你后会自动出现在这里。</p></div> : null}
          </div>
        </GlassCard>
        {reviewTasks.length ? <GlassCard className="p-4 sm:p-5" role="region" aria-label="我负责验收"><div className="flex items-center justify-between"><div><h2 className="font-semibold">我负责验收</h2><p className="mt-1 text-xs text-muted-foreground">以下是他人已提交、需要你验收或协调的事项，与本人执行任务分开。</p></div><Badge variant="warning">{reviewTasks.length} 项</Badge></div><div className="mt-4 grid gap-3">{reviewTasks.map((task) => <TaskCard key={task.id} task={task} onFeedback={notify} />)}</div></GlassCard> : null}
        {(role === "finance" || role === "hr") && supportRequests.length ? <GlassCard className="p-4 sm:p-5" role="region" aria-label="岗位协同事项"><div className="flex items-center justify-between"><div><h2 className="font-semibold">岗位协同事项</h2><p className="mt-1 text-xs text-muted-foreground">预算、付款、人员与培训申请按岗位独立办理。</p></div><Badge variant="info">{supportRequests.length} 项</Badge></div><div className="mt-4 grid gap-3">{supportRequests.map((request) => <SupportCard key={request.id} request={request} role={role} onFeedback={notify} />)}</div></GlassCard> : null}
        </div>

      </section>
    </main>
  );
}
