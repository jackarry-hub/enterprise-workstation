"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export type AgentSummary = {
  id: string;
  code: string;
  name: string;
  description: string;
  icon: string;
  status: "enabled" | "disabled";
  currentVersionId: string | null;
  revision: number | null;
  lifecycle: string | null;
  modelCode: string | null;
  promptVersion: string | null;
  tools: { code: string; highRisk: boolean }[];
  canManage: boolean;
  canInvoke: boolean;
};

type AgentEditorProps = {
  open: boolean;
  agent: AgentSummary | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (agentId: string) => Promise<void> | void;
};

const TOOL_OPTIONS = [
  { code: "knowledge.search", label: "知识检索", risk: false },
  { code: "project.read", label: "项目读取", risk: false },
  { code: "task.read", label: "任务读取", risk: false },
  { code: "send_message", label: "发送消息", risk: true },
  { code: "create_approval", label: "发起审批", risk: true },
] as const;

const DATA_SCOPE_FOR_TOOL: Record<string, string | undefined> = {
  "knowledge.search": "knowledge.read",
  "project.read": "project.read",
  "task.read": "task.read",
};

async function responsePayload(response: Response) {
  return await response.json() as Record<string, unknown>;
}

export function AgentEditor({ open, agent, onOpenChange, onSaved }: AgentEditorProps) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [promptVersion, setPromptVersion] = useState("v1");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [modelCode, setModelCode] = useState("deepseek-chat");
  const [contract, setContract] = useState("quantxy.text.v1");
  const [selectedTools, setSelectedTools] = useState<string[]>(["knowledge.search"]);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    if (!open) return;
    setCode(agent?.code ?? "");
    setName(agent?.name ?? "");
    setDescription(agent?.description ?? "");
    setPromptVersion(agent?.revision ? `v${agent.revision + 1}` : "v1");
    setModelCode(agent?.modelCode ?? "deepseek-chat");
    setSelectedTools(agent?.tools.map(({ code: toolCode }) => toolCode) ?? ["knowledge.search"]);
    setSystemPrompt("");
    setContract("quantxy.text.v1");
    setFeedback("");
  }, [agent, open]);

  const canSubmit = useMemo(() => (
    (agent || /^[a-z][a-z0-9_]{1,79}$/.test(code))
    && name.trim().length >= 2
    && systemPrompt.trim().length >= 5
    && promptVersion.trim().length > 0
    && contract.trim().length > 0
  ), [agent, code, contract, name, promptVersion, systemPrompt]);

  async function saveAndPublish() {
    if (!canSubmit || pending) return;
    setPending(true);
    setFeedback("正在保存定义与不可变版本…");
    try {
      let agentId = agent?.id;
      if (!agentId) {
        const createResponse = await fetch("/api/workstation/agents", {
          method: "POST",
          headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
          body: JSON.stringify({ code, name: name.trim(), description: description.trim(), icon: "bot", minJobLevel: 1 }),
        });
        const createPayload = await responsePayload(createResponse);
        agentId = typeof createPayload.agentId === "string" ? createPayload.agentId : undefined;
        if (!createResponse.ok || !agentId) throw new Error("agent_create_failed");
      }

      const dataScopes = [...new Set(selectedTools.map((tool) => DATA_SCOPE_FOR_TOOL[tool]).filter((scope): scope is string => Boolean(scope)))];
      const versionResponse = await fetch(`/api/workstation/agents/${encodeURIComponent(agentId)}/versions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          modelCode,
          promptVersion: promptVersion.trim(),
          systemPrompt: systemPrompt.trim(),
          inputSchema: { type: "object", properties: { input: { type: "string" } }, required: ["input"], "x-contract": contract.trim() },
          outputSchema: { type: "object", properties: { output: { type: "string" } }, required: ["output"], "x-contract": contract.trim() },
          dataScopes,
          secretRefs: ["DEEPSEEK_API_KEY"],
          limits: { maxSteps: 20, maxDepth: 3, timeoutSeconds: 300, maxTokens: 2000, maxConcurrent: 3 },
          tools: selectedTools.map((toolCode) => ({ code: toolCode, config: {} })),
        }),
      });
      const versionPayload = await responsePayload(versionResponse);
      const versionId = typeof versionPayload.versionId === "string" ? versionPayload.versionId : undefined;
      if (!versionResponse.ok || !versionId) throw new Error("agent_version_failed");

      const publishResponse = await fetch(`/api/workstation/agents/${encodeURIComponent(agentId)}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ versionId }),
      });
      if (!publishResponse.ok) throw new Error("agent_publish_failed");
      setFeedback("已发布，可按权限调用。");
      await onSaved(agentId);
      onOpenChange(false);
    } catch (error) {
      const code = error instanceof Error ? error.message : "agent_save_failed";
      setFeedback(code === "agent_publish_failed" ? "版本已保存但未发布，请检查模型、工具和数据白名单。" : "保存失败，请检查字段或稍后重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-2xl max-sm:inset-0 max-sm:h-dvh max-sm:max-h-dvh max-sm:w-full max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Bot className="size-5 text-primary" />{agent ? "发布新版本" : "新建 Agent"}</DialogTitle>
          <DialogDescription>系统提示词、模型、工具和数据范围由服务端保存；发布后版本不可修改。</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          {!agent ? <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-xs font-medium">唯一编码<Input value={code} onChange={(event) => setCode(event.target.value.toLowerCase())} placeholder="contract_review" /></label><label className="grid gap-1 text-xs font-medium">名称<Input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="合同审查 Agent" /></label></div> : <div className="rounded-2xl bg-muted px-4 py-3"><p className="text-sm font-semibold">{agent.name}</p><p className="text-xs text-muted-foreground">{agent.code} · 当前 v{agent.revision ?? 0}</p></div>}
          {!agent ? <label className="grid gap-1 text-xs font-medium">用途说明<Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={2} maxLength={2000} placeholder="说明这个 Agent 负责的业务边界" /></label> : null}
          <div className="grid gap-3 sm:grid-cols-3"><label className="grid gap-1 text-xs font-medium">模型<select className="h-10 rounded-xl border bg-background px-3 text-sm" value={modelCode} onChange={(event) => setModelCode(event.target.value)}><option value="deepseek-chat">DeepSeek Chat</option><option value="deepseek-reasoner">DeepSeek Reasoner</option><option value="deepseek-v4-flash">DeepSeek V4 Flash</option></select></label><label className="grid gap-1 text-xs font-medium">提示词版本<Input value={promptVersion} onChange={(event) => setPromptVersion(event.target.value)} maxLength={40} /></label><label className="grid gap-1 text-xs font-medium">数据合同<Input value={contract} onChange={(event) => setContract(event.target.value)} maxLength={120} /></label></div>
          <label className="grid gap-1 text-xs font-medium">系统提示词<Textarea value={systemPrompt} onChange={(event) => setSystemPrompt(event.target.value)} rows={7} maxLength={12000} placeholder="定义职责、输入输出、禁止事项和需要人工确认的边界…" /></label>
          <fieldset className="rounded-2xl border p-3"><legend className="px-1 text-xs font-semibold">授权工具</legend><div className="mt-1 grid gap-2 sm:grid-cols-2">{TOOL_OPTIONS.map((tool) => <label key={tool.code} className="flex min-h-11 items-center gap-3 rounded-xl bg-muted/60 px-3 text-sm"><input type="checkbox" checked={selectedTools.includes(tool.code)} onChange={(event) => setSelectedTools((current) => event.target.checked ? [...current, tool.code] : current.filter((item) => item !== tool.code))} /><span className="min-w-0 flex-1">{tool.label}</span>{tool.risk ? <span className="text-xs font-medium text-amber-700">需确认</span> : <CheckCircle2 className="size-4 text-emerald-600" />}</label>)}</div></fieldset>
          <div className="flex items-start gap-2 rounded-2xl bg-brand-soft p-3 text-xs leading-5 text-primary"><ShieldCheck className="mt-0.5 size-4 shrink-0" /><span>高风险工具仍须一次性人工确认；密钥只保存引用，不写入浏览器或版本记录。</span></div>
          <p role="status" className="min-h-5 text-sm text-muted-foreground">{feedback}</p>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>取消</Button><Button type="button" onClick={() => void saveAndPublish()} disabled={!canSubmit || pending}>{pending ? "发布中…" : "保存并发布"}</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
