"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Plus } from "lucide-react";

import { MobileWorkspaceNav } from "@/components/shell/mobile-workspace-nav";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { GlassCard } from "@/components/ui/glass-card";
import { RealDataNotice } from "@/components/ui/real-data-boundary";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { buildActivityProjectViews } from "@/features/activities/activity-mock-data";
import { ActivityDetail } from "@/features/activities/components/activity-detail";
import { ActivityCalendarDialog } from "@/features/activities/components/activity-calendar-dialog";
import { CreateActivityDialog } from "@/features/activities/components/create-activity-dialog";
import { ActivityList } from "@/features/activities/components/activity-list";
import { ActivityOverview } from "@/features/activities/components/activity-overview";
import { ActivityStats } from "@/features/activities/components/activity-stats";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { useOperations } from "@/features/operations/use-operations";
import { getEffectiveProjectDetails } from "@/features/projects/data/effective-project-details";
import { createLocalProject, PROJECTS_CHANGED_EVENT, readLocalProjects } from "@/features/projects/data/mock-project-repository";
import type { ProjectCollectionResult } from "@/features/projects/data/project-collection-data";
import { mockMembers } from "@/features/projects/mock-data";
import { createBusinessProject } from "@/features/projects/data/business-command-client";
import type { CreateMockProjectInput } from "@/features/projects/types";
import { useWorkspaceRouter } from "@/lib/navigation/use-workspace-router";

const defaultResult: ProjectCollectionResult = {
  details: getEffectiveProjectDetails([]),
  source: "mock",
  viewer: {},
  availableMembers: mockMembers,
};

export function ActivitiesPage({ result = defaultResult, initialSelectedId }: { result?: ProjectCollectionResult; initialSelectedId?: string }) {
  const router = useWorkspaceRouter();
  const session = useWorkspaceSession();
  const { context, actor, isFixtureBound } = useOperations(session);
  const [allActivities, setAllActivities] = useState(() => result.source === "supabase" || isFixtureBound
    ? buildActivityProjectViews(result.details, { syntheticStages: result.source === "mock" })
    : []);
  const activities = result.source === "supabase" || actor.role === "executive"
    ? allActivities
    : allActivities.filter(({ project, members }) => project.ownerId === actor.memberId || members.some(({ member }) => member.id === actor.memberId));
  const [selectedId, setSelectedId] = useState(initialSelectedId ?? allActivities.find(({ project }) => project.name === "新产品发布活动")?.project.id ?? allActivities[0]?.project.id ?? "");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const selectedActivity = activities.find(({ project }) => project.id === selectedId) ?? activities[0];
  const members = result.availableMembers;

  const refreshActivities = useCallback(() => {
    if (result.source === "supabase") {
      setAllActivities(buildActivityProjectViews(result.details, { syntheticStages: false }));
      return;
    }
    setAllActivities(isFixtureBound ? buildActivityProjectViews(getEffectiveProjectDetails(readLocalProjects(context))) : []);
  }, [context, isFixtureBound, result.details, result.source]);
  useEffect(() => {
    refreshActivities();
    if (initialSelectedId) setSelectedId(initialSelectedId);
    if (result.source !== "mock") return;
    window.addEventListener(PROJECTS_CHANGED_EVENT, refreshActivities);
    return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, refreshActivities);
  }, [initialSelectedId, refreshActivities, result.source]);

  const canCreate = result.source === "mock"
    ? isFixtureBound
    : session.permissionCodes.some((permission) => permission === "project.create" || permission === "project.manage" || permission === "organization.manage")
      && members.length > 0;

  async function createActivity(input: CreateMockProjectInput, idempotencyKey: string) {
    if (result.source === "mock") {
      if (!isFixtureBound) throw new Error("当前演示身份未绑定本地业务数据");
      const detail = createLocalProject(context, input, session.actor);
      setSelectedId(detail.project.id);
      refreshActivities();
      return;
    }
    const owner = members.find(({ id }) => id === input.ownerId);
    if (!owner?.employeePublicId) throw new Error("所选负责人缺少有效员工身份，请先完成组织同步");
    const created = await createBusinessProject({
      ownerPublicId: owner.employeePublicId,
      name: input.name,
      category: "企业活动",
      description: input.description,
      startsOn: input.startDate,
      dueOn: input.dueDate,
      budgetAmount: input.budgetAmount ?? "0.00",
      priority: input.priority,
      status: input.status,
      reason: "从活动推进中心创建活动项目",
    }, idempotencyKey);
    router.replace(`/activities?activity=${created.id}`);
    router.refresh();
  }

  if (!selectedActivity) {
    return (
      <main className="mx-auto flex w-full max-w-420 flex-col gap-4 px-3 pt-4 pb-26 sm:px-4 lg:px-5 lg:pt-6 lg:pb-8">
        <PageHeader
          title="活动推进中心"
          description="活动以项目和任务交付为基础，不要求固定工作时间或地点。"
          actions={<div className="flex items-center gap-2"><Button type="button" variant="outline" disabled><CalendarDays aria-hidden="true" />活动日历</Button><Button type="button" disabled={!canCreate} onClick={() => setCreateOpen(true)}><Plus aria-hidden="true" />创建活动</Button></div>}
        />
        <RealDataNotice message="当前账号没有可显示的真实活动数据。" />
        <GlassCard className="p-8 text-center text-sm text-muted-foreground">真实项目数据接入后，相关活动会自动显示在这里。</GlassCard>
        <MobileWorkspaceNav active="work" />
        {members.length > 0 ? <CreateActivityDialog open={createOpen} members={members} onOpenChange={setCreateOpen} onCreate={createActivity} /> : null}
      </main>
    );
  }

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
            <Button type="button" className="rounded-xl px-3.5 shadow-[0_10px_24px_rgba(47,125,246,0.2)]" disabled={!canCreate} onClick={() => setCreateOpen(true)}>
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
          onSelect={(projectId) => {
            setSelectedId(projectId);
            if (window.matchMedia?.("(max-width: 1279px)").matches) setMobileDetailOpen(true);
          }}
        />
        <ActivityDetail activity={selectedActivity} className="hidden xl:grid" />
      </section>
      <Dialog open={mobileDetailOpen} onOpenChange={setMobileDetailOpen}>
        <DialogContent className="h-[100dvh] w-screen max-w-none overflow-y-auto rounded-none xl:hidden">
          <DialogHeader className="pr-10">
            <DialogTitle>{selectedActivity.project.name}</DialogTitle>
            <DialogDescription>活动阶段、任务与关键节点</DialogDescription>
          </DialogHeader>
          <ActivityDetail activity={selectedActivity} />
        </DialogContent>
      </Dialog>
      <ActivityCalendarDialog open={calendarOpen} activities={activities} onOpenChange={setCalendarOpen} />
      <CreateActivityDialog
        open={createOpen}
        members={members}
        onOpenChange={setCreateOpen}
        onCreate={createActivity}
      />
      <MobileWorkspaceNav active="work" />
    </main>
  );
}
