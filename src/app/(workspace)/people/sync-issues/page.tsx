import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { requireWorkspaceSession } from "@/features/auth/workspace-session";
import { loadFeishuSyncOperations } from "@/features/feishu/sync-issues-data";
import { FeishuSyncIssuesPanel } from "@/features/feishu/sync-issues-panel";

export const metadata: Metadata = { title: "飞书同步问题 | 企业工作站" };
export const dynamic = "force-dynamic";

export default async function SyncIssuesPage() {
  const session = await requireWorkspaceSession();
  if (!session.permissionCodes.includes("organization.manage")) notFound();
  const operations = await loadFeishuSyncOperations(session);
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-5 sm:px-6 sm:py-8">
      <header><p className="text-sm font-medium text-primary">组织人事</p><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">飞书同步问题</h1><p className="mt-2 max-w-3xl text-sm text-muted-foreground">查看真实同步运行、乱序事件与对账差异。目录归属字段只读，处理动作写入审计。</p></header>
      <FeishuSyncIssuesPanel issues={operations.issues} runs={operations.runs} events={operations.events} />
    </main>
  );
}
