import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { AppSidebar } from "@/components/shell/app-sidebar";
import { WorkspaceHeader } from "@/components/shell/workspace-header";
import { WorkspaceShell } from "@/components/shell/workspace-shell";
import { WorkspaceSessionProvider } from "@/features/auth/workspace-session-provider";
import { useCustomerDemoSession } from "@/features/auth/workspace-session-provider";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";

const executiveSession: WorkspaceSession = {
  tenantId: "10000000-0000-4000-8000-000000000000",
  authUserId: "10000000-0000-4000-8000-000000000001",
  identity: {
    providerCode: "feishu",
    authProvider: "custom:feishu",
    providerSubject: "subject-executive-001",
  },
  organization: {
    id: "10000000-0000-4000-8000-000000000002",
    name: "量子星河",
  },
  member: {
    id: 10,
    employeeProfileId: "10000000-0000-4000-8000-000000000003",
    status: "active",
  },
  profile: {
    displayName: "张星河",
    avatarUrl: "https://example.com/avatar.png",
    departmentName: "总经办",
    jobTitle: "CEO",
    skills: ["strategy", "leadership"],
  },
  roleCodes: ["owner"],
  permissionCodes: ["dashboard.read", "organization.manage"],
  primaryRole: "executive",
  landingPath: "/dashboard",
  isAdmin: false,
  actor: {
    id: "10000000-0000-4000-8000-000000000001",
    memberId: "10",
    name: "张星河",
    role: "executive",
    roleLabel: "CEO",
    department: "总经办",
    title: "CEO",
    landingPath: "/dashboard",
  },
};

const employeeSession: WorkspaceSession = {
  ...executiveSession,
  tenantId: "30000000-0000-4000-8000-000000000000",
  authUserId: "30000000-0000-4000-8000-000000000001",
  identity: {
    providerCode: "feishu",
    authProvider: "custom:feishu",
    providerSubject: "subject-employee-001",
  },
  member: {
    id: 11,
    employeeProfileId: "30000000-0000-4000-8000-000000000003",
    status: "active",
  },
  profile: {
    displayName: "真实员工",
    avatarUrl: null,
    departmentName: "产品研发中心",
    jobTitle: "前端工程师",
    skills: ["react", "typescript"],
  },
  roleCodes: ["employee"],
  permissionCodes: ["task.manage", "attendance.self"],
  primaryRole: "employee",
  landingPath: "/execution",
  actor: {
    id: "actor-employee",
    memberId: "20000000-0000-4000-8000-000000000004",
    name: "真实员工",
    role: "employee",
    roleLabel: "普通员工",
    department: "产品研发中心",
    title: "前端工程师",
    landingPath: "/execution",
  },
};

function withSession(session: WorkspaceSession, children: React.ReactNode) {
  return (
    <WorkspaceSessionProvider session={session}>
      {children}
    </WorkspaceSessionProvider>
  );
}

function DemoProbe() {
  const demo = useCustomerDemoSession();
  return <p>{demo.enabled ? "客户演示会话已启用" : "普通会话"}</p>;
}

describe("WorkspaceShell", () => {
  beforeEach(() => window.localStorage.clear());

  it("renders the reviewed server session identity without demo switching controls", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceShell session={executiveSession}>
        <p>驾驶舱内容</p>
      </WorkspaceShell>,
    );

    expect(screen.getByText("张星河")).toBeVisible();
    expect(screen.getByText("CEO · CEO")).toBeVisible();
    expect(screen.getByRole("img", { name: "张星河" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "打开用户菜单" }));

    expect(screen.queryByText(["切换", "演示身份"].join(""))).not.toBeInTheDocument();
    expect(screen.getAllByRole("menuitem", { name: "退出登录" })).toHaveLength(1);
  });

  it("passes the ten customer demo sessions through the workspace shell", () => {
    render(
      <WorkspaceShell session={customerDemoSessions[0]} demoSessions={customerDemoSessions}>
        <DemoProbe />
      </WorkspaceShell>,
    );

    expect(screen.getByText("客户演示会话已启用")).toBeVisible();
  });

  it("exposes the enterprise navigation and workspace controls", () => {
    render(
      <WorkspaceShell session={executiveSession}>
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
    expect(screen.getByText("张星河")).toBeVisible();
    expect(screen.getByText("驾驶舱内容")).toBeVisible();
  });

  it("opens global search and exposes working shell destinations", async () => {
    const user = userEvent.setup();
    render(<WorkspaceShell session={executiveSession}><p>内容</p></WorkspaceShell>);

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
    render(withSession(executiveSession, <AppSidebar currentPath="/projects" />));

    expect(screen.getByRole("link", { name: "项目总览" })).toHaveAttribute(
      "href",
      "/projects?view=overview#project-overview",
    );
  });

  it("uses the server session instead of browser-selected fixture identity", async () => {
    const user = userEvent.setup();
    const legacyActorStorageKey = ["enterprise-workspace", "demo-actor", "v1"].join(".");
    window.localStorage.setItem(legacyActorStorageKey, "actor-executive");

    render(withSession(employeeSession, <WorkspaceHeader />));

    expect(screen.getByText("真实员工")).toBeVisible();
    expect(screen.queryByText("李总")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "打开用户菜单" }));
    expect(screen.getByRole("menuitem", { name: /我的任务/ })).toHaveAttribute("href", "/tasks");
    expect(screen.queryByRole("menuitem", { name: /我的考勤/ })).not.toBeInTheDocument();
  });
});
