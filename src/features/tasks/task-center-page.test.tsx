import { screen, within } from "@testing-library/react";
import { renderWithWorkspaceSession as render } from "@/test/workspace-session-test-utils";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { TaskCenterPage } from "@/features/tasks/task-center-page";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { renderWithSpecificWorkspaceSession } from "@/test/workspace-session-test-utils";
import { createDecisionPlan, createDefaultDecisionInput, dispatchDecisionPlan } from "@/features/decision-workbench/decision-workbench-data";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";

describe("TaskCenterPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("renders the approved task center structure", () => {
    render(<TaskCenterPage />);

    expect(screen.getByRole("heading", { name: "任务管理" })).toBeVisible();
    expect(screen.getByRole("searchbox", { name: "搜索任务或项目" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "今日待办" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "我的任务" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "快捷筛选" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "团队协作" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "日程安排" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "最近动态" })).toBeVisible();
    expect(screen.getByRole("tab", { name: /全部任务/ })).toBeVisible();
    expect(screen.queryByRole("tab", { name: /我的任务/ })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /待开始/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: /进行中/ })).toBeVisible();
    expect(screen.getByRole("tab", { name: /已完成/ })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "常用入口" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看全部待开始任务" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看全部待办" })).toBeVisible();
  });

  it("filters tasks and resets an empty result", async () => {
    const user = userEvent.setup();
    const engineerSession = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-engineer")!;
    renderWithSpecificWorkspaceSession(<TaskCenterPage />, engineerSession);

    const search = screen.getByRole("searchbox", { name: "搜索任务或项目" });
    await user.type(search, "不存在的任务");

    expect(screen.getByText("没有找到匹配的任务")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "重置筛选" }));
    expect(screen.queryByText("没有找到匹配的任务")).not.toBeInTheDocument();
  });

  it("routes ordinary project work directly to its task editor", () => {
    const engineerSession = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-engineer")!;
    renderWithSpecificWorkspaceSession(<TaskCenterPage />, engineerSession);

    expect(screen.getByRole("link", { name: "直接办理：实现首页响应式模块" })).toHaveAttribute(
      "href",
      "/projects/40000000-0000-4000-8000-000000000001?tab=tasks&task=70000000-0000-4000-8000-000000000002",
    );
    expect(window.localStorage.getItem("enterprise-workspace.projects.v1")).toBeNull();
  });

  it("opens the selected task's operation card from both task lists", () => {
    const qaSession = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-qa")!;
    const executiveSession = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-executive")!;
    const input = createDefaultDecisionInput();
    const project = dispatchDecisionPlan(createOperationFixtureContext(executiveSession), input, createDecisionPlan(input));
    renderWithSpecificWorkspaceSession(<TaskCenterPage />, qaSession);

    const taskTitle = "完成关键流程回归测试";
    const taskId = project.tasks.find(({ title }) => title === taskTitle)!.id;
    expect(screen.getByRole("link", { name: `立即办理：${taskTitle}` })).toHaveAttribute(
      "href",
      `/execution#task-${taskId}`,
    );
    expect(screen.getByRole("link", { name: `直接办理：${taskTitle}` })).toHaveAttribute(
      "href",
      `/execution#task-${taskId}`,
    );
  });

  it("shows only tasks uniquely assigned to the signed-in person", () => {
    const engineerSession = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-engineer")!;
    renderWithSpecificWorkspaceSession(<TaskCenterPage />, engineerSession);

    const list = screen.getByRole("heading", { name: "我的任务" }).closest("div")?.parentElement;
    expect(list).toBeTruthy();
    expect(within(list!).getAllByText(/陈晨/).length).toBeGreaterThan(0);
    expect(within(list!).queryByText("张伟")).not.toBeInTheDocument();
    expect(within(list!).queryByText("郭敏")).not.toBeInTheDocument();
    expect(within(list!).queryByText("刘洋")).not.toBeInTheDocument();
    expect(within(list!).queryByText("王芳")).not.toBeInTheDocument();
  });
});
