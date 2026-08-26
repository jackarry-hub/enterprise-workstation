import { screen, within } from "@testing-library/react";
import { renderWithWorkspaceSession as render } from "@/test/workspace-session-test-utils";
import { executiveWorkspaceSession, renderWithSpecificWorkspaceSession } from "@/test/workspace-session-test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { employeeDirectoryMockResult } from "@/features/hr/employee-mock-data";
import { EmployeeStats } from "@/features/hr/components/employee-stats";
import { PeoplePage } from "@/features/hr/people-page";
import { OrganizationDialogs } from "@/features/organization/organization-dialogs";
import type { EmployeeDirectoryResult } from "@/features/hr/employee-types";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";

const realDirectoryResult: EmployeeDirectoryResult = {
  source: "supabase",
  data: {
    employees: [{
      profile: {
        id: "71000000-0000-4000-8000-000000000001",
        employeeNo: "QXY-2101",
        displayName: "陈工",
        departmentId: "72000000-0000-4000-8000-000000000001",
        jobTitle: "后端工程师",
        employmentType: "full_time",
        employmentStatus: "active",
      },
      department: {
        id: "72000000-0000-4000-8000-000000000001",
        code: "ENGINEERING",
        name: "工程部",
        status: "active",
        sortOrder: 10,
      },
    }],
    departments: [{
      id: "72000000-0000-4000-8000-000000000001",
      code: "ENGINEERING",
      name: "工程部",
      status: "active",
      sortOrder: 10,
    }],
    stats: { total: 1, active: 1, probation: 0, departments: 1 },
  },
};

const employeeWorkspaceSession: WorkspaceSession = {
  ...executiveWorkspaceSession,
  authUserId: "71000000-0000-4000-8000-000000000002",
  member: {
    id: 21,
    employeeProfileId: "71000000-0000-4000-8000-000000000001",
    status: "active" as const,
  },
  profile: {
    ...executiveWorkspaceSession.profile,
    displayName: "陈工",
    departmentName: "工程部",
    jobTitle: "后端工程师",
  },
  roleCodes: ["employee"],
  permissionCodes: ["dashboard.read"],
  primaryRole: "employee" as const,
  landingPath: "/my-workspace",
  actor: {
    ...executiveWorkspaceSession.actor,
    id: "71000000-0000-4000-8000-000000000002",
    memberId: "21",
    name: "陈工",
    role: "employee" as const,
    roleLabel: "员工",
    department: "工程部",
    title: "后端工程师",
    landingPath: "/my-workspace",
  },
};

describe("PeoplePage", () => {
  it("renders a real repository directory for an ordinary employee without private fields", () => {
    renderWithSpecificWorkspaceSession(
      <PeoplePage result={realDirectoryResult} />,
      employeeWorkspaceSession,
    );

    expect(screen.getAllByText("工程部").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("当前显示 1 名员工")).toBeVisible();
    expect(screen.queryByText("13800000000")).not.toBeInTheDocument();
    expect(screen.queryByText(/演示/)).not.toBeInTheDocument();
  });

  it("renders the approved employee directory surface", () => {
    render(<PeoplePage result={employeeDirectoryMockResult} />);

    expect(screen.getByRole("heading", { name: "组织人事" })).toBeVisible();
    expect(screen.getByText("员工总数")).toBeVisible();
    expect(screen.getByText("在职人数")).toBeVisible();
    expect(screen.getByText("试用期员工")).toBeVisible();
    expect(screen.getByText("部门数量")).toBeVisible();
    expect(screen.getByRole("searchbox", { name: "搜索员工" })).toBeVisible();
    expect(screen.getByRole("region", { name: "员工目录" })).toBeVisible();
    expect(screen.getAllByText("王芳").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("当前显示 10 名员工")).toBeVisible();
  });

  it("filters employees by search keyword", async () => {
    const user = userEvent.setup();
    render(<PeoplePage result={employeeDirectoryMockResult} />);

    await user.type(screen.getByRole("searchbox", { name: "搜索员工" }), "QXY-1002");
    const directory = screen.getByRole("region", { name: "员工目录" });

    expect(within(directory).getAllByText("王芳").length).toBeGreaterThanOrEqual(1);
    expect(within(directory).queryByText("张伟")).not.toBeInTheDocument();
    expect(screen.getByText("当前显示 1 名员工")).toBeVisible();
  });

  it("combines department and employment status filters", async () => {
    const user = userEvent.setup();
    render(<PeoplePage result={employeeDirectoryMockResult} />);

    await user.click(screen.getByRole("combobox", { name: "筛选部门" }));
    await user.click(screen.getByRole("option", { name: "产品研发部" }));
    await user.click(screen.getByRole("combobox", { name: "筛选员工状态" }));
    await user.click(screen.getByRole("option", { name: "试用期" }));

    const directory = screen.getByRole("region", { name: "员工目录" });
    expect(within(directory).getAllByText("周宁").length).toBeGreaterThanOrEqual(1);
    expect(
      within(directory).queryByRole("link", { name: "查看刘洋的员工档案" }),
    ).not.toBeInTheDocument();
  });

  it("links every employee to the public detail route", () => {
    render(<PeoplePage result={employeeDirectoryMockResult} />);

    const employee = employeeDirectoryMockResult.data.employees[0];
    const links = screen.getAllByRole("link", {
      name: `查看${employee.profile.displayName}的员工档案`,
    });

    expect(links.length).toBeGreaterThanOrEqual(1);
    expect(links[0]).toHaveAttribute("href", `/people/${employee.profile.id}`);
  });

  it("shows organization actions only for the matching server capability", async () => {
    const user = userEvent.setup();
    render(<PeoplePage result={employeeDirectoryMockResult} />);

    await user.click(screen.getByRole("button", { name: "新建部门" }));

    expect(screen.getByRole("dialog", { name: "新建部门" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "分配系统角色" })).not.toBeInTheDocument();
  });

  it("does not invent directory trends or advertise searches over private fields", () => {
    render(<EmployeeStats stats={realDirectoryResult.data.stats} />);
    render(<PeoplePage result={realDirectoryResult} />);

    expect(screen.queryByText("本月净增")).not.toBeInTheDocument();
    expect(screen.queryByText("全覆盖")).not.toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "搜索员工" })).toHaveAttribute(
      "placeholder",
      "搜索姓名、工号或岗位",
    );
    expect(screen.getByRole("searchbox", { name: "搜索员工" })).toHaveClass("h-11");
    expect(screen.getByRole("combobox", { name: "筛选部门" })).toHaveClass("h-11");
    expect(screen.getByRole("combobox", { name: "筛选员工状态" })).toHaveClass("h-11");
    expect(screen.queryByRole("option", { name: "已离职" })).not.toBeInTheDocument();
  });

  it("uses a server-loaded employee selector instead of editable role command ids", async () => {
    const user = userEvent.setup();
    render(
      <OrganizationDialogs
        canManageOrganization={false}
        canManageRoles
        roleTargets={[{
          employeeId: "71000000-0000-4000-8000-000000000001",
          displayName: "陈工",
          employeeNo: "QXY-2101",
          jobTitle: "后端工程师",
          memberId: 31,
          roleVersion: 4,
        }]}
      />,
    );

    await user.click(screen.getByRole("button", { name: "分配系统角色" }));

    expect(screen.getByRole("combobox", { name: "选择员工" })).toHaveTextContent("陈工");
    expect(screen.queryByRole("spinbutton", { name: "成员编号" })).not.toBeInTheDocument();
    expect(screen.queryByRole("spinbutton", { name: "当前版本" })).not.toBeInTheDocument();
  });
});
