import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { chunkKnowledgeText, handleKnowledgeProcessorGateway, type KnowledgeProcessorDependencies } from "@/features/knowledge/processor-gateway";

const secret = "processor-secret-with-at-least-32-characters";
const content = Buffer.from("QuantXY knowledge acceptance");
const base = {
  jobType: "scan",
  sourceUrl: "https://project.supabase.co/storage/v1/object/sign/source",
  mimeType: "text/plain",
  sizeBytes: content.length,
  sha256: createHash("sha256").update(content).digest("hex"),
};

function request(body: unknown, suppliedSecret = secret) {
  return new Request("https://staging.example/api/internal/knowledge-processor", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${suppliedSecret}` },
    body: JSON.stringify(body),
  });
}

function dependencies(): KnowledgeProcessorDependencies {
  return {
    download: vi.fn().mockResolvedValue(content),
    scan: vi.fn().mockResolvedValue({ clean: true }),
    parse: vi.fn().mockResolvedValue("第一段知识\n\nSecond knowledge section"),
    embed: vi.fn().mockImplementation(async (chunks: readonly string[]) => chunks.map(() => Array(384).fill(0.125))),
  };
}

beforeEach(() => {
  vi.stubEnv("KNOWLEDGE_PROCESSOR_SECRET", secret);
  vi.stubEnv("EMBEDDING_MODEL", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2");
});

describe("knowledge processor gateway", () => {
  it("fails closed when the processor secret is absent or wrong", async () => {
    expect((await handleKnowledgeProcessorGateway(request(base, "wrong"), dependencies())).status).toBe(404);
  });

  it("scans an integrity-checked source", async () => {
    const response = await handleKnowledgeProcessorGateway(request(base), dependencies());
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ clean: true, detectedMimeType: "text/plain" });
  });

  it("rejects a source whose digest does not match", async () => {
    const response = await handleKnowledgeProcessorGateway(request({ ...base, sha256: "a".repeat(64) }), dependencies());
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "source_integrity_mismatch" });
  });

  it("returns deterministic parse chunks and real 384-dimensional vector payloads", async () => {
    const deps = dependencies();
    const parsed = await handleKnowledgeProcessorGateway(request({ ...base, jobType: "parse" }), deps);
    const parseBody = await parsed.json();
    expect(parseBody.chunks[0]).toMatchObject({ ordinal: 0, characterFrom: 0 });

    const vector = await handleKnowledgeProcessorGateway(request({ jobType: "vector", text: parseBody.text }), deps);
    const vectorBody = await vector.json();
    expect(vectorBody.model).toContain("MiniLM");
    expect(vectorBody.chunks[0].embedding).toHaveLength(384);
  });

  it("uses overlapping stable chunk ordinals", () => {
    const chunks = chunkKnowledgeText("甲".repeat(3_000));
    expect(chunks.slice(0, 3).map((chunk) => chunk.ordinal)).toEqual([0, 1, 2]);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks[1].characterFrom).toBeLessThan(chunks[0].characterTo);
  });
});
