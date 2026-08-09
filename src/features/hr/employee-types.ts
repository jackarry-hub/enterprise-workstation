export type DepartmentStatus = "active" | "inactive";
export type EmploymentType = "full_time" | "part_time" | "contractor" | "intern";
export type EmploymentStatus = "probation" | "active" | "on_leave" | "departed";
export type AccountStatus = "invited" | "active" | "suspended";

export type EmployeeRole = {
  code: "owner" | "admin" | "department_head" | "employee" | "hr" | "finance" | string;
  name: string;
};

export type EmployeeAccount = {
  organizationMemberId: string;
  status: AccountStatus;
  roles: EmployeeRole[];
};

export type Department = {
  id: string;
  organizationId: string;
  parentDepartmentId?: string;
  code: string;
  name: string;
  status: DepartmentStatus;
  sortOrder: number;
};

export type EmployeeProfile = {
  id: string;
  organizationId: string;
  employeeNo: string;
  displayName: string;
  avatarUrl?: string;
  workEmail?: string;
  phone?: string;
  departmentId?: string;
  jobTitle: string;
  managerEmployeeId?: string;
  employmentType: EmploymentType;
  employmentStatus: EmploymentStatus;
  hireDate?: string;
  departureDate?: string;
  account?: EmployeeAccount;
};

export type EmployeeDirectoryItem = {
  profile: EmployeeProfile;
  department?: Department;
  manager?: Pick<EmployeeProfile, "id" | "displayName" | "jobTitle">;
};

export type EmployeeDirectoryStats = {
  total: number;
  active: number;
  probation: number;
  departments: number;
};

export type EmployeeDirectoryFilters = {
  query: string;
  departmentId: string | "all";
  status: EmploymentStatus | "all";
};

export type EmployeeDirectoryData = {
  employees: EmployeeDirectoryItem[];
  departments: Department[];
  stats: EmployeeDirectoryStats;
  loadError?: string;
};

export type EmployeeDirectoryResult = {
  source: "mock" | "supabase";
  data: EmployeeDirectoryData;
};
