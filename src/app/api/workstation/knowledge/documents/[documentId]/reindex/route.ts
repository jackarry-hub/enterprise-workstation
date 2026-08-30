import { handleKnowledgeReindex } from "@/features/knowledge/document-processing-handler";

export async function POST(request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  return handleKnowledgeReindex(request, (await params).documentId);
}
