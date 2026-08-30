import { describe, expect, it, vi } from "vitest";
import { handleCommercialAnalytics } from "@/features/analytics/analytics-handler";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

const analyticsSession = { ...executiveWorkspaceSession, permissionCodes: [...executiveWorkspaceSession.permissionCodes, "analytics.read" as const] };
const employeeSession = { ...executiveWorkspaceSession, permissionCodes: [] };

describe("commercial analytics handler", () => {
  it("loads a bounded organization projection", async () => { const rpc = vi.fn().mockResolvedValue({ data: { metrics: [] }, error: null }); const response = await handleCommercialAnalytics(new Request("https://q.test/api?from=2026-08-01&to=2026-08-30"), { loadSession: async () => analyticsSession, rpc }); expect(response.status).toBe(200); expect(rpc).toHaveBeenCalledWith("current_commercial_metrics", { from_date: "2026-08-01", to_date: "2026-08-30" }); });
  it("blocks users without analytics permission before database access", async () => { const rpc = vi.fn(); const response = await handleCommercialAnalytics(new Request("https://q.test/api?from=2026-08-01&to=2026-08-30"), { loadSession: async () => employeeSession, rpc }); expect(response.status).toBe(403); expect(rpc).not.toHaveBeenCalled(); });
  it("rejects invalid and oversized ranges", async () => { const rpc = vi.fn(); const response = await handleCommercialAnalytics(new Request("https://q.test/api?from=2025-01-01&to=2026-08-30"), { loadSession: async () => analyticsSession, rpc }); expect(response.status).toBe(400); expect(rpc).not.toHaveBeenCalled(); });
});
