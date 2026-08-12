import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { CreateMilestoneInput, CreateMilestoneResult } from "@/features/projects/actions/create-project-milestone";
import type { Milestone, ProjectDetailData } from "@/features/projects/types";
import { formatDateInputInTimeZone } from "@/lib/date";

type CreateMilestoneDialogProps = {
  detail: ProjectDetailData;
  open: boolean;
  nextSortOrder: number;
  allowLocalFallback: boolean;
  onClose: () => void;
  onCreated: (milestone: Milestone) => void;
};

export function CreateMilestoneDialog({
  detail,
  open,
  nextSortOrder,
  allowLocalFallback,
  onClose,
  onCreated,
}: CreateMilestoneDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const defaultMembership = detail.members.find(({ role }) => role === "owner") ?? detail.members[0];
  const today = useMemo(() => formatDateInputInTimeZone(), []);

  useEffect(() => {
    if (open && document.activeElement instanceof HTMLElement) {
      restoreFocusRef.current = document.activeElement;
    }
  }, [open]);

  function closeDialog() {
    const restoreTarget = restoreFocusRef.current;
    onClose();
    queueMicrotask(() => restoreTarget?.focus());
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setIsSubmitting(true);

    const formData = new FormData(event.currentTarget);
    const ownerMembershipId = String(formData.get("ownerMembershipId") ?? defaultMembership?.id ?? "");
    const progress = Number(formData.get("progress") ?? 0);
    const input: CreateMilestoneInput = {
      projectPublicId: detail.project.id,
      ownerMembershipId,
      name: String(formData.get("name") ?? ""),
      startDate: String(formData.get("startDate") ?? "") || undefined,
      dueDate: String(formData.get("dueDate") ?? ""),
      progress,
    };

    const result: CreateMilestoneResult = allowLocalFallback
      ? { ok: false, reason: "unavailable" as const, message: "演示数据保存在当前浏览器。" }
      : await import("@/features/projects/actions/create-project-milestone").then(({ createProjectMilestone }) => createProjectMilestone(input));

    if (!result.ok && !(result.reason === "unavailable" && allowLocalFallback)) {
      setMessage(result.message);
      setIsSubmitting(false);
      return;
    }

    const selectedMembership = detail.members.find(({ id }) => id === ownerMembershipId) ?? defaultMembership;
    const now = new Date().toISOString();
    const milestone: Milestone = result.ok
      ? result.milestone
      : {
        id: `local-${Date.now()}`,
        organizationId: detail.project.organizationId,
        projectId: detail.project.id,
        ownerId: selectedMembership?.member.id,
        name: input.name.trim(),
        description: "",
        status: progress >= 100 ? "completed" : progress > 0 ? "in_progress" : "pending",
        startDate: input.startDate,
        dueDate: input.dueDate,
        progress,
        sortOrder: nextSortOrder,
        createdAt: now,
        updatedAt: now,
      };

    onCreated(milestone);
    setIsSubmitting(false);
    closeDialog();
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && closeDialog()}>
      <DialogContent>
        <div className="flex items-center gap-3 pr-10">
          <span className="grid size-11 place-items-center rounded-2xl bg-primary/10 text-primary">
            <CalendarDays aria-hidden="true" className="size-5" />
          </span>
          <DialogHeader>
            <DialogTitle className="text-lg">新增里程碑</DialogTitle>
            <DialogDescription className="text-xs">为项目增加一个可跟踪的阶段节点</DialogDescription>
          </DialogHeader>
        </div>

        <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-1.5">
            <label htmlFor="milestone-name" className="text-sm font-medium text-foreground">阶段名称</label>
            <Input id="milestone-name" name="name" required autoFocus placeholder="例如：测试上线" className="h-10 rounded-xl bg-white/75" />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="milestone-owner" className="text-sm font-medium text-foreground">负责人</label>
            <select id="milestone-owner" name="ownerMembershipId" defaultValue={defaultMembership?.id} className="h-10 rounded-xl border border-input bg-white/75 px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-3 focus:ring-ring/30">
              {detail.members.map(({ id, member }) => <option key={id} value={id}>{member.displayName}</option>)}
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label htmlFor="milestone-start" className="text-sm font-medium text-foreground">开始时间</label>
              <Input id="milestone-start" name="startDate" type="date" defaultValue={today} className="h-10 rounded-xl bg-white/75" />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="milestone-due" className="text-sm font-medium text-foreground">截止时间</label>
              <Input id="milestone-due" name="dueDate" type="date" required className="h-10 rounded-xl bg-white/75" />
            </div>
          </div>

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="milestone-progress" className="text-sm font-medium text-foreground">完成百分比</label>
              <span className="text-xs text-muted-foreground">0 - 100</span>
            </div>
            <Input id="milestone-progress" name="progress" type="number" min="0" max="100" defaultValue="0" className="h-10 rounded-xl bg-white/75" />
          </div>

          {message ? <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-destructive">{message}</p> : null}

          <DialogFooter className="mt-1">
            <DialogClose asChild>
              <Button type="button" variant="outline" className="h-9 rounded-xl">取消</Button>
            </DialogClose>
            <Button type="submit" disabled={isSubmitting} className="h-9 rounded-xl px-4">
              {isSubmitting ? <LoaderCircle data-icon="inline-start" aria-hidden="true" className="animate-spin" /> : null}
              创建里程碑
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
