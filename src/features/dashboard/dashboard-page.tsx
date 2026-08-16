"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { DashboardAiDispatch } from "@/features/dashboard/components/dashboard-ai-dispatch";
import {
  DashboardIdentity,
  DashboardProjects,
  DashboardReminders,
  DashboardTasks,
  DashboardToday,
  DashboardValue,
} from "@/features/dashboard/components/dashboard-sections";
import { buildDashboardViewModel } from "@/features/dashboard/dashboard-view-model";
import { useOperations } from "@/features/operations/use-operations";
import { MobileHomePage } from "@/features/mobile-workstation/mobile-home-page";
import { getUnifiedProjectDetails } from "@/features/projects/data/effective-project-details";
import {
  PROJECTS_CHANGED_EVENT,
  readLocalProjects,
} from "@/features/projects/data/mock-project-repository";
import type { ProjectDetailData } from "@/features/projects/types";

export function DashboardPage() {
  const session = useWorkspaceSession();
  const { state, actor, context, isFixtureBound } = useOperations(session);
  const [now] = useState(() => new Date());
  const [isMobile, setIsMobile] = useState(false);
  const [localProjects, setLocalProjects] = useState<ProjectDetailData[]>([]);
  const refreshProjects = useCallback(() => {
    setLocalProjects(isFixtureBound ? readLocalProjects(context) : []);
  }, [context, isFixtureBound]);
  const projects = useMemo(
    () => isFixtureBound ? getUnifiedProjectDetails(localProjects, state) : [],
    [isFixtureBound, localProjects, state],
  );

  useEffect(() => {
    refreshProjects();
    window.addEventListener(PROJECTS_CHANGED_EVENT, refreshProjects);
    return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, refreshProjects);
  }, [refreshProjects]);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia("(max-width: 767px)");
    const sync = () => setIsMobile(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  // Phase 2 explicitly consumes the existing customer-demo/local fixture state.
  // A future Supabase adapter can pass source: "real" without changing the UI components.
  const view = useMemo(() => buildDashboardViewModel({
    session,
    actor,
    state,
    projects,
    now,
    source: "mock",
  }), [actor, now, projects, session, state]);

  if (isMobile) return <MobileHomePage />;

  return (
    <main className="mx-auto flex w-full max-w-[1480px] flex-col gap-4 px-3 pt-4 pb-28 sm:px-5 lg:gap-5 lg:px-6 lg:pt-6 lg:pb-8">
      <DashboardIdentity session={session} identity={view.identity} source={view.source} />

      <div className="grid gap-4 lg:grid-cols-12 lg:gap-5">
        <div className={view.dispatch.canUse ? "lg:col-span-5" : "lg:col-span-12"}>
          <DashboardToday today={view.today} source={view.source} />
        </div>
        {view.dispatch.canUse ? (
          <div className="lg:col-span-7">
            <DashboardAiDispatch dispatch={view.dispatch} context={context} session={session} />
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2 lg:gap-5">
        <DashboardTasks tasks={view.tasks} />
        <DashboardProjects projects={view.projects} />
      </div>

      <div className="grid gap-4 lg:grid-cols-12 lg:gap-5">
        <div className="lg:order-2 lg:col-span-4"><DashboardValue value={view.value} /></div>
        <div className="lg:order-1 lg:col-span-8"><DashboardReminders reminders={view.reminders} source={view.source} /></div>
      </div>
    </main>
  );
}
