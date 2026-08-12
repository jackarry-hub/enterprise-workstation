import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppSidebar } from "@/components/shell/app-sidebar";
import { WorkspaceHeader } from "@/components/shell/workspace-header";
import { WorkspaceShell } from "@/components/shell/workspace-shell";
import { WorkspaceSessionProvider } from "@/features/auth/workspace-session-provider";
import { CUSTOMER_DEMO_ACTOR_KEY, useCustomerDemoSession } from "@/features/auth/workspace-session-provider";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { CUSTOMER_DEMO_STORAGE_NAMESPACE } from "@/features/demo/customer-demo-state";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  replace: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => navigation,
  useSearchParams: () => new URLSearchParams(),
}));

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
  beforeEach(() => {
    window.localStorage.clear();
    navigation.push.mockClear();
    navigation.replace.mockClear();
    navigation.refresh.mockClear();
  });

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
    expect(screen.queryByRole("region", { name: "客户演示导航" })).not.toBeInTheDocument();
  });

  it("switches among all ten customer demo identities from the user menu", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceShell session={customerDemoSessions[0]} demoSessions={customerDemoSessions}>
        <p>演示内容</p>
      </WorkspaceShell>,
    );

    await user.click(screen.getByRole("button", { name: "打开用户菜单" }));

    const menu = screen.getByRole("menu", { name: "打开用户菜单" });
    expect(within(menu).getByText("核心职责")).toBeVisible();
    expect(within(menu).getByText("战略决策")).toBeVisible();
    expect(within(menu).getByText("经营治理")).toBeVisible();
    expect(within(menu).getByText("决策闭环")).toBeVisible();
    expect(screen.getByText("切换演示身份")).toBeVisible();
    expect(screen.getAllByRole("menuitem", { name: /^切换为 / })).toHaveLength(10);

    await user.click(screen.getByRole("menuitem", { name: "切换为 陈晨 · 前端工程师" }));

    expect(window.localStorage.getItem(CUSTOMER_DEMO_ACTOR_KEY)).toBe("demo-engineer");
    expect(navigation.push).toHaveBeenCalledWith("/execution");
  });

  it("confirms and resets shared customer demo business data without losing the selected identity", async () => {
    const user = userEvent.setup();
    const operationsKey = `enterprise-workspace.operations.v1:${CUSTOMER_DEMO_STORAGE_NAMESPACE}`;
    window.localStorage.setItem(operationsKey, "changed");
    window.localStorage.setItem(CUSTOMER_DEMO_ACTOR_KEY, "demo-executive");
    render(
      <WorkspaceShell session={customerDemoSessions[0]} demoSessions={customerDemoSessions}>
        <p>演示内容</p>
      </WorkspaceShell>,
    );

    await user.click(screen.getByRole("button", { name: "打开用户菜单" }));
    await user.click(screen.getByRole("menuitem", { name: "重置演示数据" }));
    expect(screen.getByRole("heading", { name: "确认重置客户演示数据？" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "确认重置" }));

    expect(window.localStorage.getItem(operationsKey)).not.toBe("changed");
    expect(JSON.parse(window.localStorage.getItem(operationsKey) ?? "null").tasks.filter(
      ({ status }: { status: string }) => status !== "done",
    )).toHaveLength(10);
    expect(JSON.parse(window.localStorage.getItem(operationsKey) ?? "null").tasks.every(
      ({ status, progress }: { status: string; progress: number }) => status === "todo" && progress === 0,
    )).toBe(true);
    expect(window.localStorage.getItem(CUSTOMER_DEMO_ACTOR_KEY)).toBe("demo-executive");
    expect(navigation.push).toHaveBeenCalledWith("/dashboard");
    expect(navigation.refresh).toHaveBeenCalled();
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

  it("shows a department head the personal payroll entry", () => {
    const departmentHeadSession = customerDemoSessions.find(
      ({ identity }) => identity.providerSubject === "customer-demo:demo-product-head",
    )!;
    render(withSession(departmentHeadSession, <AppSidebar currentPath="/department" />));

    expect(screen.getByRole("link", { name: "我的工资单" })).toHaveAttribute("href", "/payroll");
  });

  it("also exposes a department head's payslip in the user menu", async () => {
    const user = userEvent.setup();
    const departmentHeadSession = customerDemoSessions.find(
      ({ identity }) => identity.providerSubject === "customer-demo:demo-product-head",
    )!;
    render(withSession(departmentHeadSession, <WorkspaceHeader />));

    await user.click(screen.getByRole("button", { name: "打开用户菜单" }));

    expect(screen.getByRole("menuitem", { name: "我的工资单" })).toHaveAttribute("href", "/payroll");
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
