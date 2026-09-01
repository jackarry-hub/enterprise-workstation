import { handleKnowledgeProcessorGateway } from "@/features/knowledge/processor-gateway";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleKnowledgeProcessorGateway(request);
}
