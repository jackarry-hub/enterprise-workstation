"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ExternalLink, FileCheck2, Link2, LoaderCircle, Mail, Phone, Plus, RefreshCw, ShieldCheck, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { Customer, FollowUpKind, OpportunityStage } from "@/features/customers/customer-types";
import type { MemberSummary } from "@/features/projects/types";

type ActionResult = { ok: true } | { ok: false; message: string };
type OpportunityInput = { name: string; ownerEmployeePublicId: string; amount: string; expectedCloseOn: string | null };
type FollowUpInput = { opportunityId: string | null; kind: FollowUpKind; content: string; nextFollowUpAt: string | null };
type ConversionInput = { projectName: string; description: string; startsOn: string; dueOn: string };
type ContactInput = { name: string; title: string; phone: string; email: string; isPrimary: boolean };

const opportunityLabels: Record<OpportunityStage, string> = {
  lead: "线索", qualified: "已确认", proposal: "方案中", won: "已赢单", lost: "已输单",
};
const opportunityVariants = { lead: "info", qualified: "secondary", proposal: "warning", won: "success", lost: "destructive" } as const;
const nextStage: Partial<Record<OpportunityStage, OpportunityStage>> = { lead: "qualified", qualified: "proposal", proposal: "won" };
const contractLabels = { draft: "草拟", active: "履约中", completed: "已完成", terminated: "已终止" } as const;
const contractVariants = { draft: "secondary", active: "success", completed: "info", terminated: "destructive" } as const;
const sourceLabels = { feishu: "飞书", import: "批量导入", external_crm: "外部 CRM", n8n: "n8n", other: "其他系统" } as const;
const targetLabels = { customer: "客户", contact: "联系人", opportunity: "商机", project: "项目" } as const;

function formatTime(value: string | null) {
  return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "未安排";
}

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(new Date(`${value}T00:00:00Z`)) : "未登记";
}

function dateInput(offsetDays = 0) {
  const value = new Date();
  value.setDate(value.getDate() + offsetDays);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function formatMoney(value: string) {
  const [integer, fraction = "00"] = value.split(".");
  return `${BigInt(integer).toLocaleString("zh-CN")}.${fraction.padEnd(2, "0")}`;
}

export function CustomerDetailDialog({
  customer, owners, open, onOpenChange, canManage, canConvertToProject,
  loading, loadError, onRetry, onAddContact, onAddFollowUp, onCreateOpportunity, onTransition, onConvert,
}: {
  customer: Customer | null;
  owners: readonly MemberSummary[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canManage: boolean;
  canConvertToProject: boolean;
  loading: boolean;
  loadError: string;
  onRetry: () => void;
  onAddContact: (customerId: string, input: ContactInput) => Promise<ActionResult>;
  onAddFollowUp: (customerId: string, input: FollowUpInput) => Promise<ActionResult>;
  onCreateOpportunity: (customerId: string, input: OpportunityInput) => Promise<ActionResult>;
  onTransition: (opportunityId: string, stage: OpportunityStage, version: number, lossReason: string | null) => Promise<ActionResult>;
  onConvert: (opportunityId: string, version: number, input: ConversionInput) => Promise<ActionResult>;
}) {
  const [note, setNote] = useState("");
  const [kind, setKind] = useState<FollowUpKind>("note");
  const [followUpOpportunityId, setFollowUpOpportunityId] = useState("none");
  const [nextFollowUpAt, setNextFollowUpAt] = useState("");
  const [showOpportunityForm, setShowOpportunityForm] = useState(false);
  const [opportunityName, setOpportunityName] = useState("");
  const [opportunityAmount, setOpportunityAmount] = useState("0.00");
  const [opportunityOwner, setOpportunityOwner] = useState("");
  const [expectedCloseOn, setExpectedCloseOn] = useState("");
  const [conversionId, setConversionId] = useState<string | null>(null);
  const [lossOpportunityId, setLossOpportunityId] = useState<string | null>(null);
  const [lossReason, setLossReason] = useState("");
  const [showContactForm, setShowContactForm] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactTitle, setContactTitle] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectStartsOn, setProjectStartsOn] = useState(dateInput());
  const [projectDueOn, setProjectDueOn] = useState(dateInput(30));
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setNote(""); setKind("note"); setFollowUpOpportunityId("none"); setNextFollowUpAt("");
    setShowOpportunityForm(false); setOpportunityName(""); setOpportunityAmount("0.00");
    setOpportunityOwner(customer?.owner.employeePublicId ?? owners[0]?.employeePublicId ?? ""); setExpectedCloseOn("");
    setConversionId(null); setLossOpportunityId(null); setLossReason(""); setShowContactForm(false);
    setContactName(""); setContactTitle(""); setContactPhone(""); setContactEmail(""); setProjectName(""); setProjectDescription("");
    setProjectStartsOn(dateInput()); setProjectDueOn(dateInput(30)); setBusy(false); setFeedback(""); setError("");
  }, [open, customer?.id, customer?.owner.employeePublicId, owners]);

  const wonWithoutProject = useMemo(() => customer?.opportunities.filter(({ stage, projectId }) => stage === "won" && !projectId) ?? [], [customer]);
  if (!customer) return null;
  const customerId = customer.id;
  const needsPrimaryContact = !customer.contact;

  async function run(action: () => Promise<ActionResult>, success: string) {
    setBusy(true); setError(""); setFeedback("");
    const result = await action();
    setBusy(false);
    if (!result.ok) { setError(result.message); return false; }
    setFeedback(success);
    return true;
  }

  async function saveFollowUp() {
    if (!note.trim()) { setError("请先填写本次沟通结果与下一步动作。"); return; }
    const parsedNext = nextFollowUpAt ? new Date(nextFollowUpAt).toISOString() : null;
    if (await run(() => onAddFollowUp(customerId, {
      opportunityId: followUpOpportunityId === "none" ? null : followUpOpportunityId,
      kind, content: note.trim(), nextFollowUpAt: parsedNext,
    }), "跟进记录已写入")) {
      setNote(""); setNextFollowUpAt("");
    }
  }

  async function createOpportunity() {
    if (!opportunityName.trim() || !opportunityOwner || !/^\d{1,16}(?:\.\d{1,2})?$/.test(opportunityAmount)) {
      setError("请填写商机名称、负责人和有效金额。"); return;
    }
    if (await run(() => onCreateOpportunity(customerId, {
      name: opportunityName.trim(), ownerEmployeePublicId: opportunityOwner,
      amount: opportunityAmount, expectedCloseOn: expectedCloseOn || null,
    }), "商机已创建")) {
      setOpportunityName(""); setOpportunityAmount("0.00"); setExpectedCloseOn(""); setShowOpportunityForm(false);
    }
  }

  async function createContact() {
    if (!contactName.trim() || (!contactPhone.trim() && !contactEmail.trim())) {
      setError("请填写联系人姓名，以及电话或邮箱。"); return;
    }
    if (await run(() => onAddContact(customerId, {
      name: contactName.trim(), title: contactTitle.trim(), phone: contactPhone.trim(),
      email: contactEmail.trim(), isPrimary: needsPrimaryContact,
    }), "联系人已写入")) {
      setContactName(""); setContactTitle(""); setContactPhone(""); setContactEmail(""); setShowContactForm(false);
    }
  }

  async function convertOpportunity(opportunityId: string, version: number) {
    if (!projectName.trim() || !projectStartsOn || !projectDueOn || projectDueOn < projectStartsOn) {
      setError("请填写项目名称和有效的项目周期。"); return;
    }
    if (await run(() => onConvert(opportunityId, version, {
      projectName: projectName.trim(), description: projectDescription.trim(),
      startsOn: projectStartsOn, dueOn: projectDueOn,
    }), "交付项目已创建并关联客户")) setConversionId(null);
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent aria-label={`客户详情：${customer.name}`} className="max-h-[100dvh] overflow-y-auto pb-24 max-sm:top-0 max-sm:left-0 max-sm:h-[100dvh] max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-h-[90vh] sm:max-w-3xl sm:pb-6">
        <DialogHeader><Badge variant="info" className="mb-1 w-fit">客户档案</Badge><DialogTitle className="pr-10 text-xl">{customer.name}</DialogTitle><DialogDescription>{customer.industry} · {customer.region || "地区未设置"} · 负责人 {customer.owner.displayName}</DialogDescription></DialogHeader>
        {feedback ? <p role="status" className="rounded-xl bg-success-soft px-3 py-2 text-sm text-success">{feedback}</p> : null}
        {error ? <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-destructive">{error}</p> : null}

        {loading ? <div role="status" className="flex items-center justify-center gap-2 rounded-2xl border border-border p-8 text-muted-foreground"><LoaderCircle className="size-5 animate-spin" />正在加载完整客户详情…</div> : null}
        {loadError ? <div role="alert" className="rounded-2xl border border-warning/30 bg-warning-soft p-4"><p className="font-medium text-warning">{loadError}</p><Button type="button" size="sm" variant="outline" className="mt-3" onClick={onRetry}><RefreshCw />重试详情</Button></div> : null}
        {customer.detailState === "complete" && !loading && !loadError ? <>

        <section aria-label="客户联系方式" className="rounded-2xl border border-border/70 bg-white/65 p-4">
          <div className="flex items-center justify-between gap-2"><h3 className="font-semibold">联系人</h3>{canManage ? <Button type="button" size="sm" variant="outline" onClick={() => setShowContactForm((value) => !value)}><Plus />添加联系人</Button> : null}</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2"><div className="rounded-2xl bg-muted/55 p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><UserRound className="size-3.5" />主联系人</p><p className="mt-1.5 font-medium">{customer.contact ? `${customer.contact.name}${customer.contact.title ? ` · ${customer.contact.title}` : ""}` : "未配置或当前权限不可见"}</p></div>
          <div className="rounded-2xl bg-muted/55 p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Phone className="size-3.5" />电话</p><p className="mt-1.5 font-medium">{customer.contact?.phone ?? "当前权限不可见或未填写"}</p></div>
          <div className="rounded-2xl bg-muted/55 p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Mail className="size-3.5" />邮箱</p><p className="mt-1.5 break-all font-medium">{customer.contact?.email ?? "当前权限不可见或未填写"}</p></div>
          <div className="rounded-2xl bg-muted/55 p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="size-3.5" />最早待跟进</p><p className="mt-1.5 font-medium">{formatTime(customer.nextFollowUpAt)}</p></div></div>
          {showContactForm ? <div className="mt-3 grid gap-2 rounded-xl bg-muted/45 p-3 sm:grid-cols-2"><Input aria-label="新增联系人姓名" value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="姓名" maxLength={120} /><Input aria-label="新增联系人职务" value={contactTitle} onChange={(event) => setContactTitle(event.target.value)} placeholder="职务" maxLength={120} /><Input aria-label="新增联系人电话" type="tel" value={contactPhone} onChange={(event) => setContactPhone(event.target.value)} placeholder="电话" maxLength={80} /><Input aria-label="新增联系人邮箱" type="email" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder="邮箱" maxLength={320} /><div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="ghost" onClick={() => setShowContactForm(false)}>取消</Button><Button type="button" disabled={busy} onClick={createContact}>保存联系人</Button></div></div> : null}
        </section>

        <section className="rounded-2xl border border-border/70 bg-white/65 p-4">
          <div className="flex items-center justify-between gap-2"><div><h3 className="font-semibold">销售商机</h3><p className="mt-1 text-xs text-muted-foreground">{customer.opportunities.length} 条真实商机</p></div>{canManage ? <Button type="button" size="sm" variant="outline" onClick={() => setShowOpportunityForm((value) => !value)}><Plus />新建商机</Button> : null}</div>
          {showOpportunityForm ? <div className="mt-3 grid gap-2 rounded-xl bg-muted/45 p-3 sm:grid-cols-2"><Input aria-label="商机名称" placeholder="商机名称" maxLength={160} value={opportunityName} onChange={(event) => setOpportunityName(event.target.value)} /><Input aria-label="商机金额" inputMode="decimal" placeholder="金额" value={opportunityAmount} onChange={(event) => setOpportunityAmount(event.target.value)} /><Select value={opportunityOwner} onValueChange={setOpportunityOwner}><SelectTrigger aria-label="商机负责人"><SelectValue placeholder="负责人" /></SelectTrigger><SelectContent>{owners.map((owner) => owner.employeePublicId ? <SelectItem key={owner.employeePublicId} value={owner.employeePublicId}>{owner.displayName}</SelectItem> : null)}</SelectContent></Select><Input aria-label="预计成交日期" type="date" value={expectedCloseOn} onChange={(event) => setExpectedCloseOn(event.target.value)} /><div className="flex gap-2 sm:col-span-2 sm:justify-end"><Button type="button" variant="ghost" onClick={() => setShowOpportunityForm(false)}>取消</Button><Button type="button" disabled={busy} onClick={createOpportunity}>保存商机</Button></div></div> : null}
          <div className="mt-3 space-y-2">{customer.opportunities.length ? customer.opportunities.map((opportunity) => {
            const target = nextStage[opportunity.stage];
            return <article key={opportunity.id} className="rounded-xl border border-border/70 p-3"><div className="flex flex-wrap items-start gap-2"><div className="min-w-0 flex-1"><p className="font-medium">{opportunity.name}</p><p className="mt-1 text-xs text-muted-foreground">{opportunity.currency} {formatMoney(opportunity.amount)} · {opportunity.owner.displayName}</p></div><Badge variant={opportunityVariants[opportunity.stage]}>{opportunityLabels[opportunity.stage]}</Badge></div><div className="mt-3 flex flex-wrap gap-2">{canManage && target ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => run(() => onTransition(opportunity.id, target, opportunity.version, null), `商机已推进至${opportunityLabels[target]}`)}>推进至{opportunityLabels[target]}</Button> : null}{canManage && opportunity.stage === "proposal" ? <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => { setLossOpportunityId(opportunity.id); setLossReason(""); }}>标记输单</Button> : null}{opportunity.projectId ? <Button asChild size="sm" variant="outline"><Link href={`/projects/${opportunity.projectId}`}>查看交付项目</Link></Button> : null}{canConvertToProject && opportunity.stage === "won" && !opportunity.projectId ? <Button type="button" size="sm" onClick={() => { setConversionId(opportunity.id); setProjectName(`${customer.name}-${opportunity.name}`); }}>转交付项目</Button> : null}</div></article>;
          }) : <p className="py-5 text-center text-sm text-muted-foreground">暂无商机，可从真实客户需求创建。</p>}</div>
          {lossOpportunityId ? <div className="mt-3 rounded-xl border border-destructive/25 bg-danger-soft/50 p-3"><label className="space-y-1.5 text-sm"><span>输单原因 *</span><Textarea aria-label="输单原因" maxLength={1000} value={lossReason} onChange={(event) => setLossReason(event.target.value)} placeholder="记录明确的输单原因，便于复盘" /></label><div className="mt-2 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setLossOpportunityId(null)}>取消</Button><Button type="button" variant="destructive" disabled={busy || !lossReason.trim()} onClick={() => { const opportunity = customer.opportunities.find(({ id }) => id === lossOpportunityId); if (opportunity) void run(() => onTransition(opportunity.id, "lost", opportunity.version, lossReason.trim()), "商机已标记为输单").then((ok) => { if (ok) setLossOpportunityId(null); }); }}>确认输单</Button></div></div> : null}
        </section>

        {conversionId ? <section className="rounded-2xl border border-primary/30 bg-brand-soft/40 p-4"><h3 className="font-semibold">创建交付项目</h3><p className="mt-1 text-xs text-muted-foreground">项目创建与客户关联在同一数据库事务中完成。</p><div className="mt-3 grid gap-2 sm:grid-cols-2"><Input aria-label="交付项目名称" value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="项目名称" /><Textarea aria-label="交付项目说明" value={projectDescription} onChange={(event) => setProjectDescription(event.target.value)} placeholder="交付范围与目标" className="sm:col-span-2" /><label className="space-y-1 text-xs text-muted-foreground">开始日期<Input aria-label="项目开始日期" type="date" value={projectStartsOn} onChange={(event) => setProjectStartsOn(event.target.value)} /></label><label className="space-y-1 text-xs text-muted-foreground">计划完成<Input aria-label="项目计划完成日期" type="date" value={projectDueOn} onChange={(event) => setProjectDueOn(event.target.value)} /></label><div className="flex gap-2 sm:col-span-2 sm:justify-end"><Button type="button" variant="ghost" onClick={() => setConversionId(null)}>取消</Button><Button type="button" disabled={busy} onClick={() => { const opportunity = wonWithoutProject.find(({ id }) => id === conversionId); if (opportunity) void convertOpportunity(opportunity.id, opportunity.version); }}>确认创建项目</Button></div></div></section> : null}

        <section className="rounded-2xl border border-border/70 bg-white/65 p-4"><h3 className="font-semibold">关联项目</h3><div className="mt-3 space-y-2">{customer.relatedProjects.length ? customer.relatedProjects.map((project) => project.projectId && project.projectName && project.projectProgress !== null ? <Button key={project.id} asChild variant="outline" className="w-full justify-between"><Link href={`/projects/${project.projectId}`}><span className="truncate">{project.projectName}</span><span>{project.projectProgress}%</span></Link></Button> : <div key={project.id} className="rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">关联项目已归档或当前账号无项目查看权限</div>) : <p className="text-sm text-muted-foreground">暂无关联项目</p>}</div></section>

        <section aria-label="客户合同" className="rounded-2xl border border-border/70 bg-white/65 p-4">
          <div className="flex items-center gap-2"><FileCheck2 className="size-4 text-primary" /><div><h3 className="font-semibold">合同台账</h3><p className="mt-0.5 text-xs text-muted-foreground">来自企业数据库的真实合同记录</p></div></div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">{customer.contracts.length ? customer.contracts.map((contract) => <article key={contract.id} className="rounded-xl border border-border/70 bg-muted/30 p-3"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-medium">{contract.title}</p><p className="mt-1 font-mono text-xs text-muted-foreground">{contract.contractNumber}</p></div><Badge variant={contractVariants[contract.status]}>{contractLabels[contract.status]}</Badge></div><p className="mt-3 text-lg font-semibold">{contract.currency} {formatMoney(contract.amount)}</p><p className="mt-1 text-xs text-muted-foreground">履约：{formatDate(contract.startsOn)} — {formatDate(contract.endsOn)}</p><p className="mt-1 text-xs text-muted-foreground">签署：{formatDate(contract.signedOn)}</p>{contract.projectId ? <Button asChild size="sm" variant="outline" className="mt-3 w-full"><Link href={`/projects/${contract.projectId}`}>查看关联合同项目</Link></Button> : null}</article>) : <p className="text-sm text-muted-foreground sm:col-span-2">暂无已登记合同</p>}</div>
        </section>

        {canManage ? <section aria-label="数据来源" className="rounded-2xl border border-border/70 bg-white/65 p-4">
          <div className="flex items-center gap-2"><ShieldCheck className="size-4 text-success" /><div><h3 className="font-semibold">来源与追溯</h3><p className="mt-0.5 text-xs text-muted-foreground">来源记录不可覆盖，便于审计与核验</p></div></div>
          <div className="mt-3 space-y-2">{customer.sourceLinks.length ? customer.sourceLinks.map((sourceLink) => <article key={sourceLink.id} className="flex items-center gap-3 rounded-xl border border-border/70 p-3"><div className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-primary"><Link2 className="size-4" /></div><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{sourceLabels[sourceLink.sourceSystem]} · {targetLabels[sourceLink.targetKind]}</p><p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{sourceLink.externalRecordId}</p></div>{sourceLink.sourceUrl ? <Button asChild size="icon" variant="ghost" aria-label="打开原始来源"><a href={sourceLink.sourceUrl} target="_blank" rel="noreferrer"><ExternalLink /></a></Button> : null}</article>) : <p className="text-sm text-muted-foreground">暂无外部来源记录；QuantXY 数据库为当前权威来源。</p>}</div>
        </section> : null}

        <section className="rounded-2xl border border-border/70 bg-white/65 p-4"><h3 className="font-semibold">跟进记录</h3>{canManage ? <div className="mt-3 grid gap-2 sm:grid-cols-2"><Select value={kind} onValueChange={(value) => setKind(value as FollowUpKind)}><SelectTrigger aria-label="跟进方式"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="call">电话</SelectItem><SelectItem value="meeting">会议</SelectItem><SelectItem value="email">邮件</SelectItem><SelectItem value="message">消息</SelectItem><SelectItem value="visit">拜访</SelectItem><SelectItem value="note">备注</SelectItem></SelectContent></Select><Select value={followUpOpportunityId} onValueChange={setFollowUpOpportunityId}><SelectTrigger aria-label="关联商机"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">不关联商机</SelectItem>{customer.opportunities.map((opportunity) => <SelectItem key={opportunity.id} value={opportunity.id}>{opportunity.name}</SelectItem>)}</SelectContent></Select><Textarea aria-label="新增客户跟进记录" value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录沟通结果和下一步动作" className="min-h-24 sm:col-span-2" /><label className="space-y-1 text-xs text-muted-foreground">下次跟进<Input aria-label="下次跟进时间" type="datetime-local" value={nextFollowUpAt} onChange={(event) => setNextFollowUpAt(event.target.value)} /></label><Button type="button" className="self-end" disabled={busy} onClick={saveFollowUp}>{busy ? "保存中…" : "保存跟进"}</Button></div> : null}<div className="mt-4 divide-y divide-border/70">{customer.activities.length ? customer.activities.map((activity) => <div key={activity.id} className="py-3"><div className="flex items-center justify-between gap-2"><p className="text-sm font-medium">{activity.actor.displayName}</p><span className="text-xs text-muted-foreground">{formatTime(activity.occurredAt)}</span></div><p className="mt-1 whitespace-pre-wrap text-sm">{activity.content}</p>{activity.nextFollowUpAt ? <p className="mt-1 text-xs text-warning">下次跟进：{formatTime(activity.nextFollowUpAt)}</p> : null}</div>) : <p className="py-5 text-center text-sm text-muted-foreground">暂无跟进记录</p>}</div></section>

        {customer.truncatedResources?.length ? <p role="status" className="rounded-xl bg-warning-soft px-3 py-2 text-sm text-warning">部分历史记录超过单次详情上限，仅展示最近 100 条；请使用后续审计/导出入口查看完整记录。</p> : null}
        </> : null}
        {customer.detailState === "complete" && !loading && !loadError ? <div className="fixed inset-x-0 bottom-0 border-t border-border bg-background/95 p-3 backdrop-blur sm:hidden"><Button type="button" className="w-full" disabled={!canManage} onClick={() => document.querySelector<HTMLTextAreaElement>('[aria-label="新增客户跟进记录"]')?.focus()}>{canManage ? "记录本次跟进" : "当前为只读权限"}</Button></div> : null}
      </DialogContent>
    </Dialog>
  );
}
