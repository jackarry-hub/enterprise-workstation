import { describe, expect, it } from "vitest";

import { createResolveFeishuSyncIssueHandler } from "@/app/api/workstation/feishu/sync-issues/[issueId]/resolve/handler";

describe("resolve Feishu sync issue", () => {
  it("requires organization.manage and audits an organization-bound resolution", async () => {
    let resolved = 0;
    const handler = createResolveFeishuSyncIssueHandler({
      loadSession: async () => ({ organizationId: "org-1", authUserId: "user-1", permissionCodes: ["organization.manage"] }),
      resolve: async (input) => { resolved += 1; expect(input).toMatchObject({ organizationId: "org-1", issueId: "79000000-0000-4000-8000-000000000001" }); return "resolved"; },
    });
    const response = await handler(
      new Request("https://work.quantxy.test/api/workstation/feishu/sync-issues/79000000-0000-4000-8000-000000000001/resolve", { method: "POST" }),
      { params: Promise.resolve({ issueId: "79000000-0000-4000-8000-000000000001" }) },
    );
    expect(response.status).toBe(200);
    expect(resolved).toBe(1);
  });

  it("returns a stable forbidden response without invoking the command", async () => {
    let resolved = 0;
    const response = await createResolveFeishuSyncIssueHandler({
      loadSession: async () => ({ organizationId: "org-1", authUserId: "user-1", permissionCodes: [] }),
      resolve: async () => { resolved += 1; return "resolved"; },
    })(new Request("https://work.quantxy.test"), { params: Promise.resolve({ issueId: "79000000-0000-4000-8000-000000000001" }) });
    expect(response.status).toBe(403);
    expect(resolved).toBe(0);
  });
});
