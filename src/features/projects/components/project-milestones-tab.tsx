import { CalendarCheck2, CalendarClock, CheckCircle2, CircleDashed, Plus } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/ui/status-badge";
import type { Milestone, ProjectDetailData } from "@/features/projects/types";

const milestoneLabels = {
  pending: "待开始",
  in_progress: "进行中",
  completed: "已完成",
  overdue: "已延期",
} as const;

const milestoneTones = {
  pending: "neutral",
  in_progress: "active",
  completed: "success",
  overdue: "warning",
} as const;

function formatDate(date?: string) {
  return date ? date.replaceAll("-", "/") : "待确认";
}

function initials(name: string) {
  return name.slice(-2);
}

type ProjectMilestonesTabProps = {
  detail: ProjectDetailData;
  milestones: readonly Milestone[];
  onCreate: () => void;
};

export function ProjectMilestonesTab({ detail, milestones, onCreate }: ProjectMilestonesTabProps) {
  const completed = milestones.filter(({ status }) => status === "completed").length;
  const inProgress = milestones.filter(({ status }) => status === "in_progress").length;
  const overall = milestones.length === 0
    ? 0
    : Math.round(milestones.reduce((sum, milestone) => sum + milestone.progress, 0) / milestones.length);

  const stats = [
    { label: "阶段总数", value: milestones.length, icon: CalendarCheck2, tone: "blue" },
    { label: "已完成", value: completed, icon: CheckCircle2, tone: "green" },
    { label: "进行中", value: inProgress, icon: CalendarClock, tone: "purple" },
    { label: "整体完成率", value: `${overall}%`, icon: CircleDashed, tone: "orange" },
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <GlassCard className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">里程碑计划</h2>
            <p className="mt-1 text-sm text-muted-foreground">按阶段推进项目，及时识别交付偏差</p>
          </div>
          <Button type="button" onClick={onCreate} className="h-9 rounded-xl px-3 shadow-[0_10px_24px_rgba(47,125,246,0.18)]">
            <Plus data-icon="inline-start" aria-hidden="true" />
            新增里程碑
          </Button>
        </div>
        <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {stats.map(({ label, value, icon: Icon, tone }) => (
            <div key={label} className="flex items-center gap-3 rounded-2xl border border-glass-border bg-background/62 p-4">
              <span className={tone === "green" ? "grid size-10 place-items-center rounded-2xl bg-success-soft text-success" : tone === "purple" ? "grid size-10 place-items-center rounded-2xl bg-chart-3/10 text-chart-3" : tone === "orange" ? "grid size-10 place-items-center rounded-2xl bg-warning-soft text-warning" : "grid size-10 place-items-center rounded-2xl bg-primary/10 text-primary"}>
                <Icon aria-hidden="true" className="size-5" />
              </span>
              <div>
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 text-xl font-semibold text-foreground">{value}</p>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      <GlassCard className="overflow-hidden p-4 sm:p-6">
        {milestones.length > 0 ? (
          <div className="relative flex flex-col">
            <span aria-hidden="true" className="absolute top-8 bottom-8 left-[1.15rem] w-px bg-linear-to-b from-primary via-chart-3/45 to-border sm:left-[1.45rem]" />
            {milestones.map((milestone, index) => {
              const membership = detail.members.find(({ member, id }) => member.id === milestone.ownerId || id === milestone.ownerId);
              const owner = membership?.member ?? detail.owner;
              const isComplete = milestone.status === "completed";

              return (
                <article key={milestone.id} className="relative grid grid-cols-[2.4rem_minmax(0,1fr)] gap-3 pb-4 last:pb-0 sm:grid-cols-[3rem_minmax(0,1fr)] sm:gap-4">
                  <span className={isComplete ? "relative z-10 grid size-9 place-items-center rounded-full bg-success text-white shadow-[0_8px_20px_rgba(18,173,131,0.24)] sm:size-12" : "relative z-10 grid size-9 place-items-center rounded-full border-4 border-background bg-primary text-white shadow-[0_8px_20px_rgba(47,125,246,0.2)] sm:size-12"}>
                    {isComplete ? <CheckCircle2 aria-hidden="true" className="size-4 sm:size-5" /> : <span className="text-xs font-semibold">{String(index + 1).padStart(2, "0")}</span>}
                  </span>
                  <div className="rounded-2xl border border-glass-border bg-background/62 p-4 transition-colors hover:bg-background/82 sm:p-5">
                    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2.5">
                          <h3 className="font-semibold text-foreground">{milestone.name}</h3>
                          <StatusBadge status={milestoneTones[milestone.status]}>{milestoneLabels[milestone.status]}</StatusBadge>
                        </div>
                        <p className="mt-2 text-sm leading-6 text-muted-foreground">{milestone.description || "阶段目标已建立，等待负责人补充详细说明。"}</p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 rounded-xl bg-brand-soft/60 px-3 py-2">
                        <Avatar size="sm" aria-label={owner.displayName}>
                          <AvatarFallback className="bg-white text-[10px] font-semibold text-primary">{initials(owner.displayName)}</AvatarFallback>
                        </Avatar>
                        <span className="text-xs font-medium text-foreground">{owner.displayName}</span>
                      </div>
                    </div>
                    <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(13rem,0.7fr)_minmax(12rem,1fr)] sm:items-center">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <CalendarClock aria-hidden="true" className="size-3.5 text-primary" />
                        <span>{formatDate(milestone.startDate)} - {formatDate(milestone.dueDate)}</span>
                      </div>
                      <div className="flex items-center gap-3">
                        <Progress value={milestone.progress} aria-label={`${milestone.name}完成百分比`} className="h-1.5" />
                        <span className="w-10 text-right text-xs font-semibold text-foreground">{milestone.progress}%</span>
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-glass-border bg-background/45 p-6 text-center">
            <div>
              <CalendarCheck2 aria-hidden="true" className="mx-auto size-8 text-primary" />
              <h3 className="mt-3 font-semibold text-foreground">还没有里程碑</h3>
              <p className="mt-1 text-sm text-muted-foreground">新增第一个阶段，开始推进项目计划。</p>
              <Button type="button" onClick={onCreate} className="mt-4 h-9 rounded-xl">新增里程碑</Button>
            </div>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
