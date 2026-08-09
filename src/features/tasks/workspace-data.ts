import { workspaceMockResult } from "@/features/tasks/workspace-mock-data";
import type { WorkspaceResult } from "@/features/tasks/workspace-types";
import { hasSupabaseEnv } from "@/lib/supabase/env";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof getSupabaseServerClient>>;
export type WorkspaceClientFactory = () => Promise<SupabaseServerClient>;

function emptySupabaseResult(message?: string): WorkspaceResult {
  return {
    source: "supabase",
    data: {
      viewerName: "当前用户",
      overview: { todayTaskCount: 0, pendingApprovalCount: 0, deadlineReminderCount: 0, weeklyCompletionRate: 0 },
      tasks: [],
      todos: [],
      activities: [],
      dailyReport: { projectId: "", todayCompleted: "", blockers: "", tomorrowPlan: "" },
      projects: [],
      loadError: message,
    },
  };
}

export async function loadWorkspaceData(
  clientFactory: WorkspaceClientFactory = getSupabaseServerClient,
  options: { allowMockFallback?: boolean } = {},
): Promise<WorkspaceResult> {
  const allowMockFallback = options.allowMockFallback ?? !hasSupabaseEnv();

  if (allowMockFallback) {
    return workspaceMockResult;
  }

  try {
    const client = await clientFactory();
    const userResponse = await client.auth.getUser();

    if (userResponse.error || !userResponse.data.user) {
      return emptySupabaseResult("当前账号尚未登录，无法读取个人工作数据。");
    }

    return emptySupabaseResult("真实数据连接已就绪，当前账号暂无可展示的工作事项。");
  } catch {
    return emptySupabaseResult("工作数据加载失败，请稍后重试。");
  }
}
