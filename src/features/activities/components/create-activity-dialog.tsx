"use client";

import { useRef, useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { CreateMockProjectInput, MemberSummary } from "@/features/projects/types";

export function CreateActivityDialog({ open, members, onOpenChange, onCreate }: { open: boolean; members: readonly MemberSummary[]; onOpenChange: (open: boolean) => void; onCreate: (input: CreateMockProjectInput, idempotencyKey: string) => void | Promise<void> }) {
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const attemptRef = useRef<{ signature: string; key: string } | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
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

    const input = {
      name,
      description: description || "新建企业活动，等待补充执行说明。",
      category: "企业活动",
      budgetAmount: "0.00",
      ownerId: owner.id,
      memberIds: [owner.id],
      status: "planning",
      priority: "medium",
      startDate,
      dueDate,
    } satisfies CreateMockProjectInput;
    const signature = JSON.stringify(input);
    if (attemptRef.current?.signature !== signature) attemptRef.current = { signature, key: crypto.randomUUID() };
    try {
      setIsSubmitting(true);
      setMessage("");
      await onCreate(input, attemptRef.current.key);
      attemptRef.current = null;
      formElement.reset();
      onOpenChange(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "活动创建失败，请稍后重试");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-[100dvh] w-screen max-w-none overflow-y-auto rounded-none sm:h-auto sm:max-w-xl sm:rounded-2xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><Plus className="size-5 text-primary" />创建活动</DialogTitle><DialogDescription>创建真实活动项目；阶段、任务和交付物可在项目详情继续维护。</DialogDescription></DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <label className="grid gap-1.5 text-sm font-medium">活动名称<Input name="name" required placeholder="例如：年度客户开放日" /></label>
          <label className="grid gap-1.5 text-sm font-medium">负责人<select name="ownerId" required defaultValue={members[0]?.id} className="h-9 rounded-lg border border-input bg-background px-2.5 text-sm">{members.map((member) => <option key={member.id} value={member.id}>{member.displayName} · {member.department}</option>)}</select></label>
          <div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium">开始日期<Input name="startDate" type="date" required /></label><label className="grid gap-1.5 text-sm font-medium">截止日期<Input name="dueDate" type="date" required /></label></div>
          <label className="grid gap-1.5 text-sm font-medium">活动目标<Textarea name="description" placeholder="说明活动目标与预期结果" /></label>
          {message ? <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-destructive">{message}</p> : null}
          <DialogFooter><Button type="button" variant="outline" disabled={isSubmitting} onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" disabled={isSubmitting || members.length === 0}>{isSubmitting ? "正在创建…" : "创建活动"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
