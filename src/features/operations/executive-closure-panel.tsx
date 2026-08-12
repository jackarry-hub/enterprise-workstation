"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Archive, ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { CUSTOMER_DEMO_RESET_EVENT } from "@/features/demo/customer-demo-state";
import { getActor, getTaskReviewerId, setCommandStatus, updateOperationTask } from "@/features/operations/operations-data";
import { useOperations } from "@/features/operations/use-operations";

const commandStatusLabel = { executing: "协同执行中", review: "待领导总验收", accepted: "总验收通过", archived: "已归档闭环" } as const;

export function ExecutiveClosurePanel() {
  const session = useWorkspaceSession();
  const { state, context, actor } = useOperations(session);
  const [feedback, setFeedback] = useState("");
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const done = state.tasks.filter(({ status }) => status === "done").length;
  const openSupport = state.supportRequests.filter(({ status }) => status !== "completed" && status !== "rejected").length;
  const dispatched = Boolean(state.command.projectId);
  const allDone = dispatched && done === state.tasks.length && openSupport === 0;
  const executiveReviews = state.tasks.filter((task) => task.status === "review" && getTaskReviewerId(task) === actor.id);
  const incompleteTasks = state.tasks.filter(({ status }) => status !== "done");
  const firstIncompleteTask = incompleteTasks[0];
  const unmetReason = !dispatched
    ? `请先在上方确认方案并下发 ${state.tasks.length} 项任务。`
    : firstIncompleteTask
    ? `还不能提交：${getActor(firstIncompleteTask.assigneeId).name}需先完成“${firstIncompleteTask.title}”并由${getActor(getTaskReviewerId(firstIncompleteTask)).name}验收。`
    : openSupport ? `还不能提交：仍有 ${openSupport} 项协同事项未办结。` : "所有任务和协同事项已完成，可以提交总验收。";

  useEffect(() => {
    const clearFeedback = () => setFeedback("");
    window.addEventListener(CUSTOMER_DEMO_RESET_EVENT, clearFeedback);
    return () => window.removeEventListener(CUSTOMER_DEMO_RESET_EVENT, clearFeedback);
  }, []);

  function reviewTask(taskId: string, action: "approve" | "return") {
    try {
      const reviewNote = reviewNotes[taskId]?.trim() || (action === "approve" ? "成果符合验收标准，同意通过。" : "请根据验收标准补充成果后重新提交。");
      updateOperationTask(context, taskId, action === "approve"
        ? { status: "done", reviewNote }
        : { status: "in_progress", reviewNote, progress: 70 }, actor.id, session.actor);
      setFeedback(action === "approve" ? "负责人任务已验收通过" : "任务已退回负责人修改");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "任务验收失败");
    }
  }

  function advance() {
    try {
      if (state.command.status === "executing") setCommandStatus(context, "review", actor.id);
      else if (state.command.status === "review") setCommandStatus(context, "accepted", actor.id);
      else if (state.command.status === "accepted") setCommandStatus(context, "archived", actor.id);
      setFeedback(state.command.status === "executing" ? "已进入领导总验收" : state.command.status === "review" ? "总验收已通过" : "命令成果已发布到知识库");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "状态更新失败");
    }
  }

  return (
    <section id="customer-demo-closure" className="mx-auto grid w-full max-w-420 scroll-mt-24 gap-3 px-3 pb-26 sm:px-4 lg:px-5 lg:pb-8" aria-label="真实业务闭环">
      <GlassCard className="overflow-hidden border-primary/20">
        <div className="flex flex-col gap-3 border-b border-border/70 bg-brand-soft/55 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold">CEO 验收与归档</h2><Badge variant={state.command.status === "archived" ? "success" : "info"}>{dispatched ? commandStatusLabel[state.command.status] : "待方案下发"}</Badge></div><p className="mt-1 text-sm text-muted-foreground">这里只保留需要 CEO 亲自处理的成果验收、总验收与归档。</p></div>
          <div className="flex flex-wrap gap-2">
            {state.command.status === "executing" && allDone ? <Button type="button" onClick={advance}><ShieldCheck />提交总验收</Button> : null}
            {state.command.status === "review" ? <Button type="button" onClick={advance}><CheckCircle2 />通过总验收</Button> : null}
            {state.command.status === "accepted" ? <Button type="button" onClick={advance}><Archive />完成归档</Button> : null}
            {state.command.status === "archived" ? <Button asChild><Link href="/projects">查看项目成果<ArrowRight /></Link></Button> : null}
            {state.command.status === "executing" && !allDone ? <p className="basis-full text-xs font-medium text-warning">{unmetReason}</p> : null}
          </div>
        </div>
        {feedback ? <p role="status" className="m-4 rounded-xl bg-warning-soft px-3 py-2 text-xs font-medium text-warning sm:m-5">{feedback}</p> : null}
      </GlassCard>

      {executiveReviews.length ? <GlassCard className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3"><div><h2 className="font-semibold">直属负责人任务验收</h2><p className="mt-1 text-xs text-muted-foreground">部门负责人本人执行的任务由决策人验收，避免自提自批。</p></div><Badge variant="warning">{executiveReviews.length} 项待处理</Badge></div>
        <div className="mt-4 grid gap-3">
          {executiveReviews.map((task) => {
            const files = state.files.filter(({ entityType, entityId }) => entityType === "task" && entityId === task.id);
            return <article key={task.id} className="rounded-2xl border border-border/70 bg-white/55 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-medium text-primary">{task.department} · {getActor(task.assigneeId).name}</p><h3 className="mt-1 font-semibold">{task.title}</h3><p className="mt-1 text-xs text-muted-foreground">验收标准：{task.acceptance}</p></div><Badge variant={files.length ? "success" : "warning"}>{files.length ? `${files.length} 份成果` : "缺少成果"}</Badge></div>
              <div className="mt-3 flex flex-wrap items-end gap-2"><Textarea aria-label={`${task.title}领导验收意见`} value={reviewNotes[task.id] ?? ""} onChange={(event) => setReviewNotes((current) => ({ ...current, [task.id]: event.target.value }))} placeholder="填写领导验收意见" className="min-h-9 flex-1 resize-none" /><Button aria-label={`通过验收：${task.title}`} size="sm" disabled={!files.length} onClick={() => reviewTask(task.id, "approve")}><ShieldCheck />通过</Button><Button aria-label={`退回修改：${task.title}`} size="sm" variant="outline" onClick={() => reviewTask(task.id, "return")}>退回修改</Button></div>
            </article>;
          })}
        </div>
      </GlassCard> : null}

    </section>
  );
}
