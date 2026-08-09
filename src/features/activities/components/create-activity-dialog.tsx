"use client";

import { useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ActivityProjectView } from "@/features/activities/activity-types";
import type { MemberSummary, Milestone, Project } from "@/features/projects/types";

export function CreateActivityDialog({ open, members, template, onOpenChange, onCreate }: { open: boolean; members: readonly MemberSummary[]; template: ActivityProjectView; onOpenChange: (open: boolean) => void; onCreate: (activity: ActivityProjectView) => void }) {
  const [message, setMessage] = useState("");

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "").trim();
    const ownerId = String(form.get("ownerId") ?? "");
    const startDate = String(form.get("startDate") ?? "");
    const dueDate = String(form.get("dueDate") ?? "");
    const description = String(form.get("description") ?? "").trim();
    const owner = members.find(({ id }) => id === ownerId) ?? members[0];
    if (!name || !owner || !startDate || !dueDate) {
      setMessage("请完整填写活动名称、负责人和活动周期。");
      return;
    }
    if (dueDate < startDate) {
      setMessage("截止日期不能早于开始日期。");
      return;
    }

    const id = `local-activity-${Date.now()}`;
    const now = new Date().toISOString();
    const project: Project = {
      id,
      organizationId: template.project.organizationId,
      code: `ACT-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 900) + 100)}`,
      name,
      description: description || "新建企业活动，等待补充执行说明。",
      ownerId: owner.id,
      createdById: owner.id,
      status: "planning",
      health: "on_track",
      priority: "medium",
      startDate,
      dueDate,
      progress: 0,
      createdAt: now,
      updatedAt: now,
    };
    const stageNames = ["策划", "执行", "推广", "复盘"];
    const stages: Milestone[] = stageNames.map((stageName, index) => ({
      id: `${id}-stage-${index + 1}`,
      organizationId: project.organizationId,
      projectId: id,
      ownerId: owner.id,
      name: stageName,
      description: `${stageName}阶段推进与交付检查。`,
      status: "pending",
      startDate: index === 0 ? startDate : undefined,
      dueDate,
      progress: 0,
      sortOrder: index,
      createdAt: now,
      updatedAt: now,
    }));
    onCreate({ project, owner, members: [], stages, tasks: [] });
    setMessage("");
    event.currentTarget.reset();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Plus className="size-5 text-primary" />创建活动</DialogTitle><DialogDescription>基于现有项目模型创建活动，并自动生成策划、执行、推广、复盘四个阶段。</DialogDescription></DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <label className="grid gap-1.5 text-sm font-medium">活动名称<Input name="name" required placeholder="例如：年度客户开放日" /></label>
          <label className="grid gap-1.5 text-sm font-medium">负责人<select name="ownerId" required defaultValue={members[0]?.id} className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm">{members.map((member) => <option key={member.id} value={member.id}>{member.displayName} · {member.department}</option>)}</select></label>
          <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium">开始日期<Input name="startDate" type="date" required /></label><label className="grid gap-1.5 text-sm font-medium">截止日期<Input name="dueDate" type="date" required /></label></div>
          <label className="grid gap-1.5 text-sm font-medium">活动目标<Textarea name="description" placeholder="说明活动目标与预期结果" /></label>
          {message ? <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-destructive">{message}</p> : null}
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button type="submit">创建活动</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
