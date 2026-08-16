"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CheckSquare2, FolderKanban, LayoutGrid, Search, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { navigationItems } from "@/config/navigation";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import type { WorkspaceActor, WorkspaceRole } from "@/features/auth/workspace-session-types";
import { useOperationFixtureContext } from "@/features/operations/use-operations";
import { getEffectiveProjectDetails } from "@/features/projects/data/effective-project-details";

type WorkspaceSearchItem = {
  id: string;
  label: string;
  meta: string;
  href: string;
  kind: "模块" | "项目" | "任务" | "员工";
};

const kindIcons = {
  模块: LayoutGrid,
  项目: FolderKanban,
  任务: CheckSquare2,
  员工: UserRound,
} as const;

export function buildWorkspaceSearchItems(role: WorkspaceRole = "executive", actor?: WorkspaceActor, includeFixtureData = true): WorkspaceSearchItem[] {
  const modules = navigationItems
    .filter(({ available, roles }) => available && (!roles || roles.includes(role)))
    .map(({ href, label }) => ({ id: `module-${href}`, label, meta: "量子智枢模块", href, kind: "模块" as const }));
  const projects = includeFixtureData ? getEffectiveProjectDetails() : [];
  const canSearchProjects = role === "executive" || role === "department_head";
  const canSearchTasks = role === "department_head" || role === "employee";
  const scopedProjects = role === "department_head" && actor
    ? projects.filter(({ project, members }) => project.ownerId === actor.memberId || members.some(({ member }) => member.id === actor.memberId))
    : projects;
  const projectItems = canSearchProjects ? scopedProjects.map(({ project }) => ({
    id: `project-${project.id}`,
    label: project.name,
    meta: project.code,
    href: `/projects/${project.id}`,
    kind: "项目" as const,
  })) : [];
  const taskItems = canSearchTasks ? projects.flatMap(({ project, tasks }) => tasks
    .filter((task) => role === "department_head" || !actor || task.assigneeId === actor.memberId || task.reporterId === actor.memberId)
    .map((task) => ({
    id: `task-${task.id}`,
    label: task.title,
    meta: project.name,
    href: role === "department_head" ? `/projects/${project.id}?tab=tasks&task=${task.id}` : "/tasks",
    kind: "任务" as const,
  }))) : [];
  const members = new Map<string, WorkspaceSearchItem>();
  if (role === "executive" || role === "department_head" || role === "hr") projects.forEach(({ members: projectMembers }) => {
    projectMembers.forEach(({ member }) => {
      members.set(member.id, {
        id: `member-${member.id}`,
        label: member.displayName,
        meta: `${member.department ?? "企业成员"} · ${member.title ?? "员工"}`,
        href: "/people",
        kind: "员工",
      });
    });
  });

  return [...modules, ...projectItems, ...taskItems, ...members.values()];
}

export function WorkspaceSearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const session = useWorkspaceSession();
  const { actor: fixtureActor } = useOperationFixtureContext(session);
  const actor = fixtureActor ?? session.actor;
  const includeFixtureData = fixtureActor !== null;
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<WorkspaceSearchItem[]>(() => buildWorkspaceSearchItems(actor.role, actor, includeFixtureData));
  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return items.slice(0, 8);
    return items.filter((item) => `${item.label} ${item.meta} ${item.kind}`.toLocaleLowerCase("zh-CN").includes(normalized)).slice(0, 12);
  }, [items, query]);

  useEffect(() => {
    if (open) setItems(buildWorkspaceSearchItems(actor.role, actor, includeFixtureData));
    else setQuery("");
  }, [actor, includeFixtureData, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[16%] translate-y-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="sr-only">
          <DialogTitle>全局搜索</DialogTitle>
          <DialogDescription>只搜索当前岗位有权限查看的模块和业务数据</DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-3 border-b border-border/70 px-5 py-4">
          <Search aria-hidden="true" className="size-5 text-primary" />
          <Input
            autoFocus
            aria-label="输入全局搜索关键词"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索我有权限查看的工作..."
            className="h-10 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="max-h-[58vh] overflow-y-auto p-3">
          {results.length ? (
            <div className="grid gap-1">
              {results.map((item) => {
                const Icon = kindIcons[item.kind];
                return (
                  <Link
                    key={item.id}
                    href={item.href}
                    onClick={() => onOpenChange(false)}
                    className="flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors hover:bg-brand-soft/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="size-4" /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{item.label}</span><span className="block truncate text-xs text-muted-foreground">{item.meta}</span></span>
                    <Badge variant="outline">{item.kind}</Badge>
                  </Link>
                );
              })}
            </div>
          ) : (
            <p className="px-3 py-12 text-center text-sm text-muted-foreground">没有找到匹配内容，请更换关键词。</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
