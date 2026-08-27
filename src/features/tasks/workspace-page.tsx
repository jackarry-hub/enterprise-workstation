import { MobileWorkspaceNav } from "@/components/shell/mobile-workspace-nav";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { WorkspaceActivityList } from "@/features/tasks/components/workspace-activity-list";
import { WorkspaceDailyReport } from "@/features/tasks/components/workspace-daily-report";
import { WorkspaceOverview } from "@/features/tasks/components/workspace-overview";
import { WorkspaceTaskList } from "@/features/tasks/components/workspace-task-list";
import { WorkspaceTodoList } from "@/features/tasks/components/workspace-todo-list";
import type { WorkspaceResult } from "@/features/tasks/workspace-types";

export function WorkspacePage({ result }: { result: WorkspaceResult }) {
  return (
    <main className="mx-auto flex w-full max-w-420 flex-col gap-4 px-3 pt-4 pb-26 sm:px-4 lg:px-5 lg:pt-6 lg:pb-8">
      <PageHeader title="工作中心" description={`早上好，${result.data.viewerName}。聚焦今天，把每一项工作推进到位。`} actions={<Badge variant={result.source === "mock" ? "info" : "success"}>{result.source === "mock" ? "本地数据" : "云端数据"}</Badge>} />
      <WorkspaceOverview overview={result.data.overview} loadError={result.data.loadError} approvalLoadError={result.data.approvalLoadError} />
      <section className="grid min-w-0 gap-4 xl:grid-cols-12"><WorkspaceTaskList tasks={result.data.tasks} /><WorkspaceTodoList todos={result.data.todos} allowLocalCompletion={result.source === "mock"} /></section>
      <section className="grid min-w-0 gap-4 xl:grid-cols-12"><WorkspaceDailyReport result={result} /><WorkspaceActivityList activities={result.data.activities} loadError={result.data.loadError} /></section>
      <MobileWorkspaceNav active="work" />
    </main>
  );
}
