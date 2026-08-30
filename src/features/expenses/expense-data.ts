import { getSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof getSupabaseServerClient>>;
export type ExpenseClientFactory = () => Promise<SupabaseServerClient>;

export type ExpenseReceiptOption = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
};

export type ExpenseProjectOption = {
  id: string;
  code: string;
  name: string;
  receipts: ExpenseReceiptOption[];
};

export type ExpenseDraftOption = {
  id: string;
  version: number;
  projectId: string | null;
  expenseType: "travel" | "meal" | "transport" | "office" | "other";
  amount: string;
  expenseDate: string;
  description: string;
  receiptFileIds: string[];
  updatedAt: string;
};

export type ExpenseFormOptions = {
  source: "supabase";
  projects: ExpenseProjectOption[];
  drafts: ExpenseDraftOption[];
  loadError?: string;
};

export type LoadExpenseFormOptions = {
  draftPublicId?: string;
};

type EmployeeRow = {
  id: number;
  organization_member_id: number;
};

type ExpenseDraftRow = {
  public_id: string;
  version: number;
  project_id: number | null;
  expense_type: ExpenseDraftOption["expenseType"];
  amount: number | string;
  expense_date: string;
  description: string;
  receipt_file_ids: string[] | null;
  created_at: string;
  updated_at: string;
};

type ProjectRow = {
  id: number;
  public_id: string;
  code: string;
  name: string;
  owner_member_id: number;
  status: string;
  archived_at: string | null;
};

type ProjectMemberRow = {
  project_id: number;
  member_id: number;
  left_at: string | null;
};

type FileRow = {
  public_id: string;
  project_id: number;
  original_name: string;
  mime_type: string;
  size_bytes: number | string;
  uploaded_by_member_id: number;
  verified_at: string | null;
};

function unavailable(): ExpenseFormOptions {
  return {
    source: "supabase",
    projects: [],
    drafts: [],
    loadError: "费用关联项目与票据加载失败，请刷新后重试。",
  };
}

const EXPENSE_DRAFT_PAGE_SIZE = 100;
const EXPENSE_DRAFT_MAX_ROWS = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function loadExpenseDraftRows(
  client: SupabaseServerClient,
  requesterEmployeeId: number,
  draftPublicId?: string,
) {
  const select = "public_id, version, project_id, expense_type, amount, expense_date, description, receipt_file_ids, created_at, updated_at";
  if (draftPublicId) {
    if (!UUID_PATTERN.test(draftPublicId)) throw new Error("invalid_expense_draft_id");
    const response = await client
      .from("expense_reports")
      .select(select)
      .eq("requester_employee_id", requesterEmployeeId)
      .eq("status", "draft")
      .eq("public_id", draftPublicId)
      .is("deleted_at", null)
      .maybeSingle();
    if (response.error) throw response.error;
    return response.data ? [response.data as ExpenseDraftRow] : [];
  }

  const rows: ExpenseDraftRow[] = [];
  let cursor: Pick<ExpenseDraftRow, "created_at" | "public_id"> | undefined;
  while (rows.length < EXPENSE_DRAFT_MAX_ROWS) {
    let query = client
      .from("expense_reports")
      .select(select)
      .eq("requester_employee_id", requesterEmployeeId)
      .eq("status", "draft")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .order("public_id", { ascending: false })
      .limit(EXPENSE_DRAFT_PAGE_SIZE);
    if (cursor) {
      query = query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},public_id.lt.${cursor.public_id})`);
    }
    const response = await query;
    if (response.error) throw response.error;
    const page = (response.data ?? []) as ExpenseDraftRow[];
    rows.push(...page);
    if (page.length < EXPENSE_DRAFT_PAGE_SIZE) break;
    const last = page.at(-1);
    if (!last || (last.created_at === cursor?.created_at && last.public_id === cursor.public_id)) {
      throw new Error("expense_draft_pagination_stalled");
    }
    cursor = { created_at: last.created_at, public_id: last.public_id };
  }
  return rows.sort((left, right) => (
    right.updated_at.localeCompare(left.updated_at) || right.public_id.localeCompare(left.public_id)
  ));
}

export async function loadExpenseFormOptions(
  memberId: number,
  clientFactory: ExpenseClientFactory = getSupabaseServerClient,
  options: LoadExpenseFormOptions = {},
): Promise<ExpenseFormOptions> {
  try {
    const client = await clientFactory();
    const employeeResponse = await client
      .from("employee_profiles")
      .select("id, organization_member_id")
      .eq("organization_member_id", memberId)
      .is("deleted_at", null)
      .maybeSingle();
    if (employeeResponse.error || !employeeResponse.data) throw employeeResponse.error ?? new Error("employee_not_found");
    const employee = employeeResponse.data as EmployeeRow;

    const projectResponse = await client
      .from("projects")
      .select("id, public_id, code, name, owner_member_id, status, archived_at")
      .is("deleted_at", null)
      .order("name");
    if (projectResponse.error) throw projectResponse.error;

    const projectRows = ((projectResponse.data ?? []) as ProjectRow[])
      .filter((project) => project.archived_at === null && project.status !== "cancelled");
    const projectIds = projectRows.map((project) => project.id);
    const membershipResponse = projectIds.length
      ? await client
        .from("project_members")
        .select("project_id, member_id, left_at")
        .in("project_id", projectIds)
        .eq("member_id", memberId)
        .is("left_at", null)
      : { data: [], error: null };
    if (membershipResponse.error) throw membershipResponse.error;

    const membershipIds = new Set(((membershipResponse.data ?? []) as ProjectMemberRow[])
      .filter((membership) => membership.member_id === memberId && membership.left_at === null)
      .map((membership) => membership.project_id));
    const accessibleProjects = projectRows.filter((project) => (
      project.owner_member_id === memberId || membershipIds.has(project.id)
    ));
    const accessibleIds = accessibleProjects.map((project) => project.id);
    const fileResponse = accessibleIds.length
      ? await client
        .from("files")
        .select("public_id, project_id, original_name, mime_type, size_bytes, uploaded_by_member_id, verified_at")
        .in("project_id", accessibleIds)
        .eq("uploaded_by_member_id", memberId)
        .not("verified_at", "is", null)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
      : { data: [], error: null };
    if (fileResponse.error) throw fileResponse.error;

    const draftRows = await loadExpenseDraftRows(client, employee.id, options.draftPublicId);

    const files = ((fileResponse.data ?? []) as FileRow[]).filter((file) => (
      file.uploaded_by_member_id === memberId
      && file.verified_at !== null
      && Number(file.size_bytes) > 0
      && (file.mime_type === "application/pdf" || file.mime_type.startsWith("image/"))
    ));

    const projectPublicIds = new Map(projectRows.map((project) => [project.id, project.public_id]));
    const drafts = draftRows.map((draft) => ({
      id: draft.public_id,
      version: Number(draft.version),
      projectId: draft.project_id == null ? null : projectPublicIds.get(draft.project_id) ?? null,
      expenseType: draft.expense_type,
      amount: String(draft.amount),
      expenseDate: draft.expense_date,
      description: draft.description,
      receiptFileIds: Array.isArray(draft.receipt_file_ids) ? draft.receipt_file_ids : [],
      updatedAt: draft.updated_at,
    }));

    return {
      source: "supabase",
      projects: accessibleProjects.map((project) => ({
        id: project.public_id,
        code: project.code,
        name: project.name,
        receipts: files
          .filter((file) => file.project_id === project.id)
          .map((file) => ({
            id: file.public_id,
            name: file.original_name,
            mimeType: file.mime_type,
            sizeBytes: Number(file.size_bytes),
          })),
      })),
      drafts,
    };
  } catch {
    return unavailable();
  }
}
