import { describe, expect, it, vi } from "vitest";

import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";
import { loadRoleCommandTargets } from "@/features/organization/organization-command-data";

describe("role command targets", () => {
  it("does not query role targets without the server-derived role.manage capability", async () => {
    const from = vi.fn();

    const targets = await loadRoleCommandTargets(
      { ...executiveWorkspaceSession, permissionCodes: ["organization.manage"] },
      async () => ({ from } as never),
    );

    expect(targets).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it("maps only valid, active organization members to selectable command targets", async () => {
    const result = {
      data: [
        {
          public_id: "71000000-0000-4000-8000-000000000001",
          display_name: "陈工",
          employee_no: "QXY-2101",
          job_title: "后端工程师",
          organization_id: 7,
          organization_member_id: 31,
          member: { id: 31, role_version: 4, status: "active" },
        },
        {
          public_id: "71000000-0000-4000-8000-000000000002",
          display_name: "无效成员",
          employee_no: "QXY-2102",
          job_title: "工程师",
          organization_id: 7,
          organization_member_id: null,
          member: null,
        },
        {
          public_id: "71000000-0000-4000-8000-000000000003",
          display_name: "其他组织成员",
          employee_no: "QXY-2103",
          job_title: "工程师",
          organization_id: 8,
          organization_member_id: 32,
          member: { id: 32, role_version: 2, status: "active" },
        },
      ],
      error: null,
    };
    const order = vi.fn().mockResolvedValue(result);
    const is = vi.fn().mockReturnValue({ order });
    const profileEq = vi.fn().mockReturnValue({ is });
    const profileSelect = vi.fn().mockReturnValue({ eq: profileEq });
    const organizationMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 7 }, error: null });
    const organizationEq = vi.fn().mockReturnValue({ maybeSingle: organizationMaybeSingle });
    const organizationSelect = vi.fn().mockReturnValue({ eq: organizationEq });
    const from = vi.fn((table: string) => table === "organizations"
      ? { select: organizationSelect }
      : { select: profileSelect });

    const targets = await loadRoleCommandTargets(
      { ...executiveWorkspaceSession, permissionCodes: ["role.manage"] },
      async () => ({ from } as never),
    );

    expect(from).toHaveBeenCalledWith("organizations");
    expect(organizationEq).toHaveBeenCalledWith("public_id", executiveWorkspaceSession.organization.id);
    expect(from).toHaveBeenCalledWith("employee_profiles");
    expect(profileSelect).toHaveBeenCalledWith(expect.stringContaining("role_version"));
    expect(profileEq).toHaveBeenCalledWith("organization_id", 7);
    expect(targets).toEqual([{
      employeeId: "71000000-0000-4000-8000-000000000001",
      displayName: "陈工",
      employeeNo: "QXY-2101",
      jobTitle: "后端工程师",
      memberId: 31,
      roleVersion: 4,
    }]);
  });
});
