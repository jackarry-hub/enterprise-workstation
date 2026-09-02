import { readFile } from "node:fs/promises";
import path from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  usePathname: () => "/help",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

import { AppSidebar } from "@/components/shell/app-sidebar";
import { WorkspaceHeader } from "@/components/shell/workspace-header";
import { WorkspaceShell } from "@/components/shell/workspace-shell";
import { WorkspaceSessionProvider } from "@/features/auth/workspace-session-provider";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";

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
  customRoleCodes: [],
  supervisorScopeEmployeeIds: [],
  permissionCodes: [
    "dashboard.read",
    "organization.manage",
    "project.manage",
    "task.manage",
    "salary.manage",
    "approval.manage",
    "customer.manage",
    "analytics.read",
    "settings.manage",
  ],
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

describe("WorkspaceShell", () => {
  beforeEach(() => window.localStorage.clear());

  it("keeps formal help shell consumers free of fixture modules and business storage", async () => {
    const shellRoot = path.join(process.cwd(), "src", "components", "shell");
    const [headerSource, searchSource] = await Promise.all([
      readFile(path.join(shellRoot, "workspace-header.tsx"), "utf8"),
      readFile(path.join(shellRoot, "workspace-search-dialog.tsx"), "utf8"),
    ]);

    expect(headerSource).not.toContain("@/features/operations");
    expect(searchSource).not.toContain("@/features/operations");
    expect(searchSource).not.toContain("@/features/projects/data/effective-project-details");
  });

  it("renders the formal help shell without reading business local storage", () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");

    render(<WorkspaceShell session={executiveSession}><p>帮助内容</p></WorkspaceShell>);

    expect(screen.getByText("帮助内容")).toBeVisible();
    expect(getItem).not.toHaveBeenCalled();
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

  it("shows authorized real business destinations in the formal workspace shell", () => {
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
    expect(screen.getByText("经营驾驶舱")).toBeVisible();
    expect(screen.getByText("项目管理")).toBeVisible();
    expect(screen.getByText("审批与财务")).toBeVisible();
    expect(screen.getByRole("link", { name: "任务管理" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "知识库" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "客户管理" })).toBeVisible();
    expect(screen.queryByRole("link", { name: "数据分析" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全局搜索" })).toBeVisible();
    expect(screen.getByRole("button", { name: "查看通知" })).toBeVisible();
    expect(screen.getByRole("link", { name: "查看消息" })).toHaveAttribute("href", "/approvals");
    expect(screen.getByText("张星河")).toBeVisible();
    expect(screen.getByText("驾驶舱内容")).toBeVisible();
  });

  it("opens global search without exposing unavailable fixture destinations", async () => {
    const user = userEvent.setup();
    render(<WorkspaceShell session={executiveSession}><p>内容</p></WorkspaceShell>);

    await user.click(screen.getByRole("button", { name: "全局搜索" }));
    const search = screen.getByLabelText("输入全局搜索关键词");
    await user.type(search, "企业官网升级");
    expect(screen.queryByRole("link", { name: /企业官网升级项目/ })).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "查看通知" }));
    expect(screen.getByRole("menuitem", { name: /查看全部通知/ })).toBeVisible();

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "打开用户菜单" }));
    expect(screen.getByRole("menuitem", { name: /个人资料/ })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: /偏好设置/ })).toBeVisible();
  });

  it("renders the project overview submenu after projects are ready", () => {
    render(withSession(executiveSession, <AppSidebar currentPath="/projects" />));

    expect(screen.getByRole("link", { name: "项目总览" })).toBeVisible();
  });

  it("uses the server session instead of browser-selected fixture identity", async () => {
    const user = userEvent.setup();
    const legacyActorStorageKey = ["enterprise-workspace", "demo-actor", "v1"].join(".");
    window.localStorage.setItem(legacyActorStorageKey, "actor-executive");

    render(withSession(employeeSession, <WorkspaceHeader />));

    expect(screen.getByText("真实员工")).toBeVisible();
    expect(screen.queryByText("李总")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "打开用户菜单" }));
    expect(screen.getByRole("menuitem", { name: /我的任务/ })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: /我的考勤/ })).not.toBeInTheDocument();
  });
});
