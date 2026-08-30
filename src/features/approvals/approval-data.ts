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
  created_at: string;
  version: number;
};

type ExpenseRow = {
  public_id: string;
  approval_id: number;
  version: number;
  status: NonNullable<Approval["expense"]>["status"];
  payment_reference: string | null;
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
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(timestamp).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
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
    { label: "报账类型", value: stringField(formData.costType) || stringField(formData.reimbursementCategory) || stringField(formData.expenseType) || "未分类" },
    { label: "报账金额", value: formatCurrency(formData.amount, currency) },
    { label: "费用日期", value: stringField(formData.expenseDate) || "未填写" },
    { label: "费用说明", value: stringField(formData.purpose) || stringField(formData.description) || "未填写" },
  ];
}

function buildApproval(
  row: ApprovalRow,
  employees: ReadonlyMap<number, EmployeeRow>,
  departments: ReadonlyMap<number, DepartmentRow>,
  stepsByApprovalId: ReadonlyMap<number, ApprovalStepRow[]>,
  actionsByApprovalId: ReadonlyMap<number, ApprovalActionRow[]>,
  expensesByApprovalId: ReadonlyMap<number, ExpenseRow>,
  viewerEmployeeProfileId?: string,
): Approval {
  const applicant = person(row.applicant_employee_id, employees, departments);
  const owner = row.owner_employee_id == null
    ? { id: "workflow-complete", displayName: "无当前负责人", department: "流程已结束" }
    : person(row.owner_employee_id, employees, departments);
  return {
    id: row.public_id,
    version: Number(row.version),
    code: row.approval_code,
    type: row.approval_type,
    title: row.title,
    summary: row.summary ?? "",
    applicant,
    owner,
    submittedAt: formatTimestamp(row.submitted_at),
    status: row.status,
    currentStep: row.current_step ?? (["approved", "rejected", "returned", "cancelled"].includes(row.status) ? "流程已结束" : "待处理"),
    priority: approvalPriority(row),
    initiatedByViewer: viewerEmployeeProfileId === applicant.id,
    actionableByViewer: row.status === "pending" && viewerEmployeeProfileId === owner.id,
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
    expense: (() => {
      const expense = expensesByApprovalId.get(row.id);
      return expense ? {
        id: expense.public_id,
        version: Number(expense.version),
        status: expense.status,
        paymentReference: expense.payment_reference ?? undefined,
      } : undefined;
    })(),
  };
}

function groupByApprovalId<T extends { approval_id: number }>(rows: readonly T[]) {
  const groups = new Map<number, T[]>();
  rows.forEach((row) => {
    groups.set(row.approval_id, [...(groups.get(row.approval_id) ?? []), row]);
  });
  return groups;
}

const APPROVAL_PAGE_SIZE = 250;
const APPROVAL_MAX_ROWS = 2_000;
const LOOKUP_CHUNK_SIZE = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function chunks<T>(values: readonly T[], size = LOOKUP_CHUNK_SIZE) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

async function loadPagedRows<T>(
  queryPage: (from: number, to: number) => Promise<{ data: unknown; error: unknown }>,
) {
  const rows: T[] = [];
  for (let from = 0; ; from += APPROVAL_PAGE_SIZE) {
    const response = await queryPage(from, from + APPROVAL_PAGE_SIZE - 1);
    if (response.error) throw response.error;
    const page = (response.data ?? []) as T[];
    rows.push(...page);
    if (page.length < APPROVAL_PAGE_SIZE) return rows;
  }
}

async function loadApprovalRows(client: SupabaseServerClient) {
  const rows: ApprovalRow[] = [];
  let cursor: Pick<ApprovalRow, "created_at" | "public_id"> | undefined;

  while (rows.length < APPROVAL_MAX_ROWS) {
    let query = client
      .from("approvals")
      .select("id, public_id, organization_id, applicant_employee_id, owner_employee_id, approval_code, approval_type, title, summary, form_data, current_step, status, submitted_at, completed_at, created_at, version")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("public_id", { ascending: false })
      .limit(APPROVAL_PAGE_SIZE);
    if (cursor) {
      query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},public_id.lt.${cursor.public_id})`);
    }
    const response = await query;
    if (response.error) throw response.error;
    const page = (response.data ?? []) as ApprovalRow[];
    rows.push(...page);
    if (page.length < APPROVAL_PAGE_SIZE) return rows;
    const last = page.at(-1);
    if (!last || (last.created_at === cursor?.created_at && last.public_id === cursor.public_id)) {
      throw new Error("approval_pagination_stalled");
    }
    cursor = { created_at: last.created_at, public_id: last.public_id };
  }

  return rows;
}

async function loadLookupRows<T>(
  ids: readonly number[],
  queryChunk: (ids: number[]) => Promise<{ data: unknown; error: unknown }>,
) {
  const rows: T[] = [];
  for (const idChunk of chunks(ids)) {
    const response = await queryChunk(idChunk);
    if (response.error) throw response.error;
    rows.push(...((response.data ?? []) as T[]));
  }
  return rows;
}

async function buildApprovals(
  client: SupabaseServerClient,
  approvalRows: readonly ApprovalRow[],
  stepRows: readonly ApprovalStepRow[],
  actionRows: readonly ApprovalActionRow[],
  expenseRows: readonly ExpenseRow[],
  viewerEmployeeProfileId?: string,
) {
  const employeeIds = [...new Set([
    ...approvalRows.flatMap((row) => [
      row.applicant_employee_id,
      ...(row.owner_employee_id == null ? [] : [row.owner_employee_id]),
    ]),
    ...stepRows.flatMap((row) => row.approver_employee_id == null ? [] : [row.approver_employee_id]),
    ...actionRows.map((row) => row.actor_employee_id),
  ])];
  const employeeRows = await loadLookupRows<EmployeeRow>(employeeIds, async (ids) => await client
    .from("employee_profiles")
    .select("id, public_id, display_name, job_title, avatar_url, department_id")
    .in("id", ids)
    .is("deleted_at", null));
  const departmentIds = [...new Set(employeeRows.flatMap((employee) =>
    employee.department_id == null ? [] : [employee.department_id],
  ))];
  const departmentRows = await loadLookupRows<DepartmentRow>(departmentIds, async (ids) => await client
    .from("departments")
    .select("id, name")
    .in("id", ids)
    .is("deleted_at", null));
  const employees = new Map(employeeRows.map((employee) => [employee.id, employee]));
  const departments = new Map(departmentRows.map((department) => [department.id, department]));
  const stepsByApprovalId = groupByApprovalId(stepRows);
  const actionsByApprovalId = groupByApprovalId(actionRows);
  const expensesByApprovalId = new Map(expenseRows.map((expense) => [expense.approval_id, expense]));
  return approvalRows.map((row) => buildApproval(
    row,
    employees,
    departments,
    stepsByApprovalId,
    actionsByApprovalId,
    expensesByApprovalId,
    viewerEmployeeProfileId,
  ));
}

function computeStats(approvals: readonly Approval[]): ApprovalResult["data"]["stats"] {
  return {
    pending: approvals.filter((approval) => approval.actionableByViewer).length,
    initiated: approvals.filter((approval) => approval.initiatedByViewer).length,
    approved: approvals.filter((approval) => approval.status === "approved").length,
    rejected: approvals.filter((approval) => ["rejected", "returned", "cancelled"].includes(approval.status)).length,
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
    const approvalRows = (await loadApprovalRows(client))
      .slice()
      .sort((left, right) => (
        String(right.submitted_at ?? "").localeCompare(String(left.submitted_at ?? ""))
        || right.public_id.localeCompare(left.public_id)
      ));
    if (approvalRows.length === 0) return emptySupabaseResult();
    const approvals = await buildApprovals(
      client, approvalRows, [], [], [], options.viewerEmployeeProfileId,
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
  const allowMockFallback = options.allowMockFallback ?? shouldAllowMockBusinessData();
  if (allowMockFallback) {
    return approvalMockResult.data.approvals.find((approval) => approval.id === publicId);
  }
  if (!UUID_PATTERN.test(publicId)) return undefined;
  try {
    const client = await clientFactory();
    const approvalResponse = await client
      .from("approvals")
      .select("id, public_id, organization_id, applicant_employee_id, owner_employee_id, approval_code, approval_type, title, summary, form_data, current_step, status, submitted_at, completed_at, created_at, version")
      .eq("public_id", publicId)
      .is("deleted_at", null)
      .maybeSingle();
    if (approvalResponse.error) throw approvalResponse.error;
    if (!approvalResponse.data) return undefined;
    const row = approvalResponse.data as ApprovalRow;
    const [stepRows, actionRows, expenseResponse] = await Promise.all([
      loadPagedRows<ApprovalStepRow>(async (from, to) => await client
        .from("approval_steps")
        .select("public_id, approval_id, step_order, name, approver_employee_id, status, acted_at, comment")
        .eq("approval_id", row.id)
        .order("step_order", { ascending: true })
        .order("public_id", { ascending: true })
        .range(from, to)),
      loadPagedRows<ApprovalActionRow>(async (from, to) => await client
        .from("approval_actions")
        .select("public_id, approval_id, actor_employee_id, action_type, content, created_at")
        .eq("approval_id", row.id)
        .order("created_at", { ascending: false })
        .order("public_id", { ascending: false })
        .range(from, to)),
      client
        .from("expense_reports")
        .select("public_id, approval_id, version, status, payment_reference")
        .eq("approval_id", row.id)
        .is("deleted_at", null)
        .maybeSingle(),
    ]);
    if (expenseResponse.error) throw expenseResponse.error;
    const expenseRows = expenseResponse.data ? [expenseResponse.data as ExpenseRow] : [];
    const approvals = await buildApprovals(
      client, [row], stepRows, actionRows, expenseRows, options.viewerEmployeeProfileId,
    );
    return approvals[0];
  } catch {
    throw new Error("approval_data_unavailable");
  }
}
