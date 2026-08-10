"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, CircleDot, ListChecks, PlayCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { TaskCenterFiltersCard, RecentTaskActivityCard, TaskScheduleCard, TeamCollaborationCard } from "@/features/tasks/components/task-center-aside";
import { TaskCenterHero } from "@/features/tasks/components/task-center-hero";
import { TaskCenterList } from "@/features/tasks/components/task-center-list";
import { TaskCenterSummary } from "@/features/tasks/components/task-center-summary";
import { TaskDetailDialog } from "@/features/tasks/components/task-detail-dialog";
import { getEffectiveProjectDetails } from "@/features/projects/data/effective-project-details";
import { useDemoSession } from "@/features/operations/demo-session";
import { PROJECTS_CHANGED_EVENT, readLocalProjects } from "@/features/projects/data/mock-project-repository";
import type { ProjectDetailData } from "@/features/projects/types";
import { createTaskCenterItems, filterTaskCenterItems, getAssigneeDistribution, getTaskCenterSummary, getUpcomingTaskDeadlines, scopeTaskCenterItems } from "@/features/tasks/task-center-selectors";
import { getTaskCenterAction } from "@/features/tasks/task-center-action";
import type { TaskCenterFilters, TaskCenterItem, TaskCenterTab } from "@/features/tasks/task-center-types";

const defaultFilters: TaskCenterFilters = {
  query: "",
  tab: "all",
  projectId: "all",
  assigneeId: "all",
  priority: "all",
};

const shortcutItems = [
  { tab: "all", label: "全部任务", description: "查看所有项目任务", icon: ListChecks, tone: "text-primary bg-brand-soft" },
  { tab: "pending", label: "待开始", description: "梳理待分配工作", icon: CircleDot, tone: "text-warning bg-warning-soft" },
  { tab: "in_progress", label: "进行中", description: "聚焦当前执行", icon: PlayCircle, tone: "text-chart-3 bg-chart-3/10" },
  { tab: "done", label: "已完成", description: "回顾交付成果", icon: CheckCircle2, tone: "text-success bg-success-soft" },
] as const;

export function TaskCenterWorkspace() {
  const { actor } = useDemoSession();
  const [projects, setProjects] = useState<ProjectDetailData[]>(() => getEffectiveProjectDetails([]));
  const [filters, setFilters] = useState<TaskCenterFilters>(defaultFilters);
  const [selectedItem, setSelectedItem] = useState<TaskCenterItem | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const refreshProjects = useCallback(() => {
    setProjects(getEffectiveProjectDetails(readLocalProjects()));
  }, []);

  useEffect(() => {
    refreshProjects();
    window.addEventListener(PROJECTS_CHANGED_EVENT, refreshProjects);
    return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, refreshProjects);
  }, [refreshProjects]);

  const items = useMemo(
    () => scopeTaskCenterItems(createTaskCenterItems(projects), actor).sort((left, right) => (
      right.task.createdAt.localeCompare(left.task.createdAt)
    )),
    [actor, projects],
  );
  const summary = useMemo(() => getTaskCenterSummary(items, actor.memberId), [actor.memberId, items]);
  const filteredItems = useMemo(
    () => filterTaskCenterItems(items, filters, actor.memberId),
    [actor.memberId, filters, items],
  );
  const assignees = useMemo(
    () => Array.from(new Map(items.flatMap(({ assignee }) => assignee ? [[assignee.id, assignee] as const] : [])).values()),
    [items],
  );
  const activities = useMemo(
    () => projects.flatMap(({ activities: projectActivities }) => projectActivities).sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [projects],
  );
  const roleAction = getTaskCenterAction(actor.role);

  function resetFilters() {
    setFilters(defaultFilters);
  }

  function selectTab(tab: TaskCenterTab) {
    setFilters((current) => ({ ...current, tab }));
  }

  function openTask(item: TaskCenterItem) {
    setSelectedItem(item);
    setIsDetailOpen(true);
  }

  return (
    <main className="mx-auto flex w-full max-w-420 flex-col gap-3 px-3 pt-4 pb-26 sm:px-4 lg:px-5 lg:pt-6 lg:pb-8">
      <TaskCenterHero
        query={filters.query}
        onQueryChange={(query) => setFilters((current) => ({ ...current, query }))}
      />

      <section className="grid min-w-0 gap-3 xl:grid-cols-12">
        <div className="xl:col-span-4"><TaskCenterSummary items={items} summary={summary} onShowPending={() => selectTab("pending")} /></div>
        <div className="xl:col-span-5"><TaskCenterList items={filteredItems} summary={summary} tab={filters.tab} onTabChange={selectTab} onOpenTask={openTask} onReset={resetFilters} /></div>
        <div className="xl:col-span-3"><TaskCenterFiltersCard filters={filters} projects={projects.map(({ project }) => project)} assignees={assignees} onChange={setFilters} onReset={resetFilters} /></div>
      </section>

      <section className={actor.role === "department_head" ? "grid min-w-0 gap-3 xl:grid-cols-3" : "grid min-w-0 gap-3 xl:grid-cols-2"}>
        {actor.role === "department_head" ? <TeamCollaborationCard distribution={getAssigneeDistribution(items)} /> : null}
        <TaskScheduleCard items={getUpcomingTaskDeadlines(items)} />
        <RecentTaskActivityCard activities={actor.role === "department_head" ? activities : activities.filter((activity) => activity.userId === actor.memberId || activity.userId === actor.id)} />
      </section>

      <GlassCard className="p-3 sm:p-4">
        <h2 className="mb-3 text-base font-semibold">常用入口</h2>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {shortcutItems.map(({ tab, label, description, icon: Icon, tone }) => (
            <Button key={tab} type="button" variant="outline" onClick={() => selectTab(tab)} className="h-auto justify-start rounded-2xl border-border/70 bg-white/55 p-3 text-left">
              <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${tone}`}><Icon aria-hidden="true" className="size-5" /></span>
              <span><span className="block font-medium">{label}</span><span className="mt-0.5 block text-xs font-normal text-muted-foreground">{description}</span></span>
            </Button>
          ))}
        </div>
      </GlassCard>

      <TaskDetailDialog
        item={selectedItem}
        open={isDetailOpen}
        onOpenChange={setIsDetailOpen}
        actionHref={roleAction.href}
        actionLabel={roleAction.label}
      />
    </main>
  );
}
