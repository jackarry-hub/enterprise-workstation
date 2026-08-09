import type { Metadata } from "next";

import { KnowledgePage } from "@/features/knowledge/knowledge-page";

export const metadata: Metadata = {
  title: "知识库 | 企业工作站",
};

export default function KnowledgeRoute() {
  return <KnowledgePage />;
}
