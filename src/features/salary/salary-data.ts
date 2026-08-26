import { salaryMockResult } from "@/features/salary/salary-mock-data";
import type { SalaryRecord, SalaryResult, SalaryStatus } from "@/features/salary/salary-types";
import { shouldAllowMockBusinessData } from "@/lib/runtime/workstation-mode";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof getSupabaseServerClient>>;
export type SalaryClientFactory = () => Promise<SupabaseServerClient>;

type SalaryRow = {
  public_id: string;
  organization_id: number;
  employee_profile_id: number;
  payroll_month: string;
  base_salary: number | string;
  bonus: number | string;
  performance_bonus?: number | string | null;
  project_bonus?: number | string | null;
  other_bonus?: number | string | null;
  social_security?: number | string | null;
  individual_income_tax?: number | string | null;
  other_deduction?: number | string | null;
  deductions: number | string;
  net_salary: number | string;
  status: SalaryStatus;
  paid_at: string | null;
};

type EmployeeProfileRow = {
  id: number;
  public_id: string;
  organization_member_id: number | null;
  employee_no: string;
  display_name: string;
  avatar_url: string | null;
  job_title: string;
  department_id: number | null;
  salary_grade_code?: string | null;
  job_level?: number | null;
};

type SalaryClassificationRow = {
  organization_member_id: number;
  salary_grade_code: string;
  job_level: number;
};

type DepartmentRow = {
  id: number;
  public_id?: string | null;
  name: string;
};

type LoadSalaryOptions = {
  allowMockFallback?: boolean;
  viewerEmployeeProfileId?: string;
  canManageSalary?: boolean;
};

function emptySupabaseResult(loadError?: string): SalaryResult {
  return {
    source: "supabase",
    data: {
      records: [],
      departments: [],
      stats: { totalSalary: 0, employeeCount: 0, averageSalary: 0 },
      loadError,
    },
  };
}

function numeric(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function month(value: string) {
  return value.slice(0, 7);
}

function formatTimestamp(value: string | null) {
  if (!value) return undefined;
  return value.replace("T", " ").slice(0, 16);
}

function sortByPayrollMonthDesc(a: Pick<SalaryRow, "payroll_month">, b: Pick<SalaryRow, "payroll_month">) {
  return b.payroll_month.localeCompare(a.payroll_month);
}

function buildHistory(
  employeeProfileId: number,
  rows: readonly SalaryRow[],
): SalaryRecord["history"] {
  return rows
    .filter((row) => row.employee_profile_id === employeeProfileId)
    .slice()
    .sort(sortByPayrollMonthDesc)
    .map((row) => ({
      month: month(row.payroll_month),
      netSalary: numeric(row.net_salary),
      status: row.status,
    }));
}

function buildBreakdown(row: SalaryRow): SalaryRecord["breakdown"] {
  const performanceBonus = numeric(row.performance_bonus);
  const projectBonus = numeric(row.project_bonus);
  const otherBonus = numeric(row.other_bonus);
  const socialSecurity = numeric(row.social_security);
  const individualIncomeTax = numeric(row.individual_income_tax);
  const otherDeduction = numeric(row.other_deduction);
  const hasDetailedBonus = performanceBonus > 0 || projectBonus > 0 || otherBonus > 0;
  const hasDetailedDeduction = socialSecurity > 0 || individualIncomeTax > 0 || otherDeduction > 0;

  return [
    { label: "部门职级基础工资", amount: numeric(row.base_salary), kind: "income" as const },
    ...(hasDetailedBonus
      ? [
        { label: "绩效奖金", amount: performanceBonus, kind: "income" as const },
        { label: "项目奖金池分配", amount: projectBonus, kind: "income" as const },
        { label: "其他补贴", amount: otherBonus, kind: "income" as const },
      ]
      : [{ label: "奖金", amount: numeric(row.bonus), kind: "income" as const }]),
    ...(hasDetailedDeduction
      ? [
        { label: "社保与公积金", amount: socialSecurity, kind: "deduction" as const },
        { label: "个人所得税", amount: individualIncomeTax, kind: "deduction" as const },
        { label: "其他扣款", amount: otherDeduction, kind: "deduction" as const },
      ]
      : [{ label: "扣款", amount: numeric(row.deductions), kind: "deduction" as const }]),
  ];
}

function mapSalaryRecord(
  row: SalaryRow,
  profiles: ReadonlyMap<number, EmployeeProfileRow>,
  departments: ReadonlyMap<number, DepartmentRow>,
  allSalaryRows: readonly SalaryRow[],
): SalaryRecord {
  const profile = profiles.get(row.employee_profile_id);
  const department = profile?.department_id == null
    ? undefined
    : departments.get(profile.department_id);
  return {
    id: row.public_id,
    employee: {
      id: profile?.public_id ?? `employee-${row.employee_profile_id}`,
      employeeNo: profile?.employee_no ?? `EMP-${row.employee_profile_id}`,
      displayName: profile?.display_name ?? "未知员工",
      jobTitle: profile?.job_title ?? "未配置岗位",
      salaryGradeCode: profile?.salary_grade_code ?? undefined,
      jobLevel: profile?.job_level ?? undefined,
      avatarUrl: profile?.avatar_url ?? undefined,
    },
    department: {
      id: department?.public_id ?? String(profile?.department_id ?? "unassigned"),
      name: department?.name ?? "待分配",
    },
    month: month(row.payroll_month),
    baseSalary: numeric(row.base_salary),
    bonus: numeric(row.bonus),
    deductions: numeric(row.deductions),
    netSalary: numeric(row.net_salary),
    status: row.status,
    paidAt: formatTimestamp(row.paid_at),
    breakdown: buildBreakdown(row),
    history: buildHistory(row.employee_profile_id, allSalaryRows),
  };
}

function computeStats(records: readonly SalaryRecord[]): SalaryResult["data"]["stats"] {
  const latestMonth = records[0]?.month;
  const currentMonthRecords = latestMonth
    ? records.filter((record) => record.month === latestMonth)
    : records;
  const totalSalary = currentMonthRecords.reduce((sum, record) => sum + record.netSalary, 0);
  const employeeCount = new Set(currentMonthRecords.map((record) => record.employee.id)).size;
  return {
    totalSalary,
    employeeCount,
    averageSalary: employeeCount ? Math.round(totalSalary / employeeCount) : 0,
  };
}

export async function loadSalary(
  clientFactory: SalaryClientFactory = getSupabaseServerClient,
  options: LoadSalaryOptions = {},
): Promise<SalaryResult> {
  const allowMockFallback = options.allowMockFallback ?? shouldAllowMockBusinessData();

  if (allowMockFallback) {
    return salaryMockResult;
  }

  try {
    const client = await clientFactory();
    const salaryResponse = await client
      .from("salary")
      .select("public_id, organization_id, employee_profile_id, payroll_month, base_salary, bonus, performance_bonus, project_bonus, other_bonus, social_security, individual_income_tax, other_deduction, deductions, net_salary, status, paid_at")
      .is("deleted_at", null)
      .order("payroll_month", { ascending: false });

    if (salaryResponse.error) throw salaryResponse.error;

    const salaryRows = ((salaryResponse.data ?? []) as SalaryRow[])
      .slice()
      .sort(sortByPayrollMonthDesc);
    if (salaryRows.length === 0) return emptySupabaseResult();

    const employeeProfileIds = [...new Set(salaryRows.map((row) => row.employee_profile_id))];
    const profileResponse = await client
      .from("employee_profiles")
      .select("id, public_id, organization_member_id, employee_no, display_name, avatar_url, job_title, department_id")
      .in("id", employeeProfileIds)
      .is("deleted_at", null);

    if (profileResponse.error) throw profileResponse.error;

    const classificationResponse = await client.rpc(
      options.canManageSalary === true
        ? "managed_employee_salary_classifications"
        : "current_employee_salary_classification",
    );
    if (classificationResponse.error) throw classificationResponse.error;
    const classificationsByMember = new Map(
      ((classificationResponse.data ?? []) as SalaryClassificationRow[]).map((classification) => [
        classification.organization_member_id,
        classification,
      ]),
    );
    const allProfileRows = ((profileResponse.data ?? []) as EmployeeProfileRow[]).map((profile) => {
      const classification = profile.organization_member_id === null
        ? null
        : classificationsByMember.get(profile.organization_member_id) ?? null;
      return classification
        ? {
          ...profile,
          salary_grade_code: classification.salary_grade_code,
          job_level: classification.job_level,
        }
        : profile;
    });
    const visibleProfileIds = new Set(
      allProfileRows
        .filter((profile) =>
          options.canManageSalary === true
          || !options.viewerEmployeeProfileId
          || profile.public_id === options.viewerEmployeeProfileId)
        .map((profile) => profile.id),
    );
    const visibleSalaryRows = salaryRows.filter((row) => visibleProfileIds.has(row.employee_profile_id));
    if (visibleSalaryRows.length === 0) return emptySupabaseResult();

    const profileRows = allProfileRows.filter((profile) => visibleProfileIds.has(profile.id));
    const departmentIds = [...new Set(profileRows.flatMap((profile) =>
      profile.department_id == null ? [] : [profile.department_id],
    ))];
    const departmentResponse = departmentIds.length
      ? await client
        .from("departments")
        .select("id, public_id, name")
        .in("id", departmentIds)
        .is("deleted_at", null)
      : { data: [], error: null };

    if (departmentResponse.error) throw departmentResponse.error;

    const profileById = new Map(profileRows.map((profile) => [profile.id, profile]));
    const departmentRows = (departmentResponse.data ?? []) as DepartmentRow[];
    const departmentById = new Map(departmentRows.map((department) => [department.id, department]));
    const records = visibleSalaryRows.map((row) =>
      mapSalaryRecord(row, profileById, departmentById, visibleSalaryRows),
    );
    const departments = departmentRows.map((department) => ({
      id: department.public_id ?? String(department.id),
      name: department.name,
    }));

    return {
      source: "supabase",
      data: {
        records,
        departments,
        stats: computeStats(records),
      },
    };
  } catch {
    return emptySupabaseResult("薪资数据加载失败，请检查 Supabase 权限、字段迁移和当前账号可见范围。");
  }
}

export async function loadSalaryDetail(
  publicId: string,
  clientFactory: SalaryClientFactory = getSupabaseServerClient,
  options: LoadSalaryOptions = {},
) {
  const result = await loadSalary(clientFactory, options);
  return result.data.records.find((record) => record.id === publicId);
}
