"use client";

import Link from "next/link";
import { ArrowRight, Bell, Bot, ChevronRight, Play, Sparkles } from "lucide-react";
import { useMemo } from "react";

import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { DashboardAvatar } from "@/features/dashboard/components/dashboard-avatar";
import { DashboardDispatchProgress } from "@/features/dashboard/components/dashboard-dispatch-progress";
import { buildDashboardViewModel } from "@/features/dashboard/dashboard-view-model";
import { MobileTaskRow } from "@/features/mobile-workstation/components/mobile-task-row";
import {
  mergeMobileTasks,
  operationTasksForHome,
  projectTasksForActor,
} from "@/features/mobile-workstation/mobile-task-data";
import { sortMobileTasksByPriority } from "@/features/mobile-workstation/mobile-priority";
import { useOperations } from "@/features/operations/use-operations";
import { getUnifiedProjectDetails } from "@/features/projects/data/effective-project-details";

export function MobileHomePage() {
  const session = useWorkspaceSession();
  const { state, actor } = useOperations(session);
  const projects = useMemo(() => getUnifiedProjectDetails([], state), [state]);
  const tasks = useMemo(() => {
    const active = mergeMobileTasks(
      operationTasksForHome(state, actor),
      projectTasksForActor(projects, actor).filter(({ initiatedByViewer }) => !initiatedByViewer),
    ).filter(({ status, title }) => !["done", "cancelled"].includes(status) && !/考勤|打卡|迟到|早退/.test(title));
    return sortMobileTasksByPriority(active, "2026-08-14");
  }, [actor, projects, state]);
  const view = useMemo(() => buildDashboardViewModel({
    session,
    actor,
    state,
    projects,
    now: new Date("2026-08-14T09:00:00+08:00"),
    source: "mock",
  }), [actor, projects, session, state]);
  const currentTask = tasks.find(({ href }) => href.startsWith("/execution")) ?? tasks[0];

  return (
    <main className="mobile-home-page">
      <header className="mobile-home-hero">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-[24px] font-bold tracking-tight text-[#11213d]">量子智枢</h1>
            <p className="mt-0.5 text-[10px] font-semibold tracking-[0.16em] text-[#7e8da5]">QUANTNEXUS</p>
          </div>
          <Link href="/notifications" aria-label="查看通知" className="mobile-icon-button">
            <Bell aria-hidden="true" className="size-5" />
            <span>{Math.min(Math.max(view.reminders.length, 1), 9)}</span>
          </Link>
        </div>

        <div className="mt-6 flex items-center gap-3.5">
          <DashboardAvatar session={session} className="size-[68px] sm:size-[68px]" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[25px] font-bold tracking-tight text-[#13213a]">{view.identity.name}</p>
            <p className="mt-0.5 truncate text-[13px] text-[#6c7d98]">{view.identity.titleLine}</p>
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white bg-white/80 px-2.5 py-1 text-[11px] font-semibold text-[#43516a]">
              <span aria-hidden="true" className="size-2 rounded-full bg-success" />
              {view.identity.statusLabel}
            </span>
          </div>
        </div>
      </header>

      {view.dispatch.canUse ? (
        <Link
          href="/decision"
          prefetch={false}
          aria-label="进入 AI 调度中心"
          className="mobile-decision-entry"
        >
          <span className="mobile-decision-entry__icon"><Bot aria-hidden="true" className="size-6" /></span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-primary"><Sparkles aria-hidden="true" className="size-3.5" />AI 企业大脑</span>
            <strong className="mt-0.5 block text-[17px] text-[#14213a]">AI 调度中心</strong>
            <span className="mt-0.5 block text-xs text-[#718099]">下达目标，生成可确认的执行计划</span>
          </span>
          <ArrowRight aria-hidden="true" className="size-5 shrink-0 text-primary" />
        </Link>
      ) : currentTask ? (
        <Link
          href={currentTask.href}
          prefetch={false}
          aria-label="继续当前任务"
          className="mobile-decision-entry"
        >
          <span className="mobile-decision-entry__icon"><Play aria-hidden="true" className="size-6" /></span>
          <span className="min-w-0 flex-1">
            <span className="text-[11px] font-semibold text-primary">当前个人任务</span>
            <strong className="mt-0.5 block truncate text-[17px] text-[#14213a]">{currentTask.title}</strong>
            <span className="mt-0.5 block text-xs text-[#718099]">进度 {currentTask.progress}% · 截止 {currentTask.dueDate.slice(5)}</span>
          </span>
          <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-primary" />
        </Link>
      ) : null}

      {view.dispatch.canUse && view.dispatch.current ? (
        <DashboardDispatchProgress current={view.dispatch.current} />
      ) : null}

      <section aria-labelledby="mobile-today-title">
        <div className="mobile-section-heading">
          <h2 id="mobile-today-title">今日重点</h2>
          <Link href="/tasks" prefetch={false}>全部任务 <ChevronRight aria-hidden="true" className="inline size-3.5" /></Link>
        </div>
        <div className="mobile-list-surface">
          {tasks.length ? tasks.slice(0, 3).map((task) => <MobileTaskRow key={task.id} task={task} />) : (
            <p className="mobile-empty-state">今天暂时没有待处理事项</p>
          )}
        </div>
      </section>

      <div className="mobile-fixed-action">
        <Link href={view.dispatch.canUse ? "/decision" : currentTask?.href ?? "/tasks"} prefetch={false}>
          {view.dispatch.canUse ? "下达新目标" : "查看我的任务"}
          <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </main>
  );
}
