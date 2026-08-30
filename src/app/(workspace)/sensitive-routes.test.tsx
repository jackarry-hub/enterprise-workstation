import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  executiveWorkspaceSession,
  unboundExecutiveWorkspaceSession,
} from "@/test/workspace-session-test-utils";

const dependencies = vi.hoisted(() => ({
  requireWorkspaceSession: vi.fn(),
  loadApprovals: vi.fn(),
  loadApprovalDetail: vi.fn(),
  loadSalary: vi.fn(),
  loadSalaryDetail: vi.fn(),
  loadEmployeeDirectory: vi.fn(),
  getEmployeeDetail: vi.fn(),
  loadEmployeePrivateProfile: vi.fn(),
}));

vi.mock("@/features/auth/workspace-session", () => ({
  requireWorkspaceSession: dependencies.requireWorkspaceSession,
}));

vi.mock("@/features/approvals/approval-data", () => ({
  loadApprovals: dependencies.loadApprovals,
  loadApprovalDetail: dependencies.loadApprovalDetail,
}));

vi.mock("@/features/salary/salary-data", () => ({
  loadSalary: dependencies.loadSalary,
  loadSalaryDetail: dependencies.loadSalaryDetail,
}));

vi.mock("@/features/hr/employee-data", () => ({
  loadEmployeeDirectory: dependencies.loadEmployeeDirectory,
  getEmployeeDetail: dependencies.getEmployeeDetail,
  loadEmployeePrivateProfile: dependencies.loadEmployeePrivateProfile,
}));

import ApprovalDetailRoute from "@/app/(workspace)/approvals/[id]/page";
import ApprovalsRoute from "@/app/(workspace)/approvals/page";
import PayrollDetailRoute from "@/app/(workspace)/payroll/[id]/page";
import PayrollRoute from "@/app/(workspace)/payroll/page";
import EmployeeDetailRoute from "@/app/(workspace)/people/[id]/page";
import PeopleRoute from "@/app/(workspace)/people/page";

const approvalResult = {
  source: "mock",
  data: {
    approvals: [{ id: "approval-sentinel", title: "审批夹具哨兵" }],
    stats: { pending: 1, initiated: 0, approved: 0, rejected: 0 },
  },
};
const approvalDetail = { id: "approval-sentinel", title: "审批详情夹具哨兵" };
const salaryResult = {
  source: "mock",
  data: {
    records: [{ id: "salary-sentinel", netSalary: 987654321 }],
    departments: [],
    stats: { totalSalary: 987654321, employeeCount: 1, averageSalary: 987654321 },
  },
};
const salaryDetail = { id: "salary-sentinel", netSalary: 987654321 };
const peopleResult = {
  source: "mock",
  data: {
    employees: [{ profile: { id: "person-sentinel", displayName: "员工夹具哨兵" } }],
    departments: [],
    stats: { total: 1, active: 1, probation: 0, departments: 0 },
  },
};
const employeeDetail = {
  profile: { id: "person-sentinel", displayName: "员工详情夹具哨兵" },
};
const employeePrivateProfile = { source: "supabase", data: undefined };

function serialized(value: unknown) {
  return JSON.stringify(value);
}

describe("sensitive workspace routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.loadApprovals.mockResolvedValue(approvalResult);
    dependencies.loadApprovalDetail.mockResolvedValue(approvalDetail);
    dependencies.loadSalary.mockResolvedValue(salaryResult);
    dependencies.loadSalaryDetail.mockResolvedValue(salaryDetail);
    dependencies.loadEmployeeDirectory.mockResolvedValue(peopleResult);
    dependencies.getEmployeeDetail.mockReturnValue(employeeDetail);
    dependencies.loadEmployeePrivateProfile.mockResolvedValue(employeePrivateProfile);
  });

  it("loads only the safe people directory and capability-scoped private profile for an active real session", async () => {
    dependencies.requireWorkspaceSession.mockResolvedValue(
      unboundExecutiveWorkspaceSession,
    );

    const outputs = await Promise.all([
      ApprovalsRoute({}),
      ApprovalDetailRoute({ params: Promise.resolve({ id: "approval-sentinel" }) }),
      PayrollRoute(),
      PayrollDetailRoute({ params: Promise.resolve({ id: "salary-sentinel" }) }),
      PeopleRoute(),
      EmployeeDetailRoute({ params: Promise.resolve({ id: "person-sentinel" }) }),
    ]);
    const payload = serialized(outputs);

    expect(dependencies.loadApprovals).not.toHaveBeenCalled();
    expect(dependencies.loadApprovalDetail).not.toHaveBeenCalled();
    expect(dependencies.loadSalary).not.toHaveBeenCalled();
    expect(dependencies.loadSalaryDetail).not.toHaveBeenCalled();
    expect(dependencies.loadEmployeeDirectory).toHaveBeenCalledWith(
      unboundExecutiveWorkspaceSession.organization.id,
      undefined,
      { allowMockFallback: false },
    );
    expect(dependencies.getEmployeeDetail).toHaveBeenCalledWith("person-sentinel", peopleResult);
    expect(dependencies.loadEmployeePrivateProfile).toHaveBeenCalledWith(
      "person-sentinel",
      unboundExecutiveWorkspaceSession.organization.id,
    );
    expect(payload).toContain("员工夹具哨兵");
    expect(payload).not.toContain("私密邮箱哨兵");
    expect(payload).not.toContain("987654321");
  });

  it("loads approval fixtures only for the exact explicit binding", async () => {
    dependencies.requireWorkspaceSession.mockResolvedValue(executiveWorkspaceSession);

    const list = await ApprovalsRoute({});
    const detail = await ApprovalDetailRoute({
      params: Promise.resolve({ id: "approval-sentinel" }),
    });

    expect(dependencies.loadApprovals).toHaveBeenCalledOnce();
    expect(dependencies.loadApprovalDetail).toHaveBeenCalledWith("approval-sentinel");
    expect(serialized([list, detail])).toContain("审批夹具哨兵");
  });

  it("loads payroll fixtures only for the exact explicit binding", async () => {
    dependencies.requireWorkspaceSession.mockResolvedValue(executiveWorkspaceSession);

    const list = await PayrollRoute();
    const detail = await PayrollDetailRoute({
      params: Promise.resolve({ id: "salary-sentinel" }),
    });

    expect(dependencies.loadSalary).toHaveBeenCalledOnce();
    expect(dependencies.loadSalaryDetail).toHaveBeenCalledWith("salary-sentinel");
    expect(serialized([list, detail])).toContain("987654321");
  });

  it("loads the employee directory and target-authorized private profile for the explicit session", async () => {
    dependencies.requireWorkspaceSession.mockResolvedValue(executiveWorkspaceSession);

    const list = await PeopleRoute();
    const detail = await EmployeeDetailRoute({
      params: Promise.resolve({ id: "person-sentinel" }),
    });

    expect(dependencies.loadEmployeeDirectory).toHaveBeenCalledWith(
      executiveWorkspaceSession.organization.id,
      undefined,
      { allowMockFallback: false },
    );
    expect(dependencies.getEmployeeDetail).toHaveBeenCalledWith(
      "person-sentinel",
      peopleResult,
    );
    expect(dependencies.loadEmployeePrivateProfile).toHaveBeenCalledWith(
      "person-sentinel",
      executiveWorkspaceSession.organization.id,
    );
    expect(serialized([list, detail])).toContain("员工夹具哨兵");
  });
});
