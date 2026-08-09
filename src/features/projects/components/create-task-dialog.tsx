import { useEffect, useRef, useState } from "react";
import { ClipboardPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { CreateMockTaskInput } from "@/features/projects/data/project-task-operations";
import type { ProjectDetailData, TaskPriority } from "@/features/projects/types";

type CreateTaskDialogProps = {
  detail: ProjectDetailData;
  open: boolean;
  onClose: () => void;
  onCreated: (input: CreateMockTaskInput) => void;
};

const priorityOptions: Array<{ value: TaskPriority; label: string }> = [
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "urgent", label: "紧急" },
  { value: "low", label: "低" },
];

export function CreateTaskDialog({ detail, open, onClose, onCreated }: CreateTaskDialogProps) {
  const defaultAssigneeId = detail.members.find(({ role }) => role === "owner")?.member.id
    ?? detail.members[0]?.member.id
    ?? "";
  const [assigneeId, setAssigneeId] = useState(defaultAssigneeId);
  const [priority, setPriority] = useState<TaskPriority>("high");
  const [message, setMessage] = useState("");
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open && document.activeElement instanceof HTMLElement) {
      restoreFocusRef.current = document.activeElement;
      setMessage("");
      setAssigneeId(defaultAssigneeId);
      setPriority("high");
    }
  }, [defaultAssigneeId, open]);

  function closeDialog() {
    const restoreTarget = restoreFocusRef.current;
    onClose();
    queueMicrotask(() => restoreTarget?.focus());
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const dueDate = String(formData.get("dueDate") ?? "");

    if (!title) {
      setMessage("请输入任务名称");
      return;
    }
    if (!assigneeId) {
      setMessage("请选择任务负责人");
      return;
    }
    if (!dueDate) {
      setMessage("请选择任务截止日期");
      return;
    }

    try {
      onCreated({ title, description, assigneeId, dueDate, priority });
      closeDialog();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "任务创建失败，请稍后重试");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && closeDialog()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <div className="flex items-start gap-3 pr-10">
          <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
            <ClipboardPlus aria-hidden="true" className="size-5" />
          </span>
          <DialogHeader>
            <DialogTitle className="text-lg">新建任务</DialogTitle>
            <DialogDescription className="text-xs leading-5">
              将项目拆解为明确的执行事项，并指定负责人和截止时间。
            </DialogDescription>
          </DialogHeader>
        </div>

        <form onSubmit={handleSubmit} className="mt-1 grid gap-4" noValidate>
          <div className="grid gap-1.5">
            <label htmlFor="task-title" className="text-sm font-medium text-foreground">任务名称</label>
            <Input id="task-title" name="title" autoFocus placeholder="例如：完成客户门户原型" className="h-10 rounded-xl bg-white/75" />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="task-description" className="text-sm font-medium text-foreground">任务描述</label>
            <Textarea id="task-description" name="description" placeholder="补充交付范围与验收标准" className="min-h-22 rounded-xl bg-white/75" />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <label htmlFor="task-assignee" className="text-sm font-medium text-foreground">负责人</label>
              <Select value={assigneeId} onValueChange={setAssigneeId}>
                <SelectTrigger id="task-assignee" className="h-10 w-full bg-white/75" aria-label="负责人">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {detail.members.filter(({ leftAt }) => !leftAt).map(({ id, member }) => (
                      <SelectItem key={id} value={member.id}>{member.displayName} · {member.title}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <label htmlFor="task-priority" className="text-sm font-medium text-foreground">优先级</label>
              <Select value={priority} onValueChange={(value) => setPriority(value as TaskPriority)}>
                <SelectTrigger id="task-priority" className="h-10 w-full bg-white/75" aria-label="优先级">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {priorityOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="task-due" className="text-sm font-medium text-foreground">截止日期</label>
            <Input
              id="task-due"
              name="dueDate"
              type="date"
              min={detail.project.startDate}
              defaultValue={detail.project.dueDate}
              className="h-10 rounded-xl bg-white/75"
            />
          </div>

          {message ? <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs text-destructive">{message}</p> : null}

          <DialogFooter className="mt-1">
            <Button type="button" variant="outline" onClick={closeDialog} className="h-9 rounded-xl">取消</Button>
            <Button type="submit" className="h-9 rounded-xl px-4">创建任务</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
