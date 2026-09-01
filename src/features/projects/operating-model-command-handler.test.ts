import { describe, expect, it, vi } from "vitest";

import { createOperatingModelCommandHandler } from "@/features/projects/operating-model-command-handler";

const projectId = "91000000-0000-4000-8000-000000000001";
const entityId = "91000000-0000-4000-8000-000000000002";
const employeeId = "91000000-0000-4000-8000-000000000003";
const idempotencyKey = "91000000-0000-4000-8000-000000000004";
const requestId = "91000000-0000-4000-8000-000000000005";

function request(body: Record<string, unknown>, key = idempotencyKey) {
  return new Request(`http://localhost/api/workstation/projects/${projectId}/operating-model`, {
    method: "POST", headers: { "content-type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
}

function dependencies(rpc = vi.fn()) {
  return { session: { member: { status: "active" } }, rpc, createRequestId: () => requestId };
}

describe("operating model command handler", () => {
  it("publishes a bounded SOP without accepting browser actor identity", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      outcome: "success", resource: "sop_definition", id: entityId, version: 1,
      entity: { id: entityId, projectId, version: 1, status: "active", revision: 1 },
    }, error: null });
    const response = await createOperatingModelCommandHandler(dependencies(rpc))(
      request({ command: "save_sop", definitionId: null, code: "delivery", name: "交付流程", description: "",
        steps: [{ key: "accept", name: "人工验收", description: "验证证据", kind: "approval", requiresHuman: true }],
        publish: true, reason: "发布标准交付流程" }),
      { params: Promise.resolve({ projectId }) },
    );
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("save_current_project_sop", expect.objectContaining({
      p_project_public_id: projectId, p_publish: true, request_id: requestId, idempotency_key: idempotencyKey,
    }));
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("actorMemberId");
  });

  it("records only decisions with a real evidence citation", async () => {
    const handler = createOperatingModelCommandHandler(dependencies());
    const response = await handler(request({ command: "record_decision", type: "decision", title: "确认上线窗口",
      summary: "根据验收任务安排灰度", citations: [], ownerEmployeeId: employeeId, reason: "记录决策" }),
    { params: Promise.resolve({ projectId }) });
    expect(response.status).toBe(400);
  });

  it("fails closed for malformed success and sanitizes database details", async () => {
    const malformed = vi.fn().mockResolvedValue({ data: {
      outcome: "success", resource: "project_retrospective", id: entityId, version: 1,
      entity: { id: entityId, projectId: "91000000-0000-4000-8000-000000000099", version: 1, secret: "no" },
    }, error: null });
    const response = await createOperatingModelCommandHandler(dependencies(malformed))(
      request({ command: "save_retrospective", outcome: "完成目标", wins: "协作顺畅", lessons: "提前联调",
        followUps: "沉淀模板", expectedVersion: 0, reason: "正式复盘" }), { params: Promise.resolve({ projectId }) },
    );
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "operating_model_unavailable" });
  });

  it("requires an active session and canonical idempotency key", async () => {
    const unauthorized = await createOperatingModelCommandHandler({ ...dependencies(), session: null })(
      request({}), { params: Promise.resolve({ projectId }) },
    );
    expect(unauthorized.status).toBe(401);
    const invalidKey = await createOperatingModelCommandHandler(dependencies())(
      request({ command: "update_risk" }, "bad"), { params: Promise.resolve({ projectId }) },
    );
    expect(invalidKey.status).toBe(400);
  });
});
