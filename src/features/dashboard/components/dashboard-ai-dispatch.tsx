"use client";

import {
  Archive,
  Bot,
  CheckCircle2,
  Clock3,
  History,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  TriangleAlert,
  WandSparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { AiDispatchPlan, DispatchPriority, DispatchRiskLevel } from "@/features/ai-dispatch/dispatch-contract";
import { dispatchAiPlanToOperations } from "@/features/ai-dispatch/dispatch-to-operations";
import {
  createStaticDemoDispatchResult,
  createStaticDemoExecutionSummary,
  isStaticAiDemoBuild,
} from "@/features/ai-dispatch/static-demo-client";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import type { DashboardViewModel } from "@/features/dashboard/dashboard-view-model";
import { DashboardDispatchProgress } from "@/features/dashboard/components/dashboard-dispatch-progress";
import type { OperationFixtureContext } from "@/features/operations/operation-actor-compat";
import { createDemoTaskRepository } from "@/features/tasks/repositories/demo-task-repository";
import { cn } from "@/lib/utils";

const recommendations = [
  "3天内完成移动端V1",
  "为客户官网升级项目制定一周执行计划",
  "安排团队完成本周客户交付",
  "分析当前团队任务并重新分配优先级",
] as const;

const analysisSteps = [
  "正在理解目标",
  "正在分析团队能力",
  "正在拆解任务",
  "正在评估工作负荷",
  "正在生成调度方案",
] as const;

const commandStatusLabel = {
  executing: "执行中",
  review: "待复盘",
  accepted: "已验收",
  archived: "已归档",
} as const;

const riskLabel: Record<DispatchRiskLevel, string> = {
  low: "低",
  medium: "中",
  high: "高",
};

const priorityLabel: Record<DispatchPriority, string> = {
  low: "低",
  medium: "中",
  high: "高",
  urgent: "紧急",
};

type DispatchApiSuccess = {
  plan: AiDispatchPlan;
  model: string;
  repaired: boolean;
  mode: "demo";
};

function planParticipantCount(plan: AiDispatchPlan) {
  return new Set(plan.tasks.flatMap(({ owner, assignee }) => [owner, assignee])).size;
}

function DispatchPlanDialog({
  result,
  onClose,
  onConfirm,
}: {
  result: DispatchApiSuccess;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { plan } = result;
  return (
    <>
      <DialogHeader>
        <div className="flex flex-wrap items-center gap-2">
          <DialogTitle className="flex items-center gap-2 text-xl"><Bot aria-hidden="true" className="text-primary" />AI调度方案</DialogTitle>
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-primary">DEMO MODE</span>
        </div>
        <DialogDescription>{result.model === "demo-fallback" ? "方案由浏览器内置演示规则根据当前团队生成" : "方案由 DeepSeek 基于当前演示团队生成"}；确认后会写入演示任务池并分配到个人工作台，不会写入 Supabase 或发送飞书通知。</DialogDescription>
      </DialogHeader>

      <div className="max-h-[68vh] space-y-4 overflow-y-auto pr-1">
        <div className="rounded-2xl border border-primary/15 bg-brand-soft/45 p-4">
          <p className="text-xs font-medium text-primary">目标理解</p>
          <p className="mt-1.5 font-semibold leading-6">{plan.goal}</p>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{plan.summary}</p>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ["预计周期", `${plan.estimated_days}天`],
              ["参与人员", `${planParticipantCount(plan)}人`],
              ["任务", `${plan.tasks.length}项`],
              ["风险", riskLabel[plan.risk_level]],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-white/90 bg-white/75 p-3">
                <p className="text-[11px] text-muted-foreground">{label}</p>
                <p className="mt-1 text-lg font-semibold text-[#172640]">{value}</p>
              </div>
            ))}
          </div>
        </div>

        <section aria-label="任务拆解">
          <h3 className="text-sm font-semibold">任务拆解</h3>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {plan.tasks.map((task, index) => (
              <article key={`${task.title}-${index}`} className="rounded-2xl border border-border/70 bg-background p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-primary">任务 {index + 1}</p>
                    <h4 className="mt-1 font-semibold leading-5">{task.title}</h4>
                  </div>
                  <span className={cn(
                    "shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold",
                    task.priority === "urgent" ? "bg-destructive/10 text-destructive" : task.priority === "high" ? "bg-warning-soft text-warning" : "bg-primary/10 text-primary",
                  )}>{priorityLabel[task.priority]}</span>
                </div>
                <p className="mt-2 text-xs leading-5 text-muted-foreground">{task.description}</p>
                <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <div><dt className="text-muted-foreground">建议负责人</dt><dd className="mt-0.5 font-medium">{task.owner}</dd></div>
                  <div><dt className="text-muted-foreground">建议执行人</dt><dd className="mt-0.5 font-medium">{task.assignee} · {task.role}</dd></div>
                  <div><dt className="text-muted-foreground">截止时间</dt><dd className="mt-0.5 font-medium">{task.deadline}</dd></div>
                  <div><dt className="text-muted-foreground">预计工时</dt><dd className="mt-0.5 font-medium">{task.estimated_hours}小时</dd></div>
                </dl>
                {task.dependencies.length ? <p className="mt-2 text-[11px] text-muted-foreground">前置：{task.dependencies.join("、")}</p> : null}
                <p className="mt-2 rounded-xl bg-brand-soft/45 px-2.5 py-2 text-xs leading-5"><span className="font-medium text-primary">推荐理由：</span>{task.reason}</p>
              </article>
            ))}
          </div>
        </section>

        <div className="grid gap-2 sm:grid-cols-2">
          <section className="rounded-2xl border border-warning/20 bg-warning-soft/45 p-3.5">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold"><TriangleAlert aria-hidden="true" className="size-4 text-warning" />风险</h3>
            {plan.risks.length ? <ul className="mt-2 space-y-1.5 text-xs leading-5 text-muted-foreground">{plan.risks.map((risk) => <li key={risk}>• {risk}</li>)}</ul> : <p className="mt-2 text-xs text-muted-foreground">暂无明显风险</p>}
          </section>
          <section className="rounded-2xl border border-primary/15 bg-brand-soft/35 p-3.5">
            <h3 className="text-sm font-semibold">管理者需确认</h3>
            {plan.manager_decisions.length ? <ul className="mt-2 space-y-1.5 text-xs leading-5 text-muted-foreground">{plan.manager_decisions.map((decision) => <li key={decision}>• {decision}</li>)}</ul> : <p className="mt-2 text-xs text-muted-foreground">暂无额外确认事项</p>}
          </section>
        </div>
        <p className="text-[10px] text-muted-foreground">模型：{result.model}{result.repaired ? " · 已自动修复一次结构" : ""}</p>
      </div>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>返回修改</Button>
        <Button type="button" onClick={onConfirm}><CheckCircle2 aria-hidden="true" />确认并下发</Button>
      </DialogFooter>
    </>
  );
}

export function DashboardAiDispatch({
  dispatch,
  context,
  session,
}: {
  dispatch: DashboardViewModel["dispatch"];
  context: OperationFixtureContext;
  session: WorkspaceSession;
}) {
  const [goal, setGoal] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [dialogMode, setDialogMode] = useState<"plan" | "history" | null>(null);
  const [result, setResult] = useState<DispatchApiSuccess | null>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (intervalRef.current) window.clearInterval(intervalRef.current);
  }, []);

  async function generatePlan() {
    if (!goal.trim() || loading) return;
    setLoading(true);
    setError("");
    setFeedback("");
    setResult(null);
    setActiveStep(0);
    if (intervalRef.current) window.clearInterval(intervalRef.current);
    intervalRef.current = window.setInterval(() => {
      setActiveStep((current) => Math.min(analysisSteps.length - 1, current + 1));
    }, 900);

    try {
      let payload: DispatchApiSuccess;
      if (isStaticAiDemoBuild()) {
        await new Promise((resolve) => window.setTimeout(resolve, 1_100));
        payload = createStaticDemoDispatchResult(goal.trim());
      } else {
        const response = await fetch("/api/ai/dispatch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ command: goal.trim() }),
        });
        const responsePayload = await response.json().catch(() => null) as DispatchApiSuccess | { error?: { message?: string } } | null;
        if (!response.ok || !responsePayload || !("plan" in responsePayload)) {
          const message = responsePayload && "error" in responsePayload ? responsePayload.error?.message : undefined;
          throw new Error(message || "AI调度服务暂时不可用，请稍后重试。");
        }
        payload = responsePayload;
      }
      setResult(payload);
      setDialogMode("plan");
    } catch (requestError) {
      setError(requestError instanceof Error && requestError.message
        ? requestError.message
        : "AI调度服务暂时不可用，请稍后重试。");
    } finally {
      if (intervalRef.current) window.clearInterval(intervalRef.current);
      intervalRef.current = null;
      setLoading(false);
    }
  }

  async function confirmPlan() {
    if (!result) return;
    try {
      const receipt = await dispatchAiPlanToOperations(context, result.plan, session);
      setDialogMode(null);
      setFeedback(`已下发 ${receipt.taskCount} 项任务至 ${receipt.assigneeCount} 人`);
    } catch (dispatchError) {
      setError(dispatchError instanceof Error ? dispatchError.message : "调度方案下发失败，请稍后重试。");
      setDialogMode(null);
    }
  }

  async function generateSummary() {
    const current = dispatch.current;
    if (!current?.execution || summaryLoading) return;
    setSummaryLoading(true);
    setError("");
    try {
      let payload: { summary: NonNullable<typeof current.summary>; model: string };
      if (isStaticAiDemoBuild()) {
        await new Promise((resolve) => window.setTimeout(resolve, 600));
        payload = {
          summary: createStaticDemoExecutionSummary(current.execution),
          model: "demo-fallback",
        };
      } else {
        const response = await fetch("/api/ai/summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ execution: current.execution }),
        });
        const responsePayload = await response.json().catch(() => null) as {
          summary?: NonNullable<typeof current.summary>;
          model?: string;
          error?: { message?: string };
        } | null;
        if (!response.ok || !responsePayload?.summary || !responsePayload.model) {
          throw new Error(responsePayload?.error?.message || "AI总结服务暂时不可用，请稍后重试。");
        }
        payload = { summary: responsePayload.summary, model: responsePayload.model };
      }
      await createDemoTaskRepository(context, session).saveDispatchSummary(payload.summary, payload.model);
      setFeedback(isStaticAiDemoBuild() ? "本地演示 AI 已生成执行总结" : "DeepSeek 已生成本次执行总结");
    } catch (summaryError) {
      setError(summaryError instanceof Error ? summaryError.message : "AI总结服务暂时不可用，请稍后重试。");
    } finally {
      setSummaryLoading(false);
    }
  }

  async function archiveDispatch() {
    try {
      await createDemoTaskRepository(context, session).archiveDispatch();
      setFeedback("本次 AI 调度已归档");
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "归档失败，请稍后重试。");
    }
  }

  async function resetCurrentDispatch() {
    const confirmed = window.confirm("确认重置本次 AI 调度？AI 工作流、任务和进度将被移除，部门任务与部门进度会保留。");
    if (!confirmed) return;
    try {
      await createDemoTaskRepository(context, session).resetActiveAiDispatch();
      setError("");
      setFeedback("本次 AI 调度已重置，部门任务进度已保留");
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : "重置本次 AI 调度失败，请稍后重试。");
    }
  }

  return (
    <section
      aria-labelledby="dashboard-ai-title"
      data-source="mock"
      className="relative isolate h-full overflow-hidden rounded-[30px] border border-primary/15 bg-[radial-gradient(circle_at_top_right,rgba(94,153,255,0.3),transparent_42%),linear-gradient(145deg,rgba(240,247,255,0.98),rgba(255,255,255,0.94))] p-4 shadow-[0_24px_60px_rgba(54,104,180,0.14)] sm:p-6"
    >
      <div aria-hidden="true" className="absolute -top-12 -right-10 -z-10 size-52 rounded-full border border-white/70 bg-white/25 blur-sm" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary text-white shadow-[0_12px_26px_rgba(47,128,237,0.28)]"><Bot aria-hidden="true" className="size-5" /></span>
          <div>
            <div className="flex flex-wrap items-center gap-2"><h2 id="dashboard-ai-title" className="text-lg font-semibold tracking-tight sm:text-xl">AI决策调度台</h2><span className="rounded-full bg-success-soft px-2 py-0.5 text-[10px] font-semibold text-success">{isStaticAiDemoBuild() ? "本地演示 AI" : "DeepSeek API"}</span></div>
            <p className="mt-0.5 text-xs text-muted-foreground">把目标变成清晰、可确认的执行方案</p>
          </div>
        </div>
        <span className="w-fit shrink-0 whitespace-nowrap rounded-full border border-primary/15 bg-white/65 px-2.5 py-1 text-[11px] font-medium text-primary">权限范围：{dispatch.scopeLabel}</span>
      </div>

      <div className="mt-5 rounded-2xl border border-white/90 bg-white/78 p-2.5 shadow-[0_12px_36px_rgba(61,110,178,0.09)]">
        <Textarea
          value={goal}
          onChange={(event) => { setGoal(event.target.value); setError(""); }}
          placeholder="告诉AI企业大脑，你今天想推进什么……"
          className="min-h-24 resize-none border-0 bg-transparent px-2 py-2 text-[15px] shadow-none focus-visible:ring-0"
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-2.5">
          <Button type="button" variant="ghost" size="sm" className="rounded-xl text-muted-foreground" onClick={() => setDialogMode("history")}><History aria-hidden="true" />历史指令</Button>
          <Button type="button" className="h-9 rounded-xl px-4" disabled={!dispatch.canUse || !goal.trim() || loading} onClick={generatePlan}>
            {loading ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <WandSparkles aria-hidden="true" />}
            {loading ? "AI正在分析" : "AI分析并生成调度方案"}
          </Button>
        </div>
      </div>

      {loading ? (
        <div role="status" aria-live="polite" className="mt-3 rounded-2xl border border-primary/10 bg-white/65 p-3">
          <div className="grid gap-1.5 sm:grid-cols-5">
            {analysisSteps.map((step, index) => (
              <div key={step} className={cn("flex items-center gap-1.5 rounded-xl px-2 py-1.5 text-[11px]", index === activeStep ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground")}>
                {index === activeStep ? <LoaderCircle aria-hidden="true" className="size-3.5 animate-spin" /> : <span aria-hidden="true" className="size-1.5 rounded-full bg-border" />}{step}
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-muted-foreground">{isStaticAiDemoBuild() ? "以上步骤用于演示本地 AI 的任务拆解过程。" : "以上步骤表示DeepSeek正在处理的分析范围，不代表已提前完成。"}</p>
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-destructive/15 bg-destructive/8 px-3 py-2 text-xs text-destructive">
          <span className="flex items-center gap-1.5"><TriangleAlert aria-hidden="true" className="size-4" />{error}</span>
          <Button type="button" variant="outline" size="sm" className="h-7 bg-white text-foreground" onClick={generatePlan}><RotateCcw aria-hidden="true" />重新生成</Button>
        </div>
      ) : null}

      {dispatch.current ? (
        <DashboardDispatchProgress current={dispatch.current}>
          {dispatch.current.progress === 100 && dispatch.current.isOwner ? (
            <div className="mt-3 border-t border-border/60 pt-3">
              <p className="text-xs font-medium text-success">本次目标已经全部完成</p>
              {dispatch.current.summary ? (
                <div className="mt-2 rounded-xl bg-success-soft/70 p-3 text-xs leading-5">
                  <p className="font-medium">{dispatch.current.summary.completion}</p>
                  <p className="mt-1 text-muted-foreground">{dispatch.current.summary.team_performance}</p>
                  <p className="mt-1 text-muted-foreground">下一步：{dispatch.current.summary.next_steps.join("；")}</p>
                </div>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {!dispatch.current.summary ? (
                  <Button type="button" size="sm" className="rounded-xl" disabled={summaryLoading} onClick={generateSummary}>
                    {summaryLoading ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : <Sparkles aria-hidden="true" />}
                    {summaryLoading ? (isStaticAiDemoBuild() ? "本地总结中" : "DeepSeek 总结中") : "生成 AI 执行总结"}
                  </Button>
                ) : dispatch.current.status !== "archived" ? (
                  <Button type="button" size="sm" className="rounded-xl" onClick={archiveDispatch}><Archive aria-hidden="true" />归档本次调度</Button>
                ) : <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] text-muted-foreground">已进入 AI 调度历史</span>}
              </div>
            </div>
          ) : null}
          {dispatch.current.isOwner || session.primaryRole === "executive" ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
              <p className="text-[11px] text-muted-foreground">仅清除当前 AI 工作流，保留全部部门任务及其进度。</p>
              <Button type="button" size="sm" variant="outline" className="rounded-xl" onClick={resetCurrentDispatch}><RotateCcw aria-hidden="true" />重置本次 AI 调度</Button>
            </div>
          ) : null}
        </DashboardDispatchProgress>
      ) : null}

      <div className="mt-4">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"><Sparkles aria-hidden="true" className="size-3.5 text-primary" />Demo快速指令</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {recommendations.map((recommendation) => (
            <button key={recommendation} type="button" onClick={() => { setGoal(recommendation); setError(""); }} className="rounded-full border border-primary/10 bg-white/65 px-3 py-1.5 text-left text-xs text-foreground transition hover:border-primary/30 hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30">{recommendation}</button>
          ))}
        </div>
      </div>

      {feedback ? <div role="status" className="mt-3 flex items-center gap-2 rounded-xl bg-success-soft px-3 py-2 text-xs font-medium text-success"><CheckCircle2 aria-hidden="true" className="size-4" />{feedback}<span className="ml-auto rounded-full bg-white/70 px-2 py-0.5 text-[9px] font-semibold tracking-wide">DEMO MODE</span></div> : null}

      <Dialog open={dialogMode !== null} onOpenChange={(open) => { if (!open) setDialogMode(null); }}>
        <DialogContent className={dialogMode === "plan" ? "sm:max-w-4xl" : "sm:max-w-xl"}>
          {dialogMode === "history" ? (
            <>
              <DialogHeader><DialogTitle className="flex items-center gap-2 text-xl"><History aria-hidden="true" className="text-primary" />AI 调度历史</DialogTitle><DialogDescription>当前调度和已归档复盘均保存在本浏览器 Demo Repository 中。</DialogDescription></DialogHeader>
              <div className="max-h-[60vh] space-y-2 overflow-y-auto">
                {dispatch.current ? <div className="rounded-2xl border border-primary/15 bg-brand-soft/45 p-4"><p className="font-semibold leading-6">{dispatch.current.title}</p><div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground"><span className="rounded-full bg-white px-2.5 py-1">{commandStatusLabel[dispatch.current.status]}</span><span className="rounded-full bg-white px-2.5 py-1">进度 {dispatch.current.progress}%</span><span className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1"><Clock3 aria-hidden="true" className="size-3.5" />截止 {dispatch.current.deadline}</span></div></div> : null}
                {dispatch.history.map((entry) => <article key={entry.commandId} className="rounded-2xl border border-border/70 bg-background p-4"><p className="font-semibold leading-6">{entry.goal}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{entry.aiSummary.completion}</p><div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground"><span>{entry.taskCount} 项任务</span><span>{entry.participantCount} 人参与</span><span>{entry.rejectionCount} 次退回</span><span>归档 {entry.archivedAt.slice(0, 10)}</span></div></article>)}
                {!dispatch.current && dispatch.history.length === 0 ? <p className="rounded-2xl bg-muted/50 p-5 text-center text-sm text-muted-foreground">暂无调度历史</p> : null}
              </div>
            </>
          ) : result ? <DispatchPlanDialog result={result} onClose={() => setDialogMode(null)} onConfirm={confirmPlan} /> : null}
        </DialogContent>
      </Dialog>
    </section>
  );
}
