import { KnowledgeWorkspace } from "@/features/knowledge/knowledge-workspace";
import type { KnowledgeDataResult } from "@/features/knowledge/knowledge-types";

export function KnowledgePage({ result }: { result: KnowledgeDataResult }) {
  return <KnowledgeWorkspace result={result} />;
}
