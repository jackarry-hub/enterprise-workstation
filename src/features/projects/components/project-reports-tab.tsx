"use client";

import { useRef, useState } from "react";
import { AlertCircle, CheckCircle2, FileText, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Textarea } from "@/components/ui/textarea";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import type { ProjectDetailData } from "@/features/projects/types";

export type DailyReportInput = { summary: string; nextPlan: string; blockers: string; supportNeeded: string };

export function ProjectReportsTab({ detail, canSubmit, onSubmit }: { detail: ProjectDetailData; canSubmit: boolean; onSubmit: (input: DailyReportInput, idempotencyKey: string) => void | Promise<void> }) {
  const { actor } = useWorkspaceSession();
  const [value, setValue] = useState<DailyReportInput>({ summary: "", nextPlan: "", blockers: "", supportNeeded: "" });
  const [feedback, setFeedback] = useState<{ tone: "error" | "success"; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const attemptRef = useRef<{ signature: string; key: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    if (!value.summary.trim() || !value.nextPlan.trim()) {
      setFeedback({ tone: "error", message: "请填写今日完成和下一步计划" });
      return;
    }
    const input = { summary: value.summary.trim(), nextPlan: value.nextPlan.trim(), blockers: value.blockers.trim(), supportNeeded: value.supportNeeded.trim() };
    const signature = JSON.stringify(input);
    if (attemptRef.current?.signature !== signature) attemptRef.current = { signature, key: crypto.randomUUID() };
    try {
      setIsSubmitting(true);
      setFeedback(null);
      await onSubmit(input, attemptRef.current.key);
      attemptRef.current = null;
      setValue({ summary: "", nextPlan: "", blockers: "", supportNeeded: "" });
      setFeedback({ tone: "success", message: "日报已提交并写入项目动态" });
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : "日报提交失败，请稍后重试" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
      <GlassCard className="self-start p-5 sm:p-6"><div className="flex items-center gap-2"><FileText className="size-5 text-primary" /><h2 className="text-lg font-semibold">提交项目日报</h2></div><p className="mt-1 text-sm text-muted-foreground">当前提交人：{actor.name}。日报将进入项目动态和复盘依据。</p><form className="mt-5 grid gap-3" onSubmit={submit}><label className="grid gap-1.5 text-sm font-medium">今日完成<Textarea value={value.summary} onChange={(event) => setValue((current) => ({ ...current, summary: event.target.value }))} placeholder="填写已完成的工作和结果" /></label><label className="grid gap-1.5 text-sm font-medium">下一步计划<Textarea value={value.nextPlan} onChange={(event) => setValue((current) => ({ ...current, nextPlan: event.target.value }))} placeholder="填写下一步动作、负责人或时间点" /></label><div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium">阻塞问题<Textarea value={value.blockers} onChange={(event) => setValue((current) => ({ ...current, blockers: event.target.value }))} placeholder="没有可留空" /></label><label className="grid gap-1.5 text-sm font-medium">需要支持<Textarea value={value.supportNeeded} onChange={(event) => setValue((current) => ({ ...current, supportNeeded: event.target.value }))} placeholder="需要谁提供什么支持" /></label></div>{feedback ? <p role={feedback.tone === "error" ? "alert" : "status"} className={feedback.tone === "error" ? "flex items-center gap-1.5 rounded-xl bg-danger-soft px-3 py-2 text-xs font-medium text-destructive" : "flex items-center gap-1.5 rounded-xl bg-success-soft px-3 py-2 text-xs font-medium text-success"}>{feedback.tone === "error" ? <AlertCircle aria-hidden="true" className="size-4" /> : <CheckCircle2 aria-hidden="true" className="size-4" />}{feedback.message}</p> : null}<Button type="submit" disabled={!canSubmit || isSubmitting}><Send />{isSubmitting ? "正在提交…" : "提交日报"}</Button>{!canSubmit ? <p className="text-xs text-muted-foreground">只有项目成员可以提交日报。</p> : null}</form></GlassCard>
      <GlassCard className="p-5 sm:p-6"><div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">日报记录</h2><p className="mt-1 text-sm text-muted-foreground">按日期倒序展示项目进展、阻塞与支持需求。</p></div><Badge variant="info">{detail.dailyReports.length} 篇</Badge></div>{detail.dailyReports.length ? <div className="mt-5 grid gap-3">{detail.dailyReports.map((report) => { const author = detail.members.find(({ member }) => member.id === report.authorId)?.member; return <article key={report.id} className="rounded-2xl border border-border/70 bg-white/55 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><CheckCircle2 className="size-4 text-success" /><h3 className="text-sm font-semibold">{report.reportDate} · {author?.displayName ?? "项目成员"}</h3></div><Badge variant={report.status === "submitted" ? "success" : "warning"}>{report.status === "submitted" ? "已提交" : "草稿"}</Badge></div><div className="mt-3 grid gap-3 text-xs leading-5 sm:grid-cols-2"><div><p className="font-medium text-foreground">今日完成</p><p className="mt-1 text-muted-foreground">{report.summary}</p></div><div><p className="font-medium text-foreground">下一步计划</p><p className="mt-1 text-muted-foreground">{report.nextPlan}</p></div>{report.blockers ? <div><p className="font-medium text-destructive">阻塞</p><p className="mt-1 text-muted-foreground">{report.blockers}</p></div> : null}{report.supportNeeded ? <div><p className="font-medium text-warning">需要支持</p><p className="mt-1 text-muted-foreground">{report.supportNeeded}</p></div> : null}</div></article>; })}</div> : <div className="mt-5 rounded-2xl border border-dashed border-border p-10 text-center"><FileText className="mx-auto size-6 text-muted-foreground" /><p className="mt-2 text-sm font-medium">还没有项目日报</p><p className="mt-1 text-xs text-muted-foreground">提交第一篇日报后会显示在这里。</p></div>}</GlassCard>
    </div>
  );
}
