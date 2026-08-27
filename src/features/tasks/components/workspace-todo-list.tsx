"use client";

import { useState } from "react";
import { BellRing, Check, ClipboardCheck, Clock3, ListChecks } from "lucide-react";
import Link from "next/link";

import { GlassCard } from "@/components/ui/glass-card";
import type { WorkspaceTodo } from "@/features/tasks/workspace-types";
import { cn } from "@/lib/utils";

const icons = { task: ListChecks, approval: ClipboardCheck, notice: BellRing } as const;
const tones = { task: "text-primary bg-primary/10", approval: "text-success bg-success/10", notice: "text-warning bg-warning/10" } as const;

export function WorkspaceTodoList({ todos, allowLocalCompletion = true }: { todos: readonly WorkspaceTodo[]; allowLocalCompletion?: boolean }) {
  const [completedIds, setCompletedIds] = useState<string[]>([]);
  return (
    <GlassCard className="p-5 sm:p-6 xl:col-span-4">
      <div><h2 className="font-semibold text-foreground">今日待办</h2><p className="mt-1 text-xs text-muted-foreground">任务、审批与通知统一提醒</p></div>
      <div className="mt-4 flex flex-col gap-2">
        {todos.length === 0 ? <p className="rounded-2xl border border-dashed border-glass-border p-8 text-center text-sm text-muted-foreground">当前没有待处理事项</p> : todos.map((todo) => {
          const Icon = icons[todo.type];
          const completed = completedIds.includes(todo.id);
          const content = <article className="flex gap-3 rounded-2xl border border-transparent bg-background/48 p-3 transition-colors hover:border-glass-border hover:bg-background/78"><span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", tones[todo.type])}><Icon aria-hidden="true" className="size-4" /></span><div className="min-w-0 flex-1"><h3 className={cn("text-sm font-medium leading-5 text-foreground", completed && "text-muted-foreground line-through")}>{todo.title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{todo.meta}</p><p className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground"><Clock3 aria-hidden="true" className="size-3" />{todo.time}</p></div>{allowLocalCompletion ? <button type="button" aria-label={`${completed ? "恢复" : "完成"}待办：${todo.title}`} aria-pressed={completed} onClick={() => setCompletedIds((current) => completed ? current.filter((id) => id !== todo.id) : [...current, todo.id])} className={cn("grid size-7 shrink-0 place-items-center rounded-lg border border-input bg-background text-muted-foreground", completed && "border-success bg-success text-white")}><Check className="size-3.5" /></button> : null}</article>;
          return todo.href && !allowLocalCompletion ? <Link key={todo.id} href={todo.href} className="block rounded-2xl focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/35">{content}</Link> : <div key={todo.id}>{content}</div>;
        })}
      </div>
    </GlassCard>
  );
}
