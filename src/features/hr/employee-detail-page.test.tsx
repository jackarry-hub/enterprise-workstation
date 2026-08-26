import { screen } from "@testing-library/react";
import { renderWithWorkspaceSession as render } from "@/test/workspace-session-test-utils";
import { executiveWorkspaceSession, renderWithSpecificWorkspaceSession } from "@/test/workspace-session-test-utils";
import { describe, expect, it } from "vitest";

import { EmployeeDetailPage } from "@/features/hr/employee-detail-page";
import { employeeDirectoryMockResult } from "@/features/hr/employee-mock-data";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";

const ordinaryEmployeeSession: WorkspaceSession = {
  ...executiveWorkspaceSession,
  authUserId: "61000000-0000-4000-8000-000000000099",
  member: {
    id: 99,
    employeeProfileId: "61000000-0000-4000-8000-000000000006",
    status: "active" as const,
  },
  profile: {
    ...executiveWorkspaceSession.profile,
    displayName: "陈晨",
    departmentName: "技术研发部",
    jobTitle: "前端工程师",
  },
  roleCodes: ["employee"],
  permissionCodes: ["dashboard.read"],
  primaryRole: "employee" as const,
  landingPath: "/my-workspace",
  actor: {
    ...executiveWorkspaceSession.actor,
    id: "61000000-0000-4000-8000-000000000099",
    memberId: "99",
    name: "陈晨",
    role: "employee" as const,
    roleLabel: "员工",
    department: "技术研发部",
    title: "前端工程师",
    landingPath: "/my-workspace",
  },
};

describe("EmployeeDetailPage", () => {
  const employee = employeeDirectoryMockResult.data.employees[1];

  it("renders the safe detail for a real ordinary employee without a private repository result", () => {
    renderWithSpecificWorkspaceSession(
      <EmployeeDetailPage employee={employee} />,
      ordinaryEmployeeSession,
    );

    expect(screen.getByRole("heading", { name: "王芳" })).toBeVisible();
    expect(screen.queryByText("wang.fang@quantxy.cn")).not.toBeInTheDocument();
    expect(screen.queryByText("138 0000 1002")).not.toBeInTheDocument();
    expect(screen.queryByText(/演示/)).not.toBeInTheDocument();
  });

  it("renders the employee identity and lifecycle status", () => {
    render(<EmployeeDetailPage employee={employee} />);

    expect(screen.getByRole("heading", { name: "王芳" })).toBeVisible();
    expect(screen.getAllByText("QXY-1002").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("在职").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("link", { name: "返回员工目录" })).toHaveAttribute("href", "/people");
  });

  it("renders basic, organization, and account information", () => {
    render(<EmployeeDetailPage employee={employee} />);

    expect(screen.getByRole("heading", { name: "基本信息" })).toBeVisible();
    expect(screen.getByText("公开目录基础档案")).toBeVisible();
    expect(screen.queryByText("wang.fang@quantxy.cn")).not.toBeInTheDocument();
    expect(screen.queryByText("138 0000 1002")).not.toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "组织关系" })).toBeVisible();
    expect(screen.getAllByText("人力资源部").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("人力资源总监").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("林远")).toBeVisible();

    expect(screen.getByRole("heading", { name: "账号与权限" })).toBeVisible();
    expect(screen.getAllByText("账号已开通").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("HR")).toBeVisible();
  });

  it("renders private contact details only from the capability-scoped repository result", () => {
    render(
      <EmployeeDetailPage
        employee={employee}
        privateProfile={{
          employeePublicId: employee.profile.id,
          privateEmail: "wang.fang@quantxy.cn",
          phone: "138 0000 1002",
          hireDate: "2021-06-01",
        }}
      />,
    );

    expect(screen.getByRole("heading", { name: "私密人事资料" })).toBeVisible();
    expect(screen.getByText("wang.fang@quantxy.cn")).toBeVisible();
    expect(screen.getByText("138 0000 1002")).toBeVisible();
  });

  it("does not infer an unlinked account when the public directory omitted account authority", () => {
    const publicEmployee = {
      ...employee,
      profile: { ...employee.profile, account: undefined },
    };
    render(<EmployeeDetailPage employee={publicEmployee} />);

    expect(screen.queryByText("该员工尚未关联企业工作站账号，员工档案仍可独立维护。")).not.toBeInTheDocument();
    expect(screen.queryByText("未开通账号")).not.toBeInTheDocument();
    expect(screen.queryByText("账号已开通")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "账号与权限" })).not.toBeInTheDocument();
  });
});
