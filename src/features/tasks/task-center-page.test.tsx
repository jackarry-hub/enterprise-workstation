import { screen, within } from "@testing-library/react";
import { renderWithWorkspaceSession as render } from "@/test/workspace-session-test-utils";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { TaskCenterPage } from "@/features/tasks/task-center-page";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { renderWithSpecificWorkspaceSession } from "@/test/workspace-session-test-utils";

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

  it("opens task detail and routes status work to the authorized workspace", async () => {
    const user = userEvent.setup();
    const engineerSession = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-engineer")!;
    renderWithSpecificWorkspaceSession(<TaskCenterPage />, engineerSession);

    await user.click(screen.getAllByRole("button", { name: /查看任务详情/ })[0]);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("负责人")).toBeVisible();
    expect(within(dialog).getByText("所属项目")).toBeVisible();

    expect(within(dialog).queryByRole("button", { name: "标记为已完成" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "前往我的执行工作台" })).toHaveAttribute("href", "/execution");
    expect(window.localStorage.getItem("enterprise-workspace.projects.v1")).toBeNull();
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
