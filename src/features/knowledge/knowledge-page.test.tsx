import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { KnowledgePage } from "@/features/knowledge/knowledge-page";

describe("KnowledgePage", () => {
  it("renders the approved knowledge structure", () => {
    render(<KnowledgePage />);

    expect(screen.getByRole("heading", { name: "知识库" })).toBeVisible();
    expect(screen.getByRole("searchbox", { name: "搜索知识库" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "最近查看" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "热门文档" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "知识库动态" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "文档文件夹" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "标签云" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "知识库概览" })).toBeVisible();
  });

  it("filters by category and previews a document", async () => {
    const user = userEvent.setup();
    render(<KnowledgePage />);

    await user.click(screen.getByRole("button", { name: "项目文档" }));
    await user.click(screen.getAllByRole("button", { name: /预览文档/ })[0]);

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("作者")).toBeVisible();
    expect(within(dialog).getByText("更新时间")).toBeVisible();
  });

  it("shows an empty state and resets search", async () => {
    const user = userEvent.setup();
    render(<KnowledgePage />);

    await user.type(screen.getByRole("searchbox", { name: "搜索知识库" }), "完全不存在的文档");
    expect(screen.getByText("没有找到相关文档")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "清除搜索与筛选" }));
    expect(screen.queryByText("没有找到相关文档")).not.toBeInTheDocument();
  });
});
