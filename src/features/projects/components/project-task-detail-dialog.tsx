"use client";

import { useRef, useState } from "react";
import { AlertCircle, CalendarDays, CheckCircle2, History, MessageSquareText, RotateCcw, Send, ShieldCheck, UserRound } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectDetailData, ProjectTask } from "@/features/projects/types";
import type { WorkspaceActor } from "@/features/auth/workspace-session-types";
import type { BusinessTaskTransition } from "@/features/projects/data/business-command-client";

const statusLabels = { backlog: "待开始", todo: "待开始", in_progress: "进行中", blocked: "已阻塞", in_review: "评审中", done: "已完成", cancelled: "已取消" } as const;
const statusTones = { backlog: "neutral", todo: "active", in_progress: "active", blocked: "warning", in_review: "warning", done: "success", cancelled: "neutral" } as const;

export function ProjectTaskDetailDialog({ actor, task, detail, open, onOpenChange, onComment, onTransition, canManage = false, workflowManaged = false }: { actor: WorkspaceActor; task: ProjectTask | null; detail: ProjectDetailData; open: boolean; onOpenChange: (open: boolean) => void; onComment: (taskId: string, body: string, idempotencyKey: string) => void | Promise<void>; onTransition?: (taskId: string, input: BusinessTaskTransition, idempotencyKey: string) => void | Promise<void>; canManage?: boolean; workflowManaged?: boolean }) {
  const [body, setBody] = useState("");
  const [feedback, setFeedback] = useState<{ tone: "error" | "success"; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progress, setProgress] = useState(50);
  const [workflowNote, setWorkflowNote] = useState("");
  const [resultLink, setResultLink] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const commentAttemptRef = useRef<{ signature: string; key: string } | null>(null);
  const workflowAttemptRef = useRef<{ signature: string; key: string } | null>(null);
  if (!task) return null;
  const assignee = detail.members.find(({ member }) => member.id === task.assigneeId)?.member;
  const comments = detail.comments.filter(({ taskId }) => taskId === task.id);
  const history = (detail.acceptanceEvents ?? []).filter(({ taskId }) => taskId === task.id);
  const verifiedProjectFiles = detail.files.filter(({ verifiedAt }) => Boolean(verifiedAt));
  const isAssignee = task.assigneeId === actor.memberId;
  const canReview = canManage || task.reporterId === actor.memberId;

  async function transition(input: BusinessTaskTransition) {
    if (!onTransition || isSubmitting) return;
    const signature = JSON.stringify(input);
    if (workflowAttemptRef.current?.signature !== signature) workflowAttemptRef.current = { signature, key: crypto.randomUUID() };
    try {
      setIsSubmitting(true); setFeedback(null);
      await onTransition(task!.id, input, workflowAttemptRef.current.key);
      workflowAttemptRef.current = null; setWorkflowNote(""); setResultLink(""); setSelectedFiles([]);
      setFeedback({ tone: "success", message: "任务状态已提交，执行历史已留痕" });
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : "任务状态变更失败，请稍后重试" });
    } finally { setIsSubmitting(false); }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    if (!body.trim()) { setFeedback({ tone: "error", message: "请输入评论内容" }); return; }
    const content = body.trim();
    if (commentAttemptRef.current?.signature !== content) commentAttemptRef.current = { signature: content, key: crypto.randomUUID() };
    try {
      setIsSubmitting(true);
      setFeedback(null);
      await onComment(task!.id, content, commentAttemptRef.current.key);
      commentAttemptRef.current = null;
      setBody("");
      setFeedback({ tone: "success", message: "评论已添加，并同步到项目动态" });
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : "评论提交失败，请稍后重试" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !isSubmitting && onOpenChange(nextOpen)}>
      <DialogContent className="h-[100dvh] w-screen max-w-none overflow-y-auto rounded-none sm:h-auto sm:max-h-[88vh] sm:max-w-2xl sm:rounded-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2 pr-10"><StatusBadge status={statusTones[task.status]}>{statusLabels[task.status]}</StatusBadge><Badge variant={task.priority === "urgent" ? "destructive" : "outline"}>{task.priority}</Badge></div>
          <DialogTitle className="pt-1 text-xl">{task.title}</DialogTitle>
          <DialogDescription>{task.description || "暂无任务描述"}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-muted/55 p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><UserRound className="size-3.5" />负责人</p><p className="mt-1.5 font-medium">{assignee?.displayName ?? "待分配"}</p></div>
          <div className="rounded-2xl bg-muted/55 p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="size-3.5" />截止时间</p><p className="mt-1.5 font-medium">{task.dueDate ?? "待定"}</p></div>
        </div>
        {task.acceptanceCriteria ? <section className="rounded-2xl border border-glass-border bg-background/55 p-4"><h3 className="text-sm font-semibold">验收标准</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">{task.acceptanceCriteria}</p></section> : null}
        {workflowManaged ? <section className="rounded-2xl border border-primary/15 bg-brand-soft/35 p-4">
          <div className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" /><h3 className="text-sm font-semibold">执行与验收</h3><Badge variant="outline" className="ml-auto">版本 {task.version ?? "未知"}</Badge></div>
          {!task.version ? <p className="mt-3 text-xs text-destructive">任务版本缺失，请刷新后再操作。</p> : null}
          {task.version && isAssignee && (task.status === "todo" || task.status === "backlog") ? <Button className="mt-3 w-full sm:w-auto" disabled={isSubmitting} onClick={() => void transition({ action: "claim", expectedVersion: task.version! })}>领取并开始任务</Button> : null}
          {task.version && isAssignee && task.status === "in_progress" ? <div className="mt-3 grid gap-3">
            <label className="grid gap-1.5 text-xs font-medium">当前进度 {progress}%<input type="range" min="0" max="100" step="5" value={progress} onChange={(event) => setProgress(Number(event.target.value))} /></label>
            <Textarea value={workflowNote} onChange={(event) => setWorkflowNote(event.target.value)} placeholder="本次进展、下一步或提交成果说明" />
            <Input value={resultLink} onChange={(event) => setResultLink(event.target.value)} placeholder="成果链接（可选；未选文件时必填）" />
            {verifiedProjectFiles.length ? <div className="grid gap-1.5"><p className="text-xs font-medium">关联已验证项目文件</p>{verifiedProjectFiles.slice(0, 8).map((file) => <label key={file.id} className="flex items-center gap-2 text-xs"><input type="checkbox" checked={selectedFiles.includes(file.id)} onChange={(event) => setSelectedFiles((current) => event.target.checked ? [...current, file.id] : current.filter((id) => id !== file.id))} />{file.originalName}</label>)}</div> : <p className="text-xs text-muted-foreground">暂无已验证项目文件；可提交成果链接，或先在项目文件中完成上传校验。</p>}
            <div className="flex flex-col gap-2 sm:flex-row"><Button variant="outline" disabled={isSubmitting} onClick={() => void transition({ action: "progress", expectedVersion: task.version!, progress, blocker: "", nextStep: workflowNote.trim() })}>保存进度</Button><Button disabled={isSubmitting || !workflowNote.trim() || (!resultLink.trim() && selectedFiles.length === 0)} onClick={() => void transition({ action: "submit", expectedVersion: task.version!, resultText: workflowNote.trim(), resultLink: resultLink.trim(), resultFiles: selectedFiles })}>提交验收</Button></div>
          </div> : null}
          {task.version && canReview && task.status === "in_review" ? <div className="mt-3 grid gap-3"><Textarea value={workflowNote} onChange={(event) => setWorkflowNote(event.target.value)} placeholder="填写验收意见；驳回时必填" /><div className="flex flex-col gap-2 sm:flex-row"><Button disabled={isSubmitting} onClick={() => void transition({ action: "review", expectedVersion: task.version!, decision: "pass", note: workflowNote.trim() })}><ShieldCheck />通过验收</Button><Button variant="outline" disabled={isSubmitting || !workflowNote.trim()} onClick={() => void transition({ action: "review", expectedVersion: task.version!, decision: "reject", note: workflowNote.trim() })}>退回修改</Button></div></div> : null}
          {task.version && canReview && task.status === "done" ? <div className="mt-3 grid gap-2"><Textarea value={workflowNote} onChange={(event) => setWorkflowNote(event.target.value)} placeholder="重新打开原因（可选）" /><Button variant="outline" className="w-full sm:w-auto" disabled={isSubmitting} onClick={() => void transition({ action: "reopen", expectedVersion: task.version!, note: workflowNote.trim() })}><RotateCcw />重新打开</Button></div> : null}
          {!isAssignee && !canReview ? <p className="mt-3 text-xs text-muted-foreground">你可以查看执行记录，但当前节点不需要你操作。</p> : null}
        </section> : null}
        <section className="rounded-2xl border border-glass-border bg-background/55 p-4"><div className="flex items-center gap-2"><History className="size-4 text-primary" /><h3 className="text-sm font-semibold">验收历史</h3><Badge variant="outline" className="ml-auto">{history.length}</Badge></div>{history.length ? <div className="mt-3 grid gap-2">{history.map((event) => <article key={event.id} className="rounded-xl bg-muted/55 p-3"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold">{event.eventType === "submitted" ? "提交验收" : event.eventType === "review_passed" ? "验收通过" : event.eventType === "review_rejected" ? "退回修改" : "重新打开"}</p><time className="text-[11px] text-muted-foreground">{new Date(event.occurredAt).toLocaleString("zh-CN", { hour12: false })}</time></div><p className="mt-1 text-xs text-muted-foreground">{event.actorName} · 任务版本 {event.taskVersion}</p>{event.resultText || event.note ? <p className="mt-2 whitespace-pre-wrap text-sm">{event.resultText ?? event.note}</p> : null}{event.resultFiles.length ? <div className="mt-2 flex flex-wrap gap-1">{event.resultFiles.map((fileId) => <Badge key={fileId} variant="outline">{detail.files.find(({ id }) => id === fileId)?.originalName ?? "历史文件"}</Badge>)}</div> : null}</article>)}</div> : <div className="mt-3 rounded-xl border border-dashed p-4 text-center text-xs text-muted-foreground">当前没有 202608270011 生效后的验收记录；历史数据不会被伪造成完整留痕。</div>}</section>
        <section aria-labelledby="task-comments-title" className="rounded-2xl border border-glass-border bg-background/55 p-4">
          <div className="flex items-center gap-2"><MessageSquareText className="size-4 text-primary" /><h3 id="task-comments-title" className="font-semibold">任务评论</h3><Badge variant="outline" className="ml-auto">{comments.length}</Badge></div>
          <div className="mt-3 grid max-h-52 gap-3 overflow-y-auto">
            {comments.length ? comments.map((comment) => {
              const author = detail.members.find(({ member }) => member.id === comment.authorId)?.member;
              const authorName = author?.displayName ?? (comment.authorId === actor.memberId ? actor.name : "项目成员");
              return <article key={comment.id} className="flex gap-2.5"><Avatar size="sm"><AvatarFallback className="bg-brand-soft text-primary">{authorName.slice(0, 1)}</AvatarFallback></Avatar><div className="min-w-0 flex-1 rounded-2xl bg-muted/55 px-3 py-2"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold">{authorName}</p><time className="text-[11px] text-muted-foreground">{new Date(comment.createdAt).toLocaleString("zh-CN", { hour12: false })}</time></div><p className="mt-1 text-sm leading-5 text-foreground">{comment.body}</p></div></article>;
            }) : <p className="py-5 text-center text-sm text-muted-foreground">暂无评论，添加第一条执行反馈。</p>}
          </div>
          <form className="mt-4 grid gap-2" onSubmit={submit}>
            <Textarea aria-label="任务评论内容" value={body} onChange={(event) => setBody(event.target.value)} placeholder="补充进展、问题或验收反馈..." />
            <div className="flex items-center justify-between gap-3">{feedback ? <p role={feedback.tone === "error" ? "alert" : "status"} className={feedback.tone === "error" ? "flex items-center gap-1.5 text-xs font-medium text-destructive" : "flex items-center gap-1.5 text-xs font-medium text-success"}>{feedback.tone === "error" ? <AlertCircle aria-hidden="true" className="size-4" /> : <CheckCircle2 aria-hidden="true" className="size-4" />}{feedback.message}</p> : <span /> }<Button type="submit" size="sm" disabled={isSubmitting}><Send data-icon="inline-start" />{isSubmitting ? "提交中…" : "添加评论"}</Button></div>
          </form>
        </section>
      </DialogContent>
    </Dialog>
  );
}
