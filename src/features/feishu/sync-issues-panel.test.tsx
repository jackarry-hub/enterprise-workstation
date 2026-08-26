import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { FeishuSyncIssuesPanel } from "@/features/feishu/sync-issues-panel";
import { renderWithWorkspaceSession } from "@/test/workspace-session-test-utils";

const issue = {
  id: "79000000-0000-4000-8000-000000000001",
  code: "OUT_OF_ORDER_EVENT",
  severity: "warning" as const,
  entityType: "user" as const,
  status: "open" as const,
  createdAt: "2026-08-27T00:00:00.000Z",
};

describe("Feishu sync issue panel", () => {
  it("shows real conflict actions with mobile-safe touch targets", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const user = userEvent.setup();
    renderWithWorkspaceSession(<FeishuSyncIssuesPanel issues={[issue]} onResolved={() => undefined} />);

    expect(screen.getByText("OUT_OF_ORDER_EVENT")).toBeVisible();
    const resolve = screen.getByRole("button", { name: "标记已处理" });
    expect(resolve).toHaveClass("h-11");
    await user.click(resolve);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining(issue.id), expect.objectContaining({ method: "POST" }));
  });

  it("shows sanitized run and event evidence and offers an authorized reconciliation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    const user = userEvent.setup();
    renderWithWorkspaceSession(<FeishuSyncIssuesPanel
      issues={[]}
      runs={[{ id: "run-1", status: "failed", startedAt: "2026-08-27T00:00:00.000Z", completedAt: null, errorCount: 1 }]}
      events={[{ id: "event-1", eventType: "contact.user.updated_v3", entityType: "user", disposition: "reconcile", createdAt: "2026-08-27T00:01:00.000Z" }]}
      onResolved={() => undefined}
    />);

    expect(screen.getByText("失败")).toBeVisible();
    expect(screen.getByText("contact.user.updated_v3")).toBeVisible();
    const reconcile = screen.getByRole("button", { name: "立即重新对账" });
    expect(reconcile).toHaveClass("h-11");
    await user.click(reconcile);
    expect(fetch).toHaveBeenCalledWith("/api/workstation/directory-sync", { method: "POST" });
  });

  it("shows a retryable repository outage instead of a false-green empty state", () => {
    renderWithWorkspaceSession(<FeishuSyncIssuesPanel issues={[]} unavailable onResolved={() => undefined} />);
    expect(screen.getByRole("status")).toHaveTextContent("同步问题暂时无法读取");
    expect(screen.queryByText("当前没有待处理问题")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试读取" })).toHaveClass("h-11");
  });
});
