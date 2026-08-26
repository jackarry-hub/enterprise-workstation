export type OrganizationCommandType =
  | "create_department"
  | "update_department"
  | "upsert_position"
  | "assign_member_role";

type CommandBase = {
  type: OrganizationCommandType;
  idempotencyKey: string;
};

export type CreateDepartmentCommand = CommandBase & {
  type: "create_department";
  code: string;
  name: string;
  description: string;
  sortOrder: number;
};

export type UpdateDepartmentCommand = CommandBase & {
  type: "update_department";
  departmentId: string;
  name: string;
  description: string;
  sortOrder: number;
  version: number;
};

export type UpsertPositionCommand = CommandBase & {
  type: "upsert_position";
  positionId: string | null;
  code: string;
  name: string;
  category: string;
  description: string;
  departmentId: string | null;
  version: number;
};

export type AssignMemberRoleCommand = CommandBase & {
  type: "assign_member_role";
  memberId: number;
  roleCode: "admin" | "department_head" | "employee" | "finance" | "hr";
  version: number;
};

export type OrganizationCommand =
  | CreateDepartmentCommand
  | UpdateDepartmentCommand
  | UpsertPositionCommand
  | AssignMemberRoleCommand;
