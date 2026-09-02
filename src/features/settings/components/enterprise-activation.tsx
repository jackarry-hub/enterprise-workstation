"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Bot, Building2, CheckCircle2, UsersRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type InitializationState = {
  status: string;
  canInitialize: boolean;
  companyName: string;
  shortName: string;
  industry: string;
  description: string;
  timezone: string;
  departmentCount: number;
  positionCount: number;
  skillCount: number;
};

const emptyState: InitializationState = {
  status: "loading",
  canInitialize: false,
  companyName: "",
  shortName: "",
  industry: "",
  description: "",
  timezone: "Asia/Shanghai",
  departmentCount: 0,
  positionCount: 0,
  skillCount: 0,
};

function parsed(value: unknown): InitializationState | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.status !== "string") return null;
  return {
    status: row.status,
    canInitialize: row.canInitialize === true,
    companyName: typeof row.companyName === "string" ? row.companyName : "",
    shortName: typeof row.shortName === "string" ? row.shortName : "",
    industry: typeof row.industry === "string" ? row.industry : "",
    description: typeof row.description === "string" ? row.description : "",
    timezone: typeof row.timezone === "string" && row.timezone ? row.timezone : "Asia/Shanghai",
    departmentCount: Number.isSafeInteger(row.departmentCount) ? Number(row.departmentCount) : 0,
    positionCount: Number.isSafeInteger(row.positionCount) ? Number(row.positionCount) : 0,
    skillCount: Number.isSafeInteger(row.skillCount) ? Number(row.skillCount) : 0,
  };
}

export function EnterpriseActivation() {
  const [state, setState] = useState<InitializationState>(emptyState);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/workstation/enterprise-initialization", { cache: "no-store" });
        const next = parsed(await response.json());
        if (!response.ok || !next) throw new Error("load_failed");
        setState(next);
      } catch {
        setState((current) => ({ ...current, status: "unavailable" }));
        setFeedback("企业启用状态暂不可用，请稍后刷新。");
      }
    })();
  }, []);

  async function initialize() {
    if (pending || !state.companyName.trim() || !state.shortName.trim() || !state.industry.trim()) return;
    setPending(true);
    setFeedback("正在创建部门、岗位和技能基础模板…");
    try {
      const response = await fetch("/api/workstation/enterprise-initialization", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          companyName: state.companyName,
          shortName: state.shortName,
          industry: state.industry,
          description: state.description,
          timezone: state.timezone,
        }),
      });
      const next = parsed(await response.json());
      if (!response.ok || !next) throw new Error("initialize_failed");
      setState(next);
      setFeedback("企业模板已落库，可继续导入飞书员工。");
    } catch {
      setFeedback("启用失败，请检查企业信息或稍后重试。");
    } finally {
      setPending(false);
    }
  }

  if (state.status === "ready") {
    return <section aria-labelledby="enterprise-activation-title" className="mb-6 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4">
      <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-emerald-100 text-emerald-700"><CheckCircle2 className="size-5" /></span><div className="min-w-0 flex-1"><h2 id="enterprise-activation-title" className="font-semibold">企业基础模板已启用</h2><p className="mt-1 text-sm text-muted-foreground">{state.departmentCount} 个部门 · {state.positionCount} 个岗位 · {state.skillCount} 项技能，均来自工作区数据库。</p></div></div>
      <div className="mt-4 flex flex-wrap gap-2"><Button asChild variant="outline"><Link href="/people"><UsersRound data-icon="inline-start" />去同步飞书员工</Link></Button><Button asChild variant="outline"><Link href="/agents"><Bot data-icon="inline-start" />配置 Agent 工作流</Link></Button></div>
      {feedback ? <p role="status" className="mt-3 text-xs text-muted-foreground">{feedback}</p> : null}
    </section>;
  }

  if (state.status === "loading") return <p role="status" className="mb-6 text-sm text-muted-foreground">正在检查企业启用状态…</p>;
  if (!state.canInitialize) return <section className="mb-6 rounded-2xl border p-4"><h2 className="font-semibold">企业尚未完成初始化</h2><p className="mt-1 text-sm text-muted-foreground">请由企业所有者填写基础信息并启用工作区。</p>{feedback ? <p role="status" className="mt-2 text-xs text-destructive">{feedback}</p> : null}</section>;

  const patch = (next: Partial<InitializationState>) => setState((current) => ({ ...current, ...next }));
  return <section aria-labelledby="enterprise-activation-title" className="mb-6 rounded-2xl border bg-brand-soft/40 p-4">
    <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><Building2 className="size-5" /></span><div><h2 id="enterprise-activation-title" className="font-semibold">启用新企业工作区</h2><p className="mt-1 text-sm text-muted-foreground">先建立真实部门、岗位和技能模板，再从飞书全量导入员工。</p></div></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="grid gap-1 text-xs font-medium">企业名称<Input aria-label="企业名称" maxLength={120} value={state.companyName} onChange={(event) => patch({ companyName: event.target.value })} /></label><label className="grid gap-1 text-xs font-medium">企业简称<Input aria-label="企业简称" maxLength={80} value={state.shortName} onChange={(event) => patch({ shortName: event.target.value })} /></label><label className="grid gap-1 text-xs font-medium">所属行业<Input aria-label="所属行业" maxLength={120} value={state.industry} onChange={(event) => patch({ industry: event.target.value })} /></label><label className="grid gap-1 text-xs font-medium">所在时区<select aria-label="所在时区" className="h-10 rounded-xl border bg-background px-3 text-sm" value={state.timezone} onChange={(event) => patch({ timezone: event.target.value })}><option value="Asia/Shanghai">Asia/Shanghai</option><option value="Asia/Singapore">Asia/Singapore</option></select></label></div>
    <label className="mt-3 grid gap-1 text-xs font-medium">企业说明<Textarea aria-label="企业说明" rows={3} maxLength={1_000} value={state.description} onChange={(event) => patch({ description: event.target.value })} /></label>
    {feedback ? <p role="status" className="mt-3 text-xs text-muted-foreground">{feedback}</p> : null}
    <div className="mt-4 flex justify-end"><Button data-network-write="true" disabled={pending || !state.companyName.trim() || !state.shortName.trim() || !state.industry.trim()} onClick={() => void initialize()}>{pending ? "启用中…" : "启用企业基础模板"}</Button></div>
  </section>;
}
