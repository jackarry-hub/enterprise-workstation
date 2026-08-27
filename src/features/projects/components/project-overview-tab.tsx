import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CircleDot,
  Gauge,
  History,
  Target,
  UsersRound,
  UserCog,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { ProjectActivity, ProjectDetailData } from "@/features/projects/types";
import { formatDateInputInTimeZone } from "@/lib/date";

function initials(name: string) {
  return name.slice(-2);
}

function formatActivityTime(date: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(date));
}

function activityIcon(activity: ProjectActivity) {
  if (activity.actionType === "task_updated" || activity.actionType === "milestone_updated") {
    return CheckCircle2;
  }
  if (activity.actionType === "risk_updated") {
    return AlertTriangle;
  }
  return History;
}

export function ProjectOverviewTab({ detail, canManage = false, onManageMembers }: { detail: ProjectDetailData; canManage?: boolean; onManageMembers?: () => void }) {
  const completedTasks = detail.tasks.filter(({ status }) => status === "done").length;
  const taskCompletion = detail.tasks.length === 0
    ? 0
    : Math.round((completedTasks / detail.tasks.length) * 100);
  const activeRisks = detail.risks.filter(({ status }) => status !== "closed" && status !== "mitigated").length;
  const today = formatDateInputInTimeZone();
  const delayedCount = detail.milestones.filter(({ dueDate, status }) => dueDate < today && status !== "completed").length
    + detail.tasks.filter(({ dueDate, status }) => dueDate && dueDate < today && status !== "done" && status !== "cancelled").length;

  const healthMetrics = [
    { label: "项目进度", value: `${detail.project.progress}%`, hint: "整体推进", icon: Gauge, tone: "blue" },
    { label: "任务完成率", value: `${taskCompletion}%`, hint: `${completedTasks}/${detail.tasks.length} 已完成`, icon: CheckCircle2, tone: "green" },
    { label: "风险数量", value: String(activeRisks), hint: activeRisks > 0 ? "需要持续关注" : "暂无活跃风险", icon: AlertTriangle, tone: "orange" },
    { label: "延期情况", value: String(delayedCount), hint: delayedCount > 0 ? "存在延期事项" : "按计划推进", icon: ArrowUpRight, tone: "purple" },
  ] as const;

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(20rem,0.75fr)]">
      <div className="flex min-w-0 flex-col gap-4">
        <GlassCard className="p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Target aria-hidden="true" className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold text-foreground">项目目标</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">目标对齐与项目说明</p>
            </div>
          </div>
          <div className="mt-5 rounded-2xl border border-primary/10 bg-linear-to-br from-brand-soft/75 to-background/70 p-4 sm:p-5">
            <h3 className="text-base font-semibold text-foreground">
              {detail.objective?.title ?? `高质量完成${detail.project.name}`}
            </h3>
            <p className="mt-2 text-sm leading-7 text-muted-foreground">
              {detail.objective?.description ?? detail.project.description}
            </p>
            <div className="mt-4 border-t border-glass-border pt-4">
              <p className="text-xs font-medium text-muted-foreground">项目描述</p>
              <p className="mt-1.5 text-sm leading-6 text-foreground/80">{detail.project.description}</p>
            </div>
          </div>
        </GlassCard>

        <GlassCard className="p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-2xl bg-success-soft text-success">
              <Gauge aria-hidden="true" className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold text-foreground">项目健康状态</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">进度、交付与风险综合监控</p>
            </div>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {healthMetrics.map(({ label, value, hint, icon: Icon, tone }) => (
              <div key={label} className="rounded-2xl border border-glass-border bg-background/65 p-4">
                <div className={tone === "green" ? "text-success" : tone === "orange" ? "text-warning" : tone === "purple" ? "text-chart-3" : "text-primary"}>
                  <Icon aria-hidden="true" className="size-5" />
                </div>
                <p className="mt-4 text-xs text-muted-foreground">{label}</p>
                <p className="mt-1 text-2xl font-semibold tracking-tight text-foreground">{value}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex items-center gap-3 rounded-2xl bg-brand-soft/70 px-4 py-3">
            <span className="text-xs font-medium text-muted-foreground">项目总体进度</span>
            <Progress value={detail.project.progress} aria-label="项目总体进度" className="h-1.5" />
            <span className="text-xs font-semibold text-primary">{detail.project.progress}%</span>
          </div>
        </GlassCard>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <GlassCard className="p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-2xl bg-chart-3/10 text-chart-3">
              <UsersRound aria-hidden="true" className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold text-foreground">项目成员</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">共 {detail.members.length} 位协作成员</p>
            </div>
            {canManage && onManageMembers ? <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={onManageMembers}><UserCog />管理</Button> : null}
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {detail.members.map(({ id, member, role }) => (
              <div key={id} className="flex items-center gap-3 rounded-2xl border border-transparent px-2 py-2.5 hover:border-glass-border hover:bg-background/55">
                <Avatar size="lg" aria-label={member.displayName}>
                  {member.avatarUrl ? <AvatarImage src={member.avatarUrl} alt="" /> : null}
                  <AvatarFallback className="bg-linear-to-br from-brand-soft to-background text-xs font-semibold text-primary">
                    {initials(member.displayName)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-foreground">{member.displayName}</p>
                    {role === "owner" ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">负责人</span> : null}
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{member.department} · {member.title}</p>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="flex min-h-72 flex-1 flex-col p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-2xl bg-warning-soft text-warning">
              <History aria-hidden="true" className="size-5" />
            </span>
            <div>
              <h2 className="font-semibold text-foreground">项目动态</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">最近项目操作记录</p>
            </div>
          </div>
          {detail.activities.length > 0 ? (
            <div className="mt-5 flex flex-col">
              {detail.activities.slice(0, 6).map((activity, index) => {
                const Icon = activityIcon(activity);
                return (
                  <div key={activity.id} className="relative flex gap-3 pb-5 last:pb-0">
                    {index < Math.min(detail.activities.length, 6) - 1 ? <span aria-hidden="true" className="absolute top-7 bottom-0 left-3.5 w-px bg-border" /> : null}
                    <span className="relative z-10 grid size-7 shrink-0 place-items-center rounded-full border border-primary/15 bg-background text-primary">
                      <Icon aria-hidden="true" className="size-3.5" />
                    </span>
                    <div className="min-w-0 pt-0.5">
                      <p className="text-sm leading-5 text-foreground/85">{activity.content}</p>
                      <p className="mt-1 text-[11px] text-muted-foreground">{formatActivityTime(activity.createdAt)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="mt-6 grid flex-1 place-items-center rounded-2xl border border-dashed border-glass-border bg-background/40 p-6 text-center">
              <div>
                <CircleDot aria-hidden="true" className="mx-auto size-6 text-muted-foreground" />
                <p className="mt-2 text-sm font-medium text-foreground">暂无项目动态</p>
                <p className="mt-1 text-xs text-muted-foreground">后续操作记录会显示在这里</p>
              </div>
            </div>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
