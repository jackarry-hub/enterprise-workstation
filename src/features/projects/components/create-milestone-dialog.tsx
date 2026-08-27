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
import {
  createProjectMilestone,
  type CreateMilestoneInput,
} from "@/features/projects/actions/create-project-milestone";
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
  const attemptKeyRef = useRef<string | null>(null);
  const ownerOptions = detail.members.flatMap((membership) => {
    const value = membership.member.employeePublicId
      ?? (allowLocalFallback ? membership.member.id : undefined);
    return value ? [{ membership, value }] : [];
  });
  const defaultOwner = ownerOptions.find(({ membership }) => membership.role === "owner") ?? ownerOptions[0];
  const today = useMemo(() => formatDateInputInTimeZone(), []);

  useEffect(() => {
    if (open && document.activeElement instanceof HTMLElement) {
      restoreFocusRef.current = document.activeElement;
    }
  }, [open]);

  function closeDialog() {
    const restoreTarget = restoreFocusRef.current;
    attemptKeyRef.current = null;
    onClose();
    queueMicrotask(() => restoreTarget?.focus());
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting) return;
    setMessage("");
    setIsSubmitting(true);

    try {
      const formData = new FormData(event.currentTarget);
      const ownerPublicId = String(formData.get("ownerPublicId") ?? defaultOwner?.value ?? "");
      const progress = Number(formData.get("progress") ?? 0);
      const idempotencyKey = attemptKeyRef.current ?? crypto.randomUUID();
      attemptKeyRef.current = idempotencyKey;
      const input: CreateMilestoneInput = {
        projectPublicId: detail.project.id,
        ownerPublicId,
        idempotencyKey,
        name: String(formData.get("name") ?? ""),
        startDate: String(formData.get("startDate") ?? "") || undefined,
        dueDate: String(formData.get("dueDate") ?? ""),
        progress,
      };

      const result = await createProjectMilestone(input);
      if (!result.ok && !(result.reason === "unavailable" && allowLocalFallback)) {
        if (result.reason !== "ambiguous") attemptKeyRef.current = null;
        setMessage(result.message);
        return;
      }

      const selectedMembership = ownerOptions.find(({ value }) => value === ownerPublicId)?.membership
        ?? defaultOwner?.membership;
      const now = new Date().toISOString();
      const milestone: Milestone = result.ok
        ? { ...result.milestone, ownerId: selectedMembership?.member.id ?? result.milestone.ownerId }
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
      closeDialog();
    } catch {
      setMessage("未能确认本次保存结果，请保持页面打开并使用原请求重试。");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && !isSubmitting && closeDialog()}>
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
            <Input id="milestone-name" name="name" required maxLength={160} autoFocus placeholder="例如：测试上线" className="h-10 rounded-xl bg-white/75" />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="milestone-owner" className="text-sm font-medium text-foreground">负责人</label>
            <select id="milestone-owner" name="ownerPublicId" required disabled={isSubmitting || ownerOptions.length === 0} defaultValue={defaultOwner?.value} className="h-10 rounded-xl border border-input bg-white/75 px-3 text-sm text-foreground outline-none focus:border-ring focus:ring-3 focus:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-60">
              {ownerOptions.map(({ membership, value }) => <option key={membership.id} value={value}>{membership.member.displayName}</option>)}
            </select>
            {ownerOptions.length === 0 ? <p role="alert" className="text-xs text-destructive">项目成员缺少可用员工档案，请刷新成员目录后再创建。</p> : null}
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
              <Button type="button" variant="outline" disabled={isSubmitting} className="h-9 rounded-xl">取消</Button>
            </DialogClose>
            <Button type="submit" disabled={isSubmitting || ownerOptions.length === 0} className="h-9 rounded-xl px-4">
              {isSubmitting ? <LoaderCircle data-icon="inline-start" aria-hidden="true" className="animate-spin" /> : null}
              创建里程碑
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
