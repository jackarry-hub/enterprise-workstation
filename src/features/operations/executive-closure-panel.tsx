"use client";

import Link from "next/link";
import { useState } from "react";
import { Archive, ArrowRight, Banknote, CheckCircle2, CircleDot, FileCheck2, ShieldCheck, UserRoundCheck, UsersRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Textarea } from "@/components/ui/textarea";
import { getActor, getTaskReviewerId, setCommandStatus, updateOperationTask } from "@/features/operations/operations-data";
import { OperationActionInbox } from "@/features/operations/operation-action-inbox";
import { OperationWeeklyBrief } from "@/features/operations/operation-weekly-brief";
import { useOperations } from "@/features/operations/use-operations";

const commandStatusLabel = { executing: "协同执行中", review: "待领导总验收", accepted: "总验收通过", archived: "已归档闭环" } as const;

export function ExecutiveClosurePanel() {
  const { state } = useOperations();
  const [feedback, setFeedback] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const done = state.tasks.filter(({ status }) => status === "done").length;
  const blocked = state.tasks.filter(({ status }) => status === "blocked").length;
  const reviewing = state.tasks.filter(({ status }) => status === "review").length;
  const openSupport = state.supportRequests.filter(({ status }) => status !== "completed" && status !== "rejected").length;
  const completion = state.tasks.length ? Math.round((done / state.tasks.length) * 100) : 0;
  const allDone = done === state.tasks.length && openSupport === 0;
  const executiveReviews = state.tasks.filter((task) => task.status === "review" && getTaskReviewerId(task) === "actor-executive");

  function reviewTask(taskId: string, action: "approve" | "return") {
    try {
      const reviewNote = reviewNotes[taskId]?.trim() || (action === "approve" ? "成果符合验收标准，同意通过。" : "请根据验收标准补充成果后重新提交。");
      updateOperationTask(taskId, action === "approve"
        ? { status: "done", reviewNote }
        : { status: "in_progress", reviewNote, progress: 70 }, "actor-executive");
      setFeedback(action === "approve" ? "负责人任务已验收通过" : "任务已退回负责人修改");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "任务验收失败");
    }
  }

  function advance() {
    try {
      if (state.command.status === "executing") setCommandStatus("review", "actor-executive");
      else if (state.command.status === "review") setCommandStatus("accepted", "actor-executive");
      else if (state.command.status === "accepted") setCommandStatus("archived", "actor-executive");
      setFeedback(state.command.status === "executing" ? "已进入领导总验收" : state.command.status === "review" ? "总验收已通过" : "命令成果已发布到知识库");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "状态更新失败");
    }
  }

  return (
    <section className="mx-auto grid w-full max-w-420 gap-3 px-3 pb-26 sm:px-4 lg:px-5 lg:pb-8" aria-label="真实业务闭环">
      <GlassCard className="overflow-hidden border-primary/20">
        <div className="flex flex-col gap-3 border-b border-border/70 bg-brand-soft/55 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">跨角色执行闭环</h2><Badge variant={state.command.status === "archived" ? "success" : "info"}>{commandStatusLabel[state.command.status]}</Badge></div><p className="mt-1 text-sm text-muted-foreground">负责人、员工、财务和人事共用这一条命令数据；领导只看结果、风险和待决策事项。</p></div>
          <div className="flex flex-wrap gap-2">
            {state.command.status !== "archived" ? <Button type="button" onClick={advance} disabled={state.command.status === "executing" && !allDone}>{state.command.status === "executing" ? <ShieldCheck /> : state.command.status === "review" ? <CheckCircle2 /> : <Archive />}{state.command.status === "executing" ? "提交总验收" : state.command.status === "review" ? "通过总验收" : "完成归档"}</Button> : <Button asChild><Link href="/projects">查看项目成果<ArrowRight /></Link></Button>}
          </div>
        </div>
        <div className="grid gap-4 p-4 sm:p-5 xl:grid-cols-[1.2fr_1fr]">
          <div>
            <div className="flex items-end justify-between"><div><p className="text-3xl font-semibold">{completion}%</p><p className="mt-1 text-xs text-muted-foreground">{done}/{state.tasks.length} 项任务完成</p></div><p className="text-xs text-muted-foreground">截止 {state.command.deadline}</p></div>
            <ProgressBar value={completion} className="mt-3 h-2" />
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[{ label: "待验收", value: reviewing, icon: CircleDot }, { label: "阻塞", value: blocked, icon: UsersRound }, { label: "协同待办", value: openSupport, icon: Banknote }, { label: "成果记录", value: state.knowledge.length, icon: FileCheck2 }].map(({ label, value, icon: Icon }) => <div key={label} className="rounded-xl bg-muted/55 p-3"><Icon className="size-4 text-primary" /><p className="mt-2 text-lg font-semibold">{value}</p><p className="text-[11px] text-muted-foreground">{label}</p></div>)}
            </div>
            {feedback ? <p role="status" className="mt-3 rounded-xl bg-warning-soft px-3 py-2 text-xs font-medium text-warning">{feedback}</p> : null}
          </div>
          <div className="grid gap-2">
            {[{ label: "负责人", detail: `${state.tasks.filter(({ status }) => status === "review" || status === "blocked").length} 项待协调`, icon: UsersRound }, { label: "员工", detail: `${state.tasks.filter(({ assigneeId, status }) => assigneeId === "actor-employee" && status !== "done").length} 项个人任务`, icon: UserRoundCheck }, { label: "财务", detail: `${state.supportRequests.filter(({ type, status }) => type === "finance" && status !== "completed").length} 项预算待办`, icon: Banknote }, { label: "人事", detail: `${state.supportRequests.filter(({ type, status }) => type !== "finance" && status !== "completed").length} 项人员协同`, icon: UsersRound }].map(({ label, detail, icon: Icon }) => <div key={label} className="flex items-center gap-3 rounded-xl border border-border/70 bg-white/55 px-3 py-2.5"><span className="grid size-8 place-items-center rounded-lg bg-brand-soft text-primary"><Icon /></span><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{label}执行情况</span><span className="block text-xs text-muted-foreground">{detail}</span></span></div>)}
          </div>
        </div>
      </GlassCard>

      <OperationActionInbox state={state} actor={getActor("actor-executive")} />

      <OperationWeeklyBrief state={state} actor={getActor("actor-executive")} />

      {executiveReviews.length ? <GlassCard className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">直属负责人任务验收</h2><p className="mt-1 text-xs text-muted-foreground">部门负责人本人执行的任务由决策人验收，避免自提自批。</p></div><Badge variant="warning">{executiveReviews.length} 项待处理</Badge></div>
        <div className="mt-4 grid gap-3">
          {executiveReviews.map((task) => {
            const files = state.files.filter(({ entityType, entityId }) => entityType === "task" && entityId === task.id);
            return <article key={task.id} className="rounded-2xl border border-border/70 bg-white/55 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-medium text-primary">{task.department} · {getActor(task.assigneeId).name}</p><h3 className="mt-1 font-semibold">{task.title}</h3><p className="mt-1 text-xs text-muted-foreground">验收标准：{task.acceptance}</p></div><Badge variant={files.length ? "success" : "warning"}>{files.length ? `${files.length} 份成果` : "缺少成果"}</Badge></div>
              <div className="mt-3 flex flex-wrap items-end gap-2"><Textarea aria-label={`${task.title}领导验收意见`} value={reviewNotes[task.id] ?? ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [task.id]: event.target.value }))} placeholder="填写领导验收意见" className="min-h-9 flex-1 resize-none" /><Button size="sm" disabled={!files.length} onClick={() => reviewTask(task.id, "approve")}><ShieldCheck />通过</Button><Button size="sm" variant="outline" onClick={() => reviewTask(task.id, "return")}>退回修改</Button></div>
            </article>;
          })}
        </div>
      </GlassCard> : null}

      <GlassCard className="p-4 sm:p-5"><div className="flex items-center justify-between"><div><h2 className="font-semibold">跨部门动态</h2><p className="mt-1 text-xs text-muted-foreground">所有执行、审批、上传和验收操作自动留痕。</p></div><Badge variant="outline">{state.events.length} 条记录</Badge></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{state.events.slice(0, 8).map((item) => <div key={item.id} className="rounded-xl border border-border/70 bg-white/55 p-3"><p className="text-xs font-semibold">{item.action} · {getActor(item.actorId).name}</p><p className="mt-1.5 text-[11px] leading-5 text-muted-foreground">{item.detail}</p></div>)}</div></GlassCard>
    </section>
  );
}
