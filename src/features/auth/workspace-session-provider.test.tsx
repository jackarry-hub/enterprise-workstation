import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";

import {
  useWorkspaceSession,
  WorkspaceSessionProvider,
} from "@/features/auth/workspace-session-provider";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";

const session: WorkspaceSession = {
  tenantId: "10000000-0000-4000-8000-000000000000",
  authUserId: "10000000-0000-4000-8000-000000000001",
  identity: {
    providerCode: "feishu",
    authProvider: "custom:feishu",
    providerSubject: "subject-employee-001",
  },
  organization: {
    id: "10000000-0000-4000-8000-000000000002",
    name: "量子星河",
  },
  member: {
    id: 10,
    employeeProfileId: "10000000-0000-4000-8000-000000000003",
    status: "active",
  },
  profile: {
    displayName: "测试员工",
    avatarUrl: null,
    departmentName: "AI事业部",
    jobTitle: "产品经理",
    skills: ["product", "需求分析"],
  },
  roleCodes: ["employee"],
  customRoleCodes: [],
  supervisorScopeEmployeeIds: [],
  permissionCodes: ["task.manage"],
  primaryRole: "employee",
  landingPath: "/execution",
  isAdmin: false,
  actor: {
    id: "actor-employee",
    memberId: "20000000-0000-4000-8000-000000000004",
    name: "测试员工",
    role: "employee",
    roleLabel: "普通员工",
    department: "AI事业部",
    title: "产品经理",
    landingPath: "/execution",
  },
};

describe("WorkspaceSessionProvider", () => {
  it("fails closed when the hook is used without its provider", () => {
    expect(() => renderHook(() => useWorkspaceSession())).toThrow(
      "WorkspaceSessionProvider 缺失",
    );
  });

  it("provides the immutable current session without demo switching controls", () => {
    const legacyActorStorageKey = ["enterprise-workspace", "demo-actor", "v1"].join(".");
    window.localStorage.setItem(legacyActorStorageKey, "actor-executive");

    function wrapper({ children }: { children: ReactNode }) {
      return (
        <WorkspaceSessionProvider session={session}>
          {children}
        </WorkspaceSessionProvider>
      );
    }

    const { result } = renderHook(() => useWorkspaceSession(), { wrapper });

    expect(result.current.actor.name).toBe("测试员工");
    expect(result.current.tenantId).toBe("10000000-0000-4000-8000-000000000000");
    expect(result.current.identity.providerSubject).toBe("subject-employee-001");
    expect(result.current.profile.skills).toEqual(["product", "需求分析"]);
    expect("actors" in result.current).toBe(false);
    expect("setActorId" in result.current).toBe(false);
  });
});
