import { screen } from "@testing-library/react";
import { renderWithWorkspaceSession as render } from "@/test/workspace-session-test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { WorkspacePage } from "@/features/tasks/workspace-page";
import { workspaceMockResult } from "@/features/tasks/workspace-mock-data";

describe("WorkspacePage", () => {
  it("renders the daily overview and all requested work sections", () => {
    render(<WorkspacePage result={workspaceMockResult} />);

    expect(screen.getByRole("heading", { name: "工作中心" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "今日工作概览" })).toBeVisible();
    expect(screen.getByText("今日任务")).toBeVisible();
    expect(screen.getByText("待审批")).toBeVisible();
    expect(screen.getByText("截止提醒")).toBeVisible();
    expect(screen.getByText("本周完成率")).toBeVisible();
    expect(screen.getByRole("heading", { name: "我的任务" })).toBeVisible();
    expect(screen.getByText("完善用户增长分析报告")).toBeVisible();
    expect(screen.getByRole("heading", { name: "今日待办" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "工作日报" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "最近动态" })).toBeVisible();
  });

  it("filters tasks without leaving the workspace", async () => {
    const user = userEvent.setup();
    render(<WorkspacePage result={workspaceMockResult} />);

    await user.click(screen.getByRole("button", { name: "待完成" }));

    expect(screen.getByText("产品需求评审会")).toBeVisible();
    expect(screen.queryByText("修复数据看板展示问题")).not.toBeInTheDocument();
  });

  it("saves a report locally in demo mode and shows clear feedback", async () => {
    const user = userEvent.setup();
    render(<WorkspacePage result={workspaceMockResult} />);

    const completed = screen.getByLabelText("今日完成");
    await user.clear(completed);
    await user.type(completed, "完成工作中心页面框架");
    await user.click(screen.getByRole("button", { name: "保存日报" }));

    expect(await screen.findByRole("status")).toHaveTextContent("日报已保存");
  });

  it("opens a project task and updates a todo state", async () => {
    const user = userEvent.setup();
    render(<WorkspacePage result={workspaceMockResult} />);
    const task = workspaceMockResult.data.tasks[0];
    expect(screen.getByRole("link", { name: task.title })).toHaveAttribute("href", `/projects/${task.projectId}?tab=tasks&task=${task.id}`);
    const todo = workspaceMockResult.data.todos[0];
    const toggle = screen.getByRole("button", { name: `完成待办：${todo.title}` });
    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });
});
