"use client";

import Link from "next/link";
import { useState } from "react";
import {
  ArrowRight,
  BellRing,
  CalendarDays,
  Check,
  FileText,
  MessageCircleMore,
  Radio,
  UsersRound,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  activityStages,
  announcements,
  projectActivity,
  schedules,
  todoItems,
} from "@/features/dashboard/data";
import { cn } from "@/lib/utils";

function PanelHeader({ title, action = "查看全部", href }: { title: string; action?: string; href: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
      <Button asChild variant="link" size="sm" className="px-0"><Link href={href}>{action}<ArrowRight data-icon="inline-end" aria-hidden="true" /></Link></Button>
    </div>
  );
}

export function TodoPanel() {
  const [completed, setCompleted] = useState<string[]>([]);
  return (
    <GlassCard className="min-w-0 p-5 xl:col-span-3">
      <PanelHeader title="待办事项" href="/workspace" />
      <ul className="mt-2 flex flex-col">
        {todoItems.map((item) => (
          <li key={item.title} className="flex gap-3 border-b border-border/70 py-3 last:border-b-0">
            <button
              type="button"
              aria-label={`${completed.includes(item.title) ? "恢复" : "完成"}待办：${item.title}`}
              aria-pressed={completed.includes(item.title)}
              onClick={() => setCompleted((current) => current.includes(item.title) ? current.filter((title) => title !== item.title) : [...current, item.title])}
              className={cn("mt-1 grid size-4 shrink-0 place-items-center rounded border border-input bg-background", completed.includes(item.title) && "border-success bg-success text-white")}
            >
              {completed.includes(item.title) ? <Check aria-hidden="true" className="size-3" /> : null}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className={cn("truncate text-sm font-medium text-foreground", completed.includes(item.title) && "text-muted-foreground line-through")}>{item.title}</p>
                <StatusBadge status={item.level === "紧急" ? "warning" : "neutral"}>{item.level}</StatusBadge>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="truncate">{item.meta}</span>
                <span className="shrink-0">{item.time}</span>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}

export function ActivityProgressPanel() {
  const stageIcons = [Check, Radio, MessageCircleMore, FileText];
  return (
    <GlassCard className="min-w-0 p-5 xl:col-span-4">
      <PanelHeader title="活动推进中心" action="查看全部活动" href="/activities" />
      <div className="mt-6 grid grid-cols-4 gap-2">
        {activityStages.map((stage, index) => {
          const Icon = stageIcons[index];
          return (
            <div key={stage.label} className="relative flex flex-col items-center text-center">
              {index < activityStages.length - 1 ? <div className="absolute left-[62%] top-6 h-px w-[76%] bg-border" /> : null}
              <div className={cn("relative z-10 grid size-12 place-items-center rounded-full [&>svg]:size-5", stage.state === "success" ? "bg-success-soft text-success" : stage.state === "active" ? "bg-brand-soft text-primary" : "bg-muted text-muted-foreground")}>
                <Icon aria-hidden="true" />
              </div>
              <p className="mt-3 text-sm font-medium text-foreground">{stage.label}</p>
              <p className="mt-1 text-lg font-semibold text-foreground">{stage.progress}</p>
            </div>
          );
        })}
      </div>
    </GlassCard>
  );
}

export function AnnouncementsPanel() {
  const tones = {
    blue: "bg-brand-soft text-primary",
    orange: "bg-warning-soft text-warning",
    green: "bg-success-soft text-success",
  } as const;
  return (
    <GlassCard className="min-w-0 p-5 xl:col-span-5">
      <PanelHeader title="通知公告" href="/approvals" />
      <ul className="mt-2 flex flex-col">
        {announcements.map((item) => (
          <li key={item.title} className="flex items-center gap-3 border-b border-border/70 py-3 last:border-b-0">
            <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg [&>svg]:size-4", tones[item.tone])}>
              <BellRing aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{item.title}</span>
            <time className="text-xs text-muted-foreground">{item.date}</time>
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}

export function SchedulePanel() {
  return (
    <GlassCard className="min-w-0 p-5 xl:col-span-3">
      <PanelHeader title="即将日程" action="查看活动" href="/activities" />
      <ul className="mt-2 flex flex-col gap-1">
        {schedules.map((item) => (
          <li key={item.time} className="grid grid-cols-[3.5rem_1fr] gap-3 py-2">
            <time className="text-sm font-semibold text-foreground">{item.time}</time>
            <div className="relative border-l border-border pl-4 before:absolute before:-left-1 before:top-1.5 before:size-2 before:rounded-full before:bg-primary before:content-['']">
              <p className="text-sm font-medium text-foreground">{item.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{item.place}</p>
              <p className="mt-1 text-[11px] text-primary">{item.remaining}</p>
            </div>
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}

export function CollaborationPanel() {
  const shortcuts = [
    { label: "组织概览", icon: UsersRound, href: "/people" },
    { label: "项目成果", icon: FileText, href: "/projects" },
    { label: "审批决策", icon: CalendarDays, href: "/approvals" },
    { label: "经营分析", icon: MessageCircleMore, href: "/dashboard" },
  ];
  return (
    <GlassCard className="min-w-0 p-5 xl:col-span-5">
      <PanelHeader title="经营协同" href="/approvals" />
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {shortcuts.map((item) => (
          <Link key={item.label} href={item.href} className="flex items-center gap-2 rounded-xl border border-border bg-background/65 p-3 text-sm font-medium text-foreground transition-colors hover:bg-brand-soft/70 [&>svg]:size-5 [&>svg]:text-primary"><item.icon aria-hidden="true" />{item.label}</Link>
        ))}
      </div>
    </GlassCard>
  );
}

export function ProjectActivityPanel() {
  return (
    <GlassCard className="min-w-0 p-5 xl:col-span-7">
      <PanelHeader title="项目动态" action="查看全部动态" href="/projects" />
      <ul className="mt-2 flex flex-col">
        {projectActivity.map((item) => (
          <li key={`${item.person}-${item.time}`} className="flex items-center gap-3 border-b border-border/70 py-2.5 last:border-b-0">
            <span className="grid size-8 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-primary">{item.person.slice(0, 1)}</span>
            <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              <span className="font-semibold text-primary">{item.person}</span> {item.action}
            </p>
            <time className="text-xs text-muted-foreground">{item.time}</time>
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}
