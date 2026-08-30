import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { KnowledgePage } from "@/features/knowledge/knowledge-page";
import type { KnowledgeDataResult } from "@/features/knowledge/knowledge-types";
import { renderWithWorkspaceSession as render } from "@/test/workspace-session-test-utils";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const result: KnowledgeDataResult = {
  source: "supabase",
  canManage: true,
  activities: [],
  files: [{ id: "50000000-0000-4000-8000-000000000001", name: "验收手册.pdf", mimeType: "application/pdf" }],
  categories: [{ id: "10000000-0000-4000-8000-000000000001", name: "项目文档", documentCount: 1, tone: "blue" }],
  documents: [{
    id: "20000000-0000-4000-8000-000000000001",
    title: "真实交付验收手册.pdf",
    summary: "来自数据库的项目验收流程。",
    categoryId: "10000000-0000-4000-8000-000000000001",
    type: "pdf",
    author: "王芳",
    updatedAt: "2026-08-30T08:00:00.000Z",
    views: 0,
    tags: ["项目管理", "验收"],
    status: "published",
    versionId: "30000000-0000-4000-8000-000000000001",
    sourceId: "40000000-0000-4000-8000-000000000001",
    sourceName: "验收手册.pdf",
  }],
};

describe("KnowledgePage", () => {
  it("renders only the supplied real knowledge result and real counts", () => {
    render(<KnowledgePage result={result} />);
    expect(screen.getByRole("heading", { name: "知识库" })).toBeVisible();
    expect(screen.getAllByText("真实交付验收手册.pdf").length).toBeGreaterThan(0);
    expect(screen.queryByText("企业员工手册（2026版）.pdf")).not.toBeInTheDocument();
    expect(screen.getByText("暂无当前账号可见的知识动态")).toBeVisible();
  });

  it("filters by a real directory and exposes a version-bound source link", async () => {
    const user = userEvent.setup();
    render(<KnowledgePage result={result} />);
    await user.click(screen.getByRole("button", { name: "项目文档" }));
    await user.click(screen.getAllByRole("button", { name: /预览文档/ })[0]);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("作者")).toBeVisible();
    expect(within(dialog).getByRole("link", { name: /查看来源/ })).toHaveAttribute("data-version-id", result.documents[0].versionId);
  });

  it("shows a genuine empty state and resets local filters", async () => {
    const user = userEvent.setup();
    render(<KnowledgePage result={result} />);
    await user.type(screen.getByRole("searchbox", { name: "搜索知识库" }), "完全不存在的文档");
    expect(screen.getByText("没有找到相关文档")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "清除搜索与筛选" }));
    expect(screen.queryByText("没有找到相关文档")).not.toBeInTheDocument();
  });
});
