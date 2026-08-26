import { screen } from "@testing-library/react";
import { renderWithWorkspaceSession as render } from "@/test/workspace-session-test-utils";
import { describe, expect, it } from "vitest";

import { HelpCenter } from "@/features/help/help-center";

describe("HelpCenter", () => {
  it("hides non-ready modules and excluded scope from rendered help", () => {
    render(<HelpCenter />);

    expect(screen.getByRole("heading", { name: "使用帮助" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "企业任务完整闭环" })).toBeVisible();
    expect(screen.getByText("在 AI 决策调度台输入目标、期限、预算和约束")).toBeVisible();
    expect(screen.queryByRole("link", { name: /AI 决策调度台/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /财务执行中心/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/考勤|请假/)).not.toBeInTheDocument();
  });
});
