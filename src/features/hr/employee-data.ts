import { employeeDirectoryMockResult } from "@/features/hr/employee-mock-data";
import type {
  AccountStatus,
  Department,
  EmployeeAccount,
  EmployeeDirectoryItem,
  EmployeeDirectoryResult,
  EmployeeProfile,
  EmployeeRole,
  EmploymentStatus,
  EmploymentType,
} from "@/features/hr/employee-types";
export { filterEmployees, getEmployeeDetail } from "@/features/hr/employee-selectors";
import { shouldAllowMockBusinessData } from "@/lib/runtime/workstation-mode";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof getSupabaseServerClient>>;
export type EmployeeDirectoryClientFactory = () => Promise<SupabaseServerClient>;

type DepartmentRow = {
  id: number;
  public_id: string;
  organization_id: number;
  parent_department_id: number | null;
  code: string;
  name: string;
  status: Department["status"];
  sort_order: number;
};

type EmployeeProfileRow = {
  id: number;
  public_id: string;
  organization_id: number;
  organization_member_id: number | null;
  employee_no: string;
  display_name: string;
  avatar_url: string | null;
  work_email: string | null;
  phone: string | null;
  department_id: number | null;
  job_title: string;
  manager_employee_id: number | null;
  employment_type: EmploymentType;
  employment_status: EmploymentStatus;
  hire_date: string | null;
  departure_date: string | null;
};

type MemberRow = { id: number; status: AccountStatus };
type RoleAssignmentRow = {
  member_id: number;
  roles: EmployeeRole | EmployeeRole[] | null;
};

function getStats(employees: EmployeeDirectoryItem[], departments: Department[]) {
  return {
    total: employees.length,
    active: employees.filter(({ profile }) => profile.employmentStatus === "active").length,
    probation: employees.filter(({ profile }) => profile.employmentStatus === "probation").length,
    departments: departments.filter(({ status }) => status === "active").length,
  };
}

function emptySupabaseResult(loadError?: string): EmployeeDirectoryResult {
  return {
    source: "supabase",
    data: {
      employees: [],
      departments: [],
      stats: { total: 0, active: 0, probation: 0, departments: 0 },
      loadError,
    },
  };
}

export async function loadEmployeeDirectory(
  clientFactory: EmployeeDirectoryClientFactory = getSupabaseServerClient,
  options: { allowMockFallback?: boolean } = {},
): Promise<EmployeeDirectoryResult> {
  const allowMockFallback = options.allowMockFallback ?? shouldAllowMockBusinessData();

  if (allowMockFallback) {
    return employeeDirectoryMockResult;
  }

  try {
    const client = await clientFactory();
    const [departmentResponse, profileResponse] = await Promise.all([
      client
        .from("departments")
        .select("id, public_id, organization_id, parent_department_id, code, name, status, sort_order")
        .is("deleted_at", null)
        .order("sort_order"),
      client
        .from("employee_profiles")
        .select("id, public_id, organization_id, organization_member_id, employee_no, display_name, avatar_url, work_email, phone, department_id, job_title, manager_employee_id, employment_type, employment_status, hire_date, departure_date")
        .is("deleted_at", null)
        .order("employee_no"),
    ]);

    if (departmentResponse.error || profileResponse.error) {
      throw departmentResponse.error ?? profileResponse.error;
    }

    const departmentRows = (departmentResponse.data ?? []) as DepartmentRow[];
    const profileRows = (profileResponse.data ?? []) as EmployeeProfileRow[];
    const departmentPublicIdByRowId = new Map(
      departmentRows.map((row) => [row.id, row.public_id]),
    );
    const profilePublicIdByRowId = new Map(
      profileRows.map((row) => [row.id, row.public_id]),
    );
    const departments: Department[] = departmentRows.map((row) => ({
      id: row.public_id,
      organizationId: String(row.organization_id),
      parentDepartmentId: row.parent_department_id == null
        ? undefined
        : departmentPublicIdByRowId.get(row.parent_department_id),
      code: row.code,
      name: row.name,
      status: row.status,
      sortOrder: row.sort_order,
    }));

    const memberIds = profileRows
      .flatMap((row) => row.organization_member_id == null ? [] : [row.organization_member_id]);
    let memberRows: MemberRow[] = [];
    let roleRows: RoleAssignmentRow[] = [];

    if (memberIds.length > 0) {
      const [memberResponse, roleResponse] = await Promise.all([
        client
          .from("organization_members")
          .select("id, status")
          .in("id", memberIds),
        client
          .from("member_roles")
          .select("member_id, roles(code, name)")
          .in("member_id", memberIds),
      ]);

      if (memberResponse.error || roleResponse.error) {
        throw memberResponse.error ?? roleResponse.error;
      }

      memberRows = (memberResponse.data ?? []) as MemberRow[];
      roleRows = (roleResponse.data ?? []) as unknown as RoleAssignmentRow[];
    }

    const memberById = new Map(memberRows.map((member) => [member.id, member]));
    const rolesByMemberId = new Map<number, EmployeeRole[]>();
    roleRows.forEach((row) => {
      const roles = row.roles == null
        ? []
        : Array.isArray(row.roles) ? row.roles : [row.roles];
      rolesByMemberId.set(row.member_id, [
        ...(rolesByMemberId.get(row.member_id) ?? []),
        ...roles,
      ]);
    });

    const profiles: EmployeeProfile[] = profileRows.map((row) => {
      const member = row.organization_member_id == null
        ? undefined
        : memberById.get(row.organization_member_id);
      const account: EmployeeAccount | undefined = member && row.organization_member_id != null
        ? {
          organizationMemberId: String(row.organization_member_id),
          status: member.status,
          roles: rolesByMemberId.get(row.organization_member_id) ?? [],
        }
        : undefined;

      return {
        id: row.public_id,
        organizationId: String(row.organization_id),
        employeeNo: row.employee_no,
        displayName: row.display_name,
        avatarUrl: row.avatar_url ?? undefined,
        workEmail: row.work_email ?? undefined,
        phone: row.phone ?? undefined,
        departmentId: row.department_id == null
          ? undefined
          : departmentPublicIdByRowId.get(row.department_id),
        jobTitle: row.job_title,
        managerEmployeeId: row.manager_employee_id == null
          ? undefined
          : profilePublicIdByRowId.get(row.manager_employee_id),
        employmentType: row.employment_type,
        employmentStatus: row.employment_status,
        hireDate: row.hire_date ?? undefined,
        departureDate: row.departure_date ?? undefined,
        account,
      };
    });
    const departmentById = new Map(departments.map((department) => [department.id, department]));
    const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
    const employees: EmployeeDirectoryItem[] = profiles.map((profile) => {
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

    return {
      source: "supabase",
      data: {
        employees,
        departments,
        stats: getStats(employees, departments),
      },
    };
  } catch {
    return emptySupabaseResult("员工目录加载失败，请稍后重试。");
  }
}
