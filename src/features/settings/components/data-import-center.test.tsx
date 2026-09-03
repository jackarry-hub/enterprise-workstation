import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DataImportCenter } from "@/features/settings/components/data-import-center";

const uploadVerifiedProjectFile = vi.hoisted(() => vi.fn());

vi.mock("@/features/files/verified-project-file-client", () => ({
  ProjectFileTransportError: class ProjectFileTransportError extends Error {
    constructor(public readonly code: string, public readonly retryable = false, message = "文件服务暂时不可用") {
      super(message);
    }
  },
  uploadVerifiedProjectFile,
}));

const projectId = "11111111-1111-4111-8111-111111111111";
const fileId = "22222222-2222-4222-8222-222222222222";

describe("DataImportCenter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("uploads a real project file and then creates a knowledge draft", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/workstation/data-imports") {
        return Response.json({
          source: "supabase",
          organizationName: "量子星河",
          capabilities: {
            directorySync: true,
            customerImport: true,
            customerExport: false,
            customerExportPii: false,
            projectFileUpload: true,
            knowledgeManage: true,
          },
          projects: [{ id: projectId, code: "QXY-001", name: "企业工作站" }],
          projectDataStatus: "ready",
        });
      }
      if (String(input) === "/api/workstation/knowledge/documents" && init?.method === "POST") {
        return Response.json({ outcome: "success", command: "create_draft", resource: "knowledge_document" });
      }
      return Response.json({ error: "unexpected_request" }, { status: 500 });
    });
    vi.stubGlobal("fetch", fetchMock);
    uploadVerifiedProjectFile.mockResolvedValue({ id: fileId });
    render(<DataImportCenter />);

    expect(await screen.findByText("量子星河 · 真实数据入口")).toBeVisible();
    await userEvent.upload(
      screen.getByLabelText("选择企业资料"),
      new File(["verified content"], "品牌规范.pdf", { type: "application/pdf" }),
    );
    expect(screen.getByLabelText("知识标题")).toHaveValue("品牌规范");
    await userEvent.type(screen.getByLabelText("知识摘要"), "内部品牌资料");
    await userEvent.click(screen.getByRole("button", { name: "上传并创建知识草稿" }));

    expect(await screen.findByText("企业资料已安全入库，并创建知识草稿。审核发布后即可被检索与引用。")).toBeVisible();
    expect(uploadVerifiedProjectFile).toHaveBeenCalledWith(expect.objectContaining({
      projectId,
      accessScope: "organization",
      idempotencyKey: expect.any(String),
    }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/workstation/knowledge/documents",
      expect.objectContaining({ method: "POST" }),
    ));
    const request = fetchMock.mock.calls.find(([url]) => String(url) === "/api/workstation/knowledge/documents")?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      fileId,
      title: "品牌规范",
      summary: "内部品牌资料",
      category: "企业资料",
    });
  });
});
