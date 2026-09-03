"use client";

import { useEffect, useState } from "react";
import { Bot, CheckCircle2, KeyRound, Save, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AI_BASE_URL,
  AI_MODELS,
  type AiModel,
  type PublicAiConfig,
} from "@/features/ai-config/ai-config-types";

const MODEL_LABELS: Record<AiModel, string> = {
  "deepseek-v4-flash": "DeepSeek V4 Flash",
  "deepseek-chat": "DeepSeek Chat",
  "deepseek-reasoner": "DeepSeek Reasoner",
};

export function AiProviderSettings() {
  const [config, setConfig] = useState<PublicAiConfig | null>(null);
  const [model, setModel] = useState<AiModel>("deepseek-chat");
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("正在读取模型配置…");

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const response = await fetch("/api/ai/config", { cache: "no-store" });
        const body = (await response.json()) as PublicAiConfig & { error?: string };
        if (!response.ok || body.error) throw new Error(body.error ?? "ai_config_load_failed");
        if (!active) return;
        setConfig(body);
        setModel(body.model);
        setFeedback("");
      } catch {
        if (active) setFeedback("模型配置读取失败，请稍后重试。");
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => { active = false; };
  }, []);

  async function save() {
    if (!config?.canManage || saving || (!config.keyConfigured && !apiKey)) return;
    setSaving(true);
    setFeedback("正在加密保存模型配置…");
    try {
      const response = await fetch("/api/ai/config", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ model, ...(apiKey ? { apiKey } : {}) }),
      });
      const body = (await response.json()) as PublicAiConfig & { error?: string };
      if (!response.ok || body.error) throw new Error(body.error ?? "ai_config_save_failed");
      setConfig(body);
      setApiKey("");
      setFeedback("模型配置已加密保存，AI 助手与 Agent 现可调用该模型。");
    } catch (error) {
      setFeedback(error instanceof Error && error.message === "invalid_api_key"
        ? "API Key 格式无效，请填写以 sk- 开头的 DeepSeek Key。"
        : "模型配置保存失败，请检查 Key 或稍后重试。");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="ai-provider-settings-title" className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-2xl bg-primary/10 text-primary">
            <Bot aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h2 id="ai-provider-settings-title" className="text-xl font-semibold">AI 模型</h2>
            <p className="text-sm text-muted-foreground">为 AI 助手、智能排期和 Agent 中心配置统一模型。</p>
          </div>
        </div>
        <Badge variant={config?.keyConfigured ? "success" : "outline"} className="gap-1.5">
          {config?.keyConfigured ? <CheckCircle2 className="size-3.5" /> : <KeyRound className="size-3.5" />}
          {config?.keyConfigured ? "密钥已配置" : "等待配置密钥"}
        </Badge>
      </div>

      {feedback ? <p role="status" className="rounded-xl bg-brand-soft px-3 py-2 text-xs font-medium text-primary">{feedback}</p> : null}

      <div className="grid gap-4 rounded-2xl border bg-background/70 p-4 sm:p-5">
        <label className="grid gap-2 text-sm font-medium">
          服务商
          <Input aria-label="AI 服务商" value="DeepSeek" disabled />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          API 地址
          <Input aria-label="AI API 地址" value={AI_BASE_URL} disabled />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          默认模型
          <select
            aria-label="默认模型"
            className="h-11 rounded-xl border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={model}
            disabled={loading || !config?.canManage || saving}
            onChange={(event) => setModel(event.target.value as AiModel)}
          >
            {AI_MODELS.map((value) => <option key={value} value={value}>{MODEL_LABELS[value]}</option>)}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-medium">
          DeepSeek API Key
          <Input
            aria-label="DeepSeek API Key"
            type="password"
            autoComplete="new-password"
            placeholder={config?.keyConfigured ? `已配置 · 末四位 ${config.keyHint ?? "****"}；留空表示不更换` : "sk-..."}
            value={apiKey}
            disabled={loading || !config?.canManage || saving}
            onChange={(event) => setApiKey(event.target.value)}
          />
        </label>
        <div className="flex items-start gap-2 rounded-xl bg-success/8 px-3 py-2 text-xs text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-success" />
          <p>密钥仅在服务器端加密后写入 PostgreSQL；页面不会回显完整密钥，模型请求固定发送到 DeepSeek 官方 API。</p>
        </div>
        {config?.canManage ? (
          <Button onClick={() => void save()} disabled={loading || saving || (!config.keyConfigured && !apiKey)} className="sm:justify-self-end">
            <Save data-icon="inline-start" />
            {saving ? "保存中…" : "保存 AI 配置"}
          </Button>
        ) : <p className="text-sm text-muted-foreground">当前账号没有 AI 配置管理权限。</p>}
      </div>
    </section>
  );
}
