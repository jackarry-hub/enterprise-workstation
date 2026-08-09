"use client";

import { useState } from "react";
import { CalendarDays, MessageSquareText, Send, UserRound } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectDetailData, ProjectTask } from "@/features/projects/types";
import { getCurrentUser } from "@/lib/auth/mock-user";

const statusLabels = { backlog: "待开始", todo: "待开始", in_progress: "进行中", blocked: "已阻塞", in_review: "评审中", done: "已完成", cancelled: "已取消" } as const;
const statusTones = { backlog: "neutral", todo: "active", in_progress: "active", blocked: "warning", in_review: "warning", done: "success", cancelled: "neutral" } as const;

export function ProjectTaskDetailDialog({ task, detail, open, onOpenChange, onComment }: { task: ProjectTask | null; detail: ProjectDetailData; open: boolean; onOpenChange: (open: boolean) => void; onComment: (taskId: string, body: string) => void }) {
  const [body, setBody] = useState("");
  const [message, setMessage] = useState("");
  if (!task) return null;
  const assignee = detail.members.find(({ member }) => member.id === task.assigneeId)?.member;
  const comments = detail.comments.filter(({ taskId }) => taskId === task.id);
  const actor = getCurrentUser();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!body.trim()) { setMessage("请输入评论内容"); return; }
    onComment(task!.id, body);
    setBody("");
    setMessage("评论已添加，并同步到项目动态");
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2 pr-10"><StatusBadge status={statusTones[task.status]}>{statusLabels[task.status]}</StatusBadge><Badge variant={task.priority === "urgent" ? "destructive" : "outline"}>{task.priority}</Badge></div>
          <DialogTitle className="pt-1 text-xl">{task.title}</DialogTitle>
          <DialogDescription>{task.description || "暂无任务描述"}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-muted/55 p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><UserRound className="size-3.5" />负责人</p><p className="mt-1.5 font-medium">{assignee?.displayName ?? "待分配"}</p></div>
          <div className="rounded-2xl bg-muted/55 p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="size-3.5" />截止时间</p><p className="mt-1.5 font-medium">{task.dueDate ?? "待定"}</p></div>
        </div>
        <section aria-labelledby="task-comments-title" className="rounded-2xl border border-glass-border bg-background/55 p-4">
          <div className="flex items-center gap-2"><MessageSquareText className="size-4 text-primary" /><h3 id="task-comments-title" className="font-semibold">任务评论</h3><Badge variant="outline" className="ml-auto">{comments.length}</Badge></div>
          <div className="mt-3 grid max-h-52 gap-3 overflow-y-auto">
            {comments.length ? comments.map((comment) => {
              const author = detail.members.find(({ member }) => member.id === comment.authorId)?.member;
              const authorName = author?.displayName ?? (comment.authorId === actor.memberId ? actor.displayName : "项目成员");
              return <article key={comment.id} className="flex gap-2.5"><Avatar size="sm"><AvatarFallback className="bg-brand-soft text-primary">{authorName.slice(0, 1)}</AvatarFallback></Avatar><div className="min-w-0 flex-1 rounded-2xl bg-muted/55 px-3 py-2"><div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold">{authorName}</p><time className="text-[11px] text-muted-foreground">{new Date(comment.createdAt).toLocaleString("zh-CN", { hour12: false })}</time></div><p className="mt-1 text-sm leading-5 text-foreground">{comment.body}</p></div></article>;
            }) : <p className="py-5 text-center text-sm text-muted-foreground">暂无评论，添加第一条执行反馈。</p>}
          </div>
          <form className="mt-4 grid gap-2" onSubmit={submit}>
            <Textarea aria-label="任务评论内容" value={body} onChange={(event) => setBody(event.target.value)} placeholder="补充进展、问题或验收反馈..." />
            <div className="flex items-center justify-between gap-3">{message ? <p role="status" className="text-xs font-medium text-success">{message}</p> : <span /> }<Button type="submit" size="sm"><Send data-icon="inline-start" />添加评论</Button></div>
          </form>
        </section>
      </DialogContent>
    </Dialog>
  );
}
