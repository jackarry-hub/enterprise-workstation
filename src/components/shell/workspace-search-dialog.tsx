"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { LayoutGrid, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { getVisibleNavigationItems } from "@/config/navigation";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";

type WorkspaceSearchItem = {
  id: string;
  label: string;
  meta: string;
  href: string;
  kind: "模块";
};

const kindIcons = {
  模块: LayoutGrid,
} as const;

export function buildWorkspaceSearchItems(session: WorkspaceSession): WorkspaceSearchItem[] {
  const modules = getVisibleNavigationItems(session)
    .map(({ href, label }) => ({ id: `module-${href}`, label, meta: "企业工作站模块", href, kind: "模块" as const }));
  return modules;
}

export function WorkspaceSearchDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const session = useWorkspaceSession();
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<WorkspaceSearchItem[]>(() => buildWorkspaceSearchItems(session));
  const results = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-CN");
    if (!normalized) return items.slice(0, 8);
    return items.filter((item) => `${item.label} ${item.meta} ${item.kind}`.toLocaleLowerCase("zh-CN").includes(normalized)).slice(0, 12);
  }, [items, query]);

  useEffect(() => {
    if (open) setItems(buildWorkspaceSearchItems(session));
    else setQuery("");
  }, [open, session]);

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
