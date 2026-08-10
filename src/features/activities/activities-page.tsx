"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Plus } from "lucide-react";

import { MobileWorkspaceNav } from "@/components/shell/mobile-workspace-nav";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { buildActivityProjectViews } from "@/features/activities/activity-mock-data";
import { ActivityDetail } from "@/features/activities/components/activity-detail";
import { ActivityCalendarDialog } from "@/features/activities/components/activity-calendar-dialog";
import { CreateActivityDialog } from "@/features/activities/components/create-activity-dialog";
import { ActivityList } from "@/features/activities/components/activity-list";
import { ActivityOverview } from "@/features/activities/components/activity-overview";
import { ActivityStats } from "@/features/activities/components/activity-stats";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { toOperationFixtureActor } from "@/features/operations/operation-actor-compat";
import { getEffectiveProjectDetails } from "@/features/projects/data/effective-project-details";
import { PROJECTS_CHANGED_EVENT, readLocalProjects, saveLocalProject } from "@/features/projects/data/mock-project-repository";

export function ActivitiesPage() {
  const session = useWorkspaceSession();
  const auditActor = session.actor;
  const fixtureActor = toOperationFixtureActor(session);
  const actor = fixtureActor ?? auditActor;
  const isFixtureBound = fixtureActor !== null;
  const [allActivities, setAllActivities] = useState(() => isFixtureBound ? buildActivityProjectViews(getEffectiveProjectDetails([])) : []);
  const activities = actor.role === "executive" ? allActivities : allActivities.filter(({ project, members }) => project.ownerId === actor.memberId || members.some(({ member }) => member.id === actor.memberId));
  const [selectedId, setSelectedId] = useState(allActivities.find(({ project }) => project.name === "新产品发布活动")?.project.id ?? allActivities[0]?.project.id ?? "");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const selectedActivity = activities.find(({ project }) => project.id === selectedId) ?? activities[0];
  const members = Array.from(new Map(activities.flatMap(({ owner, members: projectMembers }) => [owner, ...projectMembers.map(({ member }) => member)]).map((member) => [member.id, member])).values());

  const refreshActivities = useCallback(() => setAllActivities(isFixtureBound ? buildActivityProjectViews(getEffectiveProjectDetails(readLocalProjects())) : []), [isFixtureBound]);
  useEffect(() => {
    refreshActivities();
    window.addEventListener(PROJECTS_CHANGED_EVENT, refreshActivities);
    return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, refreshActivities);
  }, [refreshActivities]);

  function createActivity(activity: (typeof allActivities)[number]) {
    if (!isFixtureBound) throw new Error("当前真实身份未绑定本地业务夹具");
    saveLocalProject({ project: activity.project, objective: activity.objective, owner: activity.owner, members: activity.members, milestones: activity.stages, tasks: activity.tasks, comments: [], files: [], dailyReports: [], activities: [{ id: `activity-${Date.now()}`, organizationId: activity.project.organizationId, projectId: activity.project.id, userId: auditActor.id, actionType: "project_created", content: `${auditActor.name}创建了活动“${activity.project.name}”。`, createdAt: activity.project.createdAt }], risks: [], fileRelations: [] });
    setSelectedId(activity.project.id);
  }

  if (!selectedActivity) return null;

  return (
    <main className="mx-auto flex w-full max-w-420 flex-col gap-4 px-3 pt-4 pb-26 sm:px-4 lg:px-5 lg:pt-6 lg:pb-8">
      <PageHeader
        title="活动推进中心"
        description="多维度管理活动执行进度，驱动企业目标持续落地"
        actions={
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" className="rounded-xl bg-background/65" onClick={() => setCalendarOpen(true)}>
              <CalendarDays aria-hidden="true" />
              活动日历
            </Button>
            <Button type="button" className="rounded-xl px-3.5 shadow-[0_10px_24px_rgba(47,125,246,0.2)]" onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden="true" />
              创建活动
            </Button>
          </div>
        }
      />
      <ActivityStats activities={activities} />
      <ActivityOverview activity={selectedActivity} />
      <section className="grid min-w-0 gap-4 xl:grid-cols-12">
        <ActivityList
          activities={activities}
          selectedId={selectedActivity.project.id}
          onSelect={setSelectedId}
        />
        <ActivityDetail activity={selectedActivity} />
      </section>
      <ActivityCalendarDialog open={calendarOpen} activities={activities} onOpenChange={setCalendarOpen} />
      <CreateActivityDialog
        open={createOpen}
        members={members}
        template={selectedActivity}
        onOpenChange={setCreateOpen}
        onCreate={createActivity}
      />
      <MobileWorkspaceNav active="work" />
    </main>
  );
}
