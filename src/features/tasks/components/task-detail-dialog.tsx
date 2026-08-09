import Link from "next/link";
import { CalendarDays, Flag, FolderKanban, Sparkles, UserRound } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { TaskCenterItem } from "@/features/tasks/task-center-types";

type TaskDetailDialogProps = {
  item: TaskCenterItem | null;
  open: boolean;
  feedback?: string;
  onOpenChange: (open: boolean) => void;
  actionHref: string;
  actionLabel: string;
};

export function TaskDetailDialog({ item, open, feedback, onOpenChange, actionHref, actionLabel }: TaskDetailDialogProps) {
  if (!item) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2 pr-10">
            <Badge variant="info">{item.project.code}</Badge>
            <Badge variant={item.task.priority === "urgent" ? "destructive" : "outline"}>{item.task.priority === "urgent" ? "紧急" : item.task.priority}</Badge>
            {item.task.description.startsWith("AI 决策下发") ? <Badge variant="info"><Sparkles aria-hidden="true" />AI 决策下发</Badge> : null}
          </div>
          <DialogTitle className="pt-1 text-xl">{item.task.title}</DialogTitle>
          <DialogDescription>{item.task.description || "暂无任务描述"}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-muted/55 p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><FolderKanban className="size-3.5" />所属项目</p><p className="mt-1.5 font-medium">{item.project.name}</p></div>
          <div className="rounded-2xl bg-muted/55 p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><UserRound className="size-3.5" />负责人</p><div className="mt-1.5 flex items-center gap-2"><Avatar size="sm"><AvatarFallback className="bg-brand-soft text-primary">{item.assignee?.displayName.slice(0, 1) ?? "待"}</AvatarFallback></Avatar><span className="font-medium">{item.assignee?.displayName ?? "待分配"}</span></div></div>
          <div className="rounded-2xl bg-muted/55 p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="size-3.5" />截止时间</p><p className="mt-1.5 font-medium">{item.task.dueDate ?? "待定"}</p></div>
          <div className="rounded-2xl bg-muted/55 p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Flag className="size-3.5" />优先级</p><p className="mt-1.5 font-medium">{item.task.priority}</p></div>
        </div>
        <div className="rounded-2xl border border-border/70 bg-white/55 p-4">
          <div className="flex items-center justify-between text-sm"><span className="font-medium">当前进度</span><span className="font-semibold text-primary">{item.task.progress}%</span></div>
          <ProgressBar value={item.task.progress} className="mt-2 h-2" />
        </div>
        {feedback ? <p role="status" className="rounded-xl bg-success-soft px-3 py-2 text-sm font-medium text-success">{feedback}</p> : null}
        <DialogFooter>
          <Button asChild><Link href={actionHref}>{actionLabel}</Link></Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
