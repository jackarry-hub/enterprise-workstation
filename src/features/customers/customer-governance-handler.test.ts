import { describe, expect, it, vi } from "vitest";

import {
  handleCustomerArchiveCommand,
  handleCustomerContractCreateCommand,
  handleCustomerRestoreCommand,
  handleCustomerSourceLinkCreateCommand,
  handleCustomerTransferCommand,
} from "@/features/customers/customer-command-handler";

const customerId = "10000000-0000-4000-8000-000000000001";
const ownerId = "20000000-0000-4000-8000-000000000001";
const opportunityId = "30000000-0000-4000-8000-000000000001";
const projectId = "40000000-0000-4000-8000-000000000001";
const contractId = "50000000-0000-4000-8000-000000000001";
const sourceLinkId = "60000000-0000-4000-8000-000000000001";
const key = "70000000-0000-4000-8000-000000000001";
const requestId = "80000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ customerId }) };
const session = { member: { status: "active" }, permissionCodes: ["customer.manage"] };

function request(path: string, body: unknown) {
  return new Request(`http://local${path}`, { method: "POST", headers: {
    "Content-Type": "application/json", "Idempotency-Key": key,
  }, body: JSON.stringify(body) });
}

function dependencies(data: unknown, activeSession = session) {
  return { session: activeSession, rpc: vi.fn().mockResolvedValue({ data, error: null }),
    createRequestId: () => requestId };
}

describe("customer governance commands", () => {
  it("blocks ownership transfer without customer.manage", async () => {
    const deps = dependencies(null, { ...session, permissionCodes: [] });
    const response = await handleCustomerTransferCommand(request("/transfer", {
      ownerEmployeePublicId: ownerId, expectedVersion: 2, reason: "调整客户负责人",
    }), context, deps);
    expect(response.status).toBe(403);
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it("binds ownership transfer to the route customer and next version", async () => {
    const deps = dependencies({
      outcome: "success", resource: "customer_transfer", id: customerId, version: 3,
      entity: { id: customerId, version: 3, ownerEmployeePublicId: ownerId,
        previousOwnerEmployeePublicId: "21000000-0000-4000-8000-000000000001",
        updatedAt: "2026-08-28T04:00:00Z" },
    });
    const response = await handleCustomerTransferCommand(request("/transfer", {
      ownerEmployeePublicId: ownerId, expectedVersion: 2, reason: "调整客户负责人",
    }), context, deps);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ resource: "customer_transfer",
      transfer: { customerId, ownerEmployeePublicId: ownerId, version: 3 } });
    expect(deps.rpc).toHaveBeenCalledWith("transfer_current_customer_owner", expect.objectContaining({
      p_customer_public_id: customerId, p_new_owner_employee_public_id: ownerId,
      p_expected_version: 2,
    }));
  });

  it("rejects a contract DTO crossed to another customer", async () => {
    const deps = dependencies({
      outcome: "success", resource: "customer_contract", id: contractId, version: 1,
      entity: { id: contractId, customerId: ownerId, opportunityId, projectId,
        contractNumber: "HT-2026-001", title: "交付合同", status: "active",
        amount: "880000.00", currency: "CNY", signedOn: "2026-08-28",
        startsOn: "2026-09-01", endsOn: "2026-10-31", version: 1,
        createdAt: "2026-08-28T04:00:00Z", updatedAt: "2026-08-28T04:00:00Z" },
    });
    const response = await handleCustomerContractCreateCommand(request("/contracts", {
      opportunityId, projectId, contractNumber: "HT-2026-001", title: "交付合同",
      status: "active", amount: "880000.00", currency: "CNY", signedOn: "2026-08-28",
      startsOn: "2026-09-01", endsOn: "2026-10-31", version: 0, reason: "登记已签合同",
    }), context, deps);
    expect(response.status).toBe(503);
  });

  it("creates immutable source provenance only for a concrete linked record", async () => {
    const deps = dependencies({
      outcome: "success", resource: "crm_source_link", id: sourceLinkId, version: 1,
      entity: { id: sourceLinkId, customerId, contactId: null, opportunityId, projectId: null,
        sourceSystem: "feishu", externalRecordId: "opp-2026-001",
        sourceUrl: "https://example.test/source/opp-2026-001", createdAt: "2026-08-28T04:00:00Z" },
    });
    const response = await handleCustomerSourceLinkCreateCommand(request("/source-links", {
      contactId: null, opportunityId, projectId: null, sourceSystem: "feishu",
      externalRecordId: "opp-2026-001", sourceUrl: "https://example.test/source/opp-2026-001",
      version: 0, reason: "关联飞书原始商机",
    }), context, deps);
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ resource: "crm_source_link",
      sourceLink: { id: sourceLinkId, customerId, opportunityId } });
  });

  it.each([
    "https://example.test/source#access%5Ftoken=secret",
    "https://example.test/source#",
    "https://example.test:8443/source",
    "https://example.test/source?external%5Fid=1",
  ])("rejects a source URL outside the database-safe canonical form: %s", async (sourceUrl) => {
    const deps = dependencies(null);
    const response = await handleCustomerSourceLinkCreateCommand(request("/source-links", {
      contactId: null, opportunityId, projectId: null, sourceSystem: "external_crm",
      externalRecordId: "unsafe-source-url", sourceUrl,
      version: 0, reason: "拒绝携带片段的来源地址",
    }), context, deps);
    expect(response.status).toBe(400);
    expect(deps.rpc).not.toHaveBeenCalled();
  });

  it("archives and restores through separate optimistic lifecycle commands", async () => {
    const archiveDeps = dependencies({
      outcome: "success", resource: "customer_lifecycle", id: customerId, version: 3,
      entity: { id: customerId, version: 3, archived: true, archivedAt: "2026-08-28T04:00:00Z" },
    });
    const archive = await handleCustomerArchiveCommand(request("/archive", {
      expectedVersion: 2, reason: "客户合作结束",
    }), context, archiveDeps);
    expect(archive.status).toBe(200);

    const restoreDeps = dependencies({
      outcome: "success", resource: "customer_lifecycle", id: customerId, version: 4,
      entity: { id: customerId, version: 4, archived: false, archivedAt: null },
    });
    const restore = await handleCustomerRestoreCommand(request("/restore", {
      expectedVersion: 3, reason: "客户重新合作",
    }), context, restoreDeps);
    expect(restore.status).toBe(200);
    expect(await restore.json()).toMatchObject({ lifecycle: { customerId, archived: false, version: 4 } });
  });
});
