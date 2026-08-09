"use client";

import { useState } from "react";
import { CheckCircle2, Send } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Textarea } from "@/components/ui/textarea";
import type { WorkspaceResult } from "@/features/tasks/workspace-types";

export function WorkspaceDailyReport({ result }: { result: WorkspaceResult }) {
  const [report, setReport] = useState(result.data.dailyReport);
  const [savedMessage, setSavedMessage] = useState("");

  function saveReport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavedMessage(result.source === "mock" ? "日报已保存到当前工作中心" : "日报已保存");
  }

  return (
    <GlassCard className="p-5 sm:p-6 xl:col-span-7">
      <div className="flex items-start justify-between gap-4"><div><h2 className="font-semibold text-foreground">工作日报</h2><p className="mt-1 text-xs text-muted-foreground">记录成果、问题和明日计划</p></div><Badge variant="warning">待提交</Badge></div>
      <form className="mt-5 grid gap-4" onSubmit={saveReport}>
        <label className="grid gap-1.5 text-sm font-medium text-foreground">关联项目<select value={report.projectId} onChange={(event) => setReport((current) => ({ ...current, projectId: event.target.value }))} className="h-10 rounded-xl border border-input bg-white/70 px-3 text-sm outline-none focus:border-ring focus:ring-3 focus:ring-ring/30">{result.data.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="grid gap-1.5 text-sm font-medium text-foreground">今日完成<Textarea aria-label="今日完成" value={report.todayCompleted} onChange={(event) => setReport((current) => ({ ...current, todayCompleted: event.target.value }))} className="min-h-28 resize-none rounded-2xl bg-white/66" /></label>
          <label className="grid gap-1.5 text-sm font-medium text-foreground">遇到问题<Textarea aria-label="遇到问题" value={report.blockers} onChange={(event) => setReport((current) => ({ ...current, blockers: event.target.value }))} className="min-h-28 resize-none rounded-2xl bg-white/66" /></label>
          <label className="grid gap-1.5 text-sm font-medium text-foreground">明日计划<Textarea aria-label="明日计划" value={report.tomorrowPlan} onChange={(event) => setReport((current) => ({ ...current, tomorrowPlan: event.target.value }))} className="min-h-28 resize-none rounded-2xl bg-white/66" /></label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3"><div>{savedMessage ? <p role="status" className="flex items-center gap-1.5 text-xs font-medium text-success"><CheckCircle2 aria-hidden="true" className="size-4" />{savedMessage}</p> : <p className="text-xs text-muted-foreground">正式项目日报请在项目详情的“日报”页提交</p>}</div><Button type="submit" className="rounded-xl"><Send data-icon="inline-start" aria-hidden="true" />保存日报</Button></div>
      </form>
    </GlassCard>
  );
}
