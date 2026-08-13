import { screen } from "@testing-library/react";
import { renderWithWorkspaceSession as render } from "@/test/workspace-session-test-utils";
import { describe, expect, it } from "vitest";

import { HelpCenter } from "@/features/help/help-center";

describe("HelpCenter", () => {
  it("shows the current role workflow and only its allowed module entries", () => {
    render(<HelpCenter />);

    expect(screen.getByRole("heading", { name: "使用帮助" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "企业任务完整闭环" })).toBeVisible();
    expect(screen.getByText("在 AI 决策调度台输入目标、期限、预算和约束")).toBeVisible();
    expect(screen.getByRole("link", { name: /AI 决策调度台/ })).toHaveAttribute("href", "/decision");
    expect(screen.queryByRole("link", { name: /财务执行中心/ })).not.toBeInTheDocument();
  });
});
