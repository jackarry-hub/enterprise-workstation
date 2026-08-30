import { authorizeInternalKnowledgeWorker, runDefaultKnowledgeProcessingJob } from "@/features/knowledge/document-processing-handler";

export async function POST(request: Request) {
  if (!authorizeInternalKnowledgeWorker(request)) return Response.json({ error: "not_found" }, { status: 404 });
  try {
    return Response.json(await runDefaultKnowledgeProcessingJob(), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message === "knowledge_processor_unconfigured" ? "knowledge_processor_unconfigured" : "knowledge_processing_unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
