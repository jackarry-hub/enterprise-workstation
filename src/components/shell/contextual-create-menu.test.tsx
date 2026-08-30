import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/agents" }));
import { ContextualCreateMenu } from "@/components/shell/contextual-create-menu";
import { WorkspaceSessionProvider } from "@/features/auth/workspace-session-provider";
import { QUICK_CREATE_EVENT } from "@/features/quick-create/contextual-create-actions";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

describe("contextual create menu", () => {
  it("renders only Agent Center commands and dispatches the selected real target", async () => {
    const user = userEvent.setup(); const listener = vi.fn(); window.addEventListener(QUICK_CREATE_EVENT, listener);
    const session = { ...executiveWorkspaceSession, permissionCodes: [...executiveWorkspaceSession.permissionCodes, "agent.manage" as const, "agent.orchestrate" as const, "approval.submit" as const] };
    render(<WorkspaceSessionProvider session={session}><ContextualCreateMenu /></WorkspaceSessionProvider>);
    await user.click(screen.getByRole("button", { name: "快速创建" }));
    expect(screen.getByRole("menuitem", { name: "新建 Agent" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "新建 Agent 编排" })).toBeVisible();
    expect(screen.getByRole("menuitem", { name: "申请 Agent 权限" })).toBeVisible();
    expect(screen.queryByRole("menuitem", { name: "新建任务" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("menuitem", { name: "新建 Agent" }));
    expect(listener).toHaveBeenCalledOnce(); window.removeEventListener(QUICK_CREATE_EVENT, listener);
  });
});
