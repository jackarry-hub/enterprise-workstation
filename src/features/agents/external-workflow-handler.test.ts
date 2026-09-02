import { describe, expect, it, vi } from "vitest";

import { handleExternalWorkflowCollection, handleExternalWorkflowRuns, type ExternalWorkflowDependencies } from "@/features/agents/external-workflow-handler";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

const runId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";

function dependencies(overrides: Partial<ExternalWorkflowDependencies> = {}): ExternalWorkflowDependencies {
  return {
    loadSession: async () => executiveWorkspaceSession,
    userRpc: vi.fn().mockResolvedValue({ data: { items: [] }, error: null }),
    serviceRpc: vi.fn(async (name: string) => name === "start_external_workflow_run"
      ? { data: { runId, status: "running", alreadyExists: false }, error: null }
      : { data: { runId, status: "succeeded", upstreamRunId: "upstream-1", outputSummary: "已提交" }, error: null }),
    fetchExternal: vi.fn().mockResolvedValue(Response.json({ runId: "upstream-1", status: "queued" }, { status: 202 })),
    credential: () => "server-only-token",
    createRequestId: () => requestId,
    ...overrides,
  };
}

describe("external workflow Agent adapter", () => {
  it("publishes the six reviewed workflows without exposing credentials", async () => {
    const response = await handleExternalWorkflowCollection(new Request("https://q.test/api/workstation/agent-workflows"), dependencies({ credential: (provider) => provider === "image-studio" ? "secret-token" : null }));
    const body = await response.json();
    expect(response.status).toBe(200); expect(body.items).toHaveLength(6);
    expect(body.items.find((item: { code: string }) => item.code === "family-portrait")).toMatchObject({ nativeRunEnabled: true, connectionStatus: "ready" });
    expect(body.items.find((item: { code: string }) => item.code === "tarot-lead-video")).toMatchObject({ nativeRunEnabled: false, connectionStatus: "unconfigured" });
    expect(JSON.stringify(body)).not.toContain("secret-token");
  });

  it("does not create a run when the provider connection is not configured", async () => {
    const serviceRpc = vi.fn(); const fetchExternal = vi.fn();
    const response = await handleExternalWorkflowRuns(new Request("https://q.test", { method: "POST", body: JSON.stringify({ input: "生成口播视频" }) }), "digital-human-talking-video", dependencies({ serviceRpc, fetchExternal, credential: () => null }));
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ error: "workflow_connection_unconfigured" }); expect(serviceRpc).not.toHaveBeenCalled(); expect(fetchExternal).not.toHaveBeenCalled();
  });

  it("forwards a content workflow only to the fixed service endpoint and records the receipt", async () => {
    const deps = dependencies(); const response = await handleExternalWorkflowRuns(new Request("https://q.test", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": requestId }, body: JSON.stringify({ input: "生成一条产品口播视频" }) }), "digital-human-talking-video", deps);
    expect(response.status).toBe(201);
    expect(deps.fetchExternal).toHaveBeenCalledWith("https://content.quantumgalaxy.top/api/integrations/v1/workflows/digital-human-talking-video/runs", expect.objectContaining({ method: "POST", redirect: "error" }));
    const init = vi.mocked(deps.fetchExternal).mock.calls[0][1]; const headers = new Headers(init.headers);
    expect(headers.get("authorization")).toBe("Bearer server-only-token"); expect(String(init.body)).toContain("digital-human-talking-video");
    expect(deps.serviceRpc).toHaveBeenNthCalledWith(1, "start_external_workflow_run", expect.objectContaining({ p_request_id: requestId, p_workflow_code: "digital-human-talking-video" }));
    expect(deps.serviceRpc).toHaveBeenNthCalledWith(2, "finalize_external_workflow_run", expect.objectContaining({ p_status: "succeeded", p_upstream_run_id: "upstream-1" }));
  });

  it("validates image count, MIME type and size before any external write", async () => {
    const deps = dependencies(); const form = new FormData(); form.set("size", "1536x1024"); form.append("images", new File(["not-image"], "malware.exe", { type: "application/octet-stream" }));
    const response = await handleExternalWorkflowRuns(new Request("https://q.test", { method: "POST", body: form }), "family-portrait", deps);
    expect(response.status).toBe(400); expect(deps.serviceRpc).not.toHaveBeenCalled(); expect(deps.fetchExternal).not.toHaveBeenCalled();
  });

  it("forwards a validated image job without returning arbitrary upstream fields", async () => {
    const upstream = vi.fn().mockResolvedValue(Response.json({ jobId: "image-job-1", status: "queued", internalStoragePath: "must-not-leak" }, { status: 202 }));
    const deps = dependencies({ fetchExternal: upstream }); const form = new FormData(); form.set("size", "1024x1024"); form.set("promptOverride", "自然家庭合影");
    form.append("images", new File([Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])], "family.png", { type: "image/png" }));
    const request = new Request("https://q.test", { method: "POST" }); vi.spyOn(request, "formData").mockResolvedValue(form);
    const response = await handleExternalWorkflowRuns(request, "family-portrait", deps); const body = await response.json();
    expect(response.status).toBe(201); expect(upstream).toHaveBeenCalledWith("https://studio.quantumgalaxy.top/api/image-studio/jobs", expect.objectContaining({ method: "POST" }));
    expect(JSON.stringify(body)).not.toContain("internalStoragePath");
    const forwarded = vi.mocked(upstream).mock.calls[0][1].body as FormData; expect(forwarded.get("workflowKey")).toBe("family-portrait"); expect((forwarded.get("images") as File).name).toBe("family.png");
  });

  it("keeps users inside their own durable workflow history", async () => {
    const userRpc = vi.fn().mockResolvedValue({ data: { items: [{ id: runId, status: "succeeded" }] }, error: null });
    const response = await handleExternalWorkflowRuns(new Request("https://q.test", { method: "GET" }), "family-portrait", dependencies({ userRpc }));
    expect(response.status).toBe(200); expect(userRpc).toHaveBeenCalledWith("list_current_external_workflow_runs", { p_workflow_code: "family-portrait", p_limit: 50 });
  });
});
