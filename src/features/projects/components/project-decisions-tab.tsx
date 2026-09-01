"use client";

import { useMemo, useState } from "react";
import { Archive, CheckCircle2, FileCheck2, GitCommitHorizontal, Plus } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ProjectDecision, ProjectDecisionCitation, ProjectDecisionType, ProjectDetailData } from "@/features/projects/types";

const typeLabel = { decision: "决策", risk: "风险判断", lesson: "经验", action: "后续动作" } as const;

export function ProjectDecisionsTab({ detail, canManage, onRecord, onTransition }: {
  detail: ProjectDetailData;
  canManage: boolean;
  onRecord: (input: { type: ProjectDecisionType; title: string; summary: string; citations: ProjectDecisionCitation[]; ownerEmployeeId: string }, idempotencyKey: string) => Promise<void>;
  onTransition: (decision: ProjectDecision, status: "accepted" | "archived", idempotencyKey: string) => Promise<void>;
}) {
  const model = detail.operatingModel;
  const [open, setOpen] = useState(false); const [type, setType] = useState<ProjectDecisionType>("decision");
  const [title, setTitle] = useState(""); const [summary, setSummary] = useState("");
  const [owner, setOwner] = useState(detail.owner.employeePublicId ?? ""); const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false); const [feedback, setFeedback] = useState("");
  const evidenceOptions = useMemo(() => [
    ...detail.tasks.map((item) => ({ value: `task|${item.id}`, citation: { type: "task" as const, id: item.id, label: item.title } })),
    ...detail.dailyReports.map((item) => ({ value: `report|${item.id}`, citation: { type: "report" as const, id: item.id, label: `${item.reportDate} 项目日报` } })),
    ...detail.files.map((item) => ({ value: `file|${item.id}`, citation: { type: "file" as const, id: item.id, label: item.originalName } })),
  ], [detail.dailyReports, detail.files, detail.tasks]);
  const members = detail.members.flatMap(({ member }) => member.employeePublicId ? [member] : []);

  async function submit() {
    const citation = evidenceOptions.find(({ value }) => value === evidence)?.citation;
    if (!title.trim() || !summary.trim() || !owner || !citation) { setFeedback("请填写决策内容、负责人并关联一项真实证据"); return; }
    try { setBusy(true); setFeedback(""); await onRecord({ type, title: title.trim(), summary: summary.trim(), citations: [citation], ownerEmployeeId: owner }, crypto.randomUUID()); setOpen(false); setTitle(""); setSummary(""); setEvidence(""); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "决策保存失败"); }
    finally { setBusy(false); }
  }

  async function transition(decision: ProjectDecision, status: "accepted" | "archived") {
    try { setBusy(true); setFeedback(""); await onTransition(decision, status, crypto.randomUUID()); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "决策状态更新失败"); }
    finally { setBusy(false); }
  }

  if (!model) return <GlassCard className="p-6 text-sm text-destructive">项目决策模型未加载，请刷新页面。</GlassCard>;
  return <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(20rem,.8fr)]">
    <GlassCard className="p-5 sm:p-6"><div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><FileCheck2 className="size-5 text-primary" />项目决策板</h2><p className="mt-1 text-sm text-muted-foreground">每项决策绑定负责人、业务证据和确认状态。</p></div><Button onClick={() => setOpen(true)}><Plus />记录决策</Button></div>
      <div className="mt-5 grid gap-3">{model.decisions.filter(({ status }) => status !== "archived").length ? model.decisions.filter(({ status }) => status !== "archived").map((decision) => <article key={decision.id} className="rounded-2xl border border-border/70 bg-white/55 p-4"><div className="flex items-start justify-between gap-3"><div><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{typeLabel[decision.type]}</Badge><h3 className="font-medium">{decision.title}</h3></div><p className="mt-2 text-sm text-muted-foreground">{decision.summary}</p></div><Badge variant={decision.status === "accepted" ? "success" : "warning"}>{decision.status === "accepted" ? "已确认" : "待确认"}</Badge></div><div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><span>负责人 {decision.ownerName}</span>{decision.citations.map((citation) => <span key={`${citation.type}-${citation.id}`} className="rounded-full bg-primary/8 px-2 py-1 text-primary">证据：{citation.label}</span>)}</div>{canManage ? <div className="mt-3 flex gap-2">{decision.status === "proposed" ? <Button size="sm" disabled={busy} onClick={() => void transition(decision, "accepted")}><CheckCircle2 />确认</Button> : null}<Button size="sm" variant="outline" disabled={busy} onClick={() => void transition(decision, "archived")}><Archive />归档</Button></div> : null}</article>) : <p className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">暂无待处理决策。</p>}</div>{feedback ? <p role="status" className="mt-4 rounded-xl bg-muted px-4 py-3 text-sm">{feedback}</p> : null}</GlassCard>
    <GlassCard className="self-start p-5 sm:p-6"><div className="flex items-center justify-between"><h2 className="flex items-center gap-2 font-semibold"><GitCommitHorizontal className="size-4 text-primary" />统一执行轨迹</h2><Badge variant="outline">{model.trace.length}</Badge></div><div className="mt-5 grid gap-4">{model.trace.length ? model.trace.slice(0, 20).map((item) => <article key={`${item.source}-${item.id}`} className="relative border-l-2 border-primary/20 pl-4 before:absolute before:-left-1.5 before:top-0 before:size-2.5 before:rounded-full before:bg-primary"><div className="flex flex-wrap items-center gap-2"><Badge variant="outline">{item.source === "sop" ? "SOP" : item.source === "acceptance" ? "验收" : "项目"}</Badge><span className="text-xs text-muted-foreground">{new Date(item.occurredAt).toLocaleString("zh-CN")}</span></div><p className="mt-2 text-sm font-medium">{item.title}</p><p className="mt-1 text-xs text-muted-foreground">{item.actorName}</p></article>) : <p className="text-sm text-muted-foreground">尚无执行轨迹。</p>}</div></GlassCard>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="h-[100dvh] w-screen max-w-none rounded-none sm:h-auto sm:max-w-lg sm:rounded-2xl"><DialogHeader><DialogTitle>记录项目决策</DialogTitle><DialogDescription>决策必须关联现有任务、日报或文件作为证据。</DialogDescription></DialogHeader><div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-sm">类型<select className="h-10 rounded-xl border bg-background px-3" value={type} onChange={(event) => setType(event.target.value as ProjectDecisionType)}>{Object.entries(typeLabel).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className="grid gap-1.5 text-sm">负责人<select className="h-10 rounded-xl border bg-background px-3" value={owner} onChange={(event) => setOwner(event.target.value)}>{members.map((member) => <option key={member.employeePublicId} value={member.employeePublicId}>{member.displayName}</option>)}</select></label><label className="grid gap-1.5 text-sm sm:col-span-2">标题<Input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="grid gap-1.5 text-sm sm:col-span-2">内容<Textarea value={summary} onChange={(event) => setSummary(event.target.value)} /></label><label className="grid gap-1.5 text-sm sm:col-span-2">关联证据<select className="h-10 rounded-xl border bg-background px-3" value={evidence} onChange={(event) => setEvidence(event.target.value)}><option value="">请选择</option>{evidenceOptions.map((item) => <option key={item.value} value={item.value}>{item.citation.label}</option>)}</select></label></div>{feedback ? <p className="text-sm text-destructive">{feedback}</p> : null}<div className="mt-auto flex flex-col-reverse gap-2 sm:mt-0 sm:flex-row sm:justify-end"><Button variant="outline" onClick={() => setOpen(false)}>取消</Button><Button disabled={busy} onClick={() => void submit()}>{busy ? "正在保存…" : "保存决策"}</Button></div></DialogContent></Dialog>
  </div>;
}
