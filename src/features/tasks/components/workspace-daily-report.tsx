"use client";

import { useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Textarea } from "@/components/ui/textarea";
import type { WorkspaceResult } from "@/features/tasks/workspace-types";
import { submitBusinessProjectReport } from "@/features/projects/data/business-command-client";
import { formatDateInputInTimeZone } from "@/lib/date";

export function WorkspaceDailyReport({ result }: { result: WorkspaceResult }) {
  const [report, setReport] = useState(result.data.dailyReport);
  const [feedback, setFeedback] = useState<{ tone: "error" | "success"; message: string } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(result.data.dailyReport.submitted ?? false);
  const attemptRef = useRef<{ signature: string; key: string } | null>(null);
  const unavailable = Boolean(result.data.dailyReportLoadError);

  function updateReport(patch: Partial<typeof report>) {
    setReport((current) => ({ ...current, ...patch }));
    setSubmitted(false);
    setFeedback(null);
  }

  async function saveReport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    if (unavailable) {
      setFeedback({ tone: "error", message: result.data.dailyReportLoadError ?? "今日日报状态暂时无法确认" });
      return;
    }
    if (!report.projectId || !report.todayCompleted.trim() || !report.tomorrowPlan.trim()) {
      setFeedback({ tone: "error", message: "请选择项目，并填写今日完成和明日计划" });
      return;
    }
    if (result.source === "mock") {
      setSubmitted(true);
      setFeedback({ tone: "success", message: "日报已保存到当前工作中心" });
      return;
    }
    const input = {
      reportDate: formatDateInputInTimeZone(),
      summary: report.todayCompleted.trim(),
      nextPlan: report.tomorrowPlan.trim(),
      blockers: report.blockers.trim(),
      supportNeeded: "",
      reason: "从工作中心提交项目日报",
    };
    const signature = JSON.stringify({ projectId: report.projectId, ...input });
    if (attemptRef.current?.signature !== signature) attemptRef.current = { signature, key: crypto.randomUUID() };
    try {
      setIsSubmitting(true);
      setFeedback(null);
      await submitBusinessProjectReport(report.projectId, input, attemptRef.current.key);
      attemptRef.current = null;
      setSubmitted(true);
      setFeedback({ tone: "success", message: "日报已提交并写入项目记录" });
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : "日报提交失败，请稍后重试" });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <GlassCard className="p-5 sm:p-6 xl:col-span-7">
      <div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold text-foreground">工作日报</h2><p className="mt-1 text-xs text-muted-foreground">记录成果、问题和明日计划</p></div><Badge variant={unavailable ? "destructive" : submitted ? "success" : "warning"}>{unavailable ? "状态未知" : submitted ? "已提交" : "待提交"}</Badge></div>
      <form className="mt-5 grid gap-4" onSubmit={saveReport}>
        {unavailable ? <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs font-medium text-destructive">{result.data.dailyReportLoadError}</p> : null}
        <label className="grid gap-1.5 text-sm font-medium text-foreground">关联项目<select disabled={unavailable} value={report.projectId} onChange={(event) => updateReport({ projectId: event.target.value })} className="h-10 rounded-xl border border-input bg-white/70 px-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/30">{result.data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="grid gap-1.5 text-sm font-medium text-foreground">今日完成<Textarea disabled={unavailable} aria-label="今日完成" value={report.todayCompleted} onChange={(event) => updateReport({ todayCompleted: event.target.value })} className="min-h-28 resize-none rounded-2xl bg-white/66" /></label>
          <label className="grid gap-1.5 text-sm font-medium text-foreground">遇到问题<Textarea disabled={unavailable} aria-label="遇到问题" value={report.blockers} onChange={(event) => updateReport({ blockers: event.target.value })} className="min-h-28 resize-none rounded-2xl bg-white/66" /></label>
          <label className="grid gap-1.5 text-sm font-medium text-foreground">明日计划<Textarea disabled={unavailable} aria-label="明日计划" value={report.tomorrowPlan} onChange={(event) => updateReport({ tomorrowPlan: event.target.value })} className="min-h-28 resize-none rounded-2xl bg-white/66" /></label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3"><div>{feedback ? <p role={feedback.tone === "error" ? "alert" : "status"} className={feedback.tone === "error" ? "flex items-center gap-1.5 text-xs font-medium text-destructive" : "flex items-center gap-1.5 text-xs font-medium text-success"}>{feedback.tone === "error" ? <AlertCircle aria-hidden="true" className="size-4" /> : <CheckCircle2 aria-hidden="true" className="size-4" />}{feedback.message}</p> : <p className="text-xs text-muted-foreground">提交后会进入所选项目的日报与动态记录</p>}</div><Button type="submit" disabled={unavailable || isSubmitting || result.data.projects.length === 0} className="rounded-xl"><Send data-icon="inline-start" aria-hidden="true" />{isSubmitting ? "正在提交…" : result.source === "mock" ? "保存日报" : "提交日报"}</Button></div>
      </form>
    </GlassCard>
  );
}
