"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, ArrowLeft, Bot, CircleStop, History, PackagePlus, Play, Plus, RefreshCw, ShieldAlert, ShieldCheck, Workflow } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GlassCard } from "@/components/ui/glass-card";
import { Textarea } from "@/components/ui/textarea";
import { AgentEditor, type AgentSummary } from "@/features/agents/agent-editor";
import { ExternalWorkflowWorkspace } from "@/features/agents/external-workflow-workspace";
import { OrchestrationEditor } from "@/features/agents/orchestration-editor";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { QUICK_CREATE_EVENT } from "@/features/quick-create/contextual-create-actions";
import { cn } from "@/lib/utils";

type AgentRun = {
  id: string; requestId: string; versionId?: string; status: "queued" | "running" | "succeeded" | "failed";
  inputSummary?: string; outputSummary?: string; errorCode?: string; inputTokens?: number; outputTokens?: number;
  latencyMs?: number; startedAt?: string; completedAt?: string;
};
type Orchestration = { id: string; code: string; name: string; description: string; status: string; versionId: string | null; revision: number | null; nodeCount: number; edgeCount: number };
type OrchestrationRun = { id: string; status: string; outputSummary?: string; errorCode?: string; startedAt?: string; completedAt?: string; nodes?: { key: string; status: string }[] };
type RuntimeControl = { enabled: boolean; reason: string; version: number; updatedAt: string | null };

async function payload(response: Response) { return await response.json() as Record<string, unknown>; }
function formatTime(value?: string | null) { if (!value) return "—"; const time = new Date(value); return Number.isNaN(time.valueOf()) ? "—" : time.toLocaleString("zh-CN", { hour12: false }); }

export function AgentCenterWorkspace() {
  const session = useWorkspaceSession();
  const canManage = session.permissionCodes.includes("agent.manage");
  const canOrchestrate = session.permissionCodes.includes("agent.orchestrate");
  const canRequest = session.permissionCodes.includes("approval.submit");
  const canKill = session.permissionCodes.includes("agent.runtime.kill");
  const [agents, setAgents] = useState<AgentSummary[]>([]); const [orchestrations, setOrchestrations] = useState<Orchestration[]>([]); const [runs, setRuns] = useState<AgentRun[]>([]);
  const [selected, setSelected] = useState<AgentSummary | null>(null); const [section, setSection] = useState<"agents" | "orchestrations" | "workflows">("agents");
  const [editorOpen, setEditorOpen] = useState(false); const [editing, setEditing] = useState<AgentSummary | null>(null); const [orchestrationOpen, setOrchestrationOpen] = useState(false);
  const [runInput, setRunInput] = useState(""); const [pending, setPending] = useState(false); const [feedback, setFeedback] = useState("正在同步 Agent 目录…");
  const [runtime, setRuntime] = useState<RuntimeControl | null>(null); const [killOpen, setKillOpen] = useState(false); const [killReason, setKillReason] = useState("");
  const [orchestrationTarget, setOrchestrationTarget] = useState<Orchestration | null>(null); const [orchestrationInput, setOrchestrationInput] = useState(""); const [orchestrationRuns, setOrchestrationRuns] = useState<OrchestrationRun[]>([]);

  const loadDirectory = useCallback(async (selectId?: string) => {
    try {
      const requests: Promise<Response>[] = [fetch("/api/workstation/agents", { cache: "no-store" })];
      if (canOrchestrate) requests.push(fetch("/api/workstation/agent-orchestrations", { cache: "no-store" }));
      if (canKill) requests.push(fetch("/api/workstation/agents/runtime/kill-switch", { cache: "no-store" }));
      const responses = await Promise.all(requests); const agentPayload = await payload(responses[0]);
      if (!responses[0].ok) throw new Error("directory_failed");
      const nextAgents = Array.isArray(agentPayload.items) ? agentPayload.items as AgentSummary[] : [];
      let offset = 1;
      if (canOrchestrate) { const orchestrationPayload = await payload(responses[offset]); if (responses[offset].ok) setOrchestrations(Array.isArray(orchestrationPayload.items) ? orchestrationPayload.items as Orchestration[] : []); offset += 1; }
      if (canKill) { const runtimePayload = await payload(responses[offset]); if (responses[offset].ok) setRuntime(runtimePayload as RuntimeControl); }
      setAgents(nextAgents); setFeedback(nextAgents.length ? "" : "尚未创建 Agent");
      setSelected((current) => {
        const target = selectId ?? current?.id; if (target) return nextAgents.find(({ id }) => id === target) ?? null;
        const desktop = typeof window === "undefined" || !window.matchMedia || window.matchMedia("(min-width: 768px)").matches;
        return desktop ? nextAgents[0] ?? null : null;
      });
    } catch { setFeedback("Agent 目录同步失败，请稍后重试。"); }
  }, [canKill, canOrchestrate]);

  const loadRuns = useCallback(async (agentId: string) => {
    try { const response = await fetch(`/api/workstation/agents/${encodeURIComponent(agentId)}/runs`, { cache: "no-store" }); const data = await payload(response); if (!response.ok) throw new Error("runs_failed"); setRuns(Array.isArray(data.items) ? data.items as AgentRun[] : []); }
    catch { setRuns([]); setFeedback("运行记录同步失败，请稍后重试。"); }
  }, []);

  useEffect(() => { void loadDirectory(); }, [loadDirectory]);
  useEffect(() => { if (selected) void loadRuns(selected.id); else setRuns([]); }, [loadRuns, selected]);
  useEffect(() => {
    function handleQuickCreate(event: Event) {
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      if (id === "agent.create" && canManage) { setEditing(null); setEditorOpen(true); }
      if (id === "agent.orchestration.create" && canOrchestrate) { setSection("orchestrations"); setOrchestrationOpen(true); }
      if (id === "agent.permission.request" && canRequest) {
        if (selected) void requestPermission();
        else setFeedback("请先选择需要申请权限的 Agent。");
      }
    }
    window.addEventListener(QUICK_CREATE_EVENT, handleQuickCreate);
    return () => window.removeEventListener(QUICK_CREATE_EVENT, handleQuickCreate);
  });

  const successfulRuns = useMemo(() => runs.filter(({ status }) => status === "succeeded").length, [runs]);
  const highRiskTools = selected?.tools.filter(({ highRisk }) => highRisk).length ?? 0;

  async function runAgent() {
    if (!selected || !runInput.trim() || pending || runtime?.enabled) return;
    setPending(true); setFeedback("请求已提交，运行结果将写入不可变记录…");
    try {
      const response = await fetch(`/api/workstation/agents/${encodeURIComponent(selected.id)}/runs`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ input: runInput.trim() }) });
      const data = await payload(response); const run = data.run as AgentRun | undefined;
      if (!response.ok || !run?.id) throw new Error(response.status === 403 ? "forbidden" : "run_failed");
      setRunInput(""); setFeedback(`运行 ${run.id.slice(0, 8)} 已${run.status === "succeeded" ? "完成" : "记录"}。`); await loadRuns(selected.id);
    } catch (error) { setFeedback(error instanceof Error && error.message === "forbidden" ? "当前身份无调用权限，可提交限时权限申请。" : "运行失败，失败状态已记录时可刷新查看。"); }
    finally { setPending(false); }
  }

  async function requestPermission() {
    if (!selected || pending) return; setPending(true); setFeedback("正在提交原生审批…");
    try { const response = await fetch(`/api/workstation/agents/${encodeURIComponent(selected.id)}/permission-requests`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ reason: `申请在当前工作中调用 ${selected.name}`, expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString() }) }); if (!response.ok) throw new Error("request_failed"); setFeedback("权限申请已进入审批中心，通过后自动生效。可在审批中心跟踪进度。"); }
    catch { setFeedback("申请提交失败；若已有待审批申请，请勿重复提交。"); } finally { setPending(false); }
  }

  async function installStarterPack() {
    if (!canManage || pending) return;
    setPending(true); setFeedback("正在安装受控 Agent 标准套件…");
    try {
      const response = await fetch("/api/workstation/agents/starter-pack", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      const data = await payload(response);
      if (!response.ok) throw new Error("starter_pack_failed");
      await loadDirectory();
      const installed = Number(data.installed ?? 0);
      setFeedback(installed > 0
        ? `已安装并发布 ${installed} 个标准 Agent；可进入“流程编排”按顺序组合。`
        : "标准 Agent 已安装，无需重复创建。");
    } catch {
      setFeedback("标准套件安装失败，请检查 AI 配置、权限和数据库迁移状态。");
    } finally {
      setPending(false);
    }
  }

  async function toggleKillSwitch() {
    if (!runtime || killReason.trim().length < 5 || pending) return; setPending(true);
    try { const response = await fetch("/api/workstation/agents/runtime/kill-switch", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ enabled: !runtime.enabled, reason: killReason.trim() }) }); const data = await payload(response); if (!response.ok) throw new Error("kill_failed"); setRuntime(data as RuntimeControl); setKillOpen(false); setKillReason(""); setFeedback((data as unknown as RuntimeControl).enabled ? "全租户 Agent 已紧急停止；新运行被阻止，进行中运行收到取消信号。" : "全租户 Agent 运行已恢复。 "); }
    catch { setFeedback("运行控制更新失败，请刷新状态后重试。"); } finally { setPending(false); }
  }

  async function openOrchestrationRun(orchestration: Orchestration) {
    setOrchestrationTarget(orchestration); setOrchestrationInput(""); setOrchestrationRuns([]);
    try { const response = await fetch(`/api/workstation/agent-orchestrations/${encodeURIComponent(orchestration.id)}/runs`, { cache: "no-store" }); const data = await payload(response); if (response.ok) setOrchestrationRuns(Array.isArray(data.items) ? data.items as OrchestrationRun[] : []); }
    catch { /* the dialog remains usable and the POST boundary reports its own failure */ }
  }

  async function runOrchestration() {
    if (!orchestrationTarget || !orchestrationInput.trim() || pending || runtime?.enabled) return; setPending(true); setFeedback("流程已启动，正在按固定版本逐节点执行…");
    try { const response = await fetch(`/api/workstation/agent-orchestrations/${encodeURIComponent(orchestrationTarget.id)}/runs`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ input: orchestrationInput.trim() }) }); const data = await payload(response); if (!response.ok) throw new Error(String(data.error ?? "orchestration_failed")); const run = data.run as OrchestrationRun | undefined; setFeedback(`编排运行 ${run?.id?.slice(0, 8) ?? ""} 已完成。`); setOrchestrationTarget(null); }
    catch { setFeedback("编排运行失败，已执行节点与失败节点均已记录。"); } finally { setPending(false); }
  }

  return <main className="mx-auto w-full max-w-420 px-3 pt-4 pb-28 sm:px-4 lg:px-5 lg:pt-6 lg:pb-8">
    <section className="mb-4 flex flex-wrap items-end justify-between gap-3"><div><p className="text-xs font-semibold tracking-[0.18em] text-primary">CONTROLLED AGENT RUNTIME</p><h1 className="mt-1 text-2xl font-semibold tracking-tight">Agent 中心</h1><p className="mt-1 text-sm text-muted-foreground">版本、权限、运行与审计统一受服务端控制。</p></div><div className="flex flex-wrap gap-2">{canKill && runtime ? <Button type="button" variant={runtime.enabled ? "default" : "outline"} onClick={() => setKillOpen(true)}><CircleStop data-icon="inline-start" />{runtime.enabled ? "恢复运行" : "紧急停止"}</Button> : null}<Button type="button" variant="outline" onClick={() => void loadDirectory()}><RefreshCw data-icon="inline-start" />刷新</Button>{canManage ? <Button type="button" variant="outline" data-network-write="true" disabled={pending} onClick={() => void installStarterPack()}><PackagePlus data-icon="inline-start" />安装标准套件</Button> : null}{canManage ? <Button type="button" onClick={() => { setEditing(null); setEditorOpen(true); }}><Plus data-icon="inline-start" />新建 Agent</Button> : null}</div></section>
    {runtime?.enabled ? <div className="mb-3 flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"><ShieldAlert className="mt-0.5 size-5 shrink-0" /><div><p className="font-semibold">全租户 Agent 已停止</p><p className="mt-0.5 text-xs">{runtime.reason} · 控制版本 {runtime.version}</p></div></div> : null}
    {feedback ? <p role="status" className="mb-3 rounded-xl bg-brand-soft px-3 py-2 text-xs font-medium text-primary">{feedback}</p> : null}
    <div className="mb-3 flex gap-1 overflow-x-auto rounded-2xl bg-muted p-1 sm:w-fit"><button type="button" onClick={() => setSection("agents")} className={cn("shrink-0 rounded-xl px-4 py-2 text-sm font-semibold", section === "agents" ? "bg-background text-primary shadow-sm" : "text-muted-foreground")}>Agent 目录</button><button type="button" onClick={() => setSection("workflows")} className={cn("shrink-0 rounded-xl px-4 py-2 text-sm font-semibold", section === "workflows" ? "bg-background text-primary shadow-sm" : "text-muted-foreground")}>业务工作流</button>{canOrchestrate ? <button type="button" onClick={() => setSection("orchestrations")} className={cn("shrink-0 rounded-xl px-4 py-2 text-sm font-semibold", section === "orchestrations" ? "bg-background text-primary shadow-sm" : "text-muted-foreground")}>流程编排</button> : null}</div>

    {section === "orchestrations" ? <GlassCard className="p-0"><header className="flex items-center justify-between border-b px-4 py-4 sm:px-5"><div><h2 className="font-semibold">已发布编排</h2><p className="mt-1 text-xs text-muted-foreground">仅支持人工配置并审核的 DAG。</p></div><Button onClick={() => setOrchestrationOpen(true)}><Plus data-icon="inline-start" />新建编排</Button></header><div className="grid gap-3 p-3 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">{orchestrations.map((item) => <article key={item.id} className="rounded-2xl border p-4"><div className="flex items-start gap-3"><span className="grid size-10 place-items-center rounded-2xl bg-violet-100 text-violet-700"><Workflow className="size-5" /></span><div className="min-w-0 flex-1"><h3 className="truncate font-semibold">{item.name}</h3><p className="text-xs text-muted-foreground">{item.code} · v{item.revision ?? 0}</p></div><Badge variant="outline">{item.status === "published" ? "已发布" : "草稿"}</Badge></div><p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{item.description || "未填写说明"}</p><div className="mt-4 grid grid-cols-2 gap-2 text-center"><div className="rounded-xl bg-muted px-2 py-2"><p className="text-lg font-semibold">{item.nodeCount}</p><p className="text-xs text-muted-foreground">节点</p></div><div className="rounded-xl bg-muted px-2 py-2"><p className="text-lg font-semibold">{item.edgeCount}</p><p className="text-xs text-muted-foreground">连接</p></div></div>{item.status === "published" ? <Button className="mt-3 w-full" variant="outline" onClick={() => void openOrchestrationRun(item)} disabled={runtime?.enabled}><Play data-icon="inline-start" />运行流程</Button> : null}</article>)}{orchestrations.length === 0 ? <div className="col-span-full py-16 text-center"><Workflow className="mx-auto size-10 text-primary" /><h3 className="mt-3 font-semibold">尚未创建编排</h3><p className="mt-1 text-sm text-muted-foreground">从已发布 Agent 组合可审查的业务流程。</p></div> : null}</div></GlassCard> : section === "workflows" ? <ExternalWorkflowWorkspace /> : <div className="grid min-h-[calc(100dvh-14rem)] gap-3 md:grid-cols-[18rem_minmax(0,1fr)]">
      <GlassCard className={cn("overflow-hidden p-2", selected && "max-md:hidden")}><div className="px-3 py-2 text-xs font-semibold text-muted-foreground">可见 Agent · {agents.length}</div><div className="grid gap-1">{agents.map((agent) => <button key={agent.id} type="button" onClick={() => setSelected(agent)} className={cn("rounded-2xl px-3 py-3 text-left transition", selected?.id === agent.id ? "bg-primary text-primary-foreground" : "hover:bg-muted")}><span className="flex items-center gap-2"><Bot className="size-4 shrink-0" /><span className="truncate text-sm font-semibold">{agent.name}</span></span><span className={cn("mt-1 block truncate text-xs", selected?.id === agent.id ? "text-primary-foreground/75" : "text-muted-foreground")}>{agent.status === "enabled" ? `已发布 v${agent.revision ?? 0}` : "未启用"} · {agent.modelCode ?? "未配置模型"}</span></button>)}</div>{agents.length === 0 ? <div className="px-3 py-16 text-center"><Bot className="mx-auto size-9 text-primary" /><h2 className="mt-3 font-semibold">尚未创建 Agent</h2><p className="mt-1 text-sm text-muted-foreground">目录不会填充演示数据。</p>{canManage ? <Button className="mt-4" onClick={() => { setEditing(null); setEditorOpen(true); }}>新建 Agent</Button> : null}</div> : null}</GlassCard>
      <GlassCard className={cn("overflow-hidden p-0", selected && "max-md:fixed max-md:inset-0 max-md:z-50 max-md:h-dvh max-md:overflow-y-auto max-md:rounded-none max-md:bg-background")}>
        {selected ? <><header className="sticky top-0 z-10 flex min-h-16 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur sm:px-5"><Button type="button" size="icon" variant="ghost" className="md:hidden" aria-label="返回 Agent 列表" onClick={() => setSelected(null)}><ArrowLeft /></Button><span className="grid size-10 place-items-center rounded-2xl bg-primary/10 text-primary"><Bot className="size-5" /></span><div className="min-w-0 flex-1"><h2 className="truncate font-semibold">{selected.name}</h2><p className="truncate text-xs text-muted-foreground">{selected.code} · {selected.modelCode ?? "未配置模型"}</p></div><Badge variant={selected.status === "enabled" ? "default" : "outline"}>{selected.status === "enabled" ? "运行中" : "未启用"}</Badge></header>
          <div className="grid gap-3 p-3 sm:p-5"><section className="grid gap-2 sm:grid-cols-3"><div className="rounded-2xl bg-muted p-3"><p className="text-xs text-muted-foreground">当前版本</p><p className="mt-1 text-xl font-semibold">v{selected.revision ?? 0}</p></div><div className="rounded-2xl bg-muted p-3"><p className="text-xs text-muted-foreground">成功运行</p><p className="mt-1 text-xl font-semibold">{successfulRuns}</p></div><div className="rounded-2xl bg-muted p-3"><p className="text-xs text-muted-foreground">高风险工具</p><p className="mt-1 text-xl font-semibold">{highRiskTools}</p></div></section>
            <section className="rounded-2xl border p-4"><div className="flex flex-wrap items-start gap-3"><div className="min-w-0 flex-1"><h3 className="font-semibold">能力与权限范围</h3><p className="mt-1 text-sm text-muted-foreground">{selected.description || "未填写用途说明"}</p></div>{canManage ? <Button variant="outline" size="sm" onClick={() => { setEditing(selected); setEditorOpen(true); }}>发布新版本</Button> : null}</div><div className="mt-3 flex flex-wrap gap-2">{selected.tools.map((tool) => <span key={tool.code} className={cn("rounded-full px-2.5 py-1 text-xs font-medium", tool.highRisk ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800")}>{tool.code}{tool.highRisk ? " · 人工确认" : ""}</span>)}{selected.tools.length === 0 ? <span className="text-xs text-muted-foreground">未授权工具</span> : null}</div><div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><ShieldCheck className="size-4 text-primary" />每次调用仍按成员、部门、职级、有效期和租户边界实时复核。</div></section>
            <section className="rounded-2xl border p-4"><h3 className="font-semibold">发起真实运行</h3><div className="mt-3 flex items-end gap-2"><Textarea aria-label="Agent 运行输入" value={runInput} onChange={(event) => setRunInput(event.target.value)} rows={3} maxLength={12000} placeholder="输入明确的工作目标和可用上下文…" /><Button type="button" data-network-write="true" size="icon" aria-label="运行 Agent" disabled={pending || runtime?.enabled || selected.status !== "enabled" || !runInput.trim()} onClick={() => void runAgent()}><Play /></Button></div>{canRequest ? <div className="mt-3 flex items-center justify-between gap-3 rounded-xl bg-muted px-3 py-2"><p className="text-xs text-muted-foreground">调用被拒绝时，可申请 7 天限时权限。</p><Button data-network-write="true" size="sm" variant="outline" disabled={pending} onClick={() => void requestPermission()}>申请权限</Button></div> : null}</section>
            <section className="rounded-2xl border"><header className="flex items-center gap-2 border-b px-4 py-3"><History className="size-4 text-primary" /><h3 className="font-semibold">运行记录</h3><span className="ml-auto text-xs text-muted-foreground">{runs.length} 条</span></header><div className="divide-y">{runs.map((run) => <article key={run.id} className="px-4 py-3"><div className="flex items-center gap-2"><Activity className={cn("size-4", run.status === "succeeded" ? "text-emerald-600" : run.status === "failed" ? "text-red-600" : "text-amber-600")} /><span className="text-sm font-semibold">{run.status === "succeeded" ? "已完成" : run.status === "failed" ? "失败" : run.status === "running" ? "运行中" : "排队中"}</span><code className="text-xs text-muted-foreground">{run.id.slice(0, 8)}</code><span className="ml-auto text-xs text-muted-foreground">{formatTime(run.completedAt ?? run.startedAt)}</span></div>{run.outputSummary ? <p className="mt-2 line-clamp-2 text-sm">{run.outputSummary}</p> : null}{run.errorCode ? <p className="mt-2 text-xs font-medium text-red-700">{run.errorCode}</p> : null}<p className="mt-2 text-xs text-muted-foreground">{run.latencyMs ?? 0} ms · 输入 {run.inputTokens ?? 0} / 输出 {run.outputTokens ?? 0} tokens</p></article>)}{runs.length === 0 ? <p className="px-4 py-10 text-center text-sm text-muted-foreground">暂无运行记录</p> : null}</div></section>
          </div></> : <div className="grid min-h-120 place-items-center px-6 text-center"><div><Bot className="mx-auto size-10 text-primary" /><h2 className="mt-3 font-semibold">选择一个 Agent</h2><p className="mt-1 text-sm text-muted-foreground">查看能力、权限和真实运行记录。</p></div></div>}
      </GlassCard>
    </div>}
    <AgentEditor open={editorOpen} agent={editing} onOpenChange={setEditorOpen} onSaved={async (agentId) => loadDirectory(agentId)} />
    <OrchestrationEditor open={orchestrationOpen} agents={agents} onOpenChange={setOrchestrationOpen} onSaved={loadDirectory} />
    <Dialog open={Boolean(orchestrationTarget)} onOpenChange={(next) => !pending && !next && setOrchestrationTarget(null)}><DialogContent className="max-sm:inset-0 max-sm:h-dvh max-sm:w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none"><DialogHeader><DialogTitle>运行 {orchestrationTarget?.name}</DialogTitle><DialogDescription>按已发布 DAG 和固定 Agent 版本执行；任一节点失败即停止后续节点。</DialogDescription></DialogHeader><label className="grid gap-1 text-xs font-medium">流程输入<Textarea value={orchestrationInput} onChange={(event) => setOrchestrationInput(event.target.value)} rows={5} maxLength={12000} placeholder="输入业务目标和必要上下文…" /></label>{orchestrationRuns.length ? <div className="max-h-44 overflow-y-auto rounded-2xl border"><p className="border-b px-3 py-2 text-xs font-semibold">最近运行</p>{orchestrationRuns.slice(0, 5).map((run) => <div key={run.id} className="flex items-center gap-2 border-b px-3 py-2 text-xs last:border-0"><span className={cn("size-2 rounded-full", run.status === "succeeded" ? "bg-emerald-500" : run.status === "failed" ? "bg-red-500" : "bg-amber-500")} /><code>{run.id.slice(0, 8)}</code><span className="ml-auto text-muted-foreground">{formatTime(run.completedAt ?? run.startedAt)}</span></div>)}</div> : null}<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setOrchestrationTarget(null)} disabled={pending}>取消</Button><Button onClick={() => void runOrchestration()} disabled={pending || !orchestrationInput.trim() || runtime?.enabled}>{pending ? "执行中…" : "确认运行"}</Button></div></DialogContent></Dialog>
    <Dialog open={killOpen} onOpenChange={(next) => !pending && setKillOpen(next)}><DialogContent><DialogHeader><DialogTitle>{runtime?.enabled ? "恢复全租户 Agent" : "紧急停止全租户 Agent"}</DialogTitle><DialogDescription>{runtime?.enabled ? "恢复后允许新的 Agent 运行。" : "新运行将被拒绝，排队任务终止，进行中任务收到协作取消信号。"}操作会写入审计。</DialogDescription></DialogHeader><label className="grid gap-1 text-xs font-medium">操作原因<Textarea value={killReason} onChange={(event) => setKillReason(event.target.value)} rows={3} maxLength={500} placeholder="至少 5 个字符" /></label><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setKillOpen(false)} disabled={pending}>取消</Button><Button variant={runtime?.enabled ? "default" : "destructive"} onClick={() => void toggleKillSwitch()} disabled={pending || killReason.trim().length < 5}>{pending ? "处理中…" : runtime?.enabled ? "确认恢复" : "确认停止"}</Button></div></DialogContent></Dialog>
  </main>;
}
