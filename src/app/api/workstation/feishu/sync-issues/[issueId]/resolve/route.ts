import {
  createResolveFeishuSyncIssueHandler,
  defaultResolveFeishuSyncIssueDependencies,
} from "@/app/api/workstation/feishu/sync-issues/[issueId]/resolve/handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const POST = createResolveFeishuSyncIssueHandler(defaultResolveFeishuSyncIssueDependencies);
