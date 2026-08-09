import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmployeeDetailPage } from "@/features/hr/employee-detail-page";
import { employeeDirectoryMockResult } from "@/features/hr/employee-mock-data";

describe("EmployeeDetailPage", () => {
  const employee = employeeDirectoryMockResult.data.employees[1];

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
    expect(screen.getByText("wang.fang@quantxy.cn")).toBeVisible();
    expect(screen.getByText("138 0000 1002")).toBeVisible();

    expect(screen.getByRole("heading", { name: "组织关系" })).toBeVisible();
    expect(screen.getAllByText("人力资源部").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("人力资源总监").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("林远")).toBeVisible();

    expect(screen.getByRole("heading", { name: "账号与权限" })).toBeVisible();
    expect(screen.getAllByText("账号已开通").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("HR")).toBeVisible();
  });
});
