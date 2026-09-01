"use client";

import { useMemo, useState } from "react";
import { Bot, CheckCircle2, CirclePause, GitBranch, Hand, Plus, ShieldCheck, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectDetailData, ProjectSopDefinition, ProjectSopRun, ProjectSopStep } from "@/features/projects/types";

const initialSteps: ProjectSopStep[] = [
  { key: "prepare", name: "准备与分工", description: "确认目标、负责人、输入材料和完成口径。", kind: "human", requiresHuman: true },
  { key: "execute", name: "执行与留痕", description: "按任务执行，Agent 仅作为辅助工具并记录结果。", kind: "agent", requiresHuman: false },
  { key: "accept", name: "人工验收", description: "负责人依据证据完成验收并确认后续动作。", kind: "approval", requiresHuman: true },
];

const kindLabel = { human: "人工", agent: "Agent 辅助", approval: "审批", system: "系统" } as const;
const runStatusLabel = { running: "执行中", waiting_human: "待人工处理", completed: "已完成", failed: "失败", cancelled: "已取消" } as const;

export function ProjectSopTab({
  detail, canManage, onSave, onStart, onAdvance,
}: {
  detail: ProjectDetailData;
  canManage: boolean;
  onSave: (input: { definitionId: string | null; code: string; name: string; description: string; steps: ProjectSopStep[]; publish: boolean }, idempotencyKey: string) => Promise<void>;
  onStart: (definition: ProjectSopDefinition, employeeId: string, taskId: string | null, idempotencyKey: string) => Promise<void>;
  onAdvance: (run: ProjectSopRun, action: "complete_step" | "request_human" | "resume", note: string, idempotencyKey: string) => Promise<void>;
}) {
  const model = detail.operatingModel;
  const [createOpen, setCreateOpen] = useState(false);
  const [startDefinition, setStartDefinition] = useState<ProjectSopDefinition>();
  const [name, setName] = useState("标准项目执行 SOP"); const [code, setCode] = useState("project_delivery");
  const [description, setDescription] = useState("覆盖准备、执行、人工验收的标准项目流程。");
  const [steps, setSteps] = useState<ProjectSopStep[]>(initialSteps);
  const [assignee, setAssignee] = useState(""); const [taskId, setTaskId] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState("");
  const members = useMemo(() => detail.members.flatMap(({ member }) => member.employeePublicId ? [member] : []), [detail.members]);

  async function saveDefinition() {
    if (!name.trim() || !/^[a-z][a-z0-9_-]{1,79}$/.test(code) || steps.some((step) => !step.name.trim())) {
      setFeedback("请填写有效名称、英文编码和步骤"); return;
    }
    try { setBusy(true); setFeedback(""); await onSave({ definitionId: null, code, name: name.trim(), description: description.trim(), steps, publish: true }, crypto.randomUUID()); setCreateOpen(false); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "SOP 保存失败"); }
    finally { setBusy(false); }
  }

  async function startRun() {
    if (!startDefinition || !assignee) { setFeedback("请选择实际负责人"); return; }
    try { setBusy(true); setFeedback(""); await onStart(startDefinition, assignee, taskId || null, crypto.randomUUID()); setStartDefinition(undefined); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "SOP 启动失败"); }
    finally { setBusy(false); }
  }

  async function advance(run: ProjectSopRun, action: "complete_step" | "request_human" | "resume") {
    const note = notes[run.id]?.trim() ?? "";
    if (action === "complete_step" && !note) { setFeedback("完成步骤前请填写结果或证据说明"); return; }
    try { setBusy(true); setFeedback(""); await onAdvance(run, action, note, crypto.randomUUID()); setNotes((current) => ({ ...current, [run.id]: "" })); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "SOP 状态更新失败"); }
    finally { setBusy(false); }
  }

  if (!model) return <GlassCard className="p-6 text-sm text-destructive">SOP 运行模型未加载，请刷新页面。</GlassCard>;
  return <div className="grid gap-4">
    <GlassCard className="p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><GitBranch className="size-5 text-primary" />版本化 SOP</h2><p className="mt-1 text-sm text-muted-foreground">流程版本发布后不可篡改，运行记录与人工接管全程留痕。</p></div>{canManage ? <Button onClick={() => setCreateOpen(true)}><Plus />新建 SOP</Button> : null}</div>
      <div className="mt-5 grid gap-3 lg:grid-cols-2">{model.sops.length ? model.sops.map((sop) => <article key={sop.id} className="rounded-2xl border border-border/70 bg-white/55 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-medium">{sop.name}</h3><p className="mt-1 text-xs text-muted-foreground">{sop.code} · v{sop.revision ?? "草稿"}</p></div><Badge variant={sop.status === "active" ? "success" : "outline"}>{sop.status === "active" ? "已发布" : "草稿"}</Badge></div><div className="mt-4 flex flex-wrap gap-2">{sop.steps.map((step, index) => <span key={step.key} className="rounded-full bg-primary/8 px-3 py-1 text-xs text-primary">{index + 1}. {step.name}</span>)}</div>{canManage && sop.status === "active" ? <Button className="mt-4 w-full sm:w-auto" size="sm" onClick={() => { setStartDefinition(sop); setAssignee(detail.owner.employeePublicId ?? ""); }}>启动流程</Button> : null}</article>) : <p className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground lg:col-span-2">还没有正式 SOP，可从标准三步流程开始。</p>}</div>
    </GlassCard>
    <div className="grid gap-4 xl:grid-cols-2">{model.sopRuns.length ? model.sopRuns.map((run) => {
      const step = run.steps[run.currentStepIndex]; const progress = run.status === "completed" ? 100 : Math.round(run.currentStepIndex / Math.max(run.steps.length, 1) * 100);
      return <GlassCard key={run.id} className="p-5"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold">{run.definitionName}</h3><p className="mt-1 text-xs text-muted-foreground">负责人 {run.assignedName} · 版本 v{run.revision}</p></div><Badge variant={run.status === "completed" ? "success" : run.status === "failed" ? "destructive" : run.status === "waiting_human" ? "warning" : "outline"}>{runStatusLabel[run.status]}</Badge></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div><div className="mt-4 rounded-xl border border-border/60 bg-background/70 p-3"><div className="flex items-center gap-2">{step?.kind === "agent" ? <Bot className="size-4 text-primary" /> : step?.kind === "approval" ? <ShieldCheck className="size-4 text-primary" /> : <Hand className="size-4 text-primary" />}<span className="text-sm font-medium">{step ? `${run.currentStepIndex + 1}. ${step.name}` : "流程已结束"}</span></div>{step?.description ? <p className="mt-2 text-xs text-muted-foreground">{step.description}</p> : null}</div>{!["completed", "failed", "cancelled"].includes(run.status) ? <><Textarea className="mt-3" value={notes[run.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [run.id]: event.target.value }))} placeholder="填写结果、证据或人工处理说明" /><div className="mt-3 flex flex-wrap gap-2">{run.status === "waiting_human" ? <Button size="sm" disabled={busy} onClick={() => void advance(run, "complete_step")}><CheckCircle2 />确认并继续</Button> : <><Button size="sm" disabled={busy} onClick={() => void advance(run, "complete_step")}><CheckCircle2 />完成当前步骤</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void advance(run, "request_human")}><CirclePause />转人工</Button></>}</div></> : null}</GlassCard>;
    }) : <GlassCard className="p-6 text-sm text-muted-foreground xl:col-span-2">暂无运行中的 SOP 实例。</GlassCard>}</div>
    {feedback ? <p role="status" className="rounded-xl bg-muted px-4 py-3 text-sm">{feedback}</p> : null}

    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="h-[100dvh] w-screen max-w-none overflow-y-auto rounded-none sm:h-auto sm:max-h-[90dvh] sm:max-w-2xl sm:rounded-2xl"><DialogHeader><DialogTitle>新建并发布 SOP</DialogTitle><DialogDescription>发布版本不可篡改；后续调整会生成新版本。</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-sm">名称<Input value={name} onChange={(event) => setName(event.target.value)} /></label><label className="grid gap-1.5 text-sm">英文编码<Input value={code} onChange={(event) => setCode(event.target.value.toLowerCase())} /></label><label className="grid gap-1.5 text-sm sm:col-span-2">说明<Textarea value={description} onChange={(event) => setDescription(event.target.value)} /></label></div><div className="grid gap-3">{steps.map((step, index) => <div key={step.key} className="rounded-2xl border p-3"><div className="flex items-center gap-2"><span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-xs text-primary">{index + 1}</span><Input value={step.name} onChange={(event) => setSteps((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /><select className="h-9 rounded-lg border bg-background px-2 text-sm" value={step.kind} onChange={(event) => setSteps((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, kind: event.target.value as ProjectSopStep["kind"], requiresHuman: event.target.value === "approval" || item.requiresHuman } : item))}>{Object.entries(kindLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>{steps.length > 1 ? <Button size="icon-sm" variant="ghost" onClick={() => setSteps((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X /></Button> : null}</div><Textarea className="mt-2" value={step.description} onChange={(event) => setSteps((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} /><label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={step.requiresHuman} onChange={(event) => setSteps((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, requiresHuman: event.target.checked } : item))} />必须人工确认</label></div>)}</div><Button variant="outline" disabled={steps.length >= 30} onClick={() => setSteps((current) => [...current, { key: `step_${current.length + 1}`, name: "新步骤", description: "", kind: "human", requiresHuman: true }])}><Plus />添加步骤</Button>{feedback ? <p className="text-sm text-destructive">{feedback}</p> : null}<div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><Button variant="outline" onClick={() => setCreateOpen(false)}>取消</Button><Button disabled={busy} onClick={() => void saveDefinition()}>{busy ? "正在发布…" : "发布 SOP"}</Button></div></DialogContent></Dialog>
    <Dialog open={Boolean(startDefinition)} onOpenChange={(open) => !open && setStartDefinition(undefined)}><DialogContent className="h-[100dvh] w-screen max-w-none rounded-none sm:h-auto sm:max-w-md sm:rounded-2xl"><DialogHeader><DialogTitle>启动 {startDefinition?.name}</DialogTitle><DialogDescription>流程会绑定真实员工和可选任务，启动后保留完整轨迹。</DialogDescription></DialogHeader><label className="grid gap-1.5 text-sm">负责人<select className="h-10 rounded-xl border bg-background px-3" value={assignee} onChange={(event) => setAssignee(event.target.value)}><option value="">请选择</option>{members.map((member) => <option key={member.employeePublicId} value={member.employeePublicId}>{member.displayName} · {member.title}</option>)}</select></label><label className="grid gap-1.5 text-sm">关联任务（可选）<select className="h-10 rounded-xl border bg-background px-3" value={taskId} onChange={(event) => setTaskId(event.target.value)}><option value="">项目级流程</option>{detail.tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}</select></label>{feedback ? <p className="text-sm text-destructive">{feedback}</p> : null}<div className="mt-auto flex flex-col-reverse gap-2 sm:mt-0 sm:flex-row sm:justify-end"><Button variant="outline" onClick={() => setStartDefinition(undefined)}>取消</Button><Button disabled={busy || !assignee} onClick={() => void startRun()}>{busy ? "正在启动…" : "确认启动"}</Button></div></DialogContent></Dialog>
  </div>;
}
