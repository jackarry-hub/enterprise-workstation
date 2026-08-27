"use client";

import { useEffect, useState } from "react";
import { FolderSearch } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { findLocalProject } from "@/features/projects/data/mock-project-repository";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { useOperationFixtureContext } from "@/features/operations/use-operations";
import { ProjectDetailWorkspace } from "@/features/projects/project-detail-workspace";
import type { ProjectDetailResult } from "@/features/projects/types";

type ProjectDetailPageProps = {
  projectId: string;
  initialResult?: ProjectDetailResult;
};

export function ProjectDetailPage({ projectId, initialResult }: ProjectDetailPageProps) {
  const session = useWorkspaceSession();
  const context = useOperationFixtureContext(session);
  const isFixtureBound = context.actor !== null;
  const [result, setResult] = useState<ProjectDetailResult | undefined>(
    initialResult?.source === "supabase" || isFixtureBound ? initialResult : undefined,
  );

  useEffect(() => {
    if (initialResult?.source === "supabase") {
      setResult(initialResult);
      return;
    }
    if (!isFixtureBound) {
      setResult(undefined);
      return;
    }
    const localDetail = findLocalProject(context, projectId);
    setResult(localDetail ? { detail: localDetail, source: "mock" } : initialResult);
  }, [context, initialResult, isFixtureBound, projectId]);

  if (!result) {
    return (
      <main className="mx-auto w-full max-w-420 px-3 pt-5 sm:px-4 lg:px-5 lg:pt-9">
        <GlassCard className="flex min-h-72 flex-col items-center justify-center gap-4 p-6 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-primary/10 text-primary">
            <FolderSearch aria-hidden="true" className="size-6" />
          </span>
          <div>
            <h1 className="text-xl font-semibold text-foreground">未找到项目</h1>
            <p className="mt-2 text-sm text-muted-foreground">该项目可能已归档、已移除，或当前账号没有查看权限。</p>
          </div>
          <Button asChild className="rounded-xl">
            <Link href="/projects">返回项目中心</Link>
          </Button>
        </GlassCard>
      </main>
    );
  }

  return <ProjectDetailWorkspace key={`${result.detail.project.id}-${result.detail.project.updatedAt}`} result={result} />;
}
