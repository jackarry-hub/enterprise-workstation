"use client";

import Link from "next/link";
import { CalendarDays, ChevronRight, Search } from "lucide-react";
import { useState } from "react";

import type { ProjectListItem, ProjectMilestoneReminder, ProjectPortfolioStat } from "@/features/projects/types";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { useOperations } from "@/features/operations/use-operations";

const statusLabels = { planning: "规划中", active: "执行中", on_hold: "已暂停", completed: "已完成", cancelled: "已取消" } as const;

export function MobileProjectsPage({ projects }: { projects: readonly ProjectListItem[]; stats: readonly ProjectPortfolioStat[]; reminders: readonly ProjectMilestoneReminder[] }) {
  const session = useWorkspaceSession();
  const { actor } = useOperations(session);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const scoped = actor.role === "executive" ? projects : projects.filter(({ owner, members }) => owner.id === actor.memberId || members.some(({ id }) => id === actor.memberId));
  const visible = scoped.filter(({ name, code }) => `${name} ${code}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return (
    <main className="mobile-page">
      <header className="mobile-page-header"><div><h1>项目</h1><p>清楚掌握正在推进的工作</p></div><button type="button" aria-label="搜索项目" aria-expanded={searchOpen} onClick={() => setSearchOpen((value) => !value)} className="mobile-icon-button"><Search aria-hidden="true" className="size-5" /></button></header>
      {searchOpen ? <label className="mobile-search-field"><Search aria-hidden="true" className="size-4" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目名称或编号" aria-label="项目关键词" /></label> : null}
      <section aria-label="项目列表" className="mt-3 space-y-3">
        {visible.slice(0, 4).map((project) => (
          <Link data-testid="mobile-project-card" key={project.id} href={`/projects/${project.id}`} prefetch={false} aria-label={`查看${project.name}详情`} className="mobile-project-card">
            <span className="flex items-start justify-between gap-3"><span className="min-w-0"><strong className="block truncate text-[16px] text-[#16233d]">{project.name}</strong><span className="mt-1 block text-xs text-[#75849b]">{statusLabels[project.status]} · {project.owner.displayName}</span></span><ChevronRight aria-hidden="true" className="mt-1 size-4 shrink-0 text-[#718099]" /></span>
            <span className="mt-4 flex items-center justify-between text-xs text-[#718099]"><span className="flex items-center gap-1"><CalendarDays aria-hidden="true" className="size-3.5" />截止 {project.dueDate.slice(5)}</span><strong className="text-primary">{project.progress}%</strong></span>
            <span role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={project.progress} aria-label={`${project.name}进度`} className="mobile-progress-track"><span style={{ width: `${project.progress}%` }} /></span>
          </Link>
        ))}
        {!visible.length ? <p className="mobile-empty-state">没有找到相关项目</p> : null}
      </section>
    </main>
  );
}
