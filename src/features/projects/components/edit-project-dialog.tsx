"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Project, ProjectDetailData } from "@/features/projects/types";

export type EditProjectInput = Pick<Project, "name" | "description" | "status" | "dueDate">;

export function EditProjectDialog({ detail, open, onOpenChange, onSave }: { detail: ProjectDetailData; open: boolean; onOpenChange: (open: boolean) => void; onSave: (input: EditProjectInput) => void }) {
  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    onSave({
      name: String(form.get("name") ?? "").trim(),
      description: String(form.get("description") ?? "").trim(),
      status: String(form.get("status") ?? detail.project.status) as Project["status"],
      dueDate: String(form.get("dueDate") ?? detail.project.dueDate),
    });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>编辑项目</DialogTitle><DialogDescription>更新项目名称、说明、状态与截止时间。</DialogDescription></DialogHeader>
        <form key={detail.project.updatedAt} className="grid gap-4" onSubmit={submit}>
          <label className="grid gap-1.5 text-sm font-medium">项目名称<Input name="name" required defaultValue={detail.project.name} /></label>
          <label className="grid gap-1.5 text-sm font-medium">项目描述<Textarea name="description" defaultValue={detail.project.description} /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-medium">项目状态<select name="status" defaultValue={detail.project.status} className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm"><option value="planning">规划中</option><option value="active">进行中</option><option value="on_hold">已暂停</option><option value="completed">已完成</option><option value="cancelled">已取消</option></select></label>
            <label className="grid gap-1.5 text-sm font-medium">截止时间<Input name="dueDate" type="date" required min={detail.project.startDate} defaultValue={detail.project.dueDate} /></label>
          </div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit">保存项目</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
