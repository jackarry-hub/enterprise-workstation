import { randomUUID } from "node:crypto";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export type KnowledgeCommand = "create_directory" | "create_draft" | "add_version" | "publish" | "archive" | "grant_access";

type RpcResult = { data: unknown; error: { code?: string; message?: string } | null };
type ActiveSession = { member: { status: string } };

export type KnowledgeCommandDependencies = {
  loadSession: () => Promise<ActiveSession | null>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  createRequestId?: () => string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 24_576;
const ALLOWED_FIELDS: Record<KnowledgeCommand, ReadonlySet<string>> = {
  create_directory: new Set(["name", "slug", "parentId"]),
  create_draft: new Set(["fileId", "directoryId", "title", "summary", "category", "tags"]),
  add_version: new Set(["documentId", "fileId", "directoryId", "title", "summary", "category", "tags"]),
  publish: new Set(["documentId", "versionId"]),
  archive: new Set(["documentId"]),
  grant_access: new Set(["documentId", "subjectType", "subjectId", "permission"]),
};

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function parseBody(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return null;
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return null;
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function validPayload(command: KnowledgeCommand, payload: Record<string, unknown>) {
  if (Object.keys(payload).some((key) => !ALLOWED_FIELDS[command].has(key))) return false;
  const uuidFields = ["documentId", "versionId", "fileId", "directoryId", "parentId"];
  if (uuidFields.some((field) => payload[field] !== undefined && payload[field] !== null
    && (typeof payload[field] !== "string" || !UUID_PATTERN.test(payload[field] as string)))) return false;
  if ((command === "create_draft" || command === "add_version")
    && (typeof payload.fileId !== "string" || typeof payload.title !== "string")) return false;
  if (command === "create_directory" && (typeof payload.name !== "string" || typeof payload.slug !== "string")) return false;
  if ((command === "publish" || command === "archive" || command === "grant_access") && typeof payload.documentId !== "string") return false;
  if (command === "publish" && typeof payload.versionId !== "string") return false;
  return true;
}

function errorStatus(error: RpcResult["error"]) {
  if (error?.code === "42501") return 403;
  if (error?.code === "P0002") return 404;
  if (error?.code === "23505" || error?.code === "55000") return 409;
  if (error?.code === "22023") return error.message?.includes("unverified_file") ? 422 : 400;
  return 503;
}

function publicError(error: RpcResult["error"]) {
  if (error?.code === "42501") return "forbidden";
  if (error?.code === "P0002") return "not_found";
  if (error?.code === "23505") return "idempotency_conflict";
  if (error?.code === "55000") return "version_conflict";
  if (error?.code === "22023" && error.message?.includes("unverified_file")) return "unverified_file";
  if (error?.code === "22023") return "invalid_request";
  return "knowledge_service_unavailable";
}

function validResult(value: unknown, command: KnowledgeCommand) {
  if (!isRecord(value) || value.outcome !== "success" || value.command !== command || typeof value.resource !== "string") return null;
  const entity = isRecord(value.document) ? value.document : isRecord(value.directory) ? value.directory : null;
  if (entity && typeof entity.id === "string" && !UUID_PATTERN.test(entity.id)) return null;
  return value;
}

async function productionDependencies(): Promise<KnowledgeCommandDependencies> {
  const client = await getSupabaseServerClient();
  return {
    loadSession: getWorkspaceSession,
    rpc: async (name, args) => await client.rpc(name, args) as RpcResult,
  };
}

export async function handleKnowledgeCommand(
  request: Request,
  command: KnowledgeCommand,
  dependencies?: KnowledgeCommandDependencies,
  fixedPayload: Record<string, unknown> = {},
) {
  const deps = dependencies ?? await productionDependencies();
  const session = await deps.loadSession();
  if (!session) return json({ error: "unauthenticated" }, 401);
  if (session.member.status !== "active") return json({ error: "forbidden" }, 403);
  const idempotencyKey = request.headers.get("idempotency-key")?.toLowerCase();
  if (!idempotencyKey || !UUID_PATTERN.test(idempotencyKey)) return json({ error: "invalid_idempotency_key" }, 400);
  const body = await parseBody(request);
  if (!body) return json({ error: "invalid_request" }, 400);
  const payload = { ...body, ...fixedPayload };
  if (!validPayload(command, payload)) return json({ error: "invalid_request" }, 400);
  const requestId = deps.createRequestId?.() ?? randomUUID();
  const result = await deps.rpc("execute_knowledge_command", {
    p_command: command,
    p_payload: payload,
    p_idempotency_key: idempotencyKey,
    p_request_id: requestId,
  });
  if (result.error) return json({ error: publicError(result.error), requestId }, errorStatus(result.error));
  const canonical = validResult(result.data, command);
  if (!canonical) return json({ error: "knowledge_service_unavailable", requestId }, 503);
  return json({ ...canonical, requestId });
}
