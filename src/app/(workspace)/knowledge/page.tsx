import type { Metadata } from "next";

import { KnowledgePage } from "@/features/knowledge/knowledge-page";
import { requireWorkspaceSession } from "@/features/auth/workspace-session";
import { loadKnowledgeData } from "@/features/knowledge/knowledge-data";

export const metadata: Metadata = {
  title: "知识库 | 企业工作站",
};

export default async function KnowledgeRoute() {
  const session = await requireWorkspaceSession();
  const result = await loadKnowledgeData(session.permissionCodes.includes("knowledge.manage"));
  return <KnowledgePage result={result} />;
}
