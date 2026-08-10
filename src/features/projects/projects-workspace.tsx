"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { PageHeader } from "@/components/ui/page-header";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { toOperationFixtureActor } from "@/features/operations/operation-actor-compat";
import { CreateProjectDialog } from "@/features/projects/components/create-project-dialog";
import { ProjectAside } from "@/features/projects/components/project-aside";
import { ProjectFilters } from "@/features/projects/components/project-filters";
import { ProjectList } from "@/features/projects/components/project-list";
import { ProjectMobileNav } from "@/features/projects/components/project-mobile-nav";
import { ProjectStats } from "@/features/projects/components/project-stats";
import {
  createLocalProject,
  PROJECTS_CHANGED_EVENT,
  readLocalProjects,
} from "@/features/projects/data/mock-project-repository";
import {
  mergePortfolioStats,
  mergeProjectList,
} from "@/features/projects/data/project-list-operations";
import { filterProjectList } from "@/features/projects/mock-data";
import type {
  CreateMockProjectInput,
  ProjectListFilters,
  ProjectListItem,
  ProjectMilestoneReminder,
  ProjectPortfolioStat,
} from "@/features/projects/types";

const defaultFilters: ProjectListFilters = {
  group: "all",
  query: "",
  status: "all",
  priority: "all",
  ownerId: "all",
  deadline: "all",
};

type ProjectsWorkspaceProps = {
  projects: readonly ProjectListItem[];
  stats: readonly ProjectPortfolioStat[];
  reminders: readonly ProjectMilestoneReminder[];
};

export function ProjectsWorkspace({ projects, stats, reminders }: ProjectsWorkspaceProps) {
  const session = useWorkspaceSession();
  const fixtureActor = toOperationFixtureActor(session);
  const actor = fixtureActor ?? session.actor;
  const isFixtureBound = fixtureActor !== null;
  const router = useRouter();
  const [filters, setFilters] = useState<ProjectListFilters>(defaultFilters);
  const [visibleProjects, setVisibleProjects] = useState<ProjectListItem[]>(isFixtureBound ? [...projects] : []);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const refreshLocalProjects = useCallback(() => {
    setVisibleProjects(isFixtureBound ? mergeProjectList(projects, readLocalProjects()) : []);
  }, [isFixtureBound, projects]);

  useEffect(() => {
    refreshLocalProjects();
    window.addEventListener(PROJECTS_CHANGED_EVENT, refreshLocalProjects);
    return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, refreshLocalProjects);
  }, [refreshLocalProjects]);

  const scopedProjects = useMemo(
    () => actor.role === "executive" ? visibleProjects : visibleProjects.filter(({ owner, members }) => owner.id === actor.memberId || members.some(({ id }) => id === actor.memberId)),
    [actor.memberId, actor.role, visibleProjects],
  );
  const filteredProjects = useMemo(
    () => filterProjectList(scopedProjects, filters),
    [filters, scopedProjects],
  );
  const owners = useMemo(
    () => Array.from(new Map(scopedProjects.map(({ owner }) => [owner.id, owner])).values()),
    [scopedProjects],
  );
  const visibleStats = useMemo(
    () => mergePortfolioStats(stats, projects, scopedProjects),
    [projects, scopedProjects, stats],
  );

  function handleCreateProject(input: CreateMockProjectInput) {
    if (!isFixtureBound) throw new Error("当前真实身份未绑定本地业务夹具");
    const detail = createLocalProject(input);
    refreshLocalProjects();
    router.push(`/projects/${detail.project.id}`);
  }

  return (
    <main className="mx-auto flex w-full max-w-420 flex-col gap-4 px-3 pt-5 pb-26 sm:px-4 lg:px-5 lg:pt-9 lg:pb-6">
      <PageHeader
        title="项目管理中心"
        description="全面掌控项目进展，确保每个项目按时高质量交付"
        actions={(
          <Button type="button" size="lg" disabled={!isFixtureBound} onClick={() => setIsCreateOpen(true)} className="h-10 rounded-xl px-4 shadow-[0_10px_24px_rgba(47,125,246,0.24)]">
            <Plus data-icon="inline-start" aria-hidden="true" />
            新建项目
          </Button>
        )}
      />

      <ProjectStats stats={visibleStats} />

      <div className="grid min-w-0 gap-3 2xl:grid-cols-[minmax(0,1fr)_19rem]">
        <GlassCard className="min-w-0 overflow-hidden p-3 sm:p-4">
          <ProjectFilters
            filters={filters}
            owners={owners}
            onFiltersChange={setFilters}
            onReset={() => setFilters(defaultFilters)}
          />
          <section aria-label="项目组合列表" className="mt-3">
            <ProjectList projects={filteredProjects} />
          </section>
        </GlassCard>
        <ProjectAside reminders={reminders} />
      </div>

      <CreateProjectDialog
        open={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onCreate={handleCreateProject}
      />

      <ProjectMobileNav />
    </main>
  );
}
