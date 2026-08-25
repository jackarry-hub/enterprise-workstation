import { approvalMockResult } from "@/features/approvals/approval-mock-data";
import type {
  Approval,
  ApprovalAction,
  ApprovalPerson,
  ApprovalPriority,
  ApprovalResult,
  ApprovalStep,
  ApprovalStatus,
  ApprovalType,
} from "@/features/approvals/approval-types";
import { shouldAllowMockBusinessData } from "@/lib/runtime/workstation-mode";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof getSupabaseServerClient>>;
export type ApprovalClientFactory = () => Promise<SupabaseServerClient>;

type ApprovalRow = {
  id: number;
  public_id: string;
  organization_id: number;
  applicant_employee_id: number;
  owner_employee_id: number | null;
  approval_code: string;
  approval_type: ApprovalType;
  title: string;
  summary: string | null;
  form_data: Record<string, unknown>;
  current_step: string | null;
  status: ApprovalStatus;
  submitted_at: string | null;
  completed_at: string | null;
};

type ApprovalStepRow = {
  public_id: string;
  approval_id: number;
  step_order: number;
  name: string;
  approver_employee_id: number | null;
  status: ApprovalStep["status"];
  acted_at: string | null;
  comment: string | null;
};

type ApprovalActionRow = {
  public_id: string;
  approval_id: number;
  actor_employee_id: number;
  action_type: ApprovalAction["actionType"];
  content: string | null;
  created_at: string;
};

type EmployeeRow = {
  id: number;
  public_id: string;
  display_name: string;
  job_title: string | null;
  avatar_url: string | null;
  department_id: number | null;
};

type DepartmentRow = {
  id: number;
  name: string;
};

type LoadApprovalsOptions = {
  allowMockFallback?: boolean;
  viewerEmployeeProfileId?: string;
};

function emptySupabaseResult(loadError?: string): ApprovalResult {
  return {
    source: "supabase",
    data: {
      approvals: [],
      stats: { pending: 0, initiated: 0, approved: 0, rejected: 0 },
      loadError,
    },
  };
}

function formatTimestamp(value: string | null) {
  if (!value) return "";
  return value.replace("T", " ").slice(0, 16);
}

function formatCurrency(value: unknown, currency = "CNY") {
  const amount = Number(value ?? 0);
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safeAmount);
}

function stringField(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function person(
  employeeId: number | null,
  employees: ReadonlyMap<number, EmployeeRow>,
  departments: ReadonlyMap<number, DepartmentRow>,
): ApprovalPerson {
  const employee = employeeId == null ? undefined : employees.get(employeeId);
  const department = employee?.department_id == null
    ? undefined
    : departments.get(employee.department_id);
  return {
    id: employee?.public_id ?? `employee-${employeeId ?? "unassigned"}`,
    displayName: employee?.display_name ?? "待指定",
    department: department?.name ?? "待分配",
    jobTitle: employee?.job_title ?? undefined,
    avatarUrl: employee?.avatar_url ?? undefined,
  };
}

function approvalPriority(row: ApprovalRow) {
  const amount = Number(row.form_data?.amount ?? 0);
  if (row.approval_type === "contract" || amount >= 5000) return "high" satisfies ApprovalPriority;
  if (row.approval_type === "reimbursement" && amount >= 1000) return "high" satisfies ApprovalPriority;
  if (row.status === "pending") return "medium" satisfies ApprovalPriority;
  return "low" satisfies ApprovalPriority;
}

function genericFields(formData: Record<string, unknown>) {
  return Object.entries(formData)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
    .slice(0, 8)
    .map(([label, value]) => ({ label, value: String(value) }));
}

function approvalFields(row: ApprovalRow) {
  const formData = row.form_data ?? {};
  if (row.approval_type !== "reimbursement") return genericFields(formData);

  const currency = stringField(formData.currency) || "CNY";
  return [
    { label: "报账类型", value: stringField(formData.reimbursementCategory) || stringField(formData.expenseType) || "未分类" },
    { label: "报账金额", value: formatCurrency(formData.amount, currency) },
    { label: "费用日期", value: stringField(formData.expenseDate) || "未填写" },
    { label: "费用说明", value: stringField(formData.description) || "未填写" },
  ];
}

function buildApproval(
  row: ApprovalRow,
  employees: ReadonlyMap<number, EmployeeRow>,
  departments: ReadonlyMap<number, DepartmentRow>,
  stepsByApprovalId: ReadonlyMap<number, ApprovalStepRow[]>,
  actionsByApprovalId: ReadonlyMap<number, ApprovalActionRow[]>,
  viewerEmployeeProfileId?: string,
): Approval {
  const applicant = person(row.applicant_employee_id, employees, departments);
  const owner = person(row.owner_employee_id ?? row.applicant_employee_id, employees, departments);
  return {
    id: row.public_id,
    code: row.approval_code,
    type: row.approval_type,
    title: row.title,
    summary: row.summary ?? "",
    applicant,
    owner,
    submittedAt: formatTimestamp(row.submitted_at),
    status: row.status,
    currentStep: row.current_step ?? (row.status === "approved" ? "流程完成" : "待处理"),
    priority: approvalPriority(row),
    initiatedByViewer: viewerEmployeeProfileId === applicant.id,
    fields: approvalFields(row),
    steps: (stepsByApprovalId.get(row.id) ?? [])
      .slice()
      .sort((left, right) => left.step_order - right.step_order)
      .map((step) => ({
        id: step.public_id,
        name: step.name,
        approver: step.approver_employee_id == null
          ? undefined
          : person(step.approver_employee_id, employees, departments),
        status: step.status,
        actedAt: formatTimestamp(step.acted_at) || undefined,
        comment: step.comment ?? undefined,
      })),
    actions: (actionsByApprovalId.get(row.id) ?? [])
      .slice()
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .map((action) => ({
        id: action.public_id,
        actor: person(action.actor_employee_id, employees, departments),
        actionType: action.action_type,
        content: action.content ?? "",
        createdAt: formatTimestamp(action.created_at),
      })),
  };
}

function groupByApprovalId<T extends { approval_id: number }>(rows: readonly T[]) {
  const groups = new Map<number, T[]>();
  rows.forEach((row) => {
    groups.set(row.approval_id, [...(groups.get(row.approval_id) ?? []), row]);
  });
  return groups;
}

function computeStats(approvals: readonly Approval[]): ApprovalResult["data"]["stats"] {
  return {
    pending: approvals.filter((approval) => approval.status === "pending").length,
    initiated: approvals.filter((approval) => approval.initiatedByViewer).length,
    approved: approvals.filter((approval) => approval.status === "approved").length,
    rejected: approvals.filter((approval) => approval.status === "rejected").length,
  };
}

export async function loadApprovals(
  clientFactory: ApprovalClientFactory = getSupabaseServerClient,
  options: LoadApprovalsOptions = {},
): Promise<ApprovalResult> {
  const allowMockFallback = options.allowMockFallback ?? shouldAllowMockBusinessData();

  if (allowMockFallback) {
    return approvalMockResult;
  }

  try {
    const client = await clientFactory();
    const approvalResponse = await client
      .from("approvals")
      .select("id, public_id, organization_id, applicant_employee_id, owner_employee_id, approval_code, approval_type, title, summary, form_data, current_step, status, submitted_at, completed_at")
      .is("deleted_at", null)
      .order("submitted_at", { ascending: false });

    if (approvalResponse.error) throw approvalResponse.error;

    const approvalRows = ((approvalResponse.data ?? []) as ApprovalRow[])
      .slice()
      .sort((left, right) => String(right.submitted_at ?? "").localeCompare(String(left.submitted_at ?? "")));
    if (approvalRows.length === 0) return emptySupabaseResult();

    const approvalIds = approvalRows.map((row) => row.id);
    const [stepResponse, actionResponse] = await Promise.all([
      client
        .from("approval_steps")
        .select("public_id, approval_id, step_order, name, approver_employee_id, status, acted_at, comment")
        .in("approval_id", approvalIds)
        .order("step_order", { ascending: true }),
      client
        .from("approval_actions")
        .select("public_id, approval_id, actor_employee_id, action_type, content, created_at")
        .in("approval_id", approvalIds)
        .order("created_at", { ascending: false }),
    ]);

    if (stepResponse.error || actionResponse.error) {
      throw stepResponse.error ?? actionResponse.error;
    }

    const stepRows = (stepResponse.data ?? []) as ApprovalStepRow[];
    const actionRows = (actionResponse.data ?? []) as ApprovalActionRow[];
    const employeeIds = [...new Set([
      ...approvalRows.flatMap((row) => [
        row.applicant_employee_id,
        ...(row.owner_employee_id == null ? [] : [row.owner_employee_id]),
      ]),
      ...stepRows.flatMap((row) => row.approver_employee_id == null ? [] : [row.approver_employee_id]),
      ...actionRows.map((row) => row.actor_employee_id),
    ])];

    const employeeResponse = await client
      .from("employee_profiles")
      .select("id, public_id, display_name, job_title, avatar_url, department_id")
      .in("id", employeeIds)
      .is("deleted_at", null);

    if (employeeResponse.error) throw employeeResponse.error;

    const employeeRows = (employeeResponse.data ?? []) as EmployeeRow[];
    const departmentIds = [...new Set(employeeRows.flatMap((employee) =>
      employee.department_id == null ? [] : [employee.department_id],
    ))];
    const departmentResponse = departmentIds.length
      ? await client
        .from("departments")
        .select("id, name")
        .in("id", departmentIds)
        .is("deleted_at", null)
      : { data: [], error: null };

    if (departmentResponse.error) throw departmentResponse.error;

    const employees = new Map(employeeRows.map((employee) => [employee.id, employee]));
    const departments = new Map(((departmentResponse.data ?? []) as DepartmentRow[])
      .map((department) => [department.id, department]));
    const stepsByApprovalId = groupByApprovalId(stepRows);
    const actionsByApprovalId = groupByApprovalId(actionRows);
    const approvals = approvalRows.map((row) =>
      buildApproval(
        row,
        employees,
        departments,
        stepsByApprovalId,
        actionsByApprovalId,
        options.viewerEmployeeProfileId,
      ),
    );

    return {
      source: "supabase",
      data: {
        approvals,
        stats: computeStats(approvals),
      },
    };
  } catch {
    return emptySupabaseResult("审批与报账数据加载失败，请检查 Supabase 权限、迁移字段和当前账号可见范围。");
  }
}

export async function loadApprovalDetail(
  publicId: string,
  clientFactory: ApprovalClientFactory = getSupabaseServerClient,
  options: LoadApprovalsOptions = {},
) {
  const result = await loadApprovals(clientFactory, options);
  return result.data.approvals.find((approval) => approval.id === publicId);
}
