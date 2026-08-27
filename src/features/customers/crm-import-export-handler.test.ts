import { describe, expect, it, vi } from "vitest";

import {
  handleCrmExportDownload,
  handleCrmExport,
  handleCrmImport,
  computeCrmImportRowDigest,
  validateCrmImport,
} from "@/features/customers/crm-import-export-handler";

const tenantId = "10000000-0000-4000-8000-000000000001";
const ownerId = "20000000-0000-4000-8000-000000000001";
const customerId = "30000000-0000-4000-8000-000000000001";
const contactId = "40000000-0000-4000-8000-000000000001";
const exportId = "50000000-0000-4000-8000-000000000001";
const importId = "51000000-0000-4000-8000-000000000001";
const watermark = "60000000-0000-4000-8000-000000000001";
const key = "70000000-0000-4000-8000-000000000001";

const session = {
  tenantId,
  member: { status: "active" },
  permissionCodes: ["customer.manage", "customer.import", "customer.export", "customer.export_pii"],
};

function request(path: string, body: unknown) {
  return new Request(`http://local${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
}

const validRow = {
  name: "量子客户 A",
  registrationCode: "91310000IMPORT",
  ownerEmployeePublicId: ownerId,
  industry: "企业服务",
  source: "referral",
  region: "上海",
  contact: {
    name: "王经理", title: "采购负责人", phone: "13800000000", email: null,
    visibility: "assigned", isPrimary: true,
  },
};

describe("CRM import validation", () => {
  it("rejects browser scope fields and duplicate normalized business keys", () => {
    const result = validateCrmImport([
      validRow,
      { ...validRow, name: " 量子客户 a ", registrationCode: "91310000OTHER" },
      { ...validRow, name: "另一客户", tenantId },
    ], tenantId);
    expect(result.accepted).toHaveLength(1);
    expect(result.rejected).toEqual([
      expect.objectContaining({ index: 1, errors: expect.arrayContaining(["duplicate_name_in_batch"]) }),
      expect.objectContaining({ index: 2, errors: expect.arrayContaining(["untrusted_scope_field"]) }),
    ]);
    expect(result.accepted[0]).not.toHaveProperty("tenantId");
    expect(result.accepted[0].fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("requires one real contact channel when a contact is supplied", () => {
    const result = validateCrmImport([{ ...validRow, contact: { ...validRow.contact, phone: null } }], tenantId);
    expect(result.accepted).toEqual([]);
    expect(result.rejected[0]?.errors).toContain("contact_channel_required");
  });

  it("uses a stable length-prefixed digest over the normalized row", () => {
    const [row] = validateCrmImport([{ ...validRow, name: "  量子客户   A  " }], tenantId).accepted;
    expect(row.name).toBe("量子客户 A");
    expect(row.fingerprint).toBe(computeCrmImportRowDigest(row));
  });
});

describe("CRM import command", () => {
  it("uses a deterministic per-row idempotency key and canonical imported IDs", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: {
        outcome: "success", resource: "crm_import_job", id: importId, version: 1,
        entity: { id: importId, version: 1, status: "running", totalRows: 1,
          validRows: 1, validationRejectedRows: 0 },
      }, error: null })
      .mockResolvedValueOnce({ data: {
        outcome: "success", resource: "customer_import", id: customerId, version: 1,
        entity: { id: customerId, version: 1, contactId, name: validRow.name,
          registrationCode: validRow.registrationCode },
      }, error: null })
      .mockResolvedValueOnce({ data: {
        outcome: "success", resource: "crm_import_job", id: importId, version: 1,
        entity: { id: importId, version: 1, status: "completed", totalRows: 1,
          acceptedRows: 1, rejectedRows: 0 },
      }, error: null });
    const response = await handleCrmImport(request("/api/workstation/customers/import", {
      rows: [validRow], reason: "首批客户数据迁移", cursor: 0,
    }), { session, rpc, createRequestId: () => watermark });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      outcome: "success", resource: "crm_import",
      jobId: importId, acceptedRows: 1, rejectedRows: 0, totalRows: 1,
    });
    expect(rpc).toHaveBeenNthCalledWith(1, "begin_current_crm_import", expect.objectContaining({
      p_total_rows: 1, p_valid_rows: 1, p_validation_rejections: [],
      p_accepted_manifest: [{ index: 0, rowDigest: expect.stringMatching(/^[0-9a-f]{64}$/) }],
      idempotency_key: key,
    }));
    expect(rpc).toHaveBeenNthCalledWith(2, "import_current_customer_row", expect.objectContaining({
      p_import_job_public_id: importId, p_row_index: 0,
      p_name: validRow.name,
      p_owner_employee_public_id: ownerId,
      request_id: watermark,
      idempotency_key: expect.stringMatching(/^[0-9a-f-]{36}$/),
    }));
    expect(rpc).toHaveBeenNthCalledWith(3, "finalize_current_crm_import", expect.objectContaining({
      p_import_job_public_id: importId,
    }));
  });

  it("rejects an unassigned employee before any database call", async () => {
    const rpc = vi.fn();
    const response = await handleCrmImport(request("/api/workstation/customers/import", {
      rows: [validRow], reason: "越权导入", cursor: 0,
    }), { session: { ...session, permissionCodes: [] }, rpc });
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("CRM export command", () => {
  it("rejects an unassigned export before any database call", async () => {
    const rpc = vi.fn();
    const response = await handleCrmExport(request("/api/workstation/customers/export", {
      customerId: null, includeContactPii: false, reason: "越权导出",
    }), { session: { ...session, permissionCodes: [] }, rpc });
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("creates a durable permission-scoped snapshot job without returning bulk rows", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      outcome: "success", resource: "crm_export", id: exportId, version: 1,
      entity: {
        id: exportId, version: 1, watermark, scope: "all", customerId: null,
        includeContactPii: false, rowCount: 1, exportedAt: "2099-08-28T04:00:00Z",
        expiresAt: "2099-08-28T04:15:00Z",
        sha256: "a".repeat(64), downloadUrl: `/api/workstation/customers/export/${exportId}`,
      },
    }, error: null });
    const response = await handleCrmExport(request("/api/workstation/customers/export", {
      customerId: null, includeContactPii: false, reason: "季度客户台账归档",
    }), { session, rpc, createRequestId: () => watermark });
    expect(response.status).toBe(202);
    expect(response.headers.get("X-CRM-Export-Watermark")).toBe(watermark);
    expect(await response.json()).toMatchObject({
      outcome: "success", resource: "crm_export", exportId, watermark,
      rowCount: 1, downloadUrl: `/api/workstation/customers/export/${exportId}`,
    });
  });

  it("requires the dedicated PII export permission", async () => {
    const rpc = vi.fn();
    const response = await handleCrmExport(request("/api/workstation/customers/export", {
      customerId: null, includeContactPii: true, reason: "联系人备份",
    }), { session: { ...session, permissionCodes: ["customer.export"] }, rpc });
    expect(response.status).toBe(403);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("downloads a canonical snapshot only through the separately audited endpoint", async () => {
    const rows = [{ id: customerId, name: "真实客户", registrationCode: null,
      industry: "企业服务", source: "referral", region: "上海", status: "following",
      ownerEmployeePublicId: ownerId }];
    const rpc = vi.fn().mockResolvedValue({ data: {
      id: exportId, watermark, includeContactPii: false, rowCount: 1,
      sha256: "a".repeat(64), exportedAt: "2099-08-28T04:00:00Z", rows,
    }, error: null });
    const response = await handleCrmExportDownload(
      new Request(`http://local/api/workstation/customers/export/${exportId}`),
      { params: Promise.resolve({ exportId }) },
      { session, rpc, createRequestId: () => watermark },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toContain(exportId);
    expect(response.headers.get("X-CRM-Export-SHA256")).toBe("a".repeat(64));
    expect(await response.json()).toEqual({ exportId, watermark, includeContactPii: false,
      sha256: "a".repeat(64),
      exportedAt: "2099-08-28T04:00:00Z", rows });
    expect(rpc).toHaveBeenCalledWith("download_current_crm_export", {
      p_export_public_id: exportId, request_id: watermark,
    });
  });
});
