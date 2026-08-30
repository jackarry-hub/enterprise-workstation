"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, CheckCircle2, RefreshCw, Sparkles, Users } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Project = { id: string; name: string; dueDate: string; status: string };
type Member = { projectId: string; memberId: number; name: string; skills: string[]; openTaskCount: number };
type Assignment = { id: string; memberId: number; ordinal: number; title: string; description: string; acceptanceCriteria: string; dueDate: string; priority: string; evidence: { taskIds?: string[]; skills?: string[]; openTaskCount?: number } };
type Plan = { id: string; revision: number; source: "model" | "rules"; status: "draft" | "dispatched" | "superseded"; summary: { humanOverride?: boolean }; cost: number | null; riskSummary: string | null; dispatch?: { taskIds: string[]; notificationIds: string[] } | null; assignments: Assignment[] };
type Goal = { id: string; projectId: string; objective: string; createdAt: string; plan: Plan | null; override?: { reason: string; originalMemberId: number; replacementMemberId: number } | null };
type Workbench = { projects: Project[]; members: Member[]; goals: Goal[] };

async function json(response: Response) { return await response.json() as Record<string, unknown>; }

export function SchedulerWorkspace() {
  const [data, setData] = useState<Workbench>({ projects: [], members: [], goals: [] });
  const [projectId, setProjectId] = useState(""); const [objective, setObjective] = useState(""); const [workItems, setWorkItems] = useState("");
  const [selectedGoal, setSelectedGoal] = useState<Goal | null>(null); const [plan, setPlan] = useState<Plan | null>(null);
  const [overrideAssignmentId, setOverrideAssignmentId] = useState(""); const [replacementMemberId, setReplacementMemberId] = useState(""); const [overrideReason, setOverrideReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false); const [pending, setPending] = useState(false); const [feedback, setFeedback] = useState("正在同步排期记录…");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/workstation/scheduling/goals", { cache: "no-store" }); const payload = await json(response);
      if (!response.ok) throw new Error("load_failed");
      const next = { projects: Array.isArray(payload.projects) ? payload.projects as Project[] : [], members: Array.isArray(payload.members) ? payload.members as Member[] : [], goals: Array.isArray(payload.goals) ? payload.goals as Goal[] : [] };
      setData(next); setProjectId((current) => current || next.projects[0]?.id || ""); setFeedback(next.projects.length ? "" : "暂无可管理项目，需先建立项目和成员。");
      setSelectedGoal((current) => current ? next.goals.find(({ id }) => id === current.id) ?? current : next.goals[0] ?? null);
    } catch { setFeedback("排期数据同步失败，请稍后重试。"); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPlan(selectedGoal?.plan ?? null); }, [selectedGoal]);
  const projectMembers = useMemo(() => data.members.filter((member) => member.projectId === (selectedGoal?.projectId ?? projectId)), [data.members, projectId, selectedGoal?.projectId]);
  const memberName = (memberId: number) => projectMembers.find((member) => member.memberId === memberId)?.name ?? `成员 #${memberId}`;

  async function generatePlan() {
    if (!projectId || !objective.trim() || pending) return; setPending(true); setFeedback("正在保存目标并生成可审计方案…");
    try {
      const goalResponse = await fetch("/api/workstation/scheduling/goals", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ projectId, objective: objective.trim(), constraints: { workItems: workItems.split("\n").map((item) => item.trim()).filter(Boolean) } }) });
      const goalPayload = await json(goalResponse); const goal = goalPayload.goal as Goal | undefined;
      if (!goalResponse.ok || !goal?.id) throw new Error("goal_failed");
      const planResponse = await fetch(`/api/workstation/scheduling/goals/${encodeURIComponent(goal.id)}/plans`, { method: "POST", headers: { "Idempotency-Key": crypto.randomUUID() } });
      const planPayload = await json(planResponse); const generated = planPayload.plan as Plan | undefined;
      if (!planResponse.ok || !generated?.id) throw new Error("plan_failed");
      setSelectedGoal({ ...goal, createdAt: new Date().toISOString(), plan: generated }); setPlan(generated); setFeedback(generated.source === "model" ? "模型方案已保存，派发前请人工确认。" : "模型不可用或结果未通过校验，已保存规则方案。"); await load();
    } catch { setFeedback("方案生成失败，目标已保存时可刷新后继续。"); } finally { setPending(false); }
  }

  async function applyOverride() {
    if (!plan || !overrideAssignmentId || !replacementMemberId || overrideReason.trim().length < 5 || pending) return; setPending(true);
    try {
      const response = await fetch(`/api/workstation/scheduling/plans/${encodeURIComponent(plan.id)}/overrides`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ assignmentId: overrideAssignmentId, replacementMemberId: Number(replacementMemberId), reason: overrideReason.trim(), expectedRevision: plan.revision }) });
      const payload = await json(response); const next = payload.plan as Plan | undefined;
      if (!response.ok || !next) throw new Error("override_failed");
      setPlan(next); setOverrideAssignmentId(""); setReplacementMemberId(""); setOverrideReason(""); setFeedback(`人工改派：${(payload.override as { reason?: string } | undefined)?.reason ?? "已记录"}`); await load();
    } catch { setFeedback("改派失败，方案可能已被其他负责人更新。"); } finally { setPending(false); }
  }

  async function dispatchPlan() {
    if (!plan || pending) return; setPending(true);
    try {
      const response = await fetch(`/api/workstation/scheduling/plans/${encodeURIComponent(plan.id)}/dispatch`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ expectedRevision: plan.revision }) });
      const payload = await json(response); const next = payload.plan as Plan | undefined;
      if (!response.ok || !next) throw new Error("dispatch_failed");
      setPlan(next); setConfirmOpen(false); setFeedback(`已原子派发 ${next.dispatch?.taskIds.length ?? 0} 项任务，重复操作不会重复创建。`); await load();
    } catch { setFeedback("派发失败，未创建部分任务；请刷新核对方案版本。"); } finally { setPending(false); }
  }

  return <main className="mx-auto w-full max-w-420 px-3 pt-4 pb-32 sm:px-4 lg:px-5 lg:pt-6 lg:pb-8">
    <section className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold tracking-[0.18em] text-primary">EXPLAINABLE SCHEDULER</p><h1 className="mt-1 text-2xl font-semibold">智能排期</h1><p className="mt-1 text-sm text-muted-foreground">真实资源证据、版本化方案、人工改派和一次性派发。</p></div><Button type="button" variant="outline" onClick={() => void load()}><RefreshCw data-icon="inline-start"/>刷新</Button></section>
    {feedback ? <p role="status" className="mb-3 rounded-xl bg-brand-soft px-3 py-2 text-xs font-medium text-primary">{feedback}</p> : null}
    <div className="grid gap-3 xl:grid-cols-[22rem_minmax(0,1fr)]">
      <div className="grid content-start gap-3"><GlassCard className="p-4"><h2 className="font-semibold">1. 定义目标</h2><div className="mt-4 grid gap-3"><label className="grid gap-1 text-xs font-medium">项目<select className="h-11 rounded-xl border bg-background px-3 text-sm" value={projectId} onChange={(event) => setProjectId(event.target.value)}><option value="">请选择可管理项目</option>{data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><label className="grid gap-1 text-xs font-medium">目标<Input value={objective} onChange={(event) => setObjective(event.target.value)} maxLength={1000} placeholder="例如：两周内完成客户门户上线"/></label><label className="grid gap-1 text-xs font-medium">工作项（每行一项）<Textarea value={workItems} onChange={(event) => setWorkItems(event.target.value)} rows={5} placeholder={"需求确认\n开发与联调\n上线验收"}/></label><Button type="button" disabled={pending || !projectId || !objective.trim()} onClick={() => void generatePlan()}><Sparkles data-icon="inline-start"/>{pending ? "处理中…" : "生成并保存方案"}</Button></div></GlassCard>
      <GlassCard className="p-3"><h2 className="px-2 py-1 text-sm font-semibold">历史目标</h2><div className="mt-2 grid gap-1">{data.goals.map((goal) => <button type="button" key={goal.id} onClick={() => setSelectedGoal(goal)} className={cn("rounded-xl px-3 py-2 text-left", selectedGoal?.id === goal.id ? "bg-primary text-primary-foreground" : "hover:bg-muted")}><span className="block truncate text-sm font-medium">{goal.objective}</span><span className="mt-1 block text-xs opacity-70">版本 {goal.plan?.revision ?? 0} · {goal.plan?.status === "dispatched" ? "已派发" : "待确认"}</span></button>)}</div></GlassCard></div>
      <GlassCard className="overflow-hidden p-0"><header className="flex flex-wrap items-center gap-2 border-b px-4 py-4 sm:px-5"><div className="min-w-0 flex-1"><h2 className="truncate font-semibold">{selectedGoal?.objective ?? "等待生成方案"}</h2><p className="mt-1 text-xs text-muted-foreground">{plan ? `方案版本 v${plan.revision}` : "目标生成后在此进行人工确认"}</p></div>{plan ? <><span className={cn("rounded-full px-2.5 py-1 text-xs font-semibold", plan.source === "model" ? "bg-violet-100 text-violet-700" : "bg-amber-100 text-amber-700")}>{plan.source === "model" ? "模型方案" : "规则方案"}</span>{plan.summary?.humanOverride ? <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">含人工改派</span> : null}</> : null}</header>
        {!plan ? <div className="grid min-h-110 place-items-center px-6 text-center"><div><Users className="mx-auto size-10 text-primary"/><h3 className="mt-3 font-semibold">尚无排期方案</h3><p className="mt-1 text-sm text-muted-foreground">从左侧选择项目并定义目标。</p></div></div> : <div className="p-3 sm:p-5"><div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4"><div className="rounded-2xl bg-muted p-3"><p className="text-xs text-muted-foreground">任务</p><p className="mt-1 text-xl font-semibold">{plan.assignments.length}</p></div><div className="rounded-2xl bg-muted p-3"><p className="text-xs text-muted-foreground">成本</p><p className="mt-1 text-sm font-semibold">{plan.cost == null ? "未配置" : plan.cost}</p></div><div className="col-span-2 rounded-2xl bg-muted p-3"><p className="text-xs text-muted-foreground">风险提示</p><p className="mt-1 text-sm font-medium">{plan.riskSummary ?? "派发前请人工复核"}</p></div></div>
          {selectedGoal?.override ? <p className="mb-3 rounded-xl bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">人工改派：{selectedGoal.override.reason}</p> : null}
          <div className="grid gap-2">{plan.assignments.map((assignment) => <article key={assignment.id} className="rounded-2xl border p-4"><div className="flex flex-wrap items-start gap-2"><span className="grid size-7 place-items-center rounded-full bg-brand-soft text-xs font-bold text-primary">{assignment.ordinal+1}</span><div className="min-w-0 flex-1"><h3 className="font-semibold">{assignment.title}</h3><p className="mt-1 text-sm text-muted-foreground">{memberName(assignment.memberId)} · 截止 {assignment.dueDate} · 在手 {assignment.evidence.openTaskCount ?? 0} 项</p></div><span className="rounded-full bg-muted px-2 py-1 text-xs">{assignment.priority}</span></div><p className="mt-3 text-sm leading-6">{assignment.description}</p><p className="mt-2 text-xs text-muted-foreground">验收：{assignment.acceptanceCriteria}</p></article>)}</div>
          {plan.status === "draft" ? <section className="mt-4 rounded-2xl border border-dashed p-4"><h3 className="text-sm font-semibold">人工改派</h3><div className="mt-3 grid gap-2 lg:grid-cols-[1fr_1fr_2fr_auto]"><select aria-label="改派任务" className="h-10 rounded-xl border bg-background px-3 text-sm" value={overrideAssignmentId} onChange={(event) => setOverrideAssignmentId(event.target.value)}><option value="">选择任务</option>{plan.assignments.map((item) => <option value={item.id} key={item.id}>{item.title}</option>)}</select><select aria-label="替换成员" className="h-10 rounded-xl border bg-background px-3 text-sm" value={replacementMemberId} onChange={(event) => setReplacementMemberId(event.target.value)}><option value="">选择成员</option>{projectMembers.map((member) => <option value={member.memberId} key={member.memberId}>{member.name} · 在手 {member.openTaskCount}</option>)}</select><Input aria-label="改派原因" value={overrideReason} onChange={(event) => setOverrideReason(event.target.value)} placeholder="说明资源冲突或专业匹配原因"/><Button type="button" variant="outline" onClick={() => void applyOverride()} disabled={pending}>保存改派</Button></div></section> : <div className="mt-4 flex items-center gap-2 rounded-2xl bg-emerald-50 p-4 text-sm font-medium text-emerald-700"><CheckCircle2 className="size-5"/>已派发 {plan.dispatch?.taskIds.length ?? 0} 项真实任务</div>}
        </div>}
      </GlassCard>
    </div>
    {plan?.status === "draft" ? <div className="fixed inset-x-3 bottom-20 z-30 md:static md:mt-4 md:flex md:justify-end"><Button type="button" size="lg" className="w-full shadow-lg md:w-auto" disabled={pending} onClick={() => setConfirmOpen(true)}>确认并派发任务<ArrowRight data-icon="inline-end"/></Button></div> : null}
    <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}><DialogContent><DialogHeader><DialogTitle>确认派发方案 v{plan?.revision}</DialogTitle><DialogDescription>将一次性创建 {plan?.assignments.length ?? 0} 项真实任务并进入通知队列。派发后方案不可修改。</DialogDescription></DialogHeader><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setConfirmOpen(false)}>返回检查</Button><Button onClick={() => void dispatchPlan()} disabled={pending}>{pending ? "派发中…" : "确认派发"}</Button></div></DialogContent></Dialog>
  </main>;
}
