import { describe, expect, it, vi } from "vitest";

import { handleKnowledgeSearch, handleKnowledgeSource, type KnowledgeSearchDependencies } from "@/features/knowledge/knowledge-search";

const ids = {
  document: "10000000-0000-4000-8000-000000000001",
  version: "20000000-0000-4000-8000-000000000001",
  source: "30000000-0000-4000-8000-000000000001",
  file: "40000000-0000-4000-8000-000000000001",
};

function deps(data: unknown, error: { code?: string } | null = null): KnowledgeSearchDependencies {
  return {
    loadSession: async () => ({ member: { status: "active" } }),
    rpc: vi.fn().mockResolvedValue({ data, error }),
    signSource: vi.fn().mockResolvedValue("https://storage.test/signed"),
    createRequestId: () => "50000000-0000-4000-8000-000000000001",
  };
}

describe("knowledge search and citation", () => {
  it("returns stable document, version and source identities", async () => {
    const dependencies = deps([{
      document_id: ids.document, version_id: ids.version, source_id: ids.source,
      title: "交付手册", excerpt: "验收流程", rank: 0.8,
    }]);
    const response = await handleKnowledgeSearch(new Request("http://local.test/api/workstation/knowledge/search?q=验收"), dependencies);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ results: [{ documentId: ids.document, versionId: ids.version, sourceId: ids.source }] });
  });

  it("rejects oversized queries before database access", async () => {
    const dependencies = deps([]);
    const response = await handleKnowledgeSearch(new Request(`http://local.test/api/workstation/knowledge/search?q=${"x".repeat(201)}`), dependencies);
    expect(response.status).toBe(400);
    expect(dependencies.rpc).not.toHaveBeenCalled();
  });

  it("signs a source only after the permission-filtered authorization RPC", async () => {
    const dependencies = deps({
      documentId: ids.document, versionId: ids.version, sourceId: ids.source, fileId: ids.file,
      bucket: "workbench-files", objectPath: "tenants/safe/source.pdf", fileName: "source.pdf", mimeType: "application/pdf",
    });
    const response = await handleKnowledgeSource(ids.document, dependencies);
    expect(response.status).toBe(200);
    expect(dependencies.signSource).toHaveBeenCalledOnce();
    expect(await response.json()).toMatchObject({ documentId: ids.document, versionId: ids.version, sourceId: ids.source });
  });

  it("returns 404 without source metadata for an unauthorized or missing document", async () => {
    const dependencies = deps(null, { code: "P0002" });
    const response = await handleKnowledgeSource(ids.document, dependencies);
    expect(response.status).toBe(404);
    expect(dependencies.signSource).not.toHaveBeenCalled();
  });
});
