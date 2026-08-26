import { employeeDirectoryMockResult } from "@/features/hr/employee-mock-data";
import type {
  Department,
  EmployeeDirectoryItem,
  EmployeeDirectoryResult,
  EmployeePrivateProfile,
  EmployeePrivateProfileResult,
  EmployeeProfile,
  EmploymentStatus,
  EmploymentType,
} from "@/features/hr/employee-types";
export { filterEmployees, getEmployeeDetail } from "@/features/hr/employee-selectors";
import { shouldAllowMockBusinessData } from "@/lib/runtime/workstation-mode";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof getSupabaseServerClient>>;
export type EmployeeDirectoryClientFactory = () => Promise<SupabaseServerClient>;

type RpcResponse = { data: unknown; error: unknown };
type RpcClient = {
  rpc: (name: string, parameters?: Record<string, unknown>) => Promise<RpcResponse>;
};

type EmployeeDirectoryRpcRow = {
  employee_public_id: string;
  employee_no: string;
  display_name: string;
  avatar_url: string | null;
  department_public_id: string | null;
  department_code: string | null;
  department_name: string | null;
  department_status: Department["status"] | null;
  department_sort_order: number | null;
  job_title: string;
  manager_employee_public_id: string | null;
  manager_display_name: string | null;
  employment_type: EmploymentType;
  employment_status: EmploymentStatus;
};

type EmployeePrivateProfileRpcRow = {
  employee_public_id: string;
  private_email: string | null;
  phone: string | null;
  hire_date: string | null;
  departure_date: string | null;
  sensitive_hr_notes: string | null;
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

function toDirectoryRows(data: unknown): EmployeeDirectoryRpcRow[] {
  return Array.isArray(data) ? data as EmployeeDirectoryRpcRow[] : [];
}

function toPrivateProfile(data: unknown): EmployeePrivateProfile | undefined {
  const row = Array.isArray(data) ? data[0] as EmployeePrivateProfileRpcRow | undefined : undefined;
  if (!row?.employee_public_id) return undefined;

  return {
    employeePublicId: row.employee_public_id,
    privateEmail: row.private_email ?? undefined,
    phone: row.phone ?? undefined,
    hireDate: row.hire_date ?? undefined,
    departureDate: row.departure_date ?? undefined,
    sensitiveHrNotes: row.sensitive_hr_notes ?? undefined,
  };
}

function directoryFromRows(rows: EmployeeDirectoryRpcRow[]): EmployeeDirectoryResult {
  const departmentsById = new Map<string, Department>();
  rows.forEach((row) => {
    if (
      row.department_public_id
      && row.department_code
      && row.department_name
      && row.department_status
      && row.department_sort_order !== null
    ) {
      departmentsById.set(row.department_public_id, {
        id: row.department_public_id,
        code: row.department_code,
        name: row.department_name,
        status: row.department_status,
        sortOrder: row.department_sort_order,
      });
    }
  });
  const departments = [...departmentsById.values()]
    .sort((left, right) => left.sortOrder - right.sortOrder || left.code.localeCompare(right.code));
  const departmentById = new Map(departments.map((department) => [department.id, department]));

  const employees: EmployeeDirectoryItem[] = rows.map((row) => {
    const profile: EmployeeProfile = {
      id: row.employee_public_id,
      employeeNo: row.employee_no,
      displayName: row.display_name,
      avatarUrl: row.avatar_url ?? undefined,
      departmentId: row.department_public_id ?? undefined,
      jobTitle: row.job_title,
      managerEmployeeId: row.manager_employee_public_id ?? undefined,
      employmentType: row.employment_type,
      employmentStatus: row.employment_status,
    };

    return {
      profile,
      department: profile.departmentId ? departmentById.get(profile.departmentId) : undefined,
      manager: row.manager_employee_public_id && row.manager_display_name
        ? {
          id: row.manager_employee_public_id,
          displayName: row.manager_display_name,
        }
        : undefined,
    };
  });

  return {
    source: "supabase",
    data: { employees, departments, stats: getStats(employees, departments) },
  };
}

export async function loadEmployeeDirectory(
  organizationPublicId: string,
  clientFactory: EmployeeDirectoryClientFactory = getSupabaseServerClient,
  options: { allowMockFallback?: boolean } = {},
): Promise<EmployeeDirectoryResult> {
  const allowMockFallback = (options.allowMockFallback ?? shouldAllowMockBusinessData())
    && shouldAllowMockBusinessData();
  if (allowMockFallback) return employeeDirectoryMockResult;

  try {
    const client = await clientFactory() as unknown as RpcClient;
    const response = await client.rpc("current_employee_directory", {
      p_organization_public_id: organizationPublicId,
    });
    if (response.error) throw response.error;
    return directoryFromRows(toDirectoryRows(response.data));
  } catch {
    return emptySupabaseResult("员工目录加载失败，请稍后重试。");
  }
}

export async function loadEmployeePrivateProfile(
  employeePublicId: string,
  organizationPublicId: string,
  clientFactory: EmployeeDirectoryClientFactory = getSupabaseServerClient,
): Promise<EmployeePrivateProfileResult> {
  try {
    const client = await clientFactory() as unknown as RpcClient;
    const response = await client.rpc("current_employee_private_profile", {
      p_employee_public_id: employeePublicId,
      p_organization_public_id: organizationPublicId,
    });
    if (response.error) throw response.error;
    return { source: "supabase", data: toPrivateProfile(response.data) };
  } catch {
    return {
      source: "supabase",
      loadError: "员工私密档案加载失败，请稍后重试。",
    };
  }
}
