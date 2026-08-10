import { describe, expect, it } from "vitest";

import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import {
  deleteProjectFileBlob,
  readProjectFileBlob,
  storeProjectFileBlob,
} from "@/features/operations/file-storage";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

function unboundContext(overrides: Partial<WorkspaceSession> = {}) {
  const authUserId = overrides.authUserId ?? "10000000-0000-4000-8000-000000000099";
  const member = overrides.member ?? { ...executiveWorkspaceSession.member, id: 99 };
  return createOperationFixtureContext({
    ...executiveWorkspaceSession,
    ...overrides,
    authUserId,
    member,
    actor: {
      ...executiveWorkspaceSession.actor,
      id: authUserId,
      memberId: String(member.id),
      ...overrides.actor,
    },
  });
}

describe("file blob identity isolation", () => {
  it("keeps a bound file inside its workspace identity namespace", async () => {
    const context = createOperationFixtureContext(executiveWorkspaceSession);
    const file = new File(["private-data"], "private.txt", { type: "text/plain" });

    await storeProjectFileBlob(context, "shared-file-id", file);

    expect(await readProjectFileBlob(context, "shared-file-id")).toBe(file);
    await deleteProjectFileBlob(context, "shared-file-id");
    expect(await readProjectFileBlob(context, "shared-file-id")).toBeUndefined();
  });

  it.each([
    ["same role, different user", unboundContext()],
    ["same role, different tenant", unboundContext({ tenantId: "10000000-0000-4000-8000-000000000098" })],
  ])("rejects blob read, write, and delete for an unbound %s", async (_label, context) => {
    const file = new File(["private-data"], "private.txt", { type: "text/plain" });

    await expect(storeProjectFileBlob(context, "shared-file-id", file)).rejects.toThrow(
      "当前真实身份未绑定本地文件夹具",
    );
    await expect(readProjectFileBlob(context, "shared-file-id")).rejects.toThrow(
      "当前真实身份未绑定本地文件夹具",
    );
    await expect(deleteProjectFileBlob(context, "shared-file-id")).rejects.toThrow(
      "当前真实身份未绑定本地文件夹具",
    );
  });
});
