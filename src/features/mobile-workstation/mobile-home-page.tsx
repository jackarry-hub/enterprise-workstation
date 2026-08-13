"use client";

import Link from "next/link";
import { ArrowRight, Bell, BriefcaseBusiness, Bot, CheckCircle2, ClipboardCheck, ListChecks, Sparkles } from "lucide-react";
import { useMemo } from "react";

import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { useOperations } from "@/features/operations/use-operations";
import { getEffectiveProjectDetails } from "@/features/projects/data/effective-project-details";
import { approvalMockResult } from "@/features/approvals/approval-mock-data";
import { MobileTaskRow } from "@/features/mobile-workstation/components/mobile-task-row";
import { mergeMobileTasks, mobilePersonalActionFallback, operationTasksForHome, projectTasksForActor } from "@/features/mobile-workstation/mobile-task-data";
import { sortMobileTasksByPriority } from "@/features/mobile-workstation/mobile-priority";

const metrics = [
  { label: "待办任务", href: "/tasks", icon: ListChecks },
  { label: "进行中项目", href: "/projects", icon: BriefcaseBusiness },
  { label: "待审批", href: "/approvals?queue=pending", icon: ClipboardCheck },
  { label: "今日考勤", href: "/attendance?view=self", icon: CheckCircle2 },
] as const;

export function MobileHomePage() {
  const session = useWorkspaceSession();
  const { state, actor } = useOperations(session);
  const tasks = useMemo(() => {
    const active = mergeMobileTasks(
      operationTasksForHome(state.tasks, actor),
      projectTasksForActor(getEffectiveProjectDetails([]), actor),
    ).filter(({ status }) => !["done", "cancelled"].includes(status));
    return sortMobileTasksByPriority(active.length ? active : mobilePersonalActionFallback(actor), "2026-08-13");
  }, [actor, state.tasks]);
  const activeProjects = new Set(tasks.map(({ href }) => href.match(/\/projects\/([^?]+)/)?.[1]).filter(Boolean)).size || 2;
  const pendingApprovalCount = approvalMockResult.data.approvals.filter(({ status, owner }) => status === "pending" && (actor.role === "executive" || owner.displayName === actor.name)).length || 1;
  const values = [tasks.length || 3, activeProjects, pendingApprovalCount, "已打卡"];

  return (
    <main className="mobile-home-page">
      <header className="mobile-home-hero">
        <div className="flex items-center justify-between">
          <h1 className="text-[25px] font-bold tracking-tight text-[#11213d]">企业工作站</h1>
          <Link href="/notifications" aria-label="查看通知" className="mobile-icon-button"><Bell aria-hidden="true" className="size-5" /><span>3</span></Link>
        </div>
        <div className="mt-7">
          <p className="text-[29px] font-bold tracking-tight text-[#13213a]">早上好，{actor.name}</p>
          <p className="mt-1 text-[15px] text-[#6c7d98]">今天有 <strong className="text-primary">{Math.min(tasks.length || 3, 9)}</strong> 项工作需要推进</p>
        </div>
      </header>

      <section aria-label="工作概览" className="mobile-metric-grid">
        {metrics.map(({ label, href, icon: Icon }, index) => <Link key={label} href={href} prefetch={false} aria-label={`${label} ${values[index]}`} className="mobile-metric-card"><span className="mobile-metric-card__icon"><Icon aria-hidden="true" className="size-5" /></span><span><span className="block text-[13px] text-[#65758d]">{label}</span><strong className={index === 3 ? "text-[19px] text-success" : "text-[25px] text-primary"}>{values[index]}</strong></span></Link>)}
      </section>

      {actor.role === "executive" ? (
        <Link href="/decision" prefetch={false} aria-label="进入 AI 决策调度台" className="mobile-decision-entry">
          <span className="mobile-decision-entry__icon"><Bot aria-hidden="true" className="size-6" /></span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-[11px] font-semibold text-primary"><Sparkles aria-hidden="true" className="size-3.5" />CEO 专属</span>
            <strong className="mt-0.5 block text-[17px] text-[#14213a]">AI 决策调度台</strong>
            <span className="mt-0.5 block text-xs text-[#718099]">输入目标，AI 拆解部门与个人任务</span>
          </span>
          <ArrowRight aria-hidden="true" className="size-5 shrink-0 text-primary" />
        </Link>
      ) : null}

      <section className="mt-5">
        <h2 className="mb-3 text-[20px] font-bold text-[#17243d]">今日重点</h2>
        <div className="mobile-list-surface">
          {tasks.slice(0, 3).map((task) => <MobileTaskRow key={task.id} task={task} />)}
        </div>
      </section>

      <Link href="/tasks" prefetch={false} className="mobile-primary-action">查看全部待办</Link>
    </main>
  );
}
