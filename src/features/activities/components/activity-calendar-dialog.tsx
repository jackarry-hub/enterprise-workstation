import { CalendarDays } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ActivityProjectView } from "@/features/activities/activity-types";

export function ActivityCalendarDialog({ open, activities, onOpenChange }: { open: boolean; activities: readonly ActivityProjectView[]; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><CalendarDays className="size-5 text-primary" />活动日历</DialogTitle><DialogDescription>按时间查看当前活动的执行周期与截止安排。</DialogDescription></DialogHeader>
        <div className="grid max-h-[58vh] gap-2 overflow-y-auto">
          {[...activities].sort((left, right) => left.project.dueDate.localeCompare(right.project.dueDate)).map(({ project, owner }) => (
            <div key={project.id} className="flex items-center gap-3 rounded-2xl border border-glass-border bg-background/65 p-3">
              <span className="grid size-10 place-items-center rounded-xl bg-primary/10 text-primary"><CalendarDays className="size-4" /></span>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{project.name}</p><p className="mt-0.5 text-xs text-muted-foreground">{project.startDate} 至 {project.dueDate} · {owner.displayName}</p></div>
              <Badge variant={project.status === "completed" ? "success" : project.status === "active" ? "info" : "outline"}>{project.status === "completed" ? "已完成" : project.status === "active" ? "进行中" : "规划中"}</Badge>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
