import { describe, expect, it } from "vitest";

import { buildWorkspaceSearchItems } from "@/components/shell/workspace-search-dialog";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

describe("workspace search readiness", () => {
  it("does not expose fixture business records while their modules are not commercial-ready", () => {
    const items = buildWorkspaceSearchItems(executiveWorkspaceSession, executiveWorkspaceSession.actor, true);

    expect(items.filter(({ kind }) => kind !== "模块")).toEqual([]);
    expect(items).toEqual([]);
  });
});
