import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { WorkspaceShell } from "@/components/shell/workspace-shell";
import { CUSTOMER_DEMO_ACTOR_KEY, useCustomerDemoSession } from "@/features/auth/workspace-session-provider";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

function DemoProbe() {
  const demo = useCustomerDemoSession();
  return <p>{demo.enabled ? `${demo.sessions.length} 个演示身份` : "普通会话"}</p>;
}

describe("WorkspaceShell", () => {
  beforeEach(() => window.localStorage.clear());

  it("renders desktop and mobile navigation around one shared content surface", () => {
    render(<WorkspaceShell session={executiveWorkspaceSession}><p>工作内容</p></WorkspaceShell>);

    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeInTheDocument();

    const mobileRegion = screen.getByRole("region", { name: "移动工作区" });
    const mobileNavigation = within(mobileRegion).getByRole("navigation", { name: "移动端主导航" });
    for (const [label, href] of [["首页", "/dashboard"], ["项目", "/projects"], ["任务", "/tasks"], ["团队", "/people"], ["我的", "/me"]]) {
      expect(within(mobileNavigation).getByRole("link", { name: label })).toHaveAttribute("href", href);
    }

    expect(document.querySelectorAll("#main-content")).toHaveLength(1);
    expect(screen.getAllByText("工作内容")).toHaveLength(1);
    expect(screen.getAllByRole("navigation")).toHaveLength(2);
  });

  it("keeps a normal server session isolated from demo identity controls", () => {
    render(<WorkspaceShell session={executiveWorkspaceSession}><DemoProbe /></WorkspaceShell>);
    expect(screen.getByText("普通会话")).toBeVisible();
  });

  it("passes all ten demo identities through the mobile shell", () => {
    window.localStorage.setItem(CUSTOMER_DEMO_ACTOR_KEY, "demo-product-head");
    render(<WorkspaceShell session={customerDemoSessions[0]} demoSessions={customerDemoSessions}><DemoProbe /></WorkspaceShell>);
    expect(screen.getByText("10 个演示身份")).toBeVisible();
    expect(screen.getByTestId("dashboard-identity-avatar")).toHaveAttribute("data-avatar-source", "mock");
    expect(screen.getByRole("img", { name: "张伟的AI演示头像" })).toBeVisible();
  });
});
