import { createHash, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import net from "node:net";

type ProcessorJobType = "scan" | "parse" | "vector" | "cleanup";

type ProcessorRequest = {
  jobType: ProcessorJobType;
  sourceUrl?: string;
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
  text?: string;
};

export type KnowledgeProcessorDependencies = {
  download: (sourceUrl: string, maximumBytes: number) => Promise<Buffer>;
  scan: (content: Buffer) => Promise<{ clean: boolean; signature?: string }>;
  parse: (content: Buffer, mimeType: string) => Promise<string>;
  embed: (chunks: readonly string[]) => Promise<number[][]>;
};

const MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const MAX_TEXT_CHARACTERS = 150_000;
const CHUNK_CHARACTERS = 360;
const CHUNK_OVERLAP = 40;
const EMBEDDING_DIMENSIONS = 384;
const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/markdown",
  "text/csv",
  "text/html",
  "application/json",
]);

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function privateAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  const normalized = address.toLowerCase();
  return normalized === "::1" || normalized === "::" || normalized.startsWith("fc")
    || normalized.startsWith("fd") || /^fe[89ab]/.test(normalized);
}

function configuredHosts(value: string | undefined) {
  return (value ?? "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean);
}

async function validateSourceUrl(rawUrl: string) {
  const allowedHosts = configuredHosts(process.env.KNOWLEDGE_SOURCE_ALLOWED_HOSTS);
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.port || !allowedHosts.includes(url.hostname.toLowerCase())) {
    throw new Error("source_url_forbidden");
  }
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => privateAddress(address))) throw new Error("source_url_forbidden");
  return url;
}

async function downloadSource(rawUrl: string, maximumBytes: number) {
  const url = await validateSourceUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(url, { redirect: "error", signal: controller.signal });
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (!response.ok || (declared > 0 && declared > maximumBytes)) throw new Error("source_download_rejected");
    const content = Buffer.from(await response.arrayBuffer());
    if (!content.length || content.length > maximumBytes) throw new Error("source_download_rejected");
    return content;
  } finally {
    clearTimeout(timer);
  }
}

function scanWithClamAv(content: Buffer) {
  const host = process.env.CLAMAV_HOST?.trim() || "clamav";
  const port = Number(process.env.CLAMAV_PORT ?? "3310");
  if (!/^[a-z0-9.-]+$/i.test(host) || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error("clamav_configuration_invalid");
  }
  return new Promise<{ clean: boolean; signature?: string }>((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    const responses: Buffer[] = [];
    const fail = (error: Error) => { socket.destroy(); reject(error); };
    socket.setTimeout(30_000, () => fail(new Error("clamav_timeout")));
    socket.once("error", () => fail(new Error("clamav_unavailable")));
    socket.on("data", (chunk) => responses.push(Buffer.from(chunk)));
    socket.once("connect", () => {
      socket.write(Buffer.from("zINSTREAM\0"));
      for (let offset = 0; offset < content.length; offset += 64 * 1024) {
        const chunk = content.subarray(offset, Math.min(content.length, offset + 64 * 1024));
        const length = Buffer.allocUnsafe(4);
        length.writeUInt32BE(chunk.length);
        socket.write(length);
        socket.write(chunk);
      }
      socket.write(Buffer.alloc(4));
    });
    socket.once("end", () => {
      const response = Buffer.concat(responses).toString("utf8").replace(/\0/g, "").trim();
      if (/\bOK$/.test(response)) resolve({ clean: true });
      else if (/\bFOUND$/.test(response)) resolve({ clean: false, signature: response.slice(0, 160) });
      else reject(new Error("clamav_response_invalid"));
    });
  });
}

function internalServiceUrl(rawValue: string | undefined, fallback: string, expectedHost: string, expectedPath: string) {
  const url = new URL(rawValue?.trim() || fallback);
  if (url.protocol !== "http:" || url.hostname !== expectedHost || url.pathname !== expectedPath
      || url.username || url.password || url.search || url.hash) throw new Error("processor_dependency_configuration_invalid");
  return url;
}

async function parseWithUnstructured(content: Buffer, mimeType: string) {
  const url = internalServiceUrl(process.env.UNSTRUCTURED_URL, "http://unstructured:8000/general/v0/general", "unstructured", "/general/v0/general");
  const form = new FormData();
  const blobBytes = new Uint8Array(content.length);
  blobBytes.set(content);
  form.set("files", new Blob([blobBytes], { type: mimeType }), "source");
  form.set("strategy", "auto");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const response = await fetch(url, { method: "POST", body: form, signal: controller.signal });
    if (!response.ok) throw new Error("document_parse_rejected");
    const result: unknown = await response.json();
    if (!Array.isArray(result)) throw new Error("document_parse_invalid");
    const text = result.map((element) => record(element)?.text).filter((value): value is string => typeof value === "string" && value.trim().length > 0).join("\n\n").trim();
    if (!text || text.length > MAX_TEXT_CHARACTERS) throw new Error("document_text_limit_exceeded");
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function embedWithTei(chunks: readonly string[]) {
  const url = internalServiceUrl(process.env.EMBEDDING_URL, "http://embedding:80/embed", "embedding", "/embed");
  const output: number[][] = [];
  for (let offset = 0; offset < chunks.length; offset += 32) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs: chunks.slice(offset, offset + 32) }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error("embedding_rejected");
      const batch: unknown = await response.json();
      if (!Array.isArray(batch)) throw new Error("embedding_payload_invalid");
      for (const vector of batch) {
        if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS
          || vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) throw new Error("embedding_payload_invalid");
        const norm = Math.sqrt(vector.reduce((sum, value) => sum + Number(value) ** 2, 0));
        if (!Number.isFinite(norm) || norm === 0) throw new Error("embedding_payload_invalid");
        output.push((vector as number[]).map((value) => value / norm));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  if (output.length !== chunks.length) throw new Error("embedding_payload_invalid");
  return output;
}

const defaultDependencies: KnowledgeProcessorDependencies = {
  download: downloadSource,
  scan: scanWithClamAv,
  parse: parseWithUnstructured,
  embed: embedWithTei,
};

function authorized(request: Request) {
  const expected = process.env.KNOWLEDGE_PROCESSOR_SECRET?.trim();
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!expected || !supplied) return false;
  const left = Buffer.from(expected); const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}

function parseRequest(value: unknown): ProcessorRequest | null {
  const input = record(value);
  if (!input || !["scan", "parse", "vector", "cleanup"].includes(String(input.jobType))) return null;
  const jobType = input.jobType as ProcessorJobType;
  if (jobType === "cleanup") return { jobType };
  if (jobType === "vector") {
    if (typeof input.text !== "string" || !input.text.trim() || input.text.length > MAX_TEXT_CHARACTERS) return null;
    return { jobType, text: input.text };
  }
  if (typeof input.sourceUrl !== "string" || typeof input.mimeType !== "string" || !ALLOWED_MIME_TYPES.has(input.mimeType)
    || !Number.isSafeInteger(input.sizeBytes) || Number(input.sizeBytes) < 1 || Number(input.sizeBytes) > MAX_SOURCE_BYTES
    || typeof input.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(input.sha256)) return null;
  return { jobType, sourceUrl: input.sourceUrl, mimeType: input.mimeType, sizeBytes: Number(input.sizeBytes), sha256: input.sha256.toLowerCase() };
}

export function chunkKnowledgeText(text: string) {
  const chunks: Array<{ ordinal: number; content: string; tokenCount: number; page: null; characterFrom: number; characterTo: number }> = [];
  for (let start = 0; start < text.length;) {
    const end = Math.min(text.length, start + CHUNK_CHARACTERS);
    const content = text.slice(start, end).trim();
    if (content) chunks.push({ ordinal: chunks.length, content, tokenCount: Math.max(1, Math.ceil([...content].length / 2)), page: null, characterFrom: start, characterTo: end });
    if (end === text.length) break;
    start = Math.max(start + 1, end - CHUNK_OVERLAP);
  }
  return chunks;
}

export async function handleKnowledgeProcessorGateway(request: Request, dependencies: KnowledgeProcessorDependencies = defaultDependencies) {
  if (!authorized(request)) return json({ error: "not_found" }, 404);
  let input: ProcessorRequest | null = null;
  try { input = parseRequest(await request.json()); } catch { input = null; }
  if (!input) return json({ error: "invalid_request" }, 400);
  try {
    if (input.jobType === "cleanup") return json({ cleaned: true });
    if (input.jobType === "vector") {
      const chunks = chunkKnowledgeText(input.text!);
      const embeddings = await dependencies.embed(chunks.map((chunk) => chunk.content));
      return json({ model: process.env.EMBEDDING_MODEL?.trim() || "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2", chunks: chunks.map((chunk, index) => ({ ordinal: chunk.ordinal, embedding: embeddings[index] })) });
    }
    const content = await dependencies.download(input.sourceUrl!, Math.min(MAX_SOURCE_BYTES, input.sizeBytes!));
    if (content.length !== input.sizeBytes || createHash("sha256").update(content).digest("hex") !== input.sha256) throw new Error("source_integrity_mismatch");
    if (input.jobType === "scan") {
      const result = await dependencies.scan(content);
      return json({ clean: result.clean, detectedMimeType: input.mimeType, signature: result.clean ? undefined : result.signature });
    }
    const text = await dependencies.parse(content, input.mimeType!);
    return json({ text, chunks: chunkKnowledgeText(text) });
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 80) : "processor_failed";
    return json({ error: code }, code === "source_url_forbidden" || code === "source_integrity_mismatch" ? 422 : 503);
  }
}
