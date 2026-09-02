"use client";

import { useEffect, useMemo, useState } from "react";
import { Activity, ExternalLink, History, ImageIcon, Play, RefreshCw, Video } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GlassCard } from "@/components/ui/glass-card";
import { Textarea } from "@/components/ui/textarea";
import type { ExternalWorkflowDefinition } from "@/features/agents/external-workflow-catalog";
import { cn } from "@/lib/utils";

type WorkflowItem = ExternalWorkflowDefinition & {
  providerLabel: string;
  connectionStatus: "ready" | "unverified" | "unconfigured";
  nativeRunEnabled: boolean;
};
type WorkflowRun = {
  id: string;
  status: "running" | "succeeded" | "failed";
  upstreamRunId?: string;
  outputSummary?: string;
  errorCode?: string;
  startedAt?: string;
  completedAt?: string;
};

async function payload(response: Response) { return await response.json() as Record<string, unknown>; }
function formatTime(value?: string | null) { if (!value) return "—"; const time = new Date(value); return Number.isNaN(time.valueOf()) ? "—" : time.toLocaleString("zh-CN", { hour12: false }); }

export function ExternalWorkflowWorkspace() {
  const [items, setItems] = useState<WorkflowItem[]>([]);
  const [selected, setSelected] = useState<WorkflowItem | null>(null);
  const [runs, setRuns] = useState<WorkflowRun[]>([]);
  const [input, setInput] = useState("");
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState("1536x1024");
  const [files, setFiles] = useState<File[]>([]);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("正在同步外部工作流目录…");

  async function loadCatalog() {
    try {
      const response = await fetch("/api/workstation/agent-workflows", { cache: "no-store" }); const data = await payload(response);
      if (!response.ok) throw new Error("catalog_failed"); const next = Array.isArray(data.items) ? data.items as WorkflowItem[] : [];
      setItems(next); setFeedback(next.length ? "" : "尚未登记外部工作流");
    } catch { setFeedback("工作流目录同步失败，请稍后重试。"); }
  }

  async function loadRuns(workflow: WorkflowItem) {
    try {
      const response = await fetch(`/api/workstation/agent-workflows/${encodeURIComponent(workflow.code)}/runs`, { cache: "no-store" }); const data = await payload(response);
      setRuns(response.ok && Array.isArray(data.items) ? data.items as WorkflowRun[] : []);
    } catch { setRuns([]); }
  }

  useEffect(() => { void loadCatalog(); }, []);
  useEffect(() => { if (selected) void loadRuns(selected); else setRuns([]); }, [selected]);
  const connected = useMemo(() => items.filter(({ nativeRunEnabled }) => nativeRunEnabled).length, [items]);

  function openWorkflow(workflow: WorkflowItem) {
    setSelected(workflow); setInput(""); setPrompt(""); setSize("1536x1024"); setFiles([]); setFeedback("");
  }

  async function runWorkflow() {
    if (!selected || !selected.nativeRunEnabled || pending) return;
    setPending(true); setFeedback(`正在提交到${selected.providerLabel}…`);
    try {
      const headers: Record<string, string> = { "Idempotency-Key": crypto.randomUUID() }; let body: BodyInit;
      if (selected.provider === "image-studio") {
        const form = new FormData(); form.set("promptOverride", prompt.trim()); form.set("size", size); files.forEach((file) => form.append("images", file, file.name)); body = form;
      } else { headers["Content-Type"] = "application/json"; body = JSON.stringify({ input: input.trim() }); }
      const response = await fetch(`/api/workstation/agent-workflows/${encodeURIComponent(selected.code)}/runs`, { method: "POST", headers, body }); const data = await payload(response);
      if (!response.ok) throw new Error(String(data.error ?? "run_failed")); const run = data.run as WorkflowRun | undefined;
      setFeedback(run?.outputSummary || "工作流已提交并写入运行记录。"); await loadRuns(selected);
    } catch (error) {
      const code = error instanceof Error ? error.message : "run_failed";
      setFeedback(code === "workflow_connection_unconfigured" ? "服务连接尚未配置，请先使用原中控台。" : "提交失败；可打开原中控台继续处理，失败记录会保留。 ");
      await loadRuns(selected);
    } finally { setPending(false); }
  }

  return <GlassCard className="overflow-hidden p-0">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-4 sm:px-5"><div><h2 className="font-semibold">业务工作流</h2><p className="mt-1 text-xs text-muted-foreground">点击卡片进入对应工作流；服务凭证只在后端使用。</p></div><div className="flex items-center gap-2"><Badge variant="outline">{connected}/{items.length} 已验证</Badge><Button type="button" size="sm" variant="outline" onClick={() => void loadCatalog()}><RefreshCw data-icon="inline-start" />刷新</Button></div></header>
    {feedback && !selected ? <p role="status" className="m-3 rounded-xl bg-brand-soft px-3 py-2 text-xs font-medium text-primary">{feedback}</p> : null}
    <div className="grid gap-3 p-3 sm:grid-cols-2 sm:p-5 xl:grid-cols-3">{items.map((workflow) => <button key={workflow.code} type="button" onClick={() => openWorkflow(workflow)} className="group rounded-2xl border bg-background p-4 text-left transition hover:border-primary/40 hover:shadow-sm"><div className="flex items-start gap-3"><span className={cn("grid size-11 shrink-0 place-items-center rounded-2xl", workflow.provider === "image-studio" ? "bg-fuchsia-100 text-fuchsia-700" : "bg-blue-100 text-blue-700")}>{workflow.provider === "image-studio" ? <ImageIcon className="size-5" /> : <Video className="size-5" />}</span><div className="min-w-0 flex-1"><h3 className="truncate font-semibold">{workflow.name}</h3><p className="mt-0.5 truncate text-xs text-muted-foreground">{workflow.providerLabel}</p></div><Badge variant={workflow.nativeRunEnabled ? "default" : "outline"}>{workflow.nativeRunEnabled ? "可直接运行" : workflow.connectionStatus === "unverified" ? "连接未验证" : "待配置"}</Badge></div><p className="mt-3 line-clamp-2 text-sm leading-6 text-muted-foreground">{workflow.description}</p><div className="mt-4 flex items-center justify-between border-t pt-3 text-xs"><span className="font-medium text-primary">{workflow.category}</span><span className="flex items-center gap-1 text-muted-foreground">打开<ExternalLink className="size-3.5" /></span></div></button>)}{items.length === 0 && !feedback ? <p className="col-span-full py-16 text-center text-sm text-muted-foreground">尚未登记工作流</p> : null}</div>

    <Dialog open={Boolean(selected)} onOpenChange={(next) => !pending && !next && setSelected(null)}><DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl max-sm:inset-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none"><DialogHeader><DialogTitle>{selected?.name}</DialogTitle><DialogDescription>{selected?.description}</DialogDescription></DialogHeader>{selected ? <div className="grid gap-4"><div className="flex flex-wrap items-center gap-2 rounded-2xl bg-muted px-3 py-2 text-xs"><Badge variant={selected.nativeRunEnabled ? "default" : "outline"}>{selected.nativeRunEnabled ? "服务端连接已验证" : selected.connectionStatus === "unverified" ? "服务端连接未验证" : "服务端连接待配置"}</Badge><span className="text-muted-foreground">{selected.providerLabel} · {selected.code}</span></div>
      {selected.provider === "image-studio" ? <><label className="grid gap-1 text-xs font-medium">参考照片<input aria-label="参考照片" type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={(event) => setFiles(Array.from(event.target.files ?? []))} className="min-h-11 rounded-xl border bg-background px-3 py-2 text-sm" /></label><p className="text-xs text-muted-foreground">最多 8 张，每张不超过 12MB、合计不超过 48MB；支持 JPG、PNG、WebP。</p><label className="grid gap-1 text-xs font-medium">画面比例<select aria-label="画面比例" value={size} onChange={(event) => setSize(event.target.value)} className="h-11 rounded-xl border bg-background px-3 text-sm"><option value="1536x1024">横版 3:2</option><option value="1024x1536">竖版 2:3</option><option value="1024x1024">方形 1:1</option></select></label><label className="grid gap-1 text-xs font-medium">制作要求<Textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} rows={4} maxLength={4000} placeholder="可选：服装、场景、风格和需要保留的细节…" /></label></> : <label className="grid gap-1 text-xs font-medium">任务目标<Textarea aria-label="工作流任务目标" value={input} onChange={(event) => setInput(event.target.value)} rows={5} maxLength={12000} placeholder="输入选题、受众、平台、比例、风格和交付要求…" /></label>}
      {!selected.nativeRunEnabled ? <p className="rounded-2xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-800">{selected.connectionStatus === "unverified" ? "服务凭证已填写，但上游调用接口尚未验证通过。" : "当前没有服务端凭证。"}因此不会伪造运行成功；可先打开原中控台。</p> : null}
      <div className="flex flex-wrap justify-end gap-2"><a href={selected.launchUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border bg-background px-4 text-sm font-medium hover:bg-muted">打开原中控台<ExternalLink className="size-4" /></a><Button type="button" data-network-write="true" onClick={() => void runWorkflow()} disabled={pending || !selected.nativeRunEnabled || (selected.provider === "image-studio" ? files.length < 1 : !input.trim())}><Play data-icon="inline-start" />{pending ? "提交中…" : "立即运行"}</Button></div>
      <section className="rounded-2xl border"><header className="flex items-center gap-2 border-b px-3 py-2"><History className="size-4 text-primary" /><h3 className="text-sm font-semibold">运行记录</h3><span className="ml-auto text-xs text-muted-foreground">{runs.length} 条</span></header><div className="divide-y">{runs.slice(0, 10).map((run) => <article key={run.id} className="px-3 py-3"><div className="flex items-center gap-2"><Activity className={cn("size-4", run.status === "succeeded" ? "text-emerald-600" : run.status === "failed" ? "text-red-600" : "text-amber-600")} /><span className="text-sm font-semibold">{run.status === "succeeded" ? "已提交" : run.status === "failed" ? "失败" : "处理中"}</span>{run.upstreamRunId ? <code className="truncate text-xs text-muted-foreground">{run.upstreamRunId}</code> : null}<span className="ml-auto text-xs text-muted-foreground">{formatTime(run.completedAt ?? run.startedAt)}</span></div>{run.outputSummary ? <p className="mt-2 text-sm">{run.outputSummary}</p> : null}{run.errorCode ? <p className="mt-2 text-xs font-medium text-red-700">{run.errorCode}</p> : null}</article>)}{runs.length === 0 ? <p className="px-3 py-8 text-center text-sm text-muted-foreground">暂无运行记录</p> : null}</div></section>
      <p role="status" className="min-h-5 text-sm text-muted-foreground">{feedback}</p></div> : null}</DialogContent></Dialog>
  </GlassCard>;
}
