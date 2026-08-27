import { beforeEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({ getWorkspaceSession: vi.fn(), loadCustomerDetailData: vi.fn() }));
vi.mock("@/features/auth/workspace-session", () => ({ getWorkspaceSession: dependencies.getWorkspaceSession }));
vi.mock("@/features/customers/customer-data", () => ({ loadCustomerDetailData: dependencies.loadCustomerDetailData }));

import { GET } from "@/app/api/workstation/customers/[customerId]/route";

const customerId = "10000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ customerId }) };

describe("GET customer detail", () => {
  beforeEach(() => {
    dependencies.getWorkspaceSession.mockReset();
    dependencies.loadCustomerDetailData.mockReset();
  });

  it("requires an active session and delegates record visibility to customer RLS", async () => {
    dependencies.getWorkspaceSession.mockResolvedValue(null);
    expect((await GET(new Request("http://local"), context)).status).toBe(401);
    dependencies.getWorkspaceSession.mockResolvedValue({ permissionCodes: ["project.manage"] });
    dependencies.loadCustomerDetailData.mockResolvedValue({ source: "supabase" });
    expect((await GET(new Request("http://local"), context)).status).toBe(404);
    expect(dependencies.loadCustomerDetailData).toHaveBeenCalledWith(customerId);
  });

  it("returns only a real loader result with no-store caching", async () => {
    dependencies.getWorkspaceSession.mockResolvedValue({ permissionCodes: ["customer.manage"] });
    dependencies.loadCustomerDetailData.mockResolvedValue({
      source: "supabase", customer: { id: customerId, detailState: "complete", name: "真实客户" },
    });
    const response = await GET(new Request("http://local"), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ outcome: "success", resource: "customer_detail", customer: { id: customerId } });
  });

  it("distinguishes invisible records from unavailable reads", async () => {
    dependencies.getWorkspaceSession.mockResolvedValue({ permissionCodes: ["customer.manage"] });
    dependencies.loadCustomerDetailData.mockResolvedValueOnce({ source: "supabase" });
    expect((await GET(new Request("http://local"), context)).status).toBe(404);
    dependencies.loadCustomerDetailData.mockResolvedValueOnce({ source: "supabase", loadError: "unavailable" });
    expect((await GET(new Request("http://local"), context)).status).toBe(503);
  });
});
