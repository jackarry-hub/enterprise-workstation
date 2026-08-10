import { render, type RenderOptions } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import { WorkspaceSessionProvider } from "@/features/auth/workspace-session-provider";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";

export const executiveWorkspaceSession: WorkspaceSession = {
  tenantId: "10000000-0000-4000-8000-000000000000",
  authUserId: "10000000-0000-4000-8000-000000000001",
  identity: {
    providerCode: "feishu",
    authProvider: "custom:feishu",
    providerSubject: "subject-executive-001",
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
    displayName: "真实决策人",
    avatarUrl: null,
    departmentName: "总经办",
    jobTitle: "董事长",
    skills: ["strategy", "leadership"],
  },
  roleCodes: ["owner"],
  permissionCodes: ["dashboard.read", "organization.manage"],
  primaryRole: "executive",
  landingPath: "/dashboard",
  isAdmin: false,
  actor: {
    id: "10000000-0000-4000-8000-000000000001",
    memberId: "10",
    name: "真实决策人",
    role: "executive",
    roleLabel: "CEO",
    department: "总经办",
    title: "董事长",
    landingPath: "/dashboard",
  },
};

export function renderWithWorkspaceSession(
  ui: ReactElement,
  options?: Omit<RenderOptions, "wrapper">,
) {
  function SessionWrapper({ children }: { children: ReactNode }) {
    return (
      <WorkspaceSessionProvider session={executiveWorkspaceSession}>
        {children}
      </WorkspaceSessionProvider>
    );
  }

  return render(ui, { ...options, wrapper: SessionWrapper });
}
