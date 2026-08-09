import { CalendarRange, CheckCircle2, CircleDot } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
import type { ProjectDetailData } from "@/features/projects/types";

const DAY = 86_400_000;

function dayValue(value: string) {
  return new Date(`${value}T00:00:00Z`).valueOf();
}

function weekIndex(value: string, start: string) {
  return Math.max(0, Math.floor((dayValue(value) - dayValue(start)) / DAY / 7));
}

function weekSpan(start: string, end: string) {
  return Math.max(1, Math.ceil((dayValue(end) - dayValue(start) + DAY) / DAY / 7));
}

export function ProjectGanttTab({ detail }: { detail: ProjectDetailData }) {
  const projectWeeks = Math.max(1, weekSpan(detail.project.startDate, detail.project.dueDate));
  const weeks = Array.from({ length: projectWeeks }, (_, index) => {
    const date = new Date(dayValue(detail.project.startDate) + index * 7 * DAY);
    return `${date.getUTCMonth() + 1}/${date.getUTCDate()}`;
  });
  const rows = [
    ...detail.milestones.map((item) => ({ id: item.id, type: "里程碑", title: item.name, start: item.startDate ?? detail.project.startDate, end: item.dueDate, progress: item.progress, done: item.status === "completed" })),
    ...detail.tasks.filter(({ status }) => status !== "cancelled").map((item) => ({ id: item.id, type: "任务", title: item.title, start: item.startDate ?? detail.project.startDate, end: item.dueDate ?? detail.project.dueDate, progress: item.progress, done: item.status === "done" })),
  ];
  const gridStyle = { gridTemplateColumns: `minmax(13rem, 13rem) repeat(${projectWeeks}, minmax(4.5rem, 1fr))` };

  return (
    <GlassCard className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 p-5"><div><div className="flex items-center gap-2"><CalendarRange className="size-5 text-primary" /><h2 className="text-lg font-semibold">项目甘特图</h2></div><p className="mt-1 text-sm text-muted-foreground">任务和里程碑共用同一时间轴，自动反映当前进度。</p></div><Badge variant="info">{detail.project.startDate} 至 {detail.project.dueDate}</Badge></div>
      <div className="overflow-x-auto">
        <div className="min-w-max p-4">
          <div className="grid border-b border-border/70 pb-2 text-[11px] text-muted-foreground" style={gridStyle}><span className="px-2 font-medium">交付项</span>{weeks.map((week, index) => <span key={`${week}-${index}`} className="border-l border-border/60 px-2">第 {index + 1} 周 · {week}</span>)}</div>
          <div className="mt-2 grid gap-y-2">{rows.map((row) => {
            const start = Math.min(projectWeeks - 1, weekIndex(row.start, detail.project.startDate));
            const span = Math.min(projectWeeks - start, weekSpan(row.start, row.end));
            return <div key={row.id} className="grid min-h-12 items-center rounded-xl bg-muted/35" style={gridStyle}><div className="flex min-w-0 items-center gap-2 px-2"><span className={row.done ? "text-success" : "text-primary"}>{row.done ? <CheckCircle2 className="size-4" /> : <CircleDot className="size-4" />}</span><span className="min-w-0"><span className="block truncate text-sm font-medium">{row.title}</span><span className="block text-[10px] text-muted-foreground">{row.type} · {row.progress}%</span></span></div><div className="mx-1 h-7 overflow-hidden rounded-lg bg-primary/12" style={{ gridColumn: `${start + 2} / span ${span}` }}><div className="flex h-full items-center rounded-lg bg-primary/75 px-2 text-[10px] font-medium text-white" style={{ width: `${Math.max(12, row.progress)}%` }}>{row.progress}%</div></div></div>;
          })}</div>
        </div>
      </div>
    </GlassCard>
  );
}
