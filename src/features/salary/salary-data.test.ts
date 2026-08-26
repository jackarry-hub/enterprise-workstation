import { describe, expect, it, vi } from "vitest";

import { loadSalary, loadSalaryDetail } from "@/features/salary/salary-data";

type QueryResponse = { data: unknown; error: Error | null };

function createQuery(response: QueryResponse) {
  const query = {
    select: () => query,
    eq: () => query,
    in: () => query,
    is: () => query,
    order: () => query,
    limit: () => query,
    maybeSingle: () => Promise.resolve({
      data: Array.isArray(response.data) ? response.data[0] ?? null : response.data,
      error: response.error,
    }),
    then: (
      resolve: (value: QueryResponse) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise.resolve(response).then(resolve, reject),
  };

  return query;
}

describe("salary data", () => {
  it("assembles real monthly payroll from salary, employee profile and department rows", async () => {
    const responses: Record<string, QueryResponse> = {
      salary: {
        data: [
          {
            public_id: "salary-2026-08-emp-1",
            organization_id: 1,
            employee_profile_id: 11,
            payroll_month: "2026-08-01",
            base_salary: 26000,
            performance_bonus: 3200,
            project_bonus: 4800,
            other_bonus: 500,
            bonus: 8500,
            social_security: 1800,
            individual_income_tax: 950,
            other_deduction: 250,
            deductions: 3000,
            net_salary: 31500,
            status: "paid",
            paid_at: "2026-08-25T10:00:00.000Z",
          },
          {
            public_id: "salary-2026-07-emp-1",
            organization_id: 1,
            employee_profile_id: 11,
            payroll_month: "2026-07-01",
            base_salary: 25000,
            performance_bonus: 3000,
            project_bonus: 3500,
            other_bonus: 0,
            bonus: 6500,
            social_security: 1700,
            individual_income_tax: 800,
            other_deduction: 200,
            deductions: 2700,
            net_salary: 28800,
            status: "paid",
            paid_at: "2026-07-25T10:00:00.000Z",
          },
          {
            public_id: "salary-2026-08-emp-2",
            organization_id: 1,
            employee_profile_id: 12,
            payroll_month: "2026-08-01",
            base_salary: 18000,
            performance_bonus: 2000,
            project_bonus: 1200,
            other_bonus: 0,
            bonus: 3200,
            social_security: 1200,
            individual_income_tax: 500,
            other_deduction: 0,
            deductions: 1700,
            net_salary: 19500,
            status: "processing",
            paid_at: null,
          },
        ],
        error: null,
      },
      employee_profiles: {
        data: [
          {
            id: 11,
            public_id: "employee-profile-1",
            organization_member_id: 101,
            employee_no: "QXY-1001",
            display_name: "董佳瑶",
            avatar_url: null,
            job_title: "产品经理",
            department_id: 21,
          },
          {
            id: 12,
            public_id: "employee-profile-2",
            organization_member_id: 102,
            employee_no: "QXY-1002",
            display_name: "王芳",
            avatar_url: null,
            job_title: "前端工程师",
            department_id: 22,
          },
        ],
        error: null,
      },
      salary_classifications: {
        data: [
          { organization_member_id: 101, salary_grade_code: "P6", job_level: 6 },
          { organization_member_id: 102, salary_grade_code: "P5", job_level: 5 },
        ],
        error: null,
      },
      departments: {
        data: [
          { id: 21, public_id: "department-product", name: "产品研发部" },
          { id: 22, public_id: "department-engineering", name: "工程技术部" },
        ],
        error: null,
      },
    };
    const factory = (async () => ({
      from: (table: string) => createQuery(responses[table]),
      rpc: () => createQuery(responses.salary_classifications),
    })) as never;

    const result = await loadSalary(factory, { allowMockFallback: false, canManageSalary: true });

    expect(result.source).toBe("supabase");
    expect(result.data.records).toHaveLength(3);
    expect(result.data.records[0]).toMatchObject({
      id: "salary-2026-08-emp-1",
      month: "2026-08",
      employee: {
        id: "employee-profile-1",
        employeeNo: "QXY-1001",
        displayName: "董佳瑶",
        jobTitle: "产品经理",
        salaryGradeCode: "P6",
        jobLevel: 6,
      },
      department: { id: "department-product", name: "产品研发部" },
      baseSalary: 26000,
      bonus: 8500,
      deductions: 3000,
      netSalary: 31500,
      status: "paid",
    });
    expect(result.data.records[0].breakdown).toEqual([
      { label: "部门职级基础工资", amount: 26000, kind: "income" },
      { label: "绩效奖金", amount: 3200, kind: "income" },
      { label: "项目奖金池分配", amount: 4800, kind: "income" },
      { label: "其他补贴", amount: 500, kind: "income" },
      { label: "社保与公积金", amount: 1800, kind: "deduction" },
      { label: "个人所得税", amount: 950, kind: "deduction" },
      { label: "其他扣款", amount: 250, kind: "deduction" },
    ]);
    expect(result.data.records[0].history).toEqual([
      { month: "2026-08", netSalary: 31500, status: "paid" },
      { month: "2026-07", netSalary: 28800, status: "paid" },
    ]);
    expect(result.data.stats).toEqual({
      totalSalary: 51000,
      employeeCount: 2,
      averageSalary: 25500,
    });
  });

  it("resolves a real payroll detail by public salary id", async () => {
    const responses: Record<string, QueryResponse> = {
      salary: {
        data: [
          {
            public_id: "salary-detail-id",
            organization_id: 1,
            employee_profile_id: 11,
            payroll_month: "2026-08-01",
            base_salary: 12000,
            performance_bonus: 800,
            project_bonus: 1000,
            other_bonus: 0,
            bonus: 1800,
            social_security: 900,
            individual_income_tax: 120,
            other_deduction: 0,
            deductions: 1020,
            net_salary: 12780,
            status: "processing",
            paid_at: null,
          },
        ],
        error: null,
      },
      employee_profiles: {
        data: [{
          id: 11,
          public_id: "employee-detail-profile",
          organization_member_id: 101,
          employee_no: "QXY-2001",
          display_name: "李记伟",
          avatar_url: null,
          job_title: "项目经理",
          department_id: 21,
        }],
        error: null,
      },
      salary_classifications: {
        data: [{ organization_member_id: 101, salary_grade_code: "M4", job_level: 4 }],
        error: null,
      },
      departments: {
        data: [{ id: 21, public_id: "dept-pmo", name: "项目管理部" }],
        error: null,
      },
    };
    const factory = (async () => ({
      from: (table: string) => createQuery(responses[table]),
      rpc: () => createQuery(responses.salary_classifications),
    })) as never;

    const detail = await loadSalaryDetail("salary-detail-id", factory, { allowMockFallback: false });

    expect(detail?.employee.displayName).toBe("李记伟");
    expect(detail?.department.name).toBe("项目管理部");
    expect(detail?.netSalary).toBe(12780);
  });

  it("restricts real payroll rows to the viewer when the session cannot manage salary", async () => {
    const responses: Record<string, QueryResponse> = {
      salary: {
        data: [
          {
            public_id: "salary-viewer",
            organization_id: 1,
            employee_profile_id: 11,
            payroll_month: "2026-08-01",
            base_salary: 12000,
            bonus: 1500,
            deductions: 900,
            net_salary: 12600,
            status: "paid",
            paid_at: null,
          },
          {
            public_id: "salary-other",
            organization_id: 1,
            employee_profile_id: 12,
            payroll_month: "2026-08-01",
            base_salary: 18000,
            bonus: 2400,
            deductions: 1200,
            net_salary: 19200,
            status: "paid",
            paid_at: null,
          },
        ],
        error: null,
      },
      employee_profiles: {
        data: [
          {
            id: 11,
            public_id: "viewer-profile",
            organization_member_id: 101,
            employee_no: "QXY-2001",
            display_name: "当前员工",
            avatar_url: null,
            job_title: "执行工程师",
            department_id: 21,
          },
          {
            id: 12,
            public_id: "other-profile",
            organization_member_id: 102,
            employee_no: "QXY-2002",
            display_name: "其他员工",
            avatar_url: null,
            job_title: "产品经理",
            department_id: 22,
          },
        ],
        error: null,
      },
      salary_classifications: {
        data: [{ organization_member_id: 101, salary_grade_code: "P3", job_level: 3 }],
        error: null,
      },
      departments: {
        data: [{ id: 21, public_id: "dept-engineering", name: "工程技术部" }],
        error: null,
      },
    };
    const factory = (async () => ({
      from: (table: string) => createQuery(responses[table]),
      rpc: () => createQuery(responses.salary_classifications),
    })) as never;

    const result = await loadSalary(factory, {
      allowMockFallback: false,
      viewerEmployeeProfileId: "viewer-profile",
      canManageSalary: false,
    });

    expect(result.data.records.map((record) => record.id)).toEqual(["salary-viewer"]);
    expect(result.data.departments).toEqual([{ id: "dept-engineering", name: "工程技术部" }]);
    expect(result.data.stats).toEqual({
      totalSalary: 12600,
      employeeCount: 1,
      averageSalary: 12600,
    });
  });
});

describe("salary data classification privacy", () => {
  it("loads an employee classification from the self-only RPC instead of the directory table", async () => {
    const query = (result: { data: unknown[]; error: unknown }) => ({
      select: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      then: <TResult1 = typeof result, TResult2 = never>(
        onfulfilled?: ((value: typeof result) => TResult1 | PromiseLike<TResult1>) | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) => Promise.resolve(result).then(onfulfilled, onrejected),
    });
    const salary = query({
      data: [{
        public_id: "salary-1",
        organization_id: 3,
        employee_profile_id: 42,
        payroll_month: "2026-08-01",
        base_salary: 42000,
        bonus: 0,
        deductions: 0,
        net_salary: 42000,
        status: "paid",
        paid_at: null,
      }],
      error: null,
    });
    const profiles = query({
      data: [{
        id: 42,
        public_id: "profile-42",
        organization_member_id: 7,
        employee_no: "A-007",
        display_name: "当前员工",
        avatar_url: null,
        job_title: "产品经理",
        department_id: 21,
      }],
      error: null,
    });
    const departments = query({
      data: [{ id: 21, public_id: "department-21", name: "产品中心" }],
      error: null,
    });
    const classification = query({
      data: [{ organization_member_id: 7, salary_grade_code: "P6", job_level: 6 }],
      error: null,
    });
    const client = {
      from: vi.fn((table: string) => {
        if (table === "salary") return salary;
        if (table === "employee_profiles") return profiles;
        if (table === "departments") return departments;
        throw new Error(`unexpected table ${table}`);
      }),
      rpc: vi.fn((name: string) => {
        if (name === "current_employee_salary_classification") return classification;
        throw new Error(`unexpected rpc ${name}`);
      }),
    };

    const result = await loadSalary(
      async () => client as never,
      { allowMockFallback: false, viewerEmployeeProfileId: "profile-42" },
    );

    expect(client.rpc).toHaveBeenCalledWith("current_employee_salary_classification");
    expect(profiles.select).toHaveBeenCalledWith(
      expect.not.stringContaining("salary_grade_code"),
    );
    expect(profiles.select).toHaveBeenCalledWith(
      expect.not.stringContaining("job_level"),
    );
    expect(result.data.records[0]?.employee).toMatchObject({
      displayName: "当前员工",
      salaryGradeCode: "P6",
      jobLevel: 6,
    });
  });
});
