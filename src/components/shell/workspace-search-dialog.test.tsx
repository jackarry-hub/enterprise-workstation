import { describe, expect, it } from "vitest";

import { buildWorkspaceSearchItems } from "@/components/shell/workspace-search-dialog";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

describe("workspace search readiness", () => {
  it("exposes only commercially ready authorized modules and no fixture business records", () => {
    const items = buildWorkspaceSearchItems(executiveWorkspaceSession);

    expect(items.filter(({ kind }) => kind !== "模块")).toEqual([]);
    expect(items).toEqual([
      {
        id: "module-/assistant",
        label: "AI 助手",
        meta: "企业工作站模块",
        href: "/assistant",
        kind: "模块",
      },
      {
        id: "module-/agents",
        label: "Agent 中心",
        meta: "企业工作站模块",
        href: "/agents",
        kind: "模块",
      },
      {
        id: "module-/department",
        label: "负责人推进台",
        meta: "企业工作站模块",
        href: "/department",
        kind: "模块",
      },
      {
        id: "module-/people",
        label: "组织人事",
        meta: "企业工作站模块",
        href: "/people",
        kind: "模块",
      },
      {
        id: "module-/settings",
        label: "系统设置",
        meta: "企业工作站模块",
        href: "/settings",
        kind: "模块",
      },
    ]);
  });
});
