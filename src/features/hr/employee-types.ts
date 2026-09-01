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
  code: string;
  name: string;
  status: DepartmentStatus;
  sortOrder: number;
};

export type EmployeeProfile = {
  id: string;
  employeeNo: string;
  displayName: string;
  avatarUrl?: string;
  departmentId?: string;
  jobTitle: string;
  managerEmployeeId?: string;
  employmentType: EmploymentType;
  employmentStatus: EmploymentStatus;
  account?: EmployeeAccount;
};

export type EmployeePrivateProfile = {
  employeePublicId: string;
  privateEmail?: string;
  phone?: string;
  hireDate?: string;
  departureDate?: string;
  sensitiveHrNotes?: string;
};

export type EmployeeDirectoryItem = {
  profile: EmployeeProfile;
  department?: Department;
  manager?: Pick<EmployeeProfile, "id" | "displayName">;
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

export type EmployeePrivateProfileResult = {
  source: "supabase";
  data?: EmployeePrivateProfile;
  loadError?: string;
};

export type EmployeeCapabilitySkill = {
  id: string;
  code: string;
  name: string;
  level?: number;
  yearsExperience?: number;
  source: "self" | "manager" | "import" | "system";
  verificationStatus: "unverified" | "verified";
  updatedAt: string;
};

export type EmployeeWorkProfile = {
  summary: string;
  preferredTaskTypes: string[];
  growthGoals: string[];
  weeklyCapacityHours: number;
  selfSkills: Array<{ name: string; level: number }>;
  updatedAt: string;
};

export type EmployeeWorkAssignment = {
  id: string;
  title: string;
  projectId: string;
  projectName: string;
  status: string;
  priority: string;
  progress: number;
  dueDate?: string;
  updatedAt: string;
};

export type EmployeeCapabilityEvidence = {
  id: string;
  eventType: string;
  taskId: string;
  taskTitle: string;
  projectId: string;
  projectName: string;
  decision?: "pass" | "reject";
  note?: string;
  occurredAt: string;
};

export type EmployeeAgentRun = {
  id: string;
  agentId: string;
  agentName: string;
  status: string;
  inputSummary: string;
  outputSummary: string;
  modelCode: string;
  cost: number;
  latencyMs?: number;
  startedAt: string;
  completedAt?: string;
};

export type EmployeeCapabilityCenter = {
  canViewWork: boolean;
  canViewAgent: boolean;
  workProfile?: EmployeeWorkProfile;
  skills: EmployeeCapabilitySkill[];
  workload?: {
    openTasks: number;
    inProgressTasks: number;
    awaitingReviewTasks: number;
    completedTasks: number;
  };
  assignments: EmployeeWorkAssignment[];
  evidence: EmployeeCapabilityEvidence[];
  agentRuns: EmployeeAgentRun[];
};

export type EmployeeCapabilityCenterResult = {
  source: "supabase";
  data?: EmployeeCapabilityCenter;
  loadError?: string;
};
