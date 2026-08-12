import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import {
  CUSTOMER_DEMO_ACTOR_KEY,
  useCustomerDemoSession,
  useWorkspaceSession,
  WorkspaceSessionProvider,
} from "@/features/auth/workspace-session-provider";

function SessionProbe() {
  const session = useWorkspaceSession();
  const demo = useCustomerDemoSession();
  return (
    <div>
      <span data-testid="current-name">{session.profile.displayName}</span>
      <span data-testid="demo-enabled">{String(demo.enabled)}</span>
      <button type="button" onClick={() => demo.switchIdentity("demo-engineer")}>switch-demo-engineer</button>
    </div>
  );
}

describe("customer demo session", () => {
  beforeEach(() => window.localStorage.clear());

  it("switches the current workspace session and persists only the selected person", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceSessionProvider session={customerDemoSessions[0]} demoSessions={customerDemoSessions}>
        <SessionProbe />
      </WorkspaceSessionProvider>,
    );

    expect(screen.getByTestId("current-name")).toHaveTextContent("林远");
    expect(screen.getByTestId("demo-enabled")).toHaveTextContent("true");

    await user.click(screen.getByRole("button", { name: "switch-demo-engineer" }));

    expect(screen.getByTestId("current-name")).toHaveTextContent("陈晨");
    expect(window.localStorage.getItem(CUSTOMER_DEMO_ACTOR_KEY)).toBe("demo-engineer");
    expect(window.localStorage).toHaveLength(1);
  });

  it("restores a valid selected person and ignores an unknown one", async () => {
    window.localStorage.setItem(CUSTOMER_DEMO_ACTOR_KEY, "demo-finance");
    const { unmount } = render(
      <WorkspaceSessionProvider session={customerDemoSessions[0]} demoSessions={customerDemoSessions}>
        <SessionProbe />
      </WorkspaceSessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("current-name")).toHaveTextContent("周倩"));
    unmount();

    window.localStorage.setItem(CUSTOMER_DEMO_ACTOR_KEY, "missing-person");
    render(
      <WorkspaceSessionProvider session={customerDemoSessions[0]} demoSessions={customerDemoSessions}>
        <SessionProbe />
      </WorkspaceSessionProvider>,
    );

    await waitFor(() => expect(screen.getByTestId("current-name")).toHaveTextContent("林远"));
    expect(window.localStorage.getItem(CUSTOMER_DEMO_ACTOR_KEY)).toBeNull();
  });
});
