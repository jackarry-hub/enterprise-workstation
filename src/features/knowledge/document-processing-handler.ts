import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { randomUUID, timingSafeEqual } from "node:crypto";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { validateKnowledgeFileAdmission } from "@/features/files/file-command-handler";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase/server";

type RpcResult = { data: unknown; error: { code?: string } | null };
type ClaimedJob = {
  acquired: true; jobId: string; leaseToken: string; jobType: "scan" | "parse" | "vector" | "cleanup";
  attempt: number; documentId: string; versionId: string; sourceId: string;
  file: { id: string; bucket: string; objectPath: string; mimeType: string; sizeBytes: number; sha256: string };
  text?: string | null;
};

export type KnowledgeProcessingDependencies = {
  serviceRpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  process: (job: ClaimedJob) => Promise<Record<string, unknown>>;
};

export type KnowledgeReindexDependencies = {
  loadSession: () => Promise<{ member: { status: string } } | null>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  createRequestId?: () => string;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function claimed(value: unknown): ClaimedJob | null | false {
  const row = record(value);
  if (!row || row.acquired === false) return false;
  const file = record(row.file);
  if (row.acquired !== true || !file || ![row.jobId, row.leaseToken, row.documentId, row.versionId, row.sourceId, file.id]
    .every((id) => typeof id === "string" && UUID_PATTERN.test(id))) return null;
  if (!["scan", "parse", "vector", "cleanup"].includes(String(row.jobType))
    || typeof file.bucket !== "string" || typeof file.objectPath !== "string" || typeof file.mimeType !== "string"
    || typeof file.sha256 !== "string" || !Number.isSafeInteger(Number(file.sizeBytes))) return null;
  return row as unknown as ClaimedJob;
}

function privateAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb");
}

export async function validateKnowledgeProcessorUrl(rawUrl: string, allowlistedHosts: readonly string[]) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || url.username || url.password || !allowlistedHosts.includes(url.hostname.toLowerCase())) {
    throw new Error("processor_url_forbidden");
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) throw new Error("processor_url_forbidden");
  return url;
}

export async function runKnowledgeProcessingJob(dependencies: KnowledgeProcessingDependencies) {
  const claim = await dependencies.serviceRpc("claim_knowledge_processing_job", { p_lease_seconds: 180 });
  if (claim.error) return { status: "claim_failed" as const };
  const job = claimed(claim.data);
  if (job === false) return { status: "idle" as const };
  if (!job) return { status: "claim_invalid" as const };
  const admitted = validateKnowledgeFileAdmission({
    objectPath: job.file.objectPath,
    mimeType: job.file.mimeType,
    sizeBytes: Number(job.file.sizeBytes),
    sha256: job.file.sha256,
  });
  if (!admitted) {
    await dependencies.serviceRpc("complete_knowledge_processing_job", {
      p_job_id: job.jobId, p_lease_token: job.leaseToken, p_success: false, p_result: {}, p_error_code: "file_admission_rejected",
    });
    return { status: "rejected" as const, jobId: job.jobId };
  }
  try {
    const result = await dependencies.process(job);
    const complete = await dependencies.serviceRpc("complete_knowledge_processing_job", {
      p_job_id: job.jobId, p_lease_token: job.leaseToken, p_success: true, p_result: result, p_error_code: null,
    });
    return complete.error ? { status: "completion_failed" as const, jobId: job.jobId } : { status: "completed" as const, jobId: job.jobId };
  } catch (error) {
    await dependencies.serviceRpc("complete_knowledge_processing_job", {
      p_job_id: job.jobId, p_lease_token: job.leaseToken, p_success: false, p_result: {},
      p_error_code: error instanceof Error ? error.message.slice(0, 80) : "processor_failed",
    });
    return { status: "processor_failed" as const, jobId: job.jobId };
  }
}

export async function runDefaultKnowledgeProcessingJob() {
  const endpoint = process.env.KNOWLEDGE_PROCESSOR_URL?.trim();
  const secret = process.env.KNOWLEDGE_PROCESSOR_SECRET?.trim();
  const hosts = (process.env.KNOWLEDGE_PROCESSOR_ALLOWED_HOSTS ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (!endpoint || !secret || !hosts.length) throw new Error("knowledge_processor_unconfigured");
  const url = await validateKnowledgeProcessorUrl(endpoint, hosts);
  const service = getSupabaseServiceRoleClient();
  return runKnowledgeProcessingJob({
    serviceRpc: async (name, args) => await service.rpc(name, args) as RpcResult,
    process: async (job) => {
      const signed = await service.storage.from(job.file.bucket).createSignedUrl(job.file.objectPath, 300);
      if (signed.error || !signed.data?.signedUrl) throw new Error("source_sign_failed");
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 160_000);
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
          body: JSON.stringify({
            jobType: job.jobType, sourceUrl: signed.data.signedUrl, mimeType: job.file.mimeType,
            sizeBytes: job.file.sizeBytes, sha256: job.file.sha256, text: job.text ?? undefined,
          }),
          signal: controller.signal,
        });
        const contentLength = Number(response.headers.get("content-length") ?? "0");
        if (!response.ok || contentLength > 10_000_000) throw new Error("processor_rejected");
        const raw = await response.text();
        if (Buffer.byteLength(raw, "utf8") > 10_000_000) throw new Error("processor_payload_too_large");
        const parsed: unknown = JSON.parse(raw);
        const result = record(parsed);
        if (!result) throw new Error("processor_payload_invalid");
        return result;
      } finally {
        clearTimeout(timer);
      }
    },
  });
}

export async function handleKnowledgeReindex(request: Request, documentId: string, dependencies?: KnowledgeReindexDependencies) {
  if (!UUID_PATTERN.test(documentId)) return json({ error: "not_found" }, 404);
  const client = dependencies ? null : await getSupabaseServerClient();
  const deps = dependencies ?? {
    loadSession: getWorkspaceSession,
    rpc: async (name: string, args: Record<string, unknown>) => await client!.rpc(name, args) as RpcResult,
  };
  const session = await deps.loadSession();
  if (!session) return json({ error: "unauthenticated" }, 401);
  if (session.member.status !== "active") return json({ error: "forbidden" }, 403);
  const key = request.headers.get("idempotency-key")?.toLowerCase();
  if (!key || !UUID_PATTERN.test(key)) return json({ error: "invalid_idempotency_key" }, 400);
  const requestId = deps.createRequestId?.() ?? randomUUID();
  const result = await deps.rpc("queue_knowledge_reindex", { p_document_public_id: documentId, p_idempotency_key: key, p_request_id: requestId });
  if (result.error) {
    const status = result.error.code === "42501" ? 403 : result.error.code === "P0002" ? 404 : result.error.code === "22023" ? 422 : 503;
    return json({ error: status === 403 ? "forbidden" : status === 404 ? "not_found" : status === 422 ? "source_not_ready" : "knowledge_processing_unavailable", requestId }, status);
  }
  return json({ ...record(result.data), requestId }, 202);
}

export function authorizeInternalKnowledgeWorker(request: Request) {
  const expected = process.env.INTERNAL_WORKER_TOKEN?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected); const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}
