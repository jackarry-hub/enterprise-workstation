import { handleKnowledgeSource } from "@/features/knowledge/knowledge-search";

export async function GET(_: Request, { params }: { params: Promise<{ documentId: string }> }) {
  return handleKnowledgeSource((await params).documentId);
}
