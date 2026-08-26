import { describe, expect, it } from "vitest";

import { buildWorkspaceSearchItems } from "@/components/shell/workspace-search-dialog";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

describe("workspace search readiness", () => {
  it("exposes only the commercially ready people module and no fixture business records", () => {
    const items = buildWorkspaceSearchItems(executiveWorkspaceSession);

    expect(items.filter(({ kind }) => kind !== "模块")).toEqual([]);
    expect(items).toEqual([{
      id: "module-/people",
      label: "组织人事",
      meta: "企业工作站模块",
      href: "/people",
      kind: "模块",
    }]);
  });
});
