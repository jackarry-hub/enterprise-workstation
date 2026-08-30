import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { loadKnowledgeData } from "@/features/knowledge/knowledge-data";

type Response = { data: unknown; error: Error | null };

function query(response: Response) {
  const value = {
    select: () => value, is: () => value, not: () => value, order: () => value,
    limit: () => value, in: () => value,
    then: (resolve: (result: Response) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(response).then(resolve, reject),
  };
  return value;
}

describe("knowledge data", () => {
  it("assembles only RLS-visible documents with immutable version and source ids", async () => {
    const responses: Record<string, Response> = {
      knowledge_directories: { data: [{ id: 11, public_id: "10000000-0000-4000-8000-000000000001", name: "交付资料" }], error: null },
      knowledge_documents: { data: [{
        id: 21, public_id: "20000000-0000-4000-8000-000000000001", directory_id: 11, current_version_id: 31,
        owner_member_id: 41, title: "验收手册", summary: "真实流程", category: "项目", tags: ["验收"], status: "published", updated_at: "2026-08-30T08:00:00Z",
      }], error: null },
      knowledge_document_versions: { data: [{ id: 31, public_id: "30000000-0000-4000-8000-000000000001", source_file_id: 51 }], error: null },
      knowledge_sources: { data: [{ public_id: "40000000-0000-4000-8000-000000000001", version_id: 31 }], error: null },
      files: { data: [{ id: 51, public_id: "50000000-0000-4000-8000-000000000001", original_name: "验收.pdf", mime_type: "application/pdf" }], error: null },
      employee_profiles: { data: [{ organization_member_id: 41, display_name: "王芳" }], error: null },
    };
    const factory = (async () => ({ from: (table: string) => query(responses[table]) })) as never;
    const result = await loadKnowledgeData(true, factory);
    expect(result.documents[0]).toMatchObject({
      id: "20000000-0000-4000-8000-000000000001",
      versionId: "30000000-0000-4000-8000-000000000001",
      sourceId: "40000000-0000-4000-8000-000000000001",
      author: "王芳",
      type: "pdf",
    });
    expect(result.categories).toEqual([expect.objectContaining({ name: "交付资料", documentCount: 1 })]);
  });

  it("returns a traceable unavailable state and never imports fixture data", async () => {
    const factory = (async () => ({ from: () => query({ data: null, error: new Error("offline") }) })) as never;
    const result = await loadKnowledgeData(false, factory);
    expect(result).toMatchObject({ source: "supabase", documents: [], loadError: expect.any(String), requestId: expect.any(String) });
    const workspace = fs.readFileSync(path.join(process.cwd(), "src/features/knowledge/knowledge-workspace.tsx"), "utf8");
    expect(workspace).not.toContain("knowledge-mock-data");
    expect(workspace).not.toContain("OperationalKnowledgePanel");
  });
});
