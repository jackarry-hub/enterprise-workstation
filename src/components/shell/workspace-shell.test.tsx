import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { AppSidebar } from "@/components/shell/app-sidebar";
import { WorkspaceHeader } from "@/components/shell/workspace-header";
import { WorkspaceShell } from "@/components/shell/workspace-shell";
import { DemoSessionProvider } from "@/features/operations/demo-session";
import { OPERATIONS_ACTOR_KEY } from "@/features/operations/operations-data";

describe("WorkspaceShell", () => {
  beforeEach(() => window.localStorage.clear());

  it("exposes the enterprise navigation and workspace controls", () => {
    render(
      <WorkspaceShell>
        <p>驾驶舱内容</p>
      </WorkspaceShell>,
    );

    const navigation = screen.getByRole("navigation", { name: "主导航" });
    expect(navigation).toBeVisible();
    expect(
      screen.getByRole("img", { name: "量子星河 QuantXY" }),
    ).toBeVisible();
    expect(screen.getByText("AI 决策调度台")).toBeVisible();
    expect(screen.getByText("项目管理")).toBeVisible();
    expect(screen.getByText("审批中心")).toBeVisible();
    expect(screen.getByRole("link", { name: "任务管理" })).toHaveAttribute("href", "/tasks");
    expect(screen.queryByRole("link", { name: "知识库" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "客户管理" })).toHaveAttribute("href", "/customers");
    expect(screen.getByRole("link", { name: "数据分析" })).toHaveAttribute("href", "/analytics");
    expect(screen.getByRole("button", { name: "全局搜索" })).toBeVisible();
    expect(screen.getByRole("button", { name: "查看通知" })).toBeVisible();
    expect(screen.getByRole("link", { name: "查看消息" })).toHaveAttribute("href", "/approvals");
    expect(screen.getByText("李总")).toBeVisible();
    expect(screen.getByText("驾驶舱内容")).toBeVisible();
  });

  it("opens global search and exposes working shell destinations", async () => {
    const user = userEvent.setup();
    render(<WorkspaceShell><p>内容</p></WorkspaceShell>);

    await user.click(screen.getByRole("button", { name: "全局搜索" }));
    const search = screen.getByLabelText("输入全局搜索关键词");
    await user.type(search, "企业官网升级");
    const projectResult = screen.getAllByRole("link", { name: /企业官网升级项目/ }).find((link) => !link.getAttribute("href")?.includes("?"));
    expect(projectResult).toHaveAttribute("href", expect.stringContaining("/projects/"));

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "查看通知" }));
    expect(screen.getByRole("menuitem", { name: /查看全部通知/ })).toHaveAttribute("href", "/notifications");

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "打开用户菜单" }));
    expect(screen.getByRole("menuitem", { name: /个人资料/ })).toHaveAttribute("href", "/settings?tab=personal");
    expect(screen.getByRole("menuitem", { name: /偏好设置/ })).toHaveAttribute("href", "/settings?tab=notifications");
  });

  it("connects the project overview submenu to the existing project overview section", () => {
    render(<AppSidebar currentPath="/projects" />);

    expect(screen.getByRole("link", { name: "项目总览" })).toHaveAttribute(
      "href",
      "/projects?view=overview#project-overview",
    );
  });

  it("sends employees to their tasks instead of attendance", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(OPERATIONS_ACTOR_KEY, "actor-employee");

    render(<DemoSessionProvider><WorkspaceHeader /></DemoSessionProvider>);
    await screen.findByText("陈晨");
    await user.click(screen.getByRole("button", { name: "打开用户菜单" }));

    expect(screen.getByRole("menuitem", { name: /我的任务/ })).toHaveAttribute("href", "/tasks");
    expect(screen.queryByRole("menuitem", { name: /我的考勤/ })).not.toBeInTheDocument();
  });
});
