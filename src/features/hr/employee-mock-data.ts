import {
  CUSTOMER_DEMO_ORGANIZATION_ID,
  customerDemoPeople,
} from "@/features/demo/customer-demo-data";
import type {
  Department,
  EmployeeDirectoryItem,
  EmployeeDirectoryResult,
  EmployeeProfile,
} from "@/features/hr/employee-types";

const departmentIdByCode = new Map<string, string>();

export const mockDepartments: Department[] = Array.from(
  new Map(customerDemoPeople.map((person) => [person.departmentCode, person])).values(),
).map((person, index) => {
  const id = `62000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`;
  departmentIdByCode.set(person.departmentCode, id);
  return {
    id,
    organizationId: CUSTOMER_DEMO_ORGANIZATION_ID,
    code: person.departmentCode,
    name: person.department,
    status: "active",
    sortOrder: (index + 1) * 10,
  };
});

const personById = new Map(customerDemoPeople.map((person) => [person.id, person]));

const profiles: EmployeeProfile[] = customerDemoPeople.map((person) => ({
  id: person.employeeProfileId,
  organizationId: CUSTOMER_DEMO_ORGANIZATION_ID,
  employeeNo: person.employeeNo,
  displayName: person.name,
  workEmail: person.email,
  phone: person.phone,
  departmentId: departmentIdByCode.get(person.departmentCode),
  jobTitle: person.jobTitle,
  managerEmployeeId: person.managerId
    ? personById.get(person.managerId)?.employeeProfileId
    : undefined,
  employmentType: "full_time",
  employmentStatus: "active",
  hireDate: person.hireDate,
  account: {
    organizationMemberId: String(person.organizationMemberId),
    status: "active",
    roles: [{ code: person.roleCode, name: person.roleLabel }],
  },
}));

const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
const departmentById = new Map(mockDepartments.map((department) => [department.id, department]));

export const mockEmployees: EmployeeDirectoryItem[] = profiles.map((profile) => {
  const manager = profile.managerEmployeeId
    ? profileById.get(profile.managerEmployeeId)
    : undefined;

  return {
    profile,
    department: profile.departmentId ? departmentById.get(profile.departmentId) : undefined,
    manager: manager
      ? { id: manager.id, displayName: manager.displayName, jobTitle: manager.jobTitle }
      : undefined,
  };
});

export const employeeDirectoryMockResult: EmployeeDirectoryResult = {
  source: "mock",
  data: {
    employees: mockEmployees,
    departments: mockDepartments,
    stats: {
      total: mockEmployees.length,
      active: mockEmployees.length,
      probation: 0,
      departments: mockDepartments.length,
    },
  },
};
