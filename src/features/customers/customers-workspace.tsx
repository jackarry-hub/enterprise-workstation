"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { CreateCustomerDialog } from "@/features/customers/components/create-customer-dialog";
import { CustomerDetailDialog } from "@/features/customers/components/customer-detail-dialog";
import { CustomerDistributions } from "@/features/customers/components/customer-distributions";
import { CustomerList } from "@/features/customers/components/customer-list";
import { CustomerSummary } from "@/features/customers/components/customer-summary";
import { buildCustomerStats, getCustomerDistribution } from "@/features/customers/customer-selectors";
import type { CreateCustomerInput, Customer, CustomerFilters, CustomerWorkspaceResult, FollowUpKind, OpportunityStage } from "@/features/customers/customer-types";

const REQUEST_TIMEOUT_MS = 15_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const errorLabels: Record<string, string> = {
  unauthorized: "登录状态已失效，请重新登录。", forbidden: "当前账号没有执行此操作的权限。",
  not_found: "目标记录不存在或不在当前组织可见范围。", conflict: "数据已被其他人修改，请刷新后重试。",
  stale_version: "数据版本已更新，请刷新后重试。", invalid_stage: "当前商机阶段不允许执行此操作。",
  already_converted: "该商机已经创建过交付项目。", invalid_request: "提交内容不符合业务规则，请检查后重试。",
};

type CommandResource = "customer" | "customer_contact" | "customer_follow_up" | "opportunity" | "opportunity_conversion";
type CommandPayload = Record<string, unknown> & { error?: string };
type CommandResponse = { ok: true; payload: CommandPayload } | { ok: false; message: string; retryable: boolean };
type ExpectedCommand = {
  resource: CommandResource;
  targetId?: string;
  customerId?: string;
  opportunityId?: string | null;
  version?: number;
  stage?: OpportunityStage;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validCommandSuccess(payload: CommandPayload, expected: ExpectedCommand) {
  const { resource } = expected;
  if (payload.outcome !== "success" || payload.resource !== resource) return false;
  const key = { customer: "customer", customer_contact: "contact", customer_follow_up: "followUp", opportunity: "opportunity", opportunity_conversion: "conversion" }[resource];
  const entity = record(payload[key]);
  if (!entity) return false;
  if (resource === "opportunity_conversion") {
    const ids = [entity.opportunityId, entity.projectId, entity.customerProjectLinkId];
    return ids.every((id) => typeof id === "string" && UUID_PATTERN.test(id))
      && new Set(ids).size === ids.length
      && entity.opportunityId === expected.opportunityId
      && entity.opportunityVersion === expected.version
      && entity.projectVersion === 1;
  }
  if (typeof entity.id !== "string" || !UUID_PATTERN.test(entity.id)) return false;
  if (expected.targetId && entity.id !== expected.targetId) return false;
  if (expected.customerId && entity.customerId !== expected.customerId) return false;
  if ("opportunityId" in expected && entity.opportunityId !== expected.opportunityId) return false;
  if (expected.version !== undefined && entity.version !== expected.version) return false;
  if (expected.stage !== undefined && entity.stage !== expected.stage) return false;
  return true;
}

async function command(
  path: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
  idempotencyKey: string,
  expected: ExpectedCommand,
): Promise<CommandResponse> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(path, {
      method, signal: controller.signal,
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({})) as CommandPayload;
    if (!response.ok) {
      const retryable = response.status >= 500 || response.status === 408 || response.status === 429;
      return { ok: false, retryable, message: errorLabels[payload.error ?? ""] ?? (retryable
        ? "服务响应异常，保存结果尚未确认；请保持内容不变并重试核对。"
        : "操作未完成，请检查内容后重试。") };
    }
    if (!validCommandSuccess(payload, expected)) {
      return { ok: false, retryable: true, message: "服务响应不完整，保存结果尚未确认；请保持内容不变并重试核对。" };
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, retryable: true, message: "网络响应中断，保存结果尚未确认；请保持内容不变并重试核对。" };
  } finally {
    window.clearTimeout(timeout);
  }
}

export function CustomersWorkspace({ result }: { result: CustomerWorkspaceResult }) {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>(result.data.customers);
  const [filters, setFilters] = useState<CustomerFilters>(result.data.filters);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [detailCustomer, setDetailCustomer] = useState<Customer | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [pendingContactCustomerId, setPendingContactCustomerId] = useState<string | null>(null);
  const commandAttempts = useRef(new Map<string, string>());
  const detailRequest = useRef<{ generation: number; controller: AbortController | null }>({ generation: 0, controller: null });
  const filterTimer = useRef<number | null>(null);
  const stats = useMemo(() => buildCustomerStats(customers, result.data.pagination.total), [customers, result.data.pagination.total]);
  const selectedSummary = customers.find(({ id }) => id === selectedCustomerId) ?? null;

  useEffect(() => {
    setCustomers(result.data.customers);
    setFilters(result.data.filters);
  }, [result]);

  useEffect(() => () => {
    detailRequest.current.controller?.abort();
    if (filterTimer.current !== null) window.clearTimeout(filterTimer.current);
  }, []);

  async function submitCommand(
    path: string,
    method: "POST" | "PATCH",
    body: Record<string, unknown>,
    expected: ExpectedCommand,
  ) {
    const signature = `${method}:${path}:${JSON.stringify(body)}`;
    const idempotencyKey = commandAttempts.current.get(signature) ?? crypto.randomUUID();
    commandAttempts.current.set(signature, idempotencyKey);
    const response = await command(path, method, body, idempotencyKey, expected);
    if (response.ok || !response.retryable) commandAttempts.current.delete(signature);
    return response;
  }

  async function loadDetail(customerId: string) {
    detailRequest.current.controller?.abort();
    const generation = detailRequest.current.generation + 1;
    const controller = new AbortController();
    detailRequest.current = { generation, controller };
    setDetailLoading(true); setDetailError("");
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`/api/workstation/customers/${customerId}`, { signal: controller.signal, cache: "no-store" });
      const payload = await response.json().catch(() => ({})) as CommandPayload;
      const customer = record(payload.customer) as Customer | null;
      if (!response.ok || payload.outcome !== "success" || payload.resource !== "customer_detail"
        || !customer || customer.id !== customerId || customer.detailState !== "complete") {
        if (detailRequest.current.generation === generation) {
          setDetailError(errorLabels[payload.error ?? ""] ?? "客户详情暂时不可用，请重试。");
        }
        return;
      }
      if (detailRequest.current.generation === generation) setDetailCustomer(customer);
    } catch {
      if (detailRequest.current.generation === generation) {
        setDetailError("客户详情请求超时或网络中断，请重试。");
      }
    } finally {
      window.clearTimeout(timeout);
      if (detailRequest.current.generation === generation) {
        detailRequest.current.controller = null;
        setDetailLoading(false);
      }
    }
  }

  function sync(message: string, customerId?: string) {
    setFeedback(message);
    router.refresh();
    if (customerId && isDetailOpen) void loadDetail(customerId);
  }

  async function createCustomer(input: CreateCustomerInput) {
    let customerId = pendingContactCustomerId;
    if (!customerId) {
      const customerResult = await submitCommand("/api/workstation/customers", "POST", {
        name: input.name, registrationCode: input.registrationCode || null,
        ownerEmployeePublicId: input.ownerEmployeePublicId, industry: input.industry,
        source: input.source, region: input.region, status: "lead", version: 0, reason: "创建客户档案",
      }, { resource: "customer", version: 1 });
      if (!customerResult.ok) return customerResult;
      const customer = record(customerResult.payload.customer);
      customerId = typeof customer?.id === "string" ? customer.id : null;
      if (!customerId) return { ok: false as const, message: "服务返回的客户标识无效，请刷新核对。", retryable: true };
      setPendingContactCustomerId(customerId);
    }
    const contactResult = await submitCommand(`/api/workstation/customers/${customerId}/contacts`, "POST", {
      name: input.contactName, title: input.contactTitle, phone: input.phone || null,
      email: input.email || null, visibility: "assigned", isPrimary: true,
      version: 0, reason: "创建客户主联系人",
    }, { resource: "customer_contact", customerId, version: 1 });
    if (!contactResult.ok) return { ...contactResult, customerCreated: true };
    setPendingContactCustomerId(null);
    sync("客户与主联系人已写入，正在刷新列表");
    return { ok: true as const };
  }

  async function addContact(customerId: string, input: { name: string; title: string; phone: string; email: string; isPrimary: boolean }) {
    const response = await submitCommand(`/api/workstation/customers/${customerId}/contacts`, "POST", {
      name: input.name, title: input.title, phone: input.phone || null, email: input.email || null,
      visibility: "assigned", isPrimary: input.isPrimary, version: 0, reason: "补充客户联系人",
    }, { resource: "customer_contact", customerId, version: 1 });
    if (response.ok) sync("联系人已写入，正在同步客户详情", customerId);
    return response;
  }

  async function addFollowUp(customerId: string, input: { opportunityId: string | null; kind: FollowUpKind; content: string; nextFollowUpAt: string | null }) {
    const response = await submitCommand(`/api/workstation/customers/${customerId}/follow-ups`, "POST", {
      ...input, version: 0, reason: "记录客户跟进",
    }, { resource: "customer_follow_up", customerId, opportunityId: input.opportunityId });
    if (response.ok) sync("跟进记录已写入，正在同步客户详情", customerId);
    return response;
  }

  async function createOpportunity(customerId: string, input: { name: string; ownerEmployeePublicId: string; amount: string; expectedCloseOn: string | null }) {
    const response = await submitCommand(`/api/workstation/customers/${customerId}/opportunities`, "POST", {
      ...input, currency: "CNY", version: 0, reason: "创建客户商机",
    }, { resource: "opportunity", customerId, version: 1, stage: "lead" });
    if (response.ok) sync("商机已创建，正在同步客户详情", customerId);
    return response;
  }

  async function transitionOpportunity(opportunityId: string, stage: OpportunityStage, expectedVersion: number, lossReason: string | null) {
    const response = await submitCommand(`/api/workstation/opportunities/${opportunityId}`, "PATCH", {
      stage, lossReason, expectedVersion, reason: `推进商机至${stage}`,
    }, {
      resource: "opportunity", targetId: opportunityId, customerId: selectedCustomerId ?? undefined,
      version: expectedVersion + 1, stage,
    });
    if (response.ok && selectedCustomerId) sync("商机阶段已更新，正在同步客户详情", selectedCustomerId);
    return response;
  }

  async function convertOpportunity(opportunityId: string, expectedVersion: number, input: { projectName: string; description: string; startsOn: string; dueOn: string }) {
    const response = await submitCommand(`/api/workstation/opportunities/${opportunityId}/convert`, "POST", {
      ...input, category: "客户交付", status: "active", priority: "medium",
      expectedVersion, reason: "赢单商机转交付项目",
    }, { resource: "opportunity_conversion", opportunityId, version: expectedVersion + 1 });
    if (response.ok && selectedCustomerId) sync("交付项目已创建并关联，正在刷新详情", selectedCustomerId);
    return response;
  }

  function openCustomer(customer: Customer) {
    setSelectedCustomerId(customer.id); setDetailCustomer(null); setDetailError(""); setIsDetailOpen(true);
    void loadDetail(customer.id);
  }

  function customerPath(nextFilters: CustomerFilters, page = 1) {
    const params = new URLSearchParams();
    if (nextFilters.query.trim()) params.set("q", nextFilters.query.trim());
    if (nextFilters.status !== "all") params.set("status", nextFilters.status);
    if (nextFilters.source !== "all") params.set("source", nextFilters.source);
    if (nextFilters.industry !== "all") params.set("industry", nextFilters.industry);
    if (page > 1) params.set("page", String(page));
    const query = params.toString();
    return query ? `/customers?${query}` : "/customers";
  }

  function changeFilters(nextFilters: CustomerFilters) {
    const queryChanged = nextFilters.query !== filters.query;
    setFilters(nextFilters);
    if (filterTimer.current !== null) window.clearTimeout(filterTimer.current);
    if (queryChanged) {
      filterTimer.current = window.setTimeout(() => {
        filterTimer.current = null;
        router.push(customerPath(nextFilters));
      }, 300);
    } else {
      filterTimer.current = null;
      router.push(customerPath(nextFilters));
    }
  }

  function changeDetailOpen(open: boolean) {
    setIsDetailOpen(open);
    if (!open) {
      detailRequest.current.controller?.abort();
      detailRequest.current = { generation: detailRequest.current.generation + 1, controller: null };
      setDetailLoading(false);
      setDetailError("");
    }
  }

  function changeCreateOpen(open: boolean) {
    setIsCreateOpen(open);
    if (!open && pendingContactCustomerId) {
      setPendingContactCustomerId(null);
      sync("客户档案已创建，主联系人待补充；可从客户详情继续完成。");
    }
  }

  const displayedDetail = detailCustomer?.id === selectedCustomerId ? detailCustomer : selectedSummary;
  const { pagination } = result.data;
  return (
    <main className="mx-auto flex w-full max-w-420 flex-col gap-3 px-3 pt-4 pb-26 sm:px-4 lg:px-5 lg:pt-8 lg:pb-8">
      <PageHeader title="客户管理" description="真实客户、联系人、商机、跟进与交付项目统一管理。" actions={result.data.canManage ? <Button type="button" size="lg" className="h-10 rounded-xl px-4 shadow-[0_10px_24px_rgba(47,125,246,0.24)]" onClick={() => setIsCreateOpen(true)}><Plus data-icon="inline-start" />新建客户</Button> : undefined} />
      {result.data.loadError ? <section role="alert" className="flex flex-col gap-3 rounded-2xl border border-warning/30 bg-warning-soft p-4 sm:flex-row sm:items-center"><div className="flex-1"><p className="font-semibold text-warning">客户数据未加载</p><p className="mt-1 text-sm text-muted-foreground">{result.data.loadError}</p></div><Button type="button" variant="outline" onClick={() => router.refresh()}><RefreshCw />重新加载</Button></section> : null}
      {feedback ? <p role="status" className="rounded-xl bg-success-soft px-3 py-2 text-xs font-medium text-success">{feedback}</p> : null}
      {!result.data.loadError ? <>
        <CustomerSummary stats={stats} />
        <CustomerList customers={customers} industryOptions={result.data.industryOptions} total={pagination.total} filters={filters} onFiltersChange={changeFilters} onOpenCustomer={openCustomer} />
        <nav aria-label="客户分页" className="flex items-center justify-between rounded-2xl border border-border/70 bg-background/70 px-3 py-2"><p className="text-xs text-muted-foreground">第 {pagination.page} 页 · 共 {pagination.total} 家</p><div className="flex gap-2"><Button type="button" size="sm" variant="outline" disabled={!pagination.hasPrevious} onClick={() => router.push(customerPath(filters, pagination.page - 1))}><ChevronLeft />上一页</Button><Button type="button" size="sm" variant="outline" disabled={!pagination.hasNext} onClick={() => router.push(customerPath(filters, pagination.page + 1))}>下一页<ChevronRight /></Button></div></nav>
        <div className="hidden lg:block"><CustomerDistributions source={getCustomerDistribution(customers, "source")} industry={getCustomerDistribution(customers, "industry")} region={getCustomerDistribution(customers, "region")} /></div>
      </> : null}
      <CreateCustomerDialog open={isCreateOpen} onOpenChange={changeCreateOpen} owners={result.data.availableOwners} onCreate={createCustomer} />
      <CustomerDetailDialog customer={displayedDetail} owners={result.data.availableOwners} open={isDetailOpen} onOpenChange={changeDetailOpen} canManage={result.data.canManage} canConvertToProject={result.data.canConvertToProject} loading={detailLoading} loadError={detailError} onRetry={() => selectedCustomerId && loadDetail(selectedCustomerId)} onAddContact={addContact} onAddFollowUp={addFollowUp} onCreateOpportunity={createOpportunity} onTransition={transitionOpportunity} onConvert={convertOpportunity} />
    </main>
  );
}
