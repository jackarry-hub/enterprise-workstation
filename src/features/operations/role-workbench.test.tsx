import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { WorkspaceSessionProvider } from "@/features/auth/workspace-session-provider";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { RoleWorkbench } from "@/features/operations/role-workbench";

describe("RoleWorkbench customer demo", () => {
  beforeEach(() => window.localStorage.clear());

  it("attaches the built-in deliverable and submits the employee task for review", async () => {
    const user = userEvent.setup();
    const employeeSession = customerDemoSessions.find(
      ({ identity }) => identity.providerSubject === "customer-demo:demo-engineer",
    )!;
    render(
      <WorkspaceSessionProvider session={employeeSession} demoSessions={customerDemoSessions}>
        <RoleWorkbench role="employee" />
      </WorkspaceSessionProvider>,
    );

    expect(screen.queryByRole("button", { name: "重置本地试用数据" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "使用演示成果" }));

    expect(await screen.findByText("星云智造-AI工作站试点验收记录.txt")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "提交验收" }));
    expect(await screen.findByText("待验收")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("成果已提交给负责人验收");
  });
});
