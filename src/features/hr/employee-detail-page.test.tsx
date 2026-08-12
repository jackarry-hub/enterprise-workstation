import { screen } from "@testing-library/react";
import { renderWithWorkspaceSession as render } from "@/test/workspace-session-test-utils";
import { renderWithSpecificWorkspaceSession, unboundExecutiveWorkspaceSession } from "@/test/workspace-session-test-utils";
import { describe, expect, it } from "vitest";

import { EmployeeDetailPage } from "@/features/hr/employee-detail-page";
import { employeeDirectoryMockResult } from "@/features/hr/employee-mock-data";

describe("EmployeeDetailPage", () => {
  const employee = employeeDirectoryMockResult.data.employees.find(
    ({ profile }) => profile.displayName === "王芳",
  )!;

  it("does not expose fixture employee detail to an unbound real identity", () => {
    renderWithSpecificWorkspaceSession(
      <EmployeeDetailPage employee={employee} />,
      unboundExecutiveWorkspaceSession,
    );

    expect(screen.getByRole("heading", { name: "员工数据暂不可用" })).toBeVisible();
    expect(screen.queryByText("wang.fang@demo.quantxy.cn")).not.toBeInTheDocument();
  });

  it("renders the employee identity and lifecycle status", () => {
    render(<EmployeeDetailPage employee={employee} />);

    expect(screen.getByRole("heading", { name: "王芳" })).toBeVisible();
    expect(screen.getAllByText("QXY-1005").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("在职").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("link", { name: "返回员工目录" })).toHaveAttribute("href", "/people");
  });

  it("renders basic, organization, and account information", () => {
    render(<EmployeeDetailPage employee={employee} />);

    expect(screen.getByRole("heading", { name: "基本信息" })).toBeVisible();
    expect(screen.getByText("wang.fang@demo.quantxy.cn")).toBeVisible();
    expect(screen.getByText("138 0000 1005")).toBeVisible();

    expect(screen.getByRole("heading", { name: "组织关系" })).toBeVisible();
    expect(screen.getAllByText("市场增长中心").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("市场总监").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("林远")).toBeVisible();

    expect(screen.getByRole("heading", { name: "账号与权限" })).toBeVisible();
    expect(screen.getAllByText("账号已开通").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("部门负责人")).toBeVisible();
  });
});
