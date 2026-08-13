import { render, screen } from "@testing-library/react";
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

  it("renders a mobile-first shell with one five-item navigation", () => {
    render(<WorkspaceShell session={executiveWorkspaceSession}><p>工作内容</p></WorkspaceShell>);
    expect(screen.getByRole("region", { name: "移动工作区" })).toBeVisible();
    const navigation = screen.getByRole("navigation", { name: "移动端主导航" });
    expect(navigation).toBeVisible();
    for (const [label, href] of [["首页", "/dashboard"], ["任务", "/tasks"], ["项目", "/projects"], ["审批", "/approvals"], ["我的", "/me"]]) {
      expect(screen.getByRole("link", { name: label })).toHaveAttribute("href", href);
    }
    expect(screen.getAllByRole("navigation")).toHaveLength(1);
  });

  it("keeps a normal server session isolated from demo identity controls", () => {
    render(<WorkspaceShell session={executiveWorkspaceSession}><DemoProbe /></WorkspaceShell>);
    expect(screen.getByText("普通会话")).toBeVisible();
  });

  it("passes all ten demo identities through the mobile shell", () => {
    window.localStorage.setItem(CUSTOMER_DEMO_ACTOR_KEY, "demo-product-head");
    render(<WorkspaceShell session={customerDemoSessions[0]} demoSessions={customerDemoSessions}><DemoProbe /></WorkspaceShell>);
    expect(screen.getByText("10 个演示身份")).toBeVisible();
  });
});
