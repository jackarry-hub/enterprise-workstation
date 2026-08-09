"use client";

import { useState } from "react";
import { CalendarDays, ChevronRight, Clock3 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ProjectMilestoneReminder } from "@/features/projects/types";

const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
const calendarDays = Array.from({ length: 35 }, (_, index) => index - 2);

type ProjectAsideProps = {
  reminders: readonly ProjectMilestoneReminder[];
};

export function ProjectAside({ reminders }: ProjectAsideProps) {
  const [calendarOpen, setCalendarOpen] = useState(false);
  return (
    <aside className="hidden flex-col gap-3 2xl:flex">
      <GlassCard className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Clock3 aria-hidden="true" className="size-5 text-primary" />
            <h2 className="font-semibold text-foreground">里程碑提醒</h2>
          </div>
          <span className="text-xs text-muted-foreground">本月</span>
        </div>
        <div className="mt-4 flex flex-col gap-1">
          {reminders.map((reminder) => (
            <div key={reminder.id} className="flex items-center gap-3 border-b border-glass-border/70 py-3 last:border-b-0">
              <div className={reminder.status === "urgent" ? "size-2 rounded-full bg-warning" : "size-2 rounded-full bg-primary"} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{reminder.milestoneName}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{reminder.projectName}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-medium text-foreground">{reminder.dueDate.slice(5).replace("-", "/")}</p>
                <Badge variant={reminder.status === "urgent" ? "warning" : "info"} className="mt-1">
                  {reminder.status === "urgent" ? "临近" : "计划中"}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      <GlassCard className="p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <CalendarDays aria-hidden="true" className="size-5 text-primary" />
            <h2 className="font-semibold text-foreground">项目日历</h2>
          </div>
          <button type="button" onClick={() => setCalendarOpen(true)} className="flex items-center gap-1 text-xs text-muted-foreground" aria-label="查看完整项目日历">
            2026年8月<ChevronRight aria-hidden="true" className="size-3.5" />
          </button>
        </div>
        <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[11px]">
          {weekdays.map((day) => <span key={day} className="py-1 text-muted-foreground">{day}</span>)}
          {calendarDays.map((day, index) => (
            <span
              key={`${day}-${index}`}
              className={day === 4 ? "grid aspect-square place-items-center rounded-full bg-primary font-semibold text-primary-foreground" : day > 0 && day <= 31 ? "grid aspect-square place-items-center rounded-full text-foreground hover:bg-muted" : "grid aspect-square place-items-center text-muted-foreground/30"}
            >
              {day > 0 && day <= 31 ? day : ""}
            </span>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-3 text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-primary" />里程碑</span>
          <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-warning" />截止日期</span>
          <span className="flex items-center gap-1.5"><i className="size-2 rounded-full bg-success" />已完成</span>
        </div>
      </GlassCard>
      <Dialog open={calendarOpen} onOpenChange={setCalendarOpen}><DialogContent><DialogHeader><DialogTitle>项目日历</DialogTitle><DialogDescription>查看本月项目里程碑与临近截止安排。</DialogDescription></DialogHeader><div className="grid gap-2">{reminders.map((reminder) => <div key={reminder.id} className="flex items-center gap-3 rounded-2xl border border-glass-border bg-background/65 p-3"><CalendarDays className="size-4 text-primary" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{reminder.milestoneName}</p><p className="text-xs text-muted-foreground">{reminder.projectName}</p></div><Badge variant={reminder.status === "urgent" ? "warning" : "info"}>{reminder.dueDate}</Badge></div>)}</div></DialogContent></Dialog>
    </aside>
  );
}
