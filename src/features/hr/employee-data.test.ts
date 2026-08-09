import { describe, expect, it } from "vitest";

import {
  filterEmployees,
  getEmployeeDetail,
  loadEmployeeDirectory,
} from "@/features/hr/employee-data";
import { employeeDirectoryMockResult } from "@/features/hr/employee-mock-data";

describe("employee directory data", () => {
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
  });

  it.each(["林远", "QXY-1002", "wang.fang@quantxy.cn"])(
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
    const result = await loadEmployeeDirectory(
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
      async () => {
        throw new Error("permission denied");
      },
      { allowMockFallback: false },
    );

    expect(result.source).toBe("supabase");
    expect(result.data.employees).toEqual([]);
    expect(result.data.loadError).toBeTruthy();
  });
});
