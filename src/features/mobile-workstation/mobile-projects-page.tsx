"use client";

import { Search } from "lucide-react";
import { useMemo, useState } from "react";

import type { ProjectListItem, ProjectMilestoneReminder, ProjectPortfolioStat } from "@/features/projects/types";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { useOperations } from "@/features/operations/use-operations";
import { MobileProjectCard } from "@/features/mobile-workstation/components/mobile-project-card";
import { getUnifiedProjectDetails } from "@/features/projects/data/effective-project-details";
import { readLocalProjects } from "@/features/projects/data/mock-project-repository";
import { mergeProjectList } from "@/features/projects/data/project-list-operations";

type ProjectTab = "all" | "active" | "completed" | "on_hold";
const projectTabs: Array<{ key: ProjectTab; label: string }> = [
  { key: "all", label: "全部" },
  { key: "active", label: "进行中" },
  { key: "completed", label: "已完成" },
  { key: "on_hold", label: "已暂停" },
];

export function MobileProjectsPage({ projects }: { projects: readonly ProjectListItem[]; stats: readonly ProjectPortfolioStat[]; reminders: readonly ProjectMilestoneReminder[] }) {
  const session = useWorkspaceSession();
  const { actor, context, isFixtureBound, state } = useOperations(session);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<ProjectTab>("all");
  const unifiedProjects = useMemo(() => {
    if (!isFixtureBound) return [...projects];
    return mergeProjectList(
      projects,
      getUnifiedProjectDetails(readLocalProjects(context), state),
    );
  }, [context, isFixtureBound, projects, state]);
  const visible = useMemo(() => {
    const scoped = actor.role === "executive" ? unifiedProjects : unifiedProjects.filter(({ owner, members }) => owner.id === actor.memberId || members.some(({ id }) => id === actor.memberId));
    return scoped.filter((project) => (tab === "all" || project.status === tab)
      && `${project.name} ${project.code}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  }, [actor.memberId, actor.role, query, tab, unifiedProjects]);
  return (
    <main className="mobile-page">
      <header className="mobile-page-header"><div><h1>项目</h1><p>清楚掌握正在推进的工作</p></div><button type="button" aria-label="搜索项目" aria-expanded={searchOpen} onClick={() => setSearchOpen((value) => !value)} className="mobile-icon-button"><Search aria-hidden="true" className="size-5" /></button></header>
      {searchOpen ? <label className="mobile-search-field"><Search aria-hidden="true" className="size-4" /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目名称或编号" aria-label="项目关键词" /></label> : null}
      <div role="tablist" aria-label="项目状态" className="mobile-filter-tabs mt-3">
        {projectTabs.map(({ key, label }) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>)}
      </div>
      <section aria-label="项目列表" className="mt-3 space-y-3">
        {visible.slice(0, 4).map((project) => <MobileProjectCard key={project.id} project={project} />)}
        {!visible.length ? <p className="mobile-empty-state">没有找到相关项目</p> : null}
      </section>
    </main>
  );
}
