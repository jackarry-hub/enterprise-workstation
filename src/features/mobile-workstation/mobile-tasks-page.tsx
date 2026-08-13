"use client";

import Link from "next/link";
import { Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { useOperations } from "@/features/operations/use-operations";
import { getEffectiveProjectDetails } from "@/features/projects/data/effective-project-details";
import { MobileTaskRow } from "@/features/mobile-workstation/components/mobile-task-row";
import { mergeMobileTasks, mobilePersonalActionFallback, operationTasksForActor, projectTasksForActor } from "@/features/mobile-workstation/mobile-task-data";
import { sortMobileTasksByPriority } from "@/features/mobile-workstation/mobile-priority";

export function MobileTasksPage() {
  const session = useWorkspaceSession();
  const { state, actor } = useOperations(session);
  const [tab, setTab] = useState<"mine" | "initiated">("mine");
  const allItems = useMemo(() => {
    const personal = mergeMobileTasks(operationTasksForActor(state.tasks, actor), projectTasksForActor(getEffectiveProjectDetails([]), actor));
    return sortMobileTasksByPriority(personal.length ? personal : mobilePersonalActionFallback(actor), "2026-08-13");
  }, [actor, state.tasks]);
  const items = tab === "mine" ? allItems.filter(({ initiatedByViewer }) => !initiatedByViewer) : allItems.filter(({ initiatedByViewer }) => initiatedByViewer);
  return (
    <main className="mobile-page">
      <header className="mobile-page-header"><div><h1>任务</h1><p>按优先级处理今天的工作</p></div><Link href="/projects" prefetch={false} aria-label="发起任务" className="mobile-icon-button"><Plus aria-hidden="true" className="size-5" /></Link></header>
      <div role="tablist" aria-label="任务分类" className="mobile-segmented-tabs">
        <button role="tab" aria-selected={tab === "mine"} onClick={() => setTab("mine")}>我的待办</button>
        <button role="tab" aria-selected={tab === "initiated"} onClick={() => setTab("initiated")}>我发起的</button>
      </div>
      <section aria-label="任务列表" className="mobile-list-surface mt-4">
        {items.length ? items.slice(0, 5).map((task) => <MobileTaskRow key={task.id} task={task} />) : <p className="px-4 py-12 text-center text-sm text-muted-foreground">这里暂时没有任务</p>}
      </section>
    </main>
  );
}
