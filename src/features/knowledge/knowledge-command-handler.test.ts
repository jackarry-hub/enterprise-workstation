import { describe, expect, it, vi } from "vitest";

import { handleKnowledgeCommand, type KnowledgeCommandDependencies } from "@/features/knowledge/knowledge-command-handler";

const key = "10000000-0000-4000-8000-000000000001";
const fileId = "20000000-0000-4000-8000-000000000001";
const documentId = "30000000-0000-4000-8000-000000000001";
const versionId = "40000000-0000-4000-8000-000000000001";

function request(body: object) {
  return new Request("http://local.test/api/workstation/knowledge", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
}

function deps(result: { data: unknown; error: { code?: string; message?: string } | null }): KnowledgeCommandDependencies {
  return {
    loadSession: async () => ({ member: { status: "active" } }),
    rpc: vi.fn().mockResolvedValue(result),
    createRequestId: () => "50000000-0000-4000-8000-000000000001",
  };
}

describe("knowledge commands", () => {
  it("creates a verified-file draft through the single audited RPC", async () => {
    const dependencies = deps({ data: {
      outcome: "success", command: "create_draft", resource: "knowledge_document",
      document: { id: documentId, versionId, version: 1, status: "draft" },
    }, error: null });
    const response = await handleKnowledgeCommand(request({ fileId, title: "交付手册", summary: "" }), "create_draft", dependencies);
    expect(response.status).toBe(200);
    expect(dependencies.rpc).toHaveBeenCalledWith("execute_knowledge_command", expect.objectContaining({
      p_command: "create_draft", p_idempotency_key: key,
    }));
  });

  it("rejects browser actor fields and never calls the database", async () => {
    const dependencies = deps({ data: null, error: null });
    const response = await handleKnowledgeCommand(request({ fileId, title: "交付手册", actorId: documentId }), "create_draft", dependencies);
    expect(response.status).toBe(400);
    expect(dependencies.rpc).not.toHaveBeenCalled();
  });

  it("maps permission and unverified-file failures without exposing database text", async () => {
    const forbidden = deps({ data: null, error: { code: "42501", message: "sensitive detail" } });
    const denied = await handleKnowledgeCommand(request({ documentId, versionId }), "publish", forbidden);
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toContain("sensitive detail");

    const unverified = deps({ data: null, error: { code: "22023", message: "unverified_file" } });
    const rejected = await handleKnowledgeCommand(request({ fileId, title: "交付手册" }), "create_draft", unverified);
    expect(rejected.status).toBe(422);
    expect(await rejected.json()).toMatchObject({ error: "unverified_file" });
  });

  it("fails closed for inactive sessions", async () => {
    const dependencies = deps({ data: null, error: null });
    dependencies.loadSession = async () => ({ member: { status: "disabled" } });
    const response = await handleKnowledgeCommand(request({ documentId }), "archive", dependencies);
    expect(response.status).toBe(403);
    expect(dependencies.rpc).not.toHaveBeenCalled();
  });
});
