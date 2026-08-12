"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { TaskCenterFiltersCard, RecentTaskActivityCard, TaskScheduleCard } from "@/features/tasks/components/task-center-aside";
import { TaskCenterHero } from "@/features/tasks/components/task-center-hero";
import { TaskCenterList } from "@/features/tasks/components/task-center-list";
import { TaskCenterSummary } from "@/features/tasks/components/task-center-summary";
import { TaskDetailDialog } from "@/features/tasks/components/task-detail-dialog";
import { getEffectiveProjectDetails } from "@/features/projects/data/effective-project-details";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { useOperations } from "@/features/operations/use-operations";
import { PROJECTS_CHANGED_EVENT, readLocalProjects } from "@/features/projects/data/mock-project-repository";
import type { ProjectDetailData } from "@/features/projects/types";
import { createTaskCenterItems, filterTaskCenterItems, getTaskCenterSummary, getUpcomingTaskDeadlines, scopeTaskCenterItems } from "@/features/tasks/task-center-selectors";
import { getTaskCenterAction } from "@/features/tasks/task-center-action";
import type { TaskCenterFilters, TaskCenterItem, TaskCenterTab } from "@/features/tasks/task-center-types";

const defaultFilters: TaskCenterFilters = {
  query: "",
  tab: "all",
  projectId: "all",
  assigneeId: "all",
  priority: "all",
};

export function TaskCenterWorkspace() {
  const session = useWorkspaceSession();
  const { context, actor, isFixtureBound } = useOperations(session);
  const [projects, setProjects] = useState<ProjectDetailData[]>(() => isFixtureBound ? getEffectiveProjectDetails([]) : []);
  const [filters, setFilters] = useState<TaskCenterFilters>(defaultFilters);
  const [selectedItem, setSelectedItem] = useState<TaskCenterItem | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);

  const refreshProjects = useCallback(() => {
    setProjects(isFixtureBound ? getEffectiveProjectDetails(readLocalProjects(context)) : []);
  }, [context, isFixtureBound]);

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
    () => filterTaskCenterItems(items, filters),
    [filters, items],
  );
  const activities = useMemo(
    () => projects
      .flatMap(({ activities: projectActivities }) => projectActivities)
      .filter((activity) => activity.userId === actor.memberId || activity.userId === actor.id)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)),
    [actor.id, actor.memberId, projects],
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
        <div className="xl:col-span-3"><TaskCenterFiltersCard filters={filters} projects={projects.map(({ project }) => project)} onChange={setFilters} onReset={resetFilters} /></div>
      </section>

      <section className="grid min-w-0 gap-3 xl:grid-cols-2">
        <TaskScheduleCard items={getUpcomingTaskDeadlines(items)} />
        <RecentTaskActivityCard activities={activities} />
      </section>

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
