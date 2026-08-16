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
  loadProjectList: vi.fn(),
  loadProjectDetail: vi.fn(),
  customerDemoMode: false,
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
}));

vi.mock("@/features/projects/data/project-list-data", () => ({
  loadProjectList: dependencies.loadProjectList,
}));

vi.mock("@/features/projects/data/project-detail-data", () => ({
  loadProjectDetail: dependencies.loadProjectDetail,
}));

vi.mock("@/features/demo/customer-demo-mode", () => ({
  isCustomerDemoMode: () => dependencies.customerDemoMode,
}));

import ApprovalDetailRoute from "@/app/(workspace)/approvals/[id]/page";
import ApprovalsRoute from "@/app/(workspace)/approvals/page";
import PayrollDetailRoute from "@/app/(workspace)/payroll/[id]/page";
import PayrollRoute from "@/app/(workspace)/payroll/page";
import EmployeeDetailRoute from "@/app/(workspace)/people/[id]/page";
import PeopleRoute from "@/app/(workspace)/people/page";
import ProjectDetailRoute from "@/app/(workspace)/projects/[id]/page";
import ProjectsRoute from "@/app/(workspace)/projects/page";

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
const projectResult = {
  source: "supabase",
  data: {
    projects: [],
    stats: { total: 0, active: 0, completed: 0, overdue: 0 },
  },
};

function serialized(value: unknown) {
  return JSON.stringify(value);
}

describe("sensitive workspace routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dependencies.customerDemoMode = false;
    dependencies.loadApprovals.mockResolvedValue(approvalResult);
    dependencies.loadApprovalDetail.mockResolvedValue(approvalDetail);
    dependencies.loadSalary.mockResolvedValue(salaryResult);
    dependencies.loadSalaryDetail.mockResolvedValue(salaryDetail);
    dependencies.loadEmployeeDirectory.mockResolvedValue(peopleResult);
    dependencies.getEmployeeDetail.mockReturnValue(employeeDetail);
    dependencies.loadProjectList.mockResolvedValue(projectResult);
    dependencies.loadProjectDetail.mockResolvedValue(undefined);
  });

  it("does not call or serialize fixture loaders for an unbound real session", async () => {
    dependencies.requireWorkspaceSession.mockResolvedValue(
      unboundExecutiveWorkspaceSession,
    );

    const outputs = await Promise.all([
      ApprovalsRoute(),
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
    expect(dependencies.loadEmployeeDirectory).not.toHaveBeenCalled();
    expect(dependencies.getEmployeeDetail).not.toHaveBeenCalled();
    expect(payload).not.toContain("夹具哨兵");
    expect(payload).not.toContain("987654321");
  });

  it("loads approval fixtures only for the exact explicit binding", async () => {
    dependencies.requireWorkspaceSession.mockResolvedValue(executiveWorkspaceSession);

    const list = await ApprovalsRoute();
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

  it("loads employee fixtures only for the exact explicit binding", async () => {
    dependencies.requireWorkspaceSession.mockResolvedValue(executiveWorkspaceSession);

    const list = await PeopleRoute();
    const detail = await EmployeeDetailRoute({
      params: Promise.resolve({ id: "person-sentinel" }),
    });

    expect(dependencies.loadEmployeeDirectory).toHaveBeenCalledTimes(2);
    expect(dependencies.getEmployeeDetail).toHaveBeenCalledWith(
      "person-sentinel",
      peopleResult,
    );
    expect(serialized([list, detail])).toContain("员工夹具哨兵");
  });

  it("forces the complete employee demo directory in customer demo mode", async () => {
    dependencies.customerDemoMode = true;
    dependencies.requireWorkspaceSession.mockResolvedValue(executiveWorkspaceSession);

    await PeopleRoute();

    expect(dependencies.loadEmployeeDirectory).toHaveBeenCalledWith(
      undefined,
      { allowMockFallback: true },
    );
  });

  it("uses the same demo project catalog as the dashboard in customer demo mode", async () => {
    dependencies.customerDemoMode = true;

    const output = await ProjectsRoute();

    expect(dependencies.loadProjectList).not.toHaveBeenCalled();
    expect(output.props.result).toBeUndefined();
  });

  it("opens a demo project detail without waiting for Supabase", async () => {
    dependencies.customerDemoMode = true;

    const output = await ProjectDetailRoute({
      params: Promise.resolve({ id: "40000000-0000-4000-8000-000000000001" }),
    });

    expect(dependencies.loadProjectDetail).not.toHaveBeenCalled();
    expect(output.props.initialResult).toEqual(expect.objectContaining({ source: "mock" }));
    expect(output.props.initialResult.detail.project.id).toBe("40000000-0000-4000-8000-000000000001");
  });

});
