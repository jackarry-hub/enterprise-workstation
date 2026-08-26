import { describe, expect, it } from "vitest";

import { loadFeishuSyncIssues } from "@/features/feishu/sync-issues-data";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

const session: WorkspaceSession = { ...executiveWorkspaceSession, permissionCodes: ["organization.manage"] };

describe("Feishu sync issue repository", () => {
  it("returns no data without organization.manage", async () => {
    const result = await loadFeishuSyncIssues({ ...session, permissionCodes: [] }, async () => { throw new Error("must not connect"); });
    expect(result).toEqual([]);
  });

  it("binds every read to the exact session organization and exposes sanitized fields", async () => {
    const calls: Array<[string, unknown]> = [];
    const query = {
      select() { return this; },
      eq(field: string, value: unknown) { calls.push([field, value]); return this; },
      is() { return this; },
      order() { return Promise.resolve({ data: [{
        public_id: "79000000-0000-4000-8000-000000000001",
        code: "OUT_OF_ORDER_EVENT",
        severity: "warning",
        entity_type: "user",
        status: "open",
        created_at: "2026-08-27T00:00:00.000Z",
      }], error: null }); },
    };
    const result = await loadFeishuSyncIssues(session, async () => ({ from: () => query } as never));

    expect(calls).toContainEqual(["organization_public_id", session.organization.id]);
    expect(result).toEqual([expect.objectContaining({ id: "79000000-0000-4000-8000-000000000001", code: "OUT_OF_ORDER_EVENT" })]);
    expect(JSON.stringify(result)).not.toMatch(/payload|token|open_id/i);
  });
});
