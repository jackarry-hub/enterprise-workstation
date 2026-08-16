import { isStaticAiDemoBuild } from "@/features/ai-dispatch/static-demo-client";

const staticallyGeneratedProjectIds = new Set([
  "40000000-0000-4000-8000-000000000001",
  "40000000-0000-4000-8000-000000000002",
  "40000000-0000-4000-8000-000000000003",
  "40000000-0000-4000-8000-000000000004",
]);

type ProjectHrefOptions = {
  tab?: string;
  task?: string;
};

export function getProjectHref(projectId: string, options: ProjectHrefOptions = {}) {
  const staticFallback = isStaticAiDemoBuild() && !staticallyGeneratedProjectIds.has(projectId);
  const pathname = staticFallback ? "/projects" : `/projects/${projectId}`;
  const params = new URLSearchParams();

  if (staticFallback) params.set("project", projectId);
  if (options.tab) params.set("tab", options.tab);
  if (options.task) params.set("task", options.task);

  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
