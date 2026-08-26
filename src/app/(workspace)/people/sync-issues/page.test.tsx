import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import SyncIssuesPage from "@/app/(workspace)/people/sync-issues/page";

vi.mock("@/features/auth/workspace-session", () => ({
  requireWorkspaceSession: vi.fn(async () => ({ permissionCodes: ["organization.manage"], organization: { id: "org", name: "QuantXY" } })),
}));
vi.mock("@/features/feishu/sync-issues-data", () => ({ loadFeishuSyncOperations: vi.fn(async () => ({ issues: [], runs: [], events: [] })) }));
vi.mock("@/features/feishu/sync-issues-panel", () => ({ FeishuSyncIssuesPanel: () => <div>冲突工作台</div> }));

describe("sync issues page", () => {
  it("renders the manager issue workspace", async () => {
    const page = await SyncIssuesPage();
    const { render } = await import("@testing-library/react");
    render(page);
    expect(screen.getByRole("heading", { name: "飞书同步问题" })).toBeVisible();
    expect(screen.getByText("冲突工作台")).toBeVisible();
  });
});
