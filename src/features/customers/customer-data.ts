import type {
  Customer,
  CustomerActivity,
  CustomerContact,
  CustomerContract,
  CustomerDetailResult,
  CustomerFilters,
  CustomerOpportunity,
  CustomerProjectLink,
  CustomerSourceLink,
  CustomerSource,
  CustomerStatus,
  CustomerWorkspaceResult,
  FollowUpKind,
  OpportunityStage,
} from "@/features/customers/customer-types";
import { loadActiveWorkspaceScope } from "@/features/projects/data/active-workspace-data";
import { loadAvailableProjectMembers, loadProjectMemberDirectory } from "@/features/projects/data/project-member-data";
import type { MemberSummary } from "@/features/projects/types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof getSupabaseServerClient>>;
export type CustomerClientFactory = () => Promise<SupabaseServerClient>;

type CustomerRow = {
  id: number; public_id: string; owner_member_id: number; name: string;
  registration_code: string | null; industry: string; source: CustomerSource;
  region: string; status: CustomerStatus; version: number | string;
  created_at: string; updated_at: string;
};
type ContactRow = {
  record_id: number; public_id: string; customer_id: number; name: string; title: string;
  phone: string | null; email: string | null; visibility: "assigned" | "managers";
  is_primary: boolean; version: number | string; created_at: string; updated_at: string;
};
type OpportunityRow = {
  id: number; public_id: string; customer_id: number; owner_member_id: number; name: string;
  stage: OpportunityStage; amount: string; currency: string; expected_close_on: string | null;
  loss_reason: string | null; version: number | string; created_at: string; updated_at: string;
};
type OpportunityMetricRow = {
  customer_id: number; opportunity_count: number | string; deal_progress: number | string; won_amount_cny: string;
};
type FollowUpMetricRow = { customer_id: number; last_contact_at: string | null; next_follow_up_at: string | null };
type IndustryRow = { industry: string };
type FollowUpRow = {
  public_id: string; customer_id: number; opportunity_id: number | null; actor_member_id: number;
  kind: FollowUpKind; content: string; occurred_at: string; next_follow_up_at: string | null;
};
type LinkRow = {
  public_id: string; customer_id: number; opportunity_id: number | null; project_id: number;
  link_type: CustomerProjectLink["linkType"]; created_at: string;
};
type ProjectRow = { id: number; public_id: string; name: string; progress: number | string };
type ContractRow = {
  public_id: string; customer_id: number; opportunity_id: number | null; project_id: number | null;
  contract_number: string; title: string; status: CustomerContract["status"]; amount: string;
  currency: string; signed_on: string | null; starts_on: string; ends_on: string;
  version: number | string; created_at: string; updated_at: string;
};
type SourceLinkRow = {
  public_id: string; customer_id: number; contact_id: number | null; opportunity_id: number | null;
  project_id: number | null; target_kind: CustomerSourceLink["targetKind"];
  source_system: CustomerSourceLink["sourceSystem"]; external_record_id: string;
  source_url: string | null; created_at: string;
};

const PAGE_SIZE = 30;
const MAX_DETAIL_ROWS = 100;
const CUSTOMER_STATUSES = new Set<CustomerStatus>(["lead", "following", "proposal", "negotiating", "won", "lost"]);
const SOURCES = new Set<CustomerSource>(["consulting", "referral", "event", "outbound", "other"]);
const OPPORTUNITY_STAGES = new Set<OpportunityStage>(["lead", "qualified", "proposal", "won", "lost"]);
const FOLLOW_UP_KINDS = new Set<FollowUpKind>(["call", "meeting", "email", "message", "visit", "note"]);
const LINK_TYPES = new Set<CustomerProjectLink["linkType"]>(["delivery", "support", "renewal"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY_PATTERN = /^(0|[1-9]\d{0,15})(?:\.(\d{1,2}))?$/;
const AGGREGATE_MONEY_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/;
const DEFAULT_FILTERS: CustomerFilters = { query: "", status: "all", source: "all", industry: "all" };

function pagination(page: number, total = 0) {
  return { page, pageSize: PAGE_SIZE, total, hasPrevious: page > 1, hasNext: page * PAGE_SIZE < total };
}

function unavailableResult(
  canManage: boolean,
  canConvertToProject: boolean,
  canImport: boolean,
  canExport: boolean,
  canExportPii: boolean,
  page: number,
  filters: CustomerFilters,
): CustomerWorkspaceResult {
  return {
    source: "supabase",
    data: {
      customers: [], availableOwners: [], canManage, canConvertToProject,
      canImport, canExport, canExportPii, filters, industryOptions: [],
      pagination: pagination(page),
      loadError: "客户数据暂时不可用，请检查数据库迁移、权限与当前组织范围后重试。",
    },
  };
}

function requiredUuid(value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) throw new Error("invalid_customer_uuid");
  return value;
}

function requiredText(value: unknown, maximum: number) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error("invalid_customer_text");
  return value.trim();
}

function isSafeSourceUrl(value: string) {
  try {
    const parsed = new URL(value);
    const sensitive = new Set(["token", "access_token", "key", "api_key", "signature", "sig", "auth", "password", "secret"]);
    return /^https:\/\/[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?(?:[/?]|$)/.test(value)
      && parsed.protocol === "https:" && Boolean(parsed.hostname) && !parsed.username && !parsed.password
      && !value.includes("#") && !/[?&][^=&#]*%[^=&#]*=/.test(value)
      && ![...parsed.searchParams.keys()].some((key) => sensitive.has(key.toLowerCase()));
  } catch {
    return false;
  }
}

function timestamp(value: unknown) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new Error("invalid_customer_time");
  return value;
}

function optionalTimestamp(value: unknown) {
  return value === null ? null : timestamp(value);
}

function optionalDate(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error("invalid_customer_date");
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) throw new Error("invalid_customer_date");
  const date = new Date(`${value}T00:00:00Z`);
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() + 1 !== Number(match[2])
    || date.getUTCDate() !== Number(match[3])) throw new Error("invalid_customer_date");
  return value;
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error("invalid_customer_version");
  return parsed;
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error("invalid_customer_number");
  return parsed;
}

function canonicalMoney(value: unknown, aggregate = false) {
  if (typeof value !== "string") throw new Error("invalid_customer_money");
  const match = (aggregate ? AGGREGATE_MONEY_PATTERN : MONEY_PATTERN).exec(value);
  if (!match) throw new Error("invalid_customer_money");
  return `${match[1]}.${(match[2] ?? "").padEnd(2, "0")}`;
}

function moneyToCents(value: string, aggregate = false) {
  const canonical = canonicalMoney(value, aggregate);
  const [integer, fraction] = canonical.split(".");
  return BigInt(integer) * BigInt(100) + BigInt(fraction);
}

function centsToMoney(value: bigint) {
  return `${value / BigInt(100)}.${String(value % BigInt(100)).padStart(2, "0")}`;
}

function sumMoney(values: readonly string[]) {
  return centsToMoney(values.reduce((total, value) => total + moneyToCents(value, true), BigInt(0)));
}

type CustomerFilterInput = { query?: unknown; status?: unknown; source?: unknown; industry?: unknown };

export function normalizeCustomerFilters(input: CustomerFilterInput = {}): CustomerFilters {
  const query = typeof input.query === "string" && input.query.length <= 100 ? input.query.trim() : "";
  const status = typeof input.status === "string" && CUSTOMER_STATUSES.has(input.status as CustomerStatus)
    ? input.status as CustomerStatus : "all";
  const source = typeof input.source === "string" && SOURCES.has(input.source as CustomerSource)
    ? input.source as CustomerSource : "all";
  const industry = typeof input.industry === "string" && input.industry !== "all"
    && input.industry.trim().length > 0 && input.industry.length <= 80 ? input.industry.trim() : "all";
  return { ...DEFAULT_FILTERS, query, status, source, industry };
}

function escapeLikePattern(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

function requiredMember(directory: ReadonlyMap<number, { summary: MemberSummary }>, memberId: number) {
  const member = directory.get(memberId)?.summary;
  if (!member) throw new Error("customer_member_missing");
  return member;
}

function mapContact(row: ContactRow): CustomerContact {
  if (!new Set(["assigned", "managers"]).has(row.visibility)) throw new Error("invalid_contact_visibility");
  return {
    id: requiredUuid(row.public_id), version: positiveInteger(row.version), name: requiredText(row.name, 120),
    title: row.title, phone: row.phone, email: row.email, visibility: row.visibility,
    isPrimary: row.is_primary, createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at),
  };
}

function mapCustomerSummary(
  row: CustomerRow,
  owner: MemberSummary,
  primaryContact: CustomerContact | undefined,
  opportunityMetric: OpportunityMetricRow | undefined,
  followUpMetric: FollowUpMetricRow | undefined,
): Customer {
  if (!CUSTOMER_STATUSES.has(row.status) || !SOURCES.has(row.source)) throw new Error("invalid_customer_enum");
  return {
    id: requiredUuid(row.public_id), version: positiveInteger(row.version), name: requiredText(row.name, 160),
    registrationCode: row.registration_code, contact: primaryContact,
    contacts: primaryContact ? [primaryContact] : [], owner, status: row.status, source: row.source,
    industry: requiredText(row.industry, 80), region: row.region,
    lastContactAt: optionalTimestamp(followUpMetric?.last_contact_at ?? null),
    nextFollowUpAt: optionalTimestamp(followUpMetric?.next_follow_up_at ?? null),
    dealProgress: opportunityMetric ? boundedInteger(opportunityMetric.deal_progress, 0, 100) : 0,
    dealAmount: opportunityMetric ? canonicalMoney(opportunityMetric.won_amount_cny, true) : "0.00",
    createdAt: timestamp(row.created_at), updatedAt: timestamp(row.updated_at),
    relatedProjects: [], contracts: [], sourceLinks: [], opportunities: [], activities: [], detailState: "summary",
  };
}

export async function loadCustomerWorkspaceData(
  clientFactory: CustomerClientFactory = getSupabaseServerClient,
  options: {
    canManage?: boolean;
    canConvertToProject?: boolean;
    canImport?: boolean;
    canExport?: boolean;
    canExportPii?: boolean;
    page?: number;
    filters?: Partial<CustomerFilters>;
  } = {},
): Promise<CustomerWorkspaceResult> {
  const canManage = options.canManage ?? false;
  const canConvertToProject = options.canConvertToProject ?? false;
  const canImport = options.canImport ?? false;
  const canExport = options.canExport ?? false;
  const canExportPii = options.canExportPii ?? false;
  const page = Number.isSafeInteger(options.page) && (options.page ?? 0) > 0 ? options.page! : 1;
  const filters = normalizeCustomerFilters(options.filters);
  try {
    const client = await clientFactory();
    const scope = await loadActiveWorkspaceScope(client);
    const offset = (page - 1) * PAGE_SIZE;
    const customerQuery = client.from("customers")
      .select("id, public_id, owner_member_id, name, registration_code, industry, source, region, status, version, created_at, updated_at", { count: "exact" })
      .eq("tenant_id", scope.tenantId).eq("organization_id", scope.organizationId)
      .is("archived_at", null);
    if (filters.query) customerQuery.ilike("name", `%${escapeLikePattern(filters.query)}%`);
    if (filters.status !== "all") customerQuery.eq("status", filters.status);
    if (filters.source !== "all") customerQuery.eq("source", filters.source);
    if (filters.industry !== "all") customerQuery.eq("industry", filters.industry);
    const customerResponse = await customerQuery.order("updated_at", { ascending: false })
      .order("id", { ascending: false }).range(offset, offset + PAGE_SIZE - 1);
    if (customerResponse.error) throw customerResponse.error;
    const total = customerResponse.count;
    if (!Number.isSafeInteger(total) || (total ?? -1) < 0) throw new Error("customer_count_unavailable");
    const customerRows = (customerResponse.data ?? []) as CustomerRow[];
    const availableOwnersPromise = canManage ? loadAvailableProjectMembers(client, scope) : Promise.resolve([]);
    const industryOptionsPromise = client.from("current_customer_industries").select("industry")
      .eq("tenant_id", scope.tenantId).eq("organization_id", scope.organizationId)
      .order("industry", { ascending: true });
    if (customerRows.length === 0) {
      const [availableOwners, industryResponse] = await Promise.all([availableOwnersPromise, industryOptionsPromise]);
      if (industryResponse.error) throw industryResponse.error;
      const industryOptions = ((industryResponse.data ?? []) as IndustryRow[])
        .map(({ industry }) => requiredText(industry, 80));
      return { source: "supabase", data: {
        customers: [], availableOwners, canManage, canConvertToProject,
        canImport, canExport, canExportPii, filters, industryOptions,
        pagination: pagination(page, total!),
      } };
    }

    const customerIds = customerRows.map(({ id }) => id);
    const customerPublicIds = customerRows.map(({ public_id }) => public_id);
    const [contactResponse, opportunityMetricResponse, followUpMetricResponse, availableOwners, industryResponse] = await Promise.all([
      client.rpc("list_current_customer_contacts", {
        p_customer_public_ids: customerPublicIds, p_primary_only: true, p_per_customer_limit: 1,
      }),
      client.from("current_customer_opportunity_metrics")
        .select("customer_id, opportunity_count, deal_progress, won_amount_cny")
        .eq("tenant_id", scope.tenantId).eq("organization_id", scope.organizationId).in("customer_id", customerIds),
      client.from("current_customer_follow_up_metrics")
        .select("customer_id, last_contact_at, next_follow_up_at")
        .eq("tenant_id", scope.tenantId).eq("organization_id", scope.organizationId).in("customer_id", customerIds),
      availableOwnersPromise,
      industryOptionsPromise,
    ]);
    const relatedError = [contactResponse, opportunityMetricResponse, followUpMetricResponse, industryResponse]
      .find(({ error }) => error)?.error;
    if (relatedError) throw relatedError;
    const primaryContacts = new Map(((contactResponse.data ?? []) as ContactRow[])
      .filter(({ is_primary }) => is_primary).map((row) => [row.customer_id, mapContact(row)]));
    const opportunityMetrics = new Map(((opportunityMetricResponse.data ?? []) as OpportunityMetricRow[]).map((row) => [row.customer_id, row]));
    const followUpMetrics = new Map(((followUpMetricResponse.data ?? []) as FollowUpMetricRow[]).map((row) => [row.customer_id, row]));
    const directory = await loadProjectMemberDirectory(client, customerRows.map(({ owner_member_id }) => owner_member_id), scope);
    const customers = customerRows.map((row) => mapCustomerSummary(
      row, requiredMember(directory, row.owner_member_id), primaryContacts.get(row.id),
      opportunityMetrics.get(row.id), followUpMetrics.get(row.id),
    ));
    const industryOptions = ((industryResponse.data ?? []) as IndustryRow[])
      .map(({ industry }) => requiredText(industry, 80));
    return { source: "supabase", data: {
      customers, availableOwners, canManage, canConvertToProject,
      canImport, canExport, canExportPii, filters, industryOptions,
      pagination: pagination(page, total!),
    } };
  } catch {
    return unavailableResult(canManage, canConvertToProject, canImport, canExport, canExportPii, page, filters);
  }
}

export async function loadCustomerDetailData(
  customerPublicId: string,
  clientFactory: CustomerClientFactory = getSupabaseServerClient,
): Promise<CustomerDetailResult> {
  if (!UUID_PATTERN.test(customerPublicId)) return { source: "supabase" };
  try {
    const client = await clientFactory();
    const scope = await loadActiveWorkspaceScope(client);
    const customerResponse = await client.from("customers")
      .select("id, public_id, owner_member_id, name, registration_code, industry, source, region, status, version, created_at, updated_at")
      .eq("tenant_id", scope.tenantId).eq("organization_id", scope.organizationId)
      .eq("public_id", customerPublicId).is("archived_at", null).maybeSingle();
    if (customerResponse.error) throw customerResponse.error;
    const row = customerResponse.data as CustomerRow | null;
    if (!row) return { source: "supabase" };

    const [contactResponse, opportunityResponse, followUpResponse, linkResponse, contractResponse, sourceResponse] = await Promise.all([
      client.rpc("list_current_customer_contacts", {
        p_customer_public_ids: [customerPublicId], p_primary_only: false,
        p_per_customer_limit: MAX_DETAIL_ROWS + 1,
      }),
      client.from("current_customer_opportunities")
        .select("id, public_id, customer_id, owner_member_id, name, stage, amount, currency, expected_close_on, loss_reason, version, created_at, updated_at")
        .eq("tenant_id", scope.tenantId).eq("organization_id", scope.organizationId)
        .eq("customer_id", row.id).is("archived_at", null).order("updated_at", { ascending: false }).range(0, MAX_DETAIL_ROWS),
      client.from("customer_follow_ups")
        .select("public_id, customer_id, opportunity_id, actor_member_id, kind, content, occurred_at, next_follow_up_at")
        .eq("tenant_id", scope.tenantId).eq("organization_id", scope.organizationId)
        .eq("customer_id", row.id).is("archived_at", null).order("occurred_at", { ascending: false }).range(0, MAX_DETAIL_ROWS),
      client.from("customer_project_links")
        .select("public_id, customer_id, opportunity_id, project_id, link_type, created_at")
        .eq("tenant_id", scope.tenantId).eq("organization_id", scope.organizationId)
        .eq("customer_id", row.id).is("archived_at", null).order("created_at", { ascending: false }).range(0, MAX_DETAIL_ROWS),
      client.from("customer_contracts")
        .select("public_id, customer_id, opportunity_id, project_id, contract_number, title, status, amount, currency, signed_on, starts_on, ends_on, version, created_at, updated_at")
        .eq("tenant_id", scope.tenantId).eq("organization_id", scope.organizationId)
        .eq("customer_id", row.id).is("archived_at", null).order("updated_at", { ascending: false }).range(0, MAX_DETAIL_ROWS),
      client.from("crm_source_links")
        .select("public_id, customer_id, contact_id, opportunity_id, project_id, target_kind, source_system, external_record_id, source_url, created_at")
        .eq("tenant_id", scope.tenantId).eq("organization_id", scope.organizationId)
        .eq("customer_id", row.id).order("created_at", { ascending: false }).range(0, MAX_DETAIL_ROWS),
    ]);
    const relatedError = [contactResponse, opportunityResponse, followUpResponse, linkResponse, contractResponse, sourceResponse]
      .find(({ error }) => error)?.error;
    if (relatedError) throw relatedError;
    const contactRows = (contactResponse.data ?? []) as ContactRow[];
    const opportunityRows = (opportunityResponse.data ?? []) as OpportunityRow[];
    const followUpRows = (followUpResponse.data ?? []) as FollowUpRow[];
    const linkRows = (linkResponse.data ?? []) as LinkRow[];
    const contractRows = (contractResponse.data ?? []) as ContractRow[];
    const sourceRows = (sourceResponse.data ?? []) as SourceLinkRow[];
    const visibleOpportunityRows = opportunityRows.slice(0, MAX_DETAIL_ROWS);
    const visibleLinkRows = linkRows.slice(0, MAX_DETAIL_ROWS);
    const projectIds = [...new Set(visibleLinkRows.map(({ project_id }) => project_id))];
    const projectResponse = projectIds.length > 0
      ? await client.from("projects").select("id, public_id, name, progress")
        .eq("tenant_id", scope.tenantId).eq("organization_id", scope.organizationId)
        .in("id", projectIds).is("deleted_at", null)
      : { data: [], error: null };
    if (projectResponse.error) throw projectResponse.error;
    const projects = new Map(((projectResponse.data ?? []) as ProjectRow[]).map((project) => [project.id, project]));
    const directory = await loadProjectMemberDirectory(client, [
      row.owner_member_id,
      ...visibleOpportunityRows.map(({ owner_member_id }) => owner_member_id),
      ...followUpRows.slice(0, MAX_DETAIL_ROWS).map(({ actor_member_id }) => actor_member_id),
    ], scope);
    const opportunityPublicIds = new Map(opportunityRows.map((opportunity) => [opportunity.id, requiredUuid(opportunity.public_id)]));
    const contactPublicIds = new Map(contactRows.map((contact) => [contact.record_id, requiredUuid(contact.public_id)]));
    const projectPublicIds = new Map([...projects].map(([id, project]) => [id, requiredUuid(project.public_id)]));
    const links = visibleLinkRows.map<CustomerProjectLink>((link) => {
      if (!LINK_TYPES.has(link.link_type)) throw new Error("invalid_customer_link");
      const project = projects.get(link.project_id);
      return {
        id: requiredUuid(link.public_id), projectId: project ? requiredUuid(project.public_id) : null,
        projectName: project ? requiredText(project.name, 160) : null,
        projectProgress: project ? boundedInteger(project.progress, 0, 100) : null,
        opportunityId: link.opportunity_id == null ? null : opportunityPublicIds.get(link.opportunity_id) ?? null,
        linkType: link.link_type, createdAt: timestamp(link.created_at),
      };
    });
    const linkByOpportunity = new Map(links.flatMap((link) => link.opportunityId ? [[link.opportunityId, link]] : []));
    const opportunities = visibleOpportunityRows.map<CustomerOpportunity>((opportunity) => {
      if (!OPPORTUNITY_STAGES.has(opportunity.stage)) throw new Error("invalid_opportunity_stage");
      const id = requiredUuid(opportunity.public_id);
      return {
        id, version: positiveInteger(opportunity.version), name: requiredText(opportunity.name, 160),
        owner: requiredMember(directory, opportunity.owner_member_id), stage: opportunity.stage,
        amount: canonicalMoney(opportunity.amount), currency: requiredText(opportunity.currency, 3),
        expectedCloseOn: optionalDate(opportunity.expected_close_on), lossReason: opportunity.loss_reason,
        createdAt: timestamp(opportunity.created_at), updatedAt: timestamp(opportunity.updated_at),
        projectId: linkByOpportunity.get(id)?.projectName && linkByOpportunity.get(id)?.projectId
          ? linkByOpportunity.get(id)!.projectId! : undefined,
      };
    });
    const activities = followUpRows.slice(0, MAX_DETAIL_ROWS).map<CustomerActivity>((followUp) => {
      if (!FOLLOW_UP_KINDS.has(followUp.kind)) throw new Error("invalid_follow_up_kind");
      return {
        id: requiredUuid(followUp.public_id), opportunityId: followUp.opportunity_id == null
          ? null : opportunityPublicIds.get(followUp.opportunity_id) ?? null,
        kind: followUp.kind, content: requiredText(followUp.content, 8000),
        actor: requiredMember(directory, followUp.actor_member_id), occurredAt: timestamp(followUp.occurred_at),
        nextFollowUpAt: optionalTimestamp(followUp.next_follow_up_at),
      };
    });
    const contracts = contractRows.slice(0, MAX_DETAIL_ROWS).map<CustomerContract>((contract) => {
      if (!new Set<CustomerContract["status"]>(["draft", "active", "completed", "terminated"]).has(contract.status)) {
        throw new Error("invalid_contract_status");
      }
      const signedOn = optionalDate(contract.signed_on);
      const startsOn = optionalDate(contract.starts_on);
      const endsOn = optionalDate(contract.ends_on);
      if (!startsOn || !endsOn || endsOn < startsOn || !/^[A-Z]{3}$/.test(contract.currency)) {
        throw new Error("invalid_contract_period");
      }
      return {
        id: requiredUuid(contract.public_id),
        opportunityId: contract.opportunity_id === null ? null : opportunityPublicIds.get(contract.opportunity_id) ?? null,
        projectId: contract.project_id === null ? null : projectPublicIds.get(contract.project_id) ?? null,
        contractNumber: requiredText(contract.contract_number, 80), title: requiredText(contract.title, 160),
        status: contract.status, amount: canonicalMoney(contract.amount), currency: contract.currency,
        signedOn, startsOn, endsOn, version: positiveInteger(contract.version),
        createdAt: timestamp(contract.created_at), updatedAt: timestamp(contract.updated_at),
      };
    });
    const sourceLinks = sourceRows.slice(0, MAX_DETAIL_ROWS).map<CustomerSourceLink>((sourceLink) => {
      if (!new Set<CustomerSourceLink["targetKind"]>(["customer", "contact", "opportunity", "project"]).has(sourceLink.target_kind)
        || !new Set<CustomerSourceLink["sourceSystem"]>(["feishu", "import", "external_crm", "n8n", "other"]).has(sourceLink.source_system)
        || sourceLink.source_url !== null && !isSafeSourceUrl(sourceLink.source_url)) {
        throw new Error("invalid_source_link");
      }
      return {
        id: requiredUuid(sourceLink.public_id),
        contactId: sourceLink.contact_id === null ? null : contactPublicIds.get(sourceLink.contact_id) ?? null,
        opportunityId: sourceLink.opportunity_id === null ? null : opportunityPublicIds.get(sourceLink.opportunity_id) ?? null,
        projectId: sourceLink.project_id === null ? null : projectPublicIds.get(sourceLink.project_id) ?? null,
        targetKind: sourceLink.target_kind, sourceSystem: sourceLink.source_system,
        externalRecordId: requiredText(sourceLink.external_record_id, 255), sourceUrl: sourceLink.source_url,
        createdAt: timestamp(sourceLink.created_at),
      };
    });
    const contacts = contactRows.slice(0, MAX_DETAIL_ROWS).map(mapContact);
    const nextFollowUpAt = activities.flatMap((activity) => activity.nextFollowUpAt ? [activity.nextFollowUpAt] : [])
      .sort()[0] ?? null;
    const customer = mapCustomerSummary(row, requiredMember(directory, row.owner_member_id),
      contacts.find(({ isPrimary }) => isPrimary), undefined, undefined);
    customer.contacts = contacts;
    customer.opportunities = opportunities;
    customer.activities = activities;
    customer.relatedProjects = links;
    customer.contracts = contracts;
    customer.sourceLinks = sourceLinks;
    customer.lastContactAt = activities[0]?.occurredAt ?? null;
    customer.nextFollowUpAt = nextFollowUpAt;
    customer.dealProgress = opportunities.length
      ? Math.max(...opportunities.filter(({ stage }) => stage !== "lost").map(({ stage }) =>
        ({ lead: 10, qualified: 40, proposal: 70, won: 100, lost: 100 })[stage]), 0)
      : 0;
    customer.dealAmount = sumMoney(opportunities.filter(({ stage, currency }) => stage === "won" && currency === "CNY").map(({ amount }) => amount));
    customer.detailState = "complete";
    customer.truncatedResources = [
      ...(contactRows.length > MAX_DETAIL_ROWS ? ["contacts" as const] : []),
      ...(opportunityRows.length > MAX_DETAIL_ROWS ? ["opportunities" as const] : []),
      ...(followUpRows.length > MAX_DETAIL_ROWS ? ["followUps" as const] : []),
      ...(linkRows.length > MAX_DETAIL_ROWS ? ["projectLinks" as const] : []),
      ...(contractRows.length > MAX_DETAIL_ROWS ? ["contracts" as const] : []),
      ...(sourceRows.length > MAX_DETAIL_ROWS ? ["sourceLinks" as const] : []),
    ];
    return { source: "supabase", customer };
  } catch {
    return { source: "supabase", loadError: "客户详情暂时不可用，请刷新后重试。" };
  }
}

export function selectCustomerDetail(result: CustomerWorkspaceResult, customerId: string) {
  return result.data.customers.find(({ id }) => id === customerId);
}
