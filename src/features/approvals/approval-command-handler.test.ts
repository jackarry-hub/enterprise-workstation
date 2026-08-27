import { describe, expect, it, vi } from "vitest";

import { handleApprovalSubmission } from "@/features/approvals/approval-command-handler";

const templateId = "10000000-0000-4000-8000-000000000001";
const approvalId = "20000000-0000-4000-8000-000000000001";
const idempotencyKey = "30000000-0000-4000-8000-000000000001";
const requestId = "40000000-0000-4000-8000-000000000001";
const session = { member: { status: "active" }, permissionCodes: ["approval.submit"] };

function request(body: unknown, key = idempotencyKey) {
  return new Request("http://local/api/workstation/approvals", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
}

function dependencies(data: unknown, activeSession: typeof session | null = session) {
  return {
    session: activeSession,
    rpc: vi.fn().mockResolvedValue({ data, error: null }),
    createRequestId: () => requestId,
  };
}

function success(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "success", resource: "approval", id: approvalId, version: 1,
    entity: {
      id: approvalId, version: 1, approvalCode: "AP-20000000000040008000",
      approvalType: "reimbursement", title: "差旅报销审批", status: "pending",
      currentStep: "直属主管审批", templateId, templateVersion: 1,
      submittedAt: "2026-08-28T06:30:00.000Z",
    },
    ...overrides,
  };
}

describe("approval submission command", () => {
  it("submits a strict template-bound form with server-owned identity and one idempotency key", async () => {
    const deps = dependencies(success());
    const response = await handleApprovalSubmission(request({
      templateId,
      formData: { amount: "1280.50", purpose: "客户现场差旅", projectCode: "PRJ-2026-001" },
    }), deps);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      resource: "approval",
      approval: { id: approvalId, status: "pending", templateId, templateVersion: 1 },
    });
    expect(deps.rpc).toHaveBeenCalledWith("submit_current_approval", {
      template_public_id: templateId,
      form_data: { amount: "1280.50", purpose: "客户现场差旅", projectCode: "PRJ-2026-001" },
      idempotency_key: idempotencyKey,
      request_id: requestId,
    });
  });

  it("rejects inactive or unauthorized sessions before invoking the RPC", async () => {
    const deps = dependencies(null, { member: { status: "active" }, permissionCodes: [] });
    const response = await handleApprovalSubmission(request({ templateId, formData: {} }), deps);
    expect(response.status).toBe(403);
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it("returns 401 when no authenticated workspace session exists", async () => {
    const deps = dependencies(null, null);
    const response = await handleApprovalSubmission(request({ templateId, formData: {} }), deps);
    expect(response.status).toBe(401);
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it("rejects unknown body fields and malformed idempotency keys", async () => {
    const deps = dependencies(null);
    const response = await handleApprovalSubmission(request({
      templateId, formData: {}, applicantId: approvalId,
    }, "not-a-uuid"), deps);
    expect(response.status).toBe(400);
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it("maps stored template validation failures without exposing database detail", async () => {
    const deps = dependencies({ outcome: "failure", error: "invalid_form" });
    const response = await handleApprovalSubmission(request({
      templateId, formData: { amount: "12.345" },
    }), deps);
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "invalid_form" });
  });

  it("fails closed when a successful RPC response is not bound to the requested template", async () => {
    const deps = dependencies(success({ entity: { ...success().entity, templateId: approvalId } }));
    const response = await handleApprovalSubmission(request({ templateId, formData: {} }), deps);
    expect(response.status).toBe(503);
  });

  it.each([
    { approvalType: ["reimbursement"] },
    { status: ["pending"] },
    { approvalCode: "approval-1" },
    { approvalCode: "AP-FFFFFFFFFFFFFFFFFFFF" },
    { submittedAt: "next Thursday" },
  ])("rejects canonical response drift: %j", async (entityOverride) => {
    const deps = dependencies(success({ entity: { ...success().entity, ...entityOverride } }));
    const response = await handleApprovalSubmission(request({ templateId, formData: {} }), deps);
    expect(response.status).toBe(503);
  });
});
