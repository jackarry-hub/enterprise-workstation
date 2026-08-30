import { handleKnowledgeSource } from "@/features/knowledge/knowledge-search";

export async function GET(_: Request, { params }: { params: Promise<{ documentId: string }> }) {
  const response = await handleKnowledgeSource((await params).documentId);
  if (!response.ok) return response;
  const payload = await response.json() as { downloadUrl?: string };
  return payload.downloadUrl ? Response.redirect(payload.downloadUrl, 303) : Response.json({ error: "knowledge_source_unavailable" }, { status: 503 });
}
