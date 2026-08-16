import type { Metadata } from "next";

import { KnowledgePage } from "@/features/knowledge/knowledge-page";

export const metadata: Metadata = {
  title: "知识库 | 量子智枢",
};

export default function KnowledgeRoute() {
  return <KnowledgePage />;
}
