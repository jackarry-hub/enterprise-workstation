import { screen, within } from "@testing-library/react";
import { renderWithWorkspaceSession as render } from "@/test/workspace-session-test-utils";
import { renderWithSpecificWorkspaceSession, unboundExecutiveWorkspaceSession } from "@/test/workspace-session-test-utils";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { employeeDirectoryMockResult } from "@/features/hr/employee-mock-data";
import { PeoplePage } from "@/features/hr/people-page";

describe("PeoplePage", () => {
  it("does not expose the fixture roster to an unbound real identity", () => {
    renderWithSpecificWorkspaceSession(
      <PeoplePage result={employeeDirectoryMockResult} />,
      unboundExecutiveWorkspaceSession,
    );

    expect(screen.getByText("当前账号没有可显示的真实员工数据。" )).toBeVisible();
    expect(screen.queryByText("王芳")).not.toBeInTheDocument();
    expect(screen.getByText("当前显示 0 名员工")).toBeVisible();
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
});
