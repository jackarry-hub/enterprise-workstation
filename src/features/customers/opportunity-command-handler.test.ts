import { describe, expect, it, vi } from "vitest";

import {
  handleCustomerFollowUpCreateCommand,
  handleOpportunityConvertCommand,
  handleOpportunityCreateCommand,
  handleOpportunityTransitionCommand,
} from "@/features/customers/opportunity-command-handler";

const customerId = "b2000000-0000-4000-8000-000000000001";
const opportunityId = "b2000000-0000-4000-8000-000000000002";
const ownerId = "b2000000-0000-4000-8000-000000000003";
const followUpId = "b2000000-0000-4000-8000-000000000004";
const projectId = "b2000000-0000-4000-8000-000000000005";
const linkId = "b2000000-0000-4000-8000-000000000006";
const idempotencyKey = "b2000000-0000-4000-8000-000000000007";
const requestId = "b2000000-0000-4000-8000-000000000008";
const session = { member: { status: "active" }, permissionCodes: ["customer.manage", "project.manage"] };

function request(url: string, body: unknown, method = "POST", contentType = "application/json") {
  return new Request(url, {
    method,
    headers: { "content-type": contentType, "Idempotency-Key": idempotencyKey },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function opportunityInput() {
  return {
    name: "智能产线一期", ownerEmployeePublicId: ownerId, amount: "880000.00",
    currency: "CNY", expectedCloseOn: "2026-10-31", version: 0,
    reason: "登记真实商机",
  };
}

function opportunityResult(stage = "lead", version = 1) {
  return {
    outcome: "success", resource: "opportunity", id: opportunityId, version,
    entity: {
      id: opportunityId, customerId, ownerEmployeePublicId: ownerId,
      name: "智能产线一期", stage, amount: "880000.00", currency: "CNY",
      expectedCloseOn: "2026-10-31", lossReason: null, version,
      createdAt: "2026-08-28T10:00:00.000Z", updatedAt: "2026-08-28T10:00:00.000Z",
      archivedAt: null,
    },
  };
}

describe("opportunity command handler", () => {
  it("requires an active customer manager before parsing business input", async () => {
    const rpc = vi.fn();
    const unauthorized = await handleOpportunityCreateCommand(
      request(`https://workspace.test/api/workstation/customers/${customerId}/opportunities`, opportunityInput()),
      { params: Promise.resolve({ customerId }) }, { session: null, rpc },
    );
    expect(unauthorized.status).toBe(401);
    const forbidden = await handleOpportunityCreateCommand(
      request(`https://workspace.test/api/workstation/customers/${customerId}/opportunities`, opportunityInput()),
      { params: Promise.resolve({ customerId }) },
      { session: { member: { status: "active" }, permissionCodes: [] }, rpc },
    );
    expect(forbidden.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("creates a lead through an exact money-safe RPC without client scope", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: opportunityResult(), error: null });
    const response = await handleOpportunityCreateCommand(
      request(`https://workspace.test/api/workstation/customers/${customerId}/opportunities`, opportunityInput()),
      { params: Promise.resolve({ customerId: customerId.toUpperCase() }) },
      { session, rpc, createRequestId: () => requestId },
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      outcome: "success", resource: "opportunity",
      opportunity: expect.objectContaining({ id: opportunityId, customerId, amount: "880000.00" }),
    });
    expect(rpc).toHaveBeenCalledWith("create_current_opportunity", expect.objectContaining({
      p_customer_public_id: customerId, p_owner_employee_public_id: ownerId,
      p_amount: "880000.00", p_version: 0, request_id: requestId,
      idempotency_key: idempotencyKey,
    }));
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("tenantId");
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("organizationId");
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("actorId");
  });

  it("rejects amount coercion, extra actor fields and malformed dates", async () => {
    const rpc = vi.fn();
    for (const body of [
      { ...opportunityInput(), amount: 880000 },
      { ...opportunityInput(), actorId: ownerId },
      { ...opportunityInput(), expectedCloseOn: "2026-02-29" },
    ]) {
      const response = await handleOpportunityCreateCommand(
        request(`https://workspace.test/api/workstation/customers/${customerId}/opportunities`, body),
        { params: Promise.resolve({ customerId }) }, { session, rpc },
      );
      expect(response.status).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("maps an invalid stage jump to 422 and stale versions to 409", async () => {
    const invalidRpc = vi.fn().mockResolvedValue({
      data: { outcome: "failure", error: "invalid_stage" }, error: null,
    });
    const invalid = await handleOpportunityTransitionCommand(
      request(`https://workspace.test/api/workstation/opportunities/${opportunityId}`, {
        stage: "won", lossReason: null, expectedVersion: 1, reason: "禁止跳级",
      }, "PATCH"), { params: Promise.resolve({ opportunityId }) }, { session, rpc: invalidRpc },
    );
    expect(invalid.status).toBe(422);

    const staleRpc = vi.fn().mockResolvedValue({
      data: { outcome: "failure", error: "stale_version" }, error: null,
    });
    const stale = await handleOpportunityTransitionCommand(
      request(`https://workspace.test/api/workstation/opportunities/${opportunityId}`, {
        stage: "qualified", lossReason: null, expectedVersion: 1, reason: "完成资格确认",
      }, "PATCH"), { params: Promise.resolve({ opportunityId }) }, { session, rpc: staleRpc },
    );
    expect(stale.status).toBe(409);
  });

  it("requires a loss reason only for the lost terminal state", async () => {
    const rpc = vi.fn();
    for (const body of [
      { stage: "lost", lossReason: null, expectedVersion: 3, reason: "关闭" },
      { stage: "proposal", lossReason: "不应存在", expectedVersion: 2, reason: "进入方案" },
    ]) {
      const response = await handleOpportunityTransitionCommand(
        request(`https://workspace.test/api/workstation/opportunities/${opportunityId}`, body, "PATCH"),
        { params: Promise.resolve({ opportunityId }) }, { session, rpc },
      );
      expect(response.status).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("creates a follow-up with no client actor or occurred-at timestamp", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      outcome: "success", resource: "customer_follow_up", id: followUpId, version: 1,
      entity: { id: followUpId, customerId, opportunityId,
        actorEmployeePublicId: ownerId, kind: "meeting", content: "确认正式范围",
        occurredAt: "2026-08-28T10:00:00.000Z", nextFollowUpAt: "2026-08-29T10:00:00.000Z" },
    }, error: null });
    const response = await handleCustomerFollowUpCreateCommand(
      request(`https://workspace.test/api/workstation/customers/${customerId}/follow-ups`, {
        opportunityId, kind: "meeting", content: "确认正式范围",
        nextFollowUpAt: "2026-08-29T18:00:00+08:00", version: 0, reason: "记录客户会议",
      }), { params: Promise.resolve({ customerId }) }, { session, rpc },
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ outcome: "success", resource: "customer_follow_up",
      followUp: expect.objectContaining({ id: followUpId, actorEmployeePublicId: ownerId }) });
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("actorId");
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("occurredAt");
  });

  it("converts only through the aggregate RPC and confirms both canonical ids", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      outcome: "success", resource: "opportunity_conversion", id: opportunityId, version: 4,
      entity: { opportunityId, opportunityVersion: 4, projectId, projectVersion: 1,
        customerProjectLinkId: linkId },
    }, error: null });
    const response = await handleOpportunityConvertCommand(
      request(`https://workspace.test/api/workstation/opportunities/${opportunityId}/convert`, {
        projectName: "智能产线交付", description: "正式交付", category: "客户交付",
        status: "planning", priority: "high", startsOn: "2026-09-01", dueOn: "2026-10-31",
        expectedVersion: 3, reason: "赢单转交付项目",
      }), { params: Promise.resolve({ opportunityId }) }, { session, rpc },
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ outcome: "success", resource: "opportunity_conversion",
      conversion: { opportunityId, opportunityVersion: 4, projectId, projectVersion: 1,
        customerProjectLinkId: linkId } });
    expect(rpc).toHaveBeenCalledWith("convert_current_opportunity_to_project", expect.objectContaining({
      p_opportunity_public_id: opportunityId, p_expected_version: 3,
    }));
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("ownerEmployeePublicId");
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("budgetAmount");
  });

  it("fails closed for crossed conversion ids and unexpected RPC fields", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      outcome: "success", resource: "opportunity_conversion", id: projectId, version: 4,
      entity: { opportunityId, opportunityVersion: 4, projectId, projectVersion: 1,
        customerProjectLinkId: linkId, tenantId: 99 },
    }, error: null });
    const response = await handleOpportunityConvertCommand(
      request(`https://workspace.test/api/workstation/opportunities/${opportunityId}/convert`, {
        projectName: "智能产线交付", description: "正式交付", category: "客户交付",
        status: "planning", priority: "high", startsOn: "2026-09-01", dueOn: "2026-10-31",
        expectedVersion: 3, reason: "赢单转交付项目",
      }), { params: Promise.resolve({ opportunityId }) }, { session, rpc },
    );
    expect(response.status).toBe(503);
  });

  it("binds every valid-shaped success DTO to the normalized command input", async () => {
    const driftedCreate = await handleOpportunityCreateCommand(
      request(`https://workspace.test/api/workstation/customers/${customerId}/opportunities`, opportunityInput()),
      { params: Promise.resolve({ customerId }) },
      { session, rpc: vi.fn().mockResolvedValue({ data: opportunityResult("qualified", 2), error: null }) },
    );
    expect(driftedCreate.status).toBe(503);

    const driftedTransition = await handleOpportunityTransitionCommand(
      request(`https://workspace.test/api/workstation/opportunities/${opportunityId}`, {
        stage: "qualified", lossReason: null, expectedVersion: 1, reason: "完成资格确认",
      }, "PATCH"), { params: Promise.resolve({ opportunityId }) }, {
        session, rpc: vi.fn().mockResolvedValue({ data: opportunityResult("proposal", 3), error: null }),
      },
    );
    expect(driftedTransition.status).toBe(503);

    const driftedFollowUp = await handleCustomerFollowUpCreateCommand(
      request(`https://workspace.test/api/workstation/customers/${customerId}/follow-ups`, {
        opportunityId, kind: "meeting", content: "确认正式范围",
        nextFollowUpAt: "2026-08-29T10:00:00.000Z", version: 0, reason: "记录客户会议",
      }), { params: Promise.resolve({ customerId }) }, { session, rpc: vi.fn().mockResolvedValue({ data: {
        outcome: "success", resource: "customer_follow_up", id: followUpId, version: 1,
        entity: { id: followUpId, customerId, opportunityId, actorEmployeePublicId: ownerId,
          kind: "call", content: "确认正式范围", occurredAt: "2026-08-28T10:00:00.000Z",
          nextFollowUpAt: "2026-08-29T10:00:00.000Z" },
      }, error: null }) },
    );
    expect(driftedFollowUp.status).toBe(503);

    const driftedConversion = await handleOpportunityConvertCommand(
      request(`https://workspace.test/api/workstation/opportunities/${opportunityId}/convert`, {
        projectName: "智能产线交付", description: "正式交付", category: "客户交付",
        status: "planning", priority: "high", startsOn: "2026-09-01", dueOn: "2026-10-31",
        expectedVersion: 3, reason: "赢单转交付项目",
      }), { params: Promise.resolve({ opportunityId }) }, { session, rpc: vi.fn().mockResolvedValue({ data: {
        outcome: "success", resource: "opportunity_conversion", id: opportunityId, version: 4,
        entity: { opportunityId, opportunityVersion: 4, projectId, projectVersion: 2,
          customerProjectLinkId: linkId },
      }, error: null }) },
    );
    expect(driftedConversion.status).toBe(503);
  });

  it("enforces JSON media type, body size and idempotency key before RPC", async () => {
    const rpc = vi.fn();
    const media = await handleOpportunityCreateCommand(
      request(`https://workspace.test/api/workstation/customers/${customerId}/opportunities`, "{}", "POST", "text/plain"),
      { params: Promise.resolve({ customerId }) }, { session, rpc },
    );
    expect(media.status).toBe(415);
    const missingKey = new Request(
      `https://workspace.test/api/workstation/customers/${customerId}/opportunities`,
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(opportunityInput()) },
    );
    expect((await handleOpportunityCreateCommand(missingKey,
      { params: Promise.resolve({ customerId }) }, { session, rpc })).status).toBe(400);
    const oversized = new Request(
      `https://workspace.test/api/workstation/customers/${customerId}/opportunities`, {
        method: "POST", headers: { "content-type": "application/json", "content-length": "32769",
          "Idempotency-Key": idempotencyKey }, body: JSON.stringify(opportunityInput()),
      },
    );
    expect((await handleOpportunityCreateCommand(oversized,
      { params: Promise.resolve({ customerId }) }, { session, rpc })).status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });
});
