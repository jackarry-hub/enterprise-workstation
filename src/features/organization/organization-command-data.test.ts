import { describe, expect, it, vi } from "vitest";

import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";
import {
  loadManagerCommandTargets,
  loadRoleCommandTargets,
} from "@/features/organization/organization-command-data";

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

describe("manager command targets", () => {
  it("does not query manager targets without organization.manage", async () => {
    const from = vi.fn();

    const result = await loadManagerCommandTargets(
      { ...executiveWorkspaceSession, permissionCodes: ["role.manage"] },
      async () => ({ from } as never),
    );

    expect(result).toEqual({ status: "ready", targets: [] });
    expect(from).not.toHaveBeenCalled();
  });

  it("returns only active exact-organization public targets with authoritative manager versions", async () => {
    const result = {
      data: [
        {
          id: 41,
          public_id: "72000000-0000-4000-8000-000000000001",
          display_name: "陈工",
          employee_no: "QXY-2101",
          job_title: "后端工程师",
          organization_id: 7,
          organization_member_id: 31,
          department_id: 11,
          manager_employee_id: 42,
          manager_version: 4,
          manager_source: "manual",
          member: { id: 31, status: "active" },
          department: {
            id: 11,
            public_id: "73000000-0000-4000-8000-000000000001",
            organization_id: 7,
            name: "工程部",
          },
        },
        {
          id: 42,
          public_id: "72000000-0000-4000-8000-000000000002",
          display_name: "王主管",
          employee_no: "QXY-2001",
          job_title: "研发主管",
          organization_id: 7,
          organization_member_id: 32,
          department_id: 11,
          manager_employee_id: null,
          manager_version: 2,
          manager_source: "unassigned",
          member: { id: 32, status: "active" },
          department: {
            id: 11,
            public_id: "73000000-0000-4000-8000-000000000001",
            organization_id: 7,
            name: "工程部",
          },
        },
        {
          id: 43,
          public_id: "72000000-0000-4000-8000-000000000003",
          display_name: "其他组织员工",
          employee_no: "QXY-9001",
          job_title: "工程师",
          organization_id: 8,
          organization_member_id: 33,
          department_id: 12,
          manager_employee_id: null,
          manager_version: 1,
          manager_source: "unassigned",
          member: { id: 33, status: "active" },
          department: {
            id: 12,
            public_id: "73000000-0000-4000-8000-000000000002",
            organization_id: 8,
            name: "其他组织",
          },
        },
      ],
      error: null,
    };
    const order = vi.fn().mockResolvedValue(result);
    const isDeleted = vi.fn().mockReturnValue({ order });
    const isActive = vi.fn().mockReturnValue({ is: isDeleted });
    const profileEq = vi.fn().mockReturnValue({ in: isActive });
    const profileSelect = vi.fn().mockReturnValue({ eq: profileEq });
    const organizationMaybeSingle = vi.fn().mockResolvedValue({ data: { id: 7 }, error: null });
    const organizationEq = vi.fn().mockReturnValue({ maybeSingle: organizationMaybeSingle });
    const organizationSelect = vi.fn().mockReturnValue({ eq: organizationEq });
    const from = vi.fn((table: string) => table === "organizations"
      ? { select: organizationSelect }
      : { select: profileSelect });

    const loaded = await loadManagerCommandTargets(
      { ...executiveWorkspaceSession, permissionCodes: ["organization.manage"] },
      async () => ({ from } as never),
    );

    expect(profileSelect).toHaveBeenCalledWith(expect.stringContaining("manager_version"));
    expect(profileEq).toHaveBeenCalledWith("organization_id", 7);
    expect(isActive).toHaveBeenCalledWith("employment_status", ["probation", "active", "on_leave"]);
    expect(loaded).toEqual({
      status: "ready",
      targets: [
        {
          employeeId: "72000000-0000-4000-8000-000000000001",
          displayLabel: "陈工 · QXY-2101 · 后端工程师",
          departmentPublicId: "73000000-0000-4000-8000-000000000001",
          departmentName: "工程部",
          currentManagerEmployeeId: "72000000-0000-4000-8000-000000000002",
          managerVersion: 4,
          managerSource: "manual",
        },
        {
          employeeId: "72000000-0000-4000-8000-000000000002",
          displayLabel: "王主管 · QXY-2001 · 研发主管",
          departmentPublicId: "73000000-0000-4000-8000-000000000001",
          departmentName: "工程部",
          currentManagerEmployeeId: null,
          managerVersion: 2,
          managerSource: "unassigned",
        },
      ],
    });
  });

  it("surfaces a repository failure instead of presenting an empty successful selector", async () => {
    const organizationMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: { code: "08006" } });
    const organizationEq = vi.fn().mockReturnValue({ maybeSingle: organizationMaybeSingle });
    const from = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ eq: organizationEq }) });

    await expect(loadManagerCommandTargets(
      { ...executiveWorkspaceSession, permissionCodes: ["organization.manage"] },
      async () => ({ from } as never),
    )).resolves.toEqual({ status: "unavailable" });
  });
});
