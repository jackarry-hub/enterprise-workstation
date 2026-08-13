import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { TaskCenterPage } from "@/features/tasks/task-center-page";
import { renderWithSpecificWorkspaceSession } from "@/test/workspace-session-test-utils";

const engineer = customerDemoSessions.find(({ identity }) => identity.providerSubject === "customer-demo:demo-engineer")!;

describe("TaskCenterPage", () => {
  beforeEach(() => window.localStorage.clear());

  it("shows only the current person's priority-sorted work", () => {
    renderWithSpecificWorkspaceSession(<TaskCenterPage />, engineer);
    expect(screen.getByRole("heading", { name: "任务" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "我的待办" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "我发起的" })).toBeVisible();
    expect(screen.getAllByTestId("mobile-task-row").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByTestId("mobile-priority")[0]).toHaveTextContent(/逾期|紧急|高/);
    expect(screen.queryByText("设计三角色工作流原型")).not.toBeInTheDocument();
  });

  it("switches to tasks initiated by the viewer", async () => {
    const user = userEvent.setup();
    renderWithSpecificWorkspaceSession(<TaskCenterPage />, engineer);
    await user.click(screen.getByRole("tab", { name: "我发起的" }));
    expect(screen.getByRole("tab", { name: "我发起的" })).toHaveAttribute("aria-selected", "true");
  });
});
