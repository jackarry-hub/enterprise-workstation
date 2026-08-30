"use client";

import { useEffect, useMemo, useState } from "react";
import { Workflow } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AgentSummary } from "@/features/agents/agent-editor";

type OrchestrationEditorProps = {
  open: boolean;
  agents: AgentSummary[];
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void> | void;
};

async function responsePayload(response: Response) { return await response.json() as Record<string, unknown>; }

export function OrchestrationEditor({ open, agents, onOpenChange, onSaved }: OrchestrationEditorProps) {
  const available = useMemo(() => agents.filter((agent) => agent.status === "enabled" && agent.currentVersionId), [agents]);
  const [code, setCode] = useState(""); const [name, setName] = useState(""); const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<string[]>([]); const [pending, setPending] = useState(false); const [feedback, setFeedback] = useState("");
  useEffect(() => { if (open) { setCode(""); setName(""); setDescription(""); setSelected([]); setFeedback(""); } }, [open]);

  async function saveAndPublish() {
    if (!/^[a-z][a-z0-9_]{1,79}$/.test(code) || name.trim().length < 2 || selected.length < 1 || pending) return;
    setPending(true); setFeedback("正在校验 DAG 并固定 Agent 版本…");
    try {
      const ordered = selected.map((id) => available.find((agent) => agent.id === id)).filter((agent): agent is AgentSummary => Boolean(agent?.currentVersionId));
      const nodes = ordered.map((agent, index) => ({ key: `step_${index + 1}`, agentVersionId: agent.currentVersionId, inputContract: "quantxy.text.v1", outputContract: "quantxy.text.v1" }));
      const edges = nodes.slice(1).map((node, index) => ({ from: nodes[index].key, to: node.key }));
      const response = await fetch("/api/workstation/agent-orchestrations", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ code, name: name.trim(), description: description.trim(), nodes, edges }) });
      const payload = await responsePayload(response); const orchestrationId = typeof payload.orchestrationId === "string" ? payload.orchestrationId : ""; const versionId = typeof payload.versionId === "string" ? payload.versionId : "";
      if (!response.ok || !orchestrationId || !versionId) throw new Error("create_failed");
      const publish = await fetch(`/api/workstation/agent-orchestrations/${encodeURIComponent(orchestrationId)}/publish`, { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() }, body: JSON.stringify({ versionId }) });
      if (!publish.ok) throw new Error("publish_failed");
      await onSaved(); onOpenChange(false);
    } catch (error) { setFeedback(error instanceof Error && error.message === "publish_failed" ? "流程版本已保存但未发布，请检查节点合同和版本状态。" : "保存失败，请检查节点顺序与数据合同。"); }
    finally { setPending(false); }
  }

  return <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}><DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-xl max-sm:inset-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none"><DialogHeader><DialogTitle className="flex items-center gap-2"><Workflow className="size-5 text-primary" />新建编排</DialogTitle><DialogDescription>按勾选顺序生成可审查的线性 DAG，并固定每个 Agent 的已发布版本。</DialogDescription></DialogHeader><div className="grid gap-4"><div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-xs font-medium">唯一编码<Input value={code} onChange={(event) => setCode(event.target.value.toLowerCase())} placeholder="customer_followup" /></label><label className="grid gap-1 text-xs font-medium">名称<Input value={name} onChange={(event) => setName(event.target.value)} placeholder="客户跟进流程" /></label></div><label className="grid gap-1 text-xs font-medium">说明<Textarea rows={2} value={description} onChange={(event) => setDescription(event.target.value)} maxLength={2000} /></label><fieldset className="rounded-2xl border p-3"><legend className="px-1 text-xs font-semibold">节点顺序</legend><div className="mt-1 grid gap-2">{available.map((agent) => <label key={agent.id} className="flex min-h-12 items-center gap-3 rounded-xl bg-muted/60 px-3 text-sm"><input type="checkbox" checked={selected.includes(agent.id)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, agent.id] : current.filter((id) => id !== agent.id))} /><span className="grid size-6 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">{selected.indexOf(agent.id) + 1 || "·"}</span><span className="min-w-0 flex-1"><span className="block font-medium">{agent.name}</span><span className="block text-xs text-muted-foreground">固定 v{agent.revision}</span></span></label>)}</div>{available.length === 0 ? <p className="py-6 text-center text-sm text-muted-foreground">请先发布至少一个 Agent。</p> : null}</fieldset><p role="status" className="min-h-5 text-sm text-muted-foreground">{feedback}</p><div className="flex justify-end gap-2"><Button variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>取消</Button><Button onClick={() => void saveAndPublish()} disabled={pending || selected.length < 1 || name.trim().length < 2}>{pending ? "发布中…" : "保存并发布"}</Button></div></div></DialogContent></Dialog>;
}
