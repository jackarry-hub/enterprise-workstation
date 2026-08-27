"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Project, ProjectDetailData } from "@/features/projects/types";

export type EditProjectInput = Pick<Project, "name" | "description" | "status" | "dueDate">;

export function EditProjectDialog({ detail, open, onOpenChange, onSave, allowStatusChange = true }: { detail: ProjectDetailData; open: boolean; onOpenChange: (open: boolean) => void; onSave: (input: EditProjectInput, idempotencyKey: string) => void | Promise<void>; allowStatusChange?: boolean }) {
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const attemptRef = useRef<{ signature: string; key: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = {
      name: String(form.get("name") ?? "").trim(),
      description: String(form.get("description") ?? "").trim(),
      status: String(form.get("status") ?? detail.project.status) as Project["status"],
      dueDate: String(form.get("dueDate") ?? detail.project.dueDate),
    } satisfies EditProjectInput;
    if (!input.name || !input.dueDate || input.dueDate < detail.project.startDate) {
      setMessage("请检查项目名称和截止日期");
      return;
    }
    const signature = JSON.stringify(input);
    if (attemptRef.current?.signature !== signature) attemptRef.current = { signature, key: crypto.randomUUID() };
    try {
      setIsSubmitting(true);
      setMessage("");
      await onSave(input, attemptRef.current.key);
      attemptRef.current = null;
      onOpenChange(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "项目更新失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[100dvh] w-screen max-w-none overflow-y-auto rounded-none sm:h-auto sm:max-w-xl sm:rounded-2xl">
        <DialogHeader><DialogTitle>编辑项目</DialogTitle><DialogDescription>更新项目名称、说明与交付时间。</DialogDescription></DialogHeader>
        <form key={detail.project.updatedAt} className="grid gap-4" onSubmit={submit}>
          <label className="grid gap-1.5 text-sm font-medium">项目名称<Input name="name" required defaultValue={detail.project.name} /></label>
          <label className="grid gap-1.5 text-sm font-medium">项目描述<Textarea name="description" defaultValue={detail.project.description} /></label>
          <div className={allowStatusChange ? "grid gap-3 sm:grid-cols-2" : "grid gap-3"}>
            {allowStatusChange ? <label className="grid gap-1.5 text-sm font-medium">项目状态<select name="status" defaultValue={detail.project.status} className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm"><option value="planning">规划中</option><option value="active">进行中</option><option value="on_hold">已暂停</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></label> : null}
            <label className="grid gap-1.5 text-sm font-medium">截止时间<Input name="dueDate" type="date" required min={detail.project.startDate} defaultValue={detail.project.dueDate} /></label>
          </div>
          {message ? <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-destructive">{message}</p> : null}
          <DialogFooter><Button type="button" variant="outline" disabled={isSubmitting} onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={isSubmitting}>{isSubmitting ? "正在保存…" : "保存项目"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
