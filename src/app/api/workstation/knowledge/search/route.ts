import { handleKnowledgeSearch } from "@/features/knowledge/knowledge-search";

export async function GET(request: Request) {
  return handleKnowledgeSearch(request);
}
