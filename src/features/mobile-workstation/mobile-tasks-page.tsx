"use client";

import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { useMemo, useState } from "react";

import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { useOperations } from "@/features/operations/use-operations";
import { getEffectiveProjectDetails } from "@/features/projects/data/effective-project-details";
import { MobileTaskCard } from "@/features/mobile-workstation/components/mobile-task-card";
import { mergeMobileTasks, operationTasksForActor, projectTasksForActor, selectMobileTasksForScope } from "@/features/mobile-workstation/mobile-task-data";
import { sortMobileTasksByPriority } from "@/features/mobile-workstation/mobile-priority";

export function MobileTasksPage() {
  const session = useWorkspaceSession();
  const { state, actor } = useOperations(session);
  const [scope, setScope] = useState<"assigned" | "initiated">("assigned");
  const [tab, setTab] = useState<"all" | "pending" | "in_progress" | "review" | "done">("all");
  const allItems = useMemo(() => {
    const personal = mergeMobileTasks(operationTasksForActor(state, actor), projectTasksForActor(getEffectiveProjectDetails([]), actor));
    return sortMobileTasksByPriority(personal, "2026-08-14")
      .filter(({ status }) => status !== "cancelled");
  }, [actor, state]);
  const scopedItems = selectMobileTasksForScope(allItems, scope);
  const items = tab === "all" ? scopedItems : scopedItems.filter(({ status }) => tab === "in_progress" ? ["in_progress", "blocked"].includes(status) : status === tab);
  const tabs = [
    ["all", "全部"], ["pending", "待开始"], ["in_progress", "进行中"], ["review", "待验收"], ["done", "已完成"],
  ] as const;
  return (
    <main className="mobile-page">
      <header className="mobile-page-header"><div><h1>任务</h1><p>按优先级处理今天的工作</p></div><Link href="/projects" prefetch={false} aria-label="查看项目" className="mobile-icon-button"><FolderKanban aria-hidden="true" className="size-5" /></Link></header>
      <div role="tablist" aria-label="任务范围" className="mobile-scope-tabs">
        <button role="tab" aria-selected={scope === "assigned"} onClick={() => setScope("assigned")}>我的待办</button>
        <button role="tab" aria-selected={scope === "initiated"} onClick={() => setScope("initiated")}>我发起的</button>
      </div>
      <div role="tablist" aria-label="任务状态" className="mobile-filter-tabs mt-3">
        {tabs.map(([key, label]) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>{label}</button>)}
      </div>
      <section aria-label="任务列表" className="mt-4 space-y-3">
        {items.length ? items.slice(0, 5).map((task) => <div data-testid="mobile-task-row" key={task.id}><MobileTaskCard task={task} /></div>) : <p className="mobile-empty-state mobile-surface">这里暂时没有任务</p>}
      </section>
    </main>
  );
}
