import { describe, expect, it, vi } from "vitest";

import {
  handleApprovalAction,
  handleApprovalSubmission,
} from "@/features/approvals/approval-command-handler";

const templateId = "10000000-0000-4000-8000-000000000001";
const approvalId = "20000000-0000-4000-8000-000000000001";
const idempotencyKey = "30000000-0000-4000-8000-000000000001";
const requestId = "40000000-0000-4000-8000-000000000001";
const ownerEmployeeId = "50000000-0000-4000-8000-000000000001";
const session = { member: { status: "active" }, permissionCodes: ["approval.submit"] };

function request(body: unknown, key = idempotencyKey) {
  return new Request("http://local/api/workstation/approvals", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
}

function actionRequest(body: unknown, key = idempotencyKey) {
  return new Request(`http://local/api/workstation/approvals/${approvalId}/actions`, {
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

function actionSuccess(overrides: Record<string, unknown> = {}) {
  return {
    outcome: "success", resource: "approval", id: approvalId, version: 2,
    entity: {
      id: approvalId, version: 2, status: "pending", currentStep: "财务复核",
      currentStepOrder: 2, ownerEmployeeId, completedAt: null,
      lastAction: {
        type: "approve", comment: null, actedAt: "2026-08-28T07:00:00.000Z",
      },
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

describe("approval action command", () => {
  it("lets the server-confirmed current approver advance one version without a browser actor", async () => {
    const deps = dependencies(actionSuccess());
    const response = await handleApprovalAction(actionRequest({
      command: "approve", expectedVersion: 1, comment: null,
    }), approvalId, deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      resource: "approval",
      approval: { id: approvalId, version: 2, status: "pending", currentStepOrder: 2 },
    });
    expect(deps.rpc).toHaveBeenCalledWith("act_on_current_approval", {
      approval_public_id: approvalId,
      command: "approve",
      expected_version: 1,
      comment: null,
      request_id: idempotencyKey,
    });
  });

  it("maps an unrelated employee decision to forbidden without disclosing the approval", async () => {
    const deps = dependencies({ outcome: "failure", error: "forbidden" });
    const response = await handleApprovalAction(actionRequest({
      command: "approve", expectedVersion: 1, comment: null,
    }), approvalId, deps);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
  });

  it("maps a concurrent second writer to refresh-required conflict", async () => {
    const deps = dependencies({ outcome: "failure", error: "conflict" });
    const response = await handleApprovalAction(actionRequest({
      command: "reject", expectedVersion: 1, comment: "预算依据不足",
    }), approvalId, deps);
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "conflict" });
  });

  it("rejects actor spoofing and unknown action fields before the RPC", async () => {
    const deps = dependencies(null);
    const response = await handleApprovalAction(actionRequest({
      command: "approve", expectedVersion: 1, comment: null, actorEmployeeId: ownerEmployeeId,
    }), approvalId, deps);
    expect(response.status).toBe(400);
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it.each(["reject", "return", "cancel"])("requires a bounded reason for %s", async (command) => {
    const deps = dependencies(null);
    const response = await handleApprovalAction(actionRequest({
      command, expectedVersion: 1, comment: "  ",
    }), approvalId, deps);
    expect(response.status).toBe(400);
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it("requires an idempotency key and a positive safe expected version", async () => {
    const deps = dependencies(null);
    const response = await handleApprovalAction(actionRequest({
      command: "approve", expectedVersion: 0, comment: null,
    }, "not-a-uuid"), approvalId, deps);
    expect(response.status).toBe(400);
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it("rejects an expected version outside the PostgreSQL integer contract", async () => {
    const deps = dependencies(null);
    const response = await handleApprovalAction(actionRequest({
      command: "approve", expectedVersion: 2_147_483_648, comment: null,
    }), approvalId, deps);
    expect(response.status).toBe(400);
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it("rejects a successful response whose version is not request-bound", async () => {
    const deps = dependencies(actionSuccess({
      entity: { ...actionSuccess().entity, version: 3 },
    }));
    const response = await handleApprovalAction(actionRequest({
      command: "approve", expectedVersion: 1, comment: null,
    }), approvalId, deps);
    expect(response.status).toBe(503);
  });

  it("rejects a command-incompatible terminal status even when the DTO is otherwise coherent", async () => {
    const actedAt = "2026-08-28T07:00:00.000Z";
    const deps = dependencies(actionSuccess({ entity: {
      ...actionSuccess().entity,
      status: "rejected", currentStep: null, currentStepOrder: null,
      ownerEmployeeId: null, completedAt: actedAt,
      lastAction: { type: "approve", comment: null, actedAt },
    } }));
    const response = await handleApprovalAction(actionRequest({
      command: "approve", expectedVersion: 1, comment: null,
    }), approvalId, deps);
    expect(response.status).toBe(503);
  });

  it("rejects a successful response whose comment is not request-bound", async () => {
    const deps = dependencies(actionSuccess({ entity: {
      ...actionSuccess().entity,
      lastAction: { type: "approve", comment: "被篡改的意见", actedAt: "2026-08-28T07:00:00.000Z" },
    } }));
    const response = await handleApprovalAction(actionRequest({
      command: "approve", expectedVersion: 1, comment: null,
    }), approvalId, deps);
    expect(response.status).toBe(503);
  });

  it("distinguishes missing authentication from an inactive workspace member", async () => {
    const noSession = dependencies(null, null);
    const unauthorized = await handleApprovalAction(actionRequest({
      command: "approve", expectedVersion: 1, comment: null,
    }), approvalId, noSession);
    expect(unauthorized.status).toBe(401);
    const inactive = dependencies(null, { member: { status: "suspended" }, permissionCodes: [] });
    const forbidden = await handleApprovalAction(actionRequest({
      command: "approve", expectedVersion: 1, comment: null,
    }), approvalId, inactive);
    expect(forbidden.status).toBe(403);
    expect(inactive.rpc).not.toHaveBeenCalled();
  });
});
