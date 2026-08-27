import { describe, expect, it, vi } from "vitest";

import {
  handleCustomerContactCreateCommand,
  handleCustomerCreateCommand,
  handleCustomerUpdateCommand,
} from "@/features/customers/customer-command-handler";

const customerId = "b1000000-0000-4000-8000-000000000001";
const ownerId = "b1000000-0000-4000-8000-000000000002";
const contactId = "b1000000-0000-4000-8000-000000000003";
const idempotencyKey = "b1000000-0000-4000-8000-000000000004";
const requestId = "b1000000-0000-4000-8000-000000000005";
const session = { member: { status: "active" }, permissionCodes: ["customer.manage"] };

function request(url: string, method: string, body: unknown, contentType = "application/json") {
  return new Request(url, {
    method,
    headers: { "content-type": contentType, "Idempotency-Key": idempotencyKey },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function customerInput() {
  return {
    name: "量子制造", registrationCode: "91310000TEST", ownerEmployeePublicId: ownerId,
    industry: "manufacturing", source: "referral", region: "上海", status: "following",
    version: 0, reason: "建立正式客户档案",
  };
}

function customerResult(version = 1) {
  return {
    outcome: "success", resource: "customer", id: customerId, version,
    entity: {
      id: customerId, version, ownerEmployeePublicId: ownerId, name: "量子制造",
      registrationCode: "91310000TEST", industry: "manufacturing", source: "referral",
      region: "上海", status: "following", updatedAt: "2026-08-28T10:00:00.000Z",
      archivedAt: null,
    },
  };
}

describe("customer command handler", () => {
  it("requires an active customer manager before parsing the body", async () => {
    const rpc = vi.fn();
    const unauthorized = await handleCustomerCreateCommand(
      request("https://workspace.test/api/workstation/customers", "POST", customerInput()),
      { session: null, rpc },
    );
    expect(unauthorized.status).toBe(401);

    const forbidden = await handleCustomerCreateCommand(
      request("https://workspace.test/api/workstation/customers", "POST", customerInput()),
      { session: { member: { status: "active" }, permissionCodes: [] }, rpc },
    );
    expect(forbidden.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("creates a customer through one exact idempotent RPC without client scope", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: customerResult(), error: null });
    const response = await handleCustomerCreateCommand(
      request("https://workspace.test/api/workstation/customers", "POST", customerInput()),
      { session, rpc, createRequestId: () => requestId },
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      outcome: "success", resource: "customer",
      customer: expect.objectContaining({ id: customerId, version: 1, name: "量子制造" }),
    });
    expect(rpc).toHaveBeenCalledWith("create_current_customer", expect.objectContaining({
      p_owner_employee_public_id: ownerId, p_version: 0,
      request_id: requestId, idempotency_key: idempotencyKey,
    }));
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("tenantId");
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("organizationId");
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("actorId");
  });

  it("rejects empty, unexpected and client-owned scope fields", async () => {
    const rpc = vi.fn();
    for (const body of [
      { ...customerInput(), name: "" },
      { ...customerInput(), tenantId: "spoof" },
      { ...customerInput(), version: 1 },
    ]) {
      const response = await handleCustomerCreateCommand(
        request("https://workspace.test/api/workstation/customers", "POST", body),
        { session, rpc },
      );
      expect(response.status).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });

  it("enforces JSON media type and body size before the RPC", async () => {
    const rpc = vi.fn();
    const media = await handleCustomerCreateCommand(
      request("https://workspace.test/api/workstation/customers", "POST", "{}", "text/plain"),
      { session, rpc },
    );
    expect(media.status).toBe(415);
    const oversized = new Request("https://workspace.test/api/workstation/customers", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "32769",
        "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(customerInput()),
    });
    expect((await handleCustomerCreateCommand(oversized, { session, rpc })).status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("updates by public id and optimistic version", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: customerResult(3), error: null });
    const input = { ...customerInput(), expectedVersion: 2 } as Record<string, unknown>;
    delete input.version;
    const response = await handleCustomerUpdateCommand(
      request(`https://workspace.test/api/workstation/customers/${customerId}`, "PATCH", input),
      { params: Promise.resolve({ customerId: customerId.toUpperCase() }) },
      { session, rpc, createRequestId: () => requestId },
    );
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("update_current_customer", expect.objectContaining({
      p_customer_public_id: customerId, p_expected_version: 2,
    }));
  });

  it("maps a stale update to conflict and sanitizes unknown failures", async () => {
    const input = { ...customerInput(), expectedVersion: 2 } as Record<string, unknown>;
    delete input.version;
    const staleRpc = vi.fn().mockResolvedValue({ data: { outcome: "failure", error: "stale_version" }, error: null });
    const stale = await handleCustomerUpdateCommand(
      request(`https://workspace.test/api/workstation/customers/${customerId}`, "PATCH", input),
      { params: Promise.resolve({ customerId }) }, { session, rpc: staleRpc },
    );
    expect(stale.status).toBe(409);

    const unknownRpc = vi.fn().mockResolvedValue({ data: { outcome: "failure", error: "private_database_detail" }, error: null });
    const unknown = await handleCustomerUpdateCommand(
      request(`https://workspace.test/api/workstation/customers/${customerId}`, "PATCH", input),
      { params: Promise.resolve({ customerId }) }, { session, rpc: unknownRpc },
    );
    expect(unknown.status).toBe(503);
    expect(await unknown.json()).toEqual({ error: "customer_command_unavailable" });
  });

  it("creates restricted contact PII without accepting an actor", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      outcome: "success", resource: "customer_contact", id: contactId, version: 1,
      entity: { id: contactId, customerId, version: 1, name: "王经理", title: "采购负责人",
        phone: "13800000000", email: "buyer@example.test", visibility: "assigned", isPrimary: true,
        createdAt: "2026-08-28T10:00:00.000Z", updatedAt: "2026-08-28T10:00:00.000Z" },
    }, error: null });
    const response = await handleCustomerContactCreateCommand(
      request(`https://workspace.test/api/workstation/customers/${customerId}/contacts`, "POST", {
        name: "王经理", title: "采购负责人", phone: "13800000000", email: "buyer@example.test",
        visibility: "assigned", isPrimary: true, version: 0, reason: "录入主要联系人",
      }), { params: Promise.resolve({ customerId }) }, { session, rpc },
    );
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ outcome: "success", resource: "customer_contact",
      contact: expect.objectContaining({ id: contactId, customerId, isPrimary: true }) });
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("actorId");
  });

  it("rejects a malformed success DTO instead of confirming a crossed resource", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      ...customerResult(), resource: "project", id: ownerId,
    }, error: null });
    const response = await handleCustomerCreateCommand(
      request("https://workspace.test/api/workstation/customers", "POST", customerInput()),
      { session, rpc },
    );
    expect(response.status).toBe(503);
  });

  it("rejects extra success and failure fields at the RPC trust boundary", async () => {
    const extraSuccess = vi.fn().mockResolvedValue({ data: {
      ...customerResult(), internalTenantId: 99,
    }, error: null });
    const successResponse = await handleCustomerCreateCommand(
      request("https://workspace.test/api/workstation/customers", "POST", customerInput()),
      { session, rpc: extraSuccess },
    );
    expect(successResponse.status).toBe(503);

    const extraFailure = vi.fn().mockResolvedValue({ data: {
      outcome: "failure", error: "conflict", detail: "private index name",
    }, error: null });
    const failureResponse = await handleCustomerCreateCommand(
      request("https://workspace.test/api/workstation/customers", "POST", customerInput()),
      { session, rpc: extraFailure },
    );
    expect(failureResponse.status).toBe(503);
    expect(await failureResponse.json()).toEqual({ error: "customer_command_unavailable" });
  });

  it("rejects a contact success DTO without valid contact PII", async () => {
    for (const pii of [
      { phone: null, email: null },
      { phone: null, email: "not-an-email" },
    ]) {
      const rpc = vi.fn().mockResolvedValue({ data: {
        outcome: "success", resource: "customer_contact", id: contactId, version: 1,
        entity: { id: contactId, customerId, version: 1, name: "王经理", title: "采购负责人",
          ...pii, visibility: "assigned", isPrimary: true,
          createdAt: "2026-08-28T10:00:00.000Z", updatedAt: "2026-08-28T10:00:00.000Z" },
      }, error: null });
      const response = await handleCustomerContactCreateCommand(
        request(`https://workspace.test/api/workstation/customers/${customerId}/contacts`, "POST", {
          name: "王经理", title: "采购负责人", phone: "13800000000", email: null,
          visibility: "assigned", isPrimary: true, version: 0, reason: "录入主要联系人",
        }), { params: Promise.resolve({ customerId }) }, { session, rpc },
      );
      expect(response.status).toBe(503);
    }
  });

  it("rejects canonical success timestamps with impossible calendar dates", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      ...customerResult(), entity: { ...customerResult().entity,
        updatedAt: "2026-02-29T10:00:00.000Z" },
    }, error: null });
    const response = await handleCustomerCreateCommand(
      request("https://workspace.test/api/workstation/customers", "POST", customerInput()),
      { session, rpc },
    );
    expect(response.status).toBe(503);
  });
});
