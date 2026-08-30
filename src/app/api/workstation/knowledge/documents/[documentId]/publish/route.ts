import { handleKnowledgeCommand } from "@/features/knowledge/knowledge-command-handler";

export async function POST(request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  return handleKnowledgeCommand(request, "publish", undefined, { documentId: (await params).documentId });
}
