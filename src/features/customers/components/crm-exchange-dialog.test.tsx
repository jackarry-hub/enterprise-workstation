import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CrmExchangeDialog } from "@/features/customers/components/crm-exchange-dialog";

const exportId = "50000000-0000-4000-8000-000000000001";

describe("CrmExchangeDialog", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:crm-export") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  });

  it("uploads a bounded JSON batch through the durable import endpoint", async () => {
    const user = userEvent.setup();
    const complete = vi.fn();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      outcome: "success", resource: "crm_import", jobId: "51000000-0000-4000-8000-000000000001",
      acceptedRows: 1, rejectedRows: 0, totalRows: 1, rejected: [],
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    render(<CrmExchangeDialog open onOpenChange={vi.fn()} canImport canExport canExportPii onComplete={complete} />);
    const file = new File([JSON.stringify([{ name: "真实客户" }])], "customers.json", { type: "application/json" });
    await user.upload(screen.getByLabelText("客户导入文件"), file);
    await user.type(screen.getByLabelText("导入原因"), "历史 CRM 数据迁移");
    await user.click(screen.getByRole("button", { name: "开始导入" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workstation/customers/import");
    expect(fetchMock.mock.calls[0][1]?.body).toContain("真实客户");
    expect(await screen.findByRole("status")).toHaveTextContent("成功 1 条");
    expect(complete).toHaveBeenCalledOnce();
  });

  it("advances resumable import chunks with one stable idempotency key", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        outcome: "processing", resource: "crm_import", jobId: "51000000-0000-4000-8000-000000000001",
        nextCursor: 20, processedRows: 20, validRows: 21, validationRejectedRows: 0,
        totalRows: 21, rejected: [],
      }), { status: 202, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        outcome: "success", resource: "crm_import", jobId: "51000000-0000-4000-8000-000000000001",
        acceptedRows: 21, rejectedRows: 0, totalRows: 21, rejected: [],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    render(<CrmExchangeDialog open onOpenChange={vi.fn()} canImport canExport canExportPii={false} onComplete={vi.fn()} />);
    const rows = Array.from({ length: 21 }, (_, index) => ({ name: `客户 ${index + 1}` }));
    await user.upload(screen.getByLabelText("客户导入文件"), new File([JSON.stringify(rows)], "customers.json", { type: "application/json" }));
    await user.type(screen.getByLabelText("导入原因"), "分批迁移");
    await user.click(screen.getByRole("button", { name: "开始导入" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[0][1]?.body).toContain('"cursor":0');
    expect(fetchMock.mock.calls[1][1]?.body).toContain('"cursor":20');
    const firstHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    const secondHeaders = fetchMock.mock.calls[1][1]?.headers as Record<string, string>;
    expect(secondHeaders["Idempotency-Key"]).toBe(firstHeaders["Idempotency-Key"]);
  });

  it("rejects a terminal import response that contradicts prior chunk totals", async () => {
    const user = userEvent.setup();
    const complete = vi.fn();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        outcome: "processing", resource: "crm_import", jobId: "51000000-0000-4000-8000-000000000001",
        nextCursor: 20, processedRows: 20, validRows: 41, validationRejectedRows: 1,
        totalRows: 42, rejected: [{ index: 41, errors: ["invalid_name"] }],
      }), { status: 202, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        outcome: "processing", resource: "crm_import", jobId: "51000000-0000-4000-8000-000000000001",
        nextCursor: 40, processedRows: 40, validRows: 41, validationRejectedRows: 1,
        totalRows: 42, rejected: [],
      }), { status: 202, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        outcome: "success", resource: "crm_import", jobId: "51000000-0000-4000-8000-000000000001",
        acceptedRows: 42, rejectedRows: 0, totalRows: 42, rejected: [],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    render(<CrmExchangeDialog open onOpenChange={vi.fn()} canImport canExport={false} canExportPii={false} onComplete={complete} />);
    const rows = Array.from({ length: 42 }, (_, index) => ({ name: `客户 ${index + 1}` }));
    await user.upload(screen.getByLabelText("客户导入文件"), new File([JSON.stringify(rows)], "customers.json", { type: "application/json" }));
    await user.type(screen.getByLabelText("导入原因"), "校验跨批次汇总");
    await user.click(screen.getByRole("button", { name: "开始导入" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("状态尚未确认");
    expect(complete).not.toHaveBeenCalled();
  });

  it("requires terminal import responses to include every rejected row", async () => {
    const user = userEvent.setup();
    const complete = vi.fn();
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
        outcome: "processing", resource: "crm_import", jobId: "51000000-0000-4000-8000-000000000001",
        nextCursor: 20, processedRows: 20, validRows: 21, validationRejectedRows: 0,
        totalRows: 21, rejected: [],
      }), { status: 202, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        outcome: "partial", resource: "crm_import", jobId: "51000000-0000-4000-8000-000000000001",
        acceptedRows: 20, rejectedRows: 1, totalRows: 21, rejected: [],
      }), { status: 207, headers: { "Content-Type": "application/json" } }));
    render(<CrmExchangeDialog open onOpenChange={vi.fn()} canImport canExport={false} canExportPii={false} onComplete={complete} />);
    const rows = Array.from({ length: 21 }, (_, index) => ({ name: `客户 ${index + 1}` }));
    await user.upload(screen.getByLabelText("客户导入文件"), new File([JSON.stringify(rows)], "customers.json", { type: "application/json" }));
    await user.type(screen.getByLabelText("导入原因"), "校验拒绝明细完整性");
    await user.click(screen.getByRole("button", { name: "开始导入" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("状态尚未确认");
    expect(complete).not.toHaveBeenCalled();
  });

  it("keeps the idempotency key when a successful response is malformed", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ outcome: "success", resource: "crm_import" }), {
        status: 200, headers: { "Content-Type": "application/json" },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        outcome: "success", resource: "crm_import", jobId: "51000000-0000-4000-8000-000000000001",
        acceptedRows: 1, rejectedRows: 0, totalRows: 1, rejected: [],
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    render(<CrmExchangeDialog open onOpenChange={vi.fn()} canImport canExport={false} canExportPii={false} onComplete={vi.fn()} />);
    await user.upload(screen.getByLabelText("客户导入文件"), new File(["[{}]"], "customers.json", { type: "application/json" }));
    await user.type(screen.getByLabelText("导入原因"), "确认响应契约");
    await user.click(screen.getByRole("button", { name: "开始导入" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("状态尚未确认");
    await user.click(screen.getByRole("button", { name: "开始导入" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const firstHeaders = fetchMock.mock.calls[0][1]?.headers as Record<string, string>;
    const secondHeaders = fetchMock.mock.calls[1][1]?.headers as Record<string, string>;
    expect(secondHeaders["Idempotency-Key"]).toBe(firstHeaders["Idempotency-Key"]);
  });

  it("requests a PII-gated snapshot before starting the separately audited download", async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    const rows = Array.from({ length: 3 }, (_, index) => ({
      id: `30000000-0000-4000-8000-00000000000${index + 1}`,
      name: `真实客户 ${index + 1}`, registrationCode: null, industry: "企业服务",
      source: "referral", region: "上海", status: "following",
      ownerEmployeePublicId: "20000000-0000-4000-8000-000000000001",
      primaryContact: null,
    }));
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({
      outcome: "success", resource: "crm_export", exportId,
      watermark: "60000000-0000-4000-8000-000000000001", rowCount: 3,
      includeContactPii: true,
      exportedAt: "2099-08-28T04:00:00Z", expiresAt: "2099-08-28T04:15:00Z",
      sha256: "a".repeat(64),
      downloadUrl: `/api/workstation/customers/export/${exportId}`,
    }), { status: 202, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        exportId, watermark: "60000000-0000-4000-8000-000000000001",
        includeContactPii: true, sha256: "a".repeat(64),
        exportedAt: "2099-08-28T04:00:00Z", rows,
      }), { status: 200, headers: { "Content-Type": "application/json", "X-CRM-Export-SHA256": "a".repeat(64) } }));
    render(<CrmExchangeDialog open onOpenChange={vi.fn()} canImport canExport canExportPii onComplete={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "导出" }));
    await user.click(screen.getByRole("checkbox"));
    await user.type(screen.getByLabelText("导出用途"), "季度客户台账归档");
    await user.click(screen.getByRole("button", { name: "生成并下载快照" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[0][0]).toBe("/api/workstation/customers/export");
    expect(fetchMock.mock.calls[0][1]?.body).toContain('"includeContactPii":true');
    expect(click).toHaveBeenCalledOnce();
    expect(await screen.findByRole("status")).toHaveTextContent("下载已完成");
    expect(screen.getByRole("button", { name: "重新下载已生成快照" })).toBeInTheDocument();
  });
});
