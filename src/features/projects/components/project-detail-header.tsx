import { useState } from "react";
import {
  CalendarRange,
  Clock3,
  FolderKanban,
  MoreHorizontal,
  PencilLine,
  Plus,
  Archive,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarGroup, AvatarGroupCount, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { GlassCard } from "@/components/ui/glass-card";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ProjectDetailData } from "@/features/projects/types";

const statusLabels = {
  planning: "规划中",
  active: "进行中",
  on_hold: "已暂停",
  completed: "已完成",
  cancelled: "已取消",
} as const;

const statusTones = {
  planning: "neutral",
  active: "active",
  on_hold: "warning",
  completed: "success",
  cancelled: "neutral",
} as const;

function initials(name: string) {
  return name.slice(-2);
}

function formatDate(date: string) {
  return date.replaceAll("-", "/");
}

type ProjectDetailHeaderProps = {
  detail: ProjectDetailData;
  onAddTask: () => void;
  onEdit: () => void;
  canManage?: boolean;
  onArchive?: () => void;
};

export function ProjectDetailHeader({ detail, onAddTask, onEdit, onArchive, canManage = true }: ProjectDetailHeaderProps) {
  const [feedback, setFeedback] = useState("");
  const visibleMembers = detail.members.slice(0, 3);
  const hiddenMemberCount = Math.max(detail.members.length - visibleMembers.length, 0);

  return (
    <GlassCard className="relative overflow-hidden p-4 sm:p-5 lg:p-6">
      <div aria-hidden="true" className="pointer-events-none absolute -top-24 right-8 size-60 rounded-full bg-primary/8 blur-3xl" />
      <div className="relative flex flex-col gap-5 2xl:flex-row 2xl:items-center">
        <section className="flex min-w-0 flex-1 items-start gap-4">
          <div className="grid size-13 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-primary to-chart-5 text-primary-foreground shadow-[0_14px_30px_rgba(47,125,246,0.25)] sm:size-16">
            <FolderKanban aria-hidden="true" className="size-6 sm:size-7" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl lg:text-[1.7rem]">
                {detail.project.name}
              </h1>
              <StatusBadge status={statusTones[detail.project.status]}>
                {statusLabels[detail.project.status]}
              </StatusBadge>
            </div>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {detail.project.description}
            </p>
            <p className="mt-2 text-xs font-medium tracking-wide text-primary">
              {detail.project.code}
            </p>
          </div>
        </section>

        <section aria-label="项目关键信息" className="grid gap-3 sm:grid-cols-2 2xl:w-146 2xl:grid-cols-[1.1fr_1.35fr_1.2fr]">
          <div className="rounded-2xl border border-glass-border bg-background/58 px-4 py-3.5">
            <p className="text-xs text-muted-foreground">当前进度</p>
            <div className="mt-2 flex items-center gap-3">
              <span className="text-2xl font-semibold tracking-tight text-foreground">{detail.project.progress}%</span>
              <Progress aria-label="项目当前进度" value={detail.project.progress} className="h-1.5" />
            </div>
          </div>
          <div className="rounded-2xl border border-glass-border bg-background/58 px-4 py-3.5">
            <p className="text-xs text-muted-foreground">负责人 / 项目成员</p>
            <div className="mt-2 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Avatar size="sm" aria-label={detail.owner.displayName}>
                  {detail.owner.avatarUrl ? <AvatarImage src={detail.owner.avatarUrl} alt="" /> : null}
                  <AvatarFallback className="bg-linear-to-br from-primary to-chart-3 text-[10px] text-white">
                    {initials(detail.owner.displayName)}
                  </AvatarFallback>
                </Avatar>
                <span className="truncate text-sm font-semibold text-foreground">{detail.owner.displayName}</span>
              </div>
              <AvatarGroup>
                {visibleMembers.map(({ id, member }) => (
                  <Avatar key={id} size="sm" aria-label={member.displayName}>
                    {member.avatarUrl ? <AvatarImage src={member.avatarUrl} alt="" /> : null}
                    <AvatarFallback className="bg-brand-soft text-[10px] font-semibold text-primary">
                      {initials(member.displayName)}
                    </AvatarFallback>
                  </Avatar>
                ))}
                {hiddenMemberCount > 0 ? <AvatarGroupCount>+{hiddenMemberCount}</AvatarGroupCount> : null}
              </AvatarGroup>
            </div>
          </div>
          <div className="rounded-2xl border border-glass-border bg-background/58 px-4 py-3.5 sm:col-span-2 2xl:col-span-1">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CalendarRange aria-hidden="true" className="size-3.5 text-primary" />
              项目周期
            </div>
            <p className="mt-2 text-sm font-semibold text-foreground">
              {formatDate(detail.project.startDate)} - {formatDate(detail.project.dueDate)}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <Clock3 aria-hidden="true" className="size-3" />
              截止 {formatDate(detail.project.dueDate)}
            </p>
          </div>
        </section>

        <div className="flex shrink-0 items-center gap-2">
          {canManage ? <><Button type="button" variant="outline" className="h-9 rounded-xl bg-background/70 px-3" onClick={onEdit}>
            <PencilLine data-icon="inline-start" aria-hidden="true" />
            编辑项目
          </Button>
          <Button type="button" onClick={onAddTask} className="h-9 rounded-xl px-3 shadow-[0_10px_24px_rgba(47,125,246,0.2)]">
            <Plus data-icon="inline-start" aria-hidden="true" />
            添加任务
          </Button></> : null}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="ghost" size="icon" className="size-9 rounded-xl bg-background/55" aria-label="更多项目操作">
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40 rounded-xl border border-glass-border bg-background/95 p-1.5">
              <DropdownMenuItem onSelect={async () => { await navigator.clipboard?.writeText(window.location.href); setFeedback("项目链接已复制"); }}>复制项目链接</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => { const content = JSON.stringify({ project: detail.project, milestones: detail.milestones, tasks: detail.tasks }, null, 2); const url = URL.createObjectURL(new Blob([content], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${detail.project.code}-项目报告.json`; anchor.click(); URL.revokeObjectURL(url); setFeedback("项目报告已导出"); }}>导出项目报告</DropdownMenuItem>
              {canManage && onArchive ? <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={onArchive}><Archive />归档项目</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {feedback ? <p role="status" className="relative mt-3 text-right text-xs font-medium text-success">{feedback}</p> : null}
    </GlassCard>
  );
}
