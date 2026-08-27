import { afterEach, describe, expect, it, vi } from "vitest";

import {
  filterEmployees,
  getEmployeeDetail,
  loadEmployeeDirectory,
} from "@/features/hr/employee-data";
import * as employeeData from "@/features/hr/employee-data";
import { employeeDirectoryMockResult } from "@/features/hr/employee-mock-data";

const organizationPublicId = "62000000-0000-4000-8000-000000000001";

describe("employee directory data", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps the mock directory relationally complete", () => {
    const { departments, employees, stats } = employeeDirectoryMockResult.data;

    expect(employees.length).toBeGreaterThanOrEqual(8);
    expect(departments.length).toBeGreaterThanOrEqual(6);
    expect(stats.total).toBe(employees.length);
    expect(stats.active).toBe(
      employees.filter(({ profile }) => profile.employmentStatus === "active").length,
    );
    expect(
      employees.every(({ profile, department }) =>
        profile.departmentId ? department?.id === profile.departmentId : true,
      ),
    ).toBe(true);
    for (const employee of employees) {
      for (const field of [
        "phone", "privateEmail", "workEmail", "hireDate", "departureDate",
        "sensitiveHrNotes", "salaryGradeCode", "jobLevel",
      ]) {
        expect(employee.profile).not.toHaveProperty(field);
      }
    }
  });

  it.each(["林远", "QXY-1002", "人力资源总监"])(
    "finds employees with query %s",
    (query) => {
      const matches = filterEmployees(employeeDirectoryMockResult.data.employees, {
        query,
        departmentId: "all",
        status: "all",
      });

      expect(matches).toHaveLength(1);
    },
  );

  it("combines department and employment status filters", () => {
    const productDepartment = employeeDirectoryMockResult.data.departments.find(
      ({ code }) => code === "PRODUCT",
    );
    const matches = filterEmployees(employeeDirectoryMockResult.data.employees, {
      query: "",
      departmentId: productDepartment?.id ?? "missing",
      status: "probation",
    });

    expect(matches).toHaveLength(1);
    expect(matches[0].profile.displayName).toBe("周宁");
  });

  it("resolves detail by public id and returns nothing for an unknown employee", () => {
    const employee = employeeDirectoryMockResult.data.employees[0];

    expect(getEmployeeDetail(employee.profile.id)?.profile.employeeNo).toBe("QXY-1001");
    expect(getEmployeeDetail("missing-employee")).toBeUndefined();
  });

  it("uses the complete mock directory only when fallback is allowed", async () => {
    vi.stubEnv("WORKSTATION_ALLOW_MOCK_DATA", "true");
    const result = await loadEmployeeDirectory(
      organizationPublicId,
      async () => {
        throw new Error("Supabase configuration missing");
      },
      { allowMockFallback: true },
    );

    expect(result.source).toBe("mock");
    expect(result.data.employees.length).toBeGreaterThanOrEqual(8);
  });

  it("does not disguise a configured Supabase failure as mock data", async () => {
    const result = await loadEmployeeDirectory(
      organizationPublicId,
      async () => {
        throw new Error("permission denied");
      },
      { allowMockFallback: false },
    );

    expect(result.source).toBe("supabase");
    expect(result.data.employees).toEqual([]);
    expect(result.data.loadError).toBeTruthy();
  });

  it("does not use mock employees by default in production", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const result = await loadEmployeeDirectory(organizationPublicId, async () => {
      throw new Error("Supabase configuration missing");
    });

    expect(result.source).toBe("supabase");
    expect(result.data.employees).toEqual([]);
    expect(result.data.loadError).toBeTruthy();
  });

  it("does not allow an explicit production mock fallback", async () => {
    vi.stubEnv("NODE_ENV", "production");

    const result = await loadEmployeeDirectory(
      organizationPublicId,
      async () => {
        throw new Error("Supabase configuration missing");
      },
      { allowMockFallback: true },
    );

    expect(result.source).toBe("supabase");
    expect(result.data.employees).toEqual([]);
    expect(result.data.loadError).toBeTruthy();
  });

  it("loads the public directory only through its RPC and strips every private field", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        employee_public_id: "61000000-0000-4000-8000-000000000001",
        employee_no: "QXY-1001",
        display_name: "林远",
        avatar_url: "https://cdn.example.test/lin.png",
        department_public_id: "62000000-0000-4000-8000-000000000001",
        department_code: "GENERAL",
        department_name: "总经办",
        department_status: "active",
        department_sort_order: 10,
        job_title: "董事长兼 CEO",
        manager_employee_public_id: null,
        manager_display_name: null,
        employment_type: "full_time",
        employment_status: "active",
        phone: "13800001001",
        private_email: "lin.private@example.test",
        hire_date: "2021-03-08",
        departure_date: null,
        sensitive_hr_notes: "董事会保密备注",
        salary_grade_code: "P9",
        job_level: 20,
      }],
      error: null,
    });

    const result = await loadEmployeeDirectory(
      organizationPublicId,
      async () => ({ rpc } as never),
      { allowMockFallback: false },
    );

    expect(rpc).toHaveBeenCalledWith("current_employee_directory", {
      p_organization_public_id: organizationPublicId,
    });
    expect(result.source).toBe("supabase");
    expect(result.data.loadError).toBeUndefined();
    expect(result.data.employees[0]?.profile).toMatchObject({
      id: "61000000-0000-4000-8000-000000000001",
      displayName: "林远",
      jobTitle: "董事长兼 CEO",
    });
    for (const field of [
      "phone", "privateEmail", "workEmail", "hireDate", "departureDate",
      "sensitiveHrNotes", "salaryGradeCode", "jobLevel",
    ]) {
      expect(result.data.employees[0]?.profile).not.toHaveProperty(field);
    }
  });

  it("loads private employee details from the dedicated target-bound RPC", async () => {
    const privateLoader = (employeeData as unknown as Record<string, unknown>)
      .loadEmployeePrivateProfile;
    expect(privateLoader).toBeTypeOf("function");
    if (typeof privateLoader !== "function") return;

    const rpc = vi.fn().mockResolvedValue({
      data: [{
        employee_public_id: "61000000-0000-4000-8000-000000000001",
        private_email: "lin.private@example.test",
        phone: "13800001001",
        hire_date: "2021-03-08",
        departure_date: null,
        sensitive_hr_notes: "董事会保密备注",
      }],
      error: null,
    });
    const result = await privateLoader(
      "61000000-0000-4000-8000-000000000001",
      organizationPublicId,
      async () => ({ rpc } as never),
    ) as { source: string; data?: { phone?: string; privateEmail?: string; hireDate?: string } };

    expect(rpc).toHaveBeenCalledWith("current_employee_private_profile", {
      p_employee_public_id: "61000000-0000-4000-8000-000000000001",
      p_organization_public_id: organizationPublicId,
    });
    expect(result).toMatchObject({
      source: "supabase",
      data: {
        privateEmail: "lin.private@example.test",
        phone: "13800001001",
        hireDate: "2021-03-08",
      },
    });
  });
});
