import { randomUUID } from "node:crypto";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import type { KnowledgeCitationDto } from "@/features/knowledge/knowledge-types-v2";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase/server";

type RpcError = { code?: string } | null;
type RpcResult = { data: unknown; error: RpcError };
type ActiveSession = { member: { status: string } };
type AuthorizedSource = {
  documentId: string; versionId: string; sourceId: string; fileId: string;
  bucket: string; objectPath: string; fileName: string; mimeType: string;
};

export type KnowledgeSearchDependencies = {
  loadSession: () => Promise<ActiveSession | null>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  signSource?: (source: AuthorizedSource) => Promise<string>;
  createRequestId?: () => string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function citation(value: unknown): KnowledgeCitationDto | null {
  const row = record(value);
  if (!row || ![row.document_id, row.version_id, row.source_id].every((id) => typeof id === "string" && UUID_PATTERN.test(id))) return null;
  if (typeof row.title !== "string" || typeof row.excerpt !== "string" || !Number.isFinite(Number(row.rank))) return null;
  return {
    documentId: row.document_id as string,
    versionId: row.version_id as string,
    sourceId: row.source_id as string,
    title: row.title,
    excerpt: row.excerpt,
    rank: Number(row.rank),
  };
}

function source(value: unknown): AuthorizedSource | null {
  const row = record(value);
  if (!row || ![row.documentId, row.versionId, row.sourceId, row.fileId].every((id) => typeof id === "string" && UUID_PATTERN.test(id))) return null;
  if (![row.bucket, row.objectPath, row.fileName, row.mimeType].every((item) => typeof item === "string" && item.length > 0)) return null;
  return row as AuthorizedSource;
}

async function productionDependencies(): Promise<KnowledgeSearchDependencies> {
  const client = await getSupabaseServerClient();
  return {
    loadSession: getWorkspaceSession,
    rpc: async (name, args) => await client.rpc(name, args) as RpcResult,
    signSource: async (authorized) => {
      const service = getSupabaseServiceRoleClient();
      const response = await service.storage.from(authorized.bucket).createSignedUrl(authorized.objectPath, 300, { download: authorized.fileName });
      if (response.error || !response.data?.signedUrl) throw new Error("source_sign_failed");
      return response.data.signedUrl;
    },
  };
}

export async function handleKnowledgeSearch(request: Request, dependencies?: KnowledgeSearchDependencies) {
  const deps = dependencies ?? await productionDependencies();
  const session = await deps.loadSession();
  if (!session) return json({ error: "unauthenticated" }, 401);
  if (session.member.status !== "active") return json({ error: "forbidden" }, 403);
  const url = new URL(request.url);
  const query = url.searchParams.get("q")?.trim() ?? "";
  const requestedLimit = Number(url.searchParams.get("limit") ?? "20");
  if (query.length < 1 || query.length > 200 || !Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 50) {
    return json({ error: "invalid_request" }, 400);
  }
  const requestId = deps.createRequestId?.() ?? randomUUID();
  const result = await deps.rpc("search_current_knowledge", { p_query: query, p_limit_count: requestedLimit, p_request_id: requestId });
  if (result.error) return json({ error: result.error.code === "42501" ? "forbidden" : "knowledge_search_unavailable", requestId }, result.error.code === "42501" ? 403 : 503);
  if (!Array.isArray(result.data)) return json({ error: "knowledge_search_unavailable", requestId }, 503);
  const citations = result.data.map(citation);
  if (citations.some((item) => item === null)) return json({ error: "knowledge_search_unavailable", requestId }, 503);
  return json({ results: citations, requestId });
}

export async function handleKnowledgeSource(documentId: string, dependencies?: KnowledgeSearchDependencies) {
  if (!UUID_PATTERN.test(documentId)) return json({ error: "not_found" }, 404);
  const deps = dependencies ?? await productionDependencies();
  const session = await deps.loadSession();
  if (!session) return json({ error: "unauthenticated" }, 401);
  if (session.member.status !== "active") return json({ error: "forbidden" }, 403);
  const requestId = deps.createRequestId?.() ?? randomUUID();
  const result = await deps.rpc("authorize_knowledge_source", { p_document_public_id: documentId, p_request_id: requestId });
  if (result.error) return json({ error: result.error.code === "P0002" ? "not_found" : "knowledge_source_unavailable", requestId }, result.error.code === "P0002" ? 404 : 503);
  const authorized = source(result.data);
  if (!authorized || !deps.signSource) return json({ error: "knowledge_source_unavailable", requestId }, 503);
  try {
    const downloadUrl = await deps.signSource(authorized);
    return json({ documentId: authorized.documentId, versionId: authorized.versionId, sourceId: authorized.sourceId, downloadUrl, expiresIn: 300, requestId });
  } catch {
    return json({ error: "knowledge_source_unavailable", requestId }, 503);
  }
}
