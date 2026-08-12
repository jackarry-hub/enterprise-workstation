import { CalendarClock, CheckCircle2, Filter, RotateCcw, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { Project, ProjectActivity, TaskPriority } from "@/features/projects/types";
import type { TaskCenterFilters, TaskCenterItem } from "@/features/tasks/task-center-types";

type TaskCenterFiltersCardProps = {
  filters: TaskCenterFilters;
  projects: readonly Project[];
  onChange: (filters: TaskCenterFilters) => void;
  onReset: () => void;
};

export function TaskCenterFiltersCard({ filters, projects, onChange, onReset }: TaskCenterFiltersCardProps) {
  function patchFilter(patch: Partial<TaskCenterFilters>) {
    onChange({ ...filters, ...patch });
  }

  return (
    <GlassCard className="min-h-76 p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <Filter aria-hidden="true" className="size-4 text-primary" />
        <h2 className="text-base font-semibold">快捷筛选</h2>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
        <label className="space-y-1.5 text-xs text-muted-foreground">
          <span>所属项目</span>
          <Select value={filters.projectId} onValueChange={(value) => patchFilter({ projectId: value })}>
            <SelectTrigger aria-label="所属项目筛选" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部项目</SelectItem>
              {projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </label>
        <label className="space-y-1.5 text-xs text-muted-foreground">
          <span>优先级</span>
          <Select value={filters.priority} onValueChange={(value) => patchFilter({ priority: value as TaskPriority | "all" })}>
            <SelectTrigger aria-label="优先级筛选" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部优先级</SelectItem>
              <SelectItem value="urgent">紧急</SelectItem>
              <SelectItem value="high">高</SelectItem>
              <SelectItem value="medium">中</SelectItem>
              <SelectItem value="low">低</SelectItem>
            </SelectContent>
          </Select>
        </label>
        <Button type="button" variant="outline" className="self-end" onClick={onReset}>
          <RotateCcw data-icon="inline-start" aria-hidden="true" />
          重置全部筛选
        </Button>
      </div>
    </GlassCard>
  );
}

export function TaskScheduleCard({ items }: { items: readonly TaskCenterItem[] }) {
  return (
    <GlassCard className="p-4 sm:p-5">
      <div className="flex items-center gap-2"><CalendarClock aria-hidden="true" className="size-4 text-primary" /><h2 className="text-base font-semibold">日程安排</h2></div>
      <div className="mt-3 divide-y divide-border/70">
        {items.slice(0, 4).map((item, index) => (
          <div key={item.task.id} className="grid grid-cols-[3.2rem_minmax(0,1fr)] gap-3 py-2.5 text-sm">
            <div className="relative pl-3 text-xs font-medium text-primary before:absolute before:top-1.5 before:left-0 before:size-1.5 before:rounded-full before:bg-primary">{item.task.dueDate?.slice(5) ?? "待定"}</div>
            <div><p className="truncate font-medium">{item.task.title}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{item.project.name}{index === 0 ? " · 优先推进" : ""}</p></div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}

export function RecentTaskActivityCard({ activities }: { activities: readonly ProjectActivity[] }) {
  return (
    <GlassCard className="p-4 sm:p-5">
      <div className="flex items-center gap-2"><Sparkles aria-hidden="true" className="size-4 text-primary" /><h2 className="text-base font-semibold">最近动态</h2></div>
      <div className="mt-3 divide-y divide-border/70">
        {activities.slice(0, 4).map((activity) => (
          <div key={activity.id} className="flex gap-3 py-2.5 text-sm">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-primary"><CheckCircle2 aria-hidden="true" className="size-4" /></span>
            <div className="min-w-0"><p className="line-clamp-2 leading-5">{activity.content}</p><p className="mt-0.5 text-xs text-muted-foreground">{activity.createdAt.slice(5, 16).replace("T", " ")}</p></div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
