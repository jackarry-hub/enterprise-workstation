export type DatabaseRoleCode =
  | "owner"
  | "admin"
  | "department_head"
  | "employee"
  | "finance"
  | "hr";

export type WorkspaceRole =
  | "executive"
  | "department_head"
  | "employee"
  | "finance"
  | "hr";

export type WorkspacePermissionCode =
  | "dashboard.read"
  | "organization.manage"
  | "department.manage"
  | "project.read"
  | "project.create"
  | "project.manage"
  | "project.comment"
  | "project.files"
  | "project.report"
  | "task.execute"
  | "task.manage"
  | "hr.manage"
  | "attendance.self"
  | "attendance.manage"
  | "salary.self"
  | "salary.manage"
  | "approval.self"
  | "approval.manage"
  | "files.manage";

export type WorkspaceActor = {
  id: string;
  memberId: string;
  name: string;
  role: WorkspaceRole;
  roleLabel: string;
  department: string;
  title: string;
  salaryGradeCode?: string;
  jobLevel?: number;
  landingPath: string;
};

export type WorkspaceIdentity = {
  providerCode: string;
  authProvider: string;
  providerSubject: string;
};

export type WorkspaceSession = {
  tenantId: string;
  authUserId: string;
  identity: WorkspaceIdentity;
  organization: { id: string; name: string };
  member: {
    id: number;
    employeeProfileId: string;
    status: "active";
  };
  profile: {
    displayName: string;
    avatarUrl: string | null;
    departmentName: string;
    jobTitle: string;
    salaryGradeCode?: string;
    jobLevel?: number;
    skills: string[];
  };
  roleCodes: DatabaseRoleCode[];
  permissionCodes: WorkspacePermissionCode[];
  primaryRole: WorkspaceRole;
  landingPath: string;
  isAdmin: boolean;
  actor: WorkspaceActor;
};
