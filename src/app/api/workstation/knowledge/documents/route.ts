import { handleKnowledgeCommand } from "@/features/knowledge/knowledge-command-handler";

export async function POST(request: Request) {
  return handleKnowledgeCommand(request, "create_draft");
}
