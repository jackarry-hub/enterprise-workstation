"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { CreateCustomerDialog } from "@/features/customers/components/create-customer-dialog";
import { CustomerDetailDialog } from "@/features/customers/components/customer-detail-dialog";
import { CustomerDistributions } from "@/features/customers/components/customer-distributions";
import { CustomerList } from "@/features/customers/components/customer-list";
import { CustomerActivityCard, CustomerReminderCard, SalesFunnelCard } from "@/features/customers/components/customer-side-panels";
import { CustomerSummary } from "@/features/customers/components/customer-summary";
import { readCustomers, saveCustomers } from "@/features/customers/customer-repository";
import { buildCustomerStats, filterCustomers, getCustomerDistribution } from "@/features/customers/customer-selectors";
import type { CreateCustomerInput, Customer, CustomerFilters } from "@/features/customers/customer-types";
import { getDefaultProjectDetails } from "@/features/projects/data/effective-project-details";
import { mockMembers } from "@/features/projects/mock-data";

const defaultFilters: CustomerFilters = { query: "", status: "all", source: "all", industry: "all" };
const projects = getDefaultProjectDetails();

export function CustomersWorkspace() {
  const [customers, setCustomers] = useState<Customer[]>(readCustomers);
  const [filters, setFilters] = useState<CustomerFilters>(defaultFilters);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const filteredCustomers = useMemo(() => filterCustomers(customers, filters), [customers, filters]);
  const stats = useMemo(() => buildCustomerStats(customers), [customers]);

  useEffect(() => setCustomers(readCustomers()), []);

  function persistCustomers(next: Customer[]) {
    setCustomers(saveCustomers(next));
  }

  function createCustomer(input: CreateCustomerInput) {
    const customer: Customer = {
      id: `customer-local-${Date.now()}`,
      name: input.name,
      contact: { name: input.contactName, phone: input.phone || "待补充", email: "待补充", title: "联系人" },
      owner: mockMembers[0],
      status: "lead",
      source: input.source,
      industry: input.industry,
      region: "华东地区",
      lastContactAt: new Date().toISOString().slice(0, 10),
      nextFollowUpAt: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
      dealProgress: 10,
      dealAmount: 0,
      createdAt: new Date().toISOString().slice(0, 10),
      relatedProjectIds: [],
      activities: [{ id: `activity-local-${Date.now()}`, content: "创建客户档案并进入初步沟通", createdAt: "刚刚" }],
    };
    persistCustomers([customer, ...customers]);
    setFeedback("客户已创建，已加入跟进列表");
  }

  function updateCustomer(customerId: string, updater: (customer: Customer) => Customer) {
    const next = customers.map((customer) => customer.id === customerId ? updater(customer) : customer);
    persistCustomers(next);
    setSelectedCustomer((current) => current?.id === customerId ? next.find(({ id }) => id === customerId) ?? current : current);
  }

  function addFollowUp(customerId: string, content: string) {
    const now = new Date();
    updateCustomer(customerId, (customer) => ({ ...customer, lastContactAt: now.toISOString().slice(0, 10), nextFollowUpAt: new Date(now.valueOf() + 3 * 86_400_000).toISOString().slice(0, 10), activities: [{ id: `customer-activity-${Date.now()}`, content, createdAt: "刚刚" }, ...customer.activities] }));
    setFeedback("跟进记录已保存，并更新下次跟进日期");
  }

  function advanceCustomer(customerId: string) {
    const statusOrder: Customer["status"][] = ["lead", "following", "proposal", "negotiating", "won"];
    updateCustomer(customerId, (customer) => { const index = statusOrder.indexOf(customer.status); const status = statusOrder[Math.min(statusOrder.length - 1, index + 1)]; return { ...customer, status, dealProgress: status === "won" ? 100 : Math.max(customer.dealProgress, (index + 1) * 22), activities: [{ id: `customer-stage-${Date.now()}`, content: `客户阶段已推进至${status === "following" ? "持续跟进" : status === "proposal" ? "方案沟通" : status === "negotiating" ? "商务谈判" : "已成交"}`, createdAt: "刚刚" }, ...customer.activities] }; });
    setFeedback("客户阶段已推进");
  }

  function openCustomer(customer: Customer) {
    setSelectedCustomer(customer);
    setIsDetailOpen(true);
  }

  return (
    <main className="mx-auto flex w-full max-w-420 flex-col gap-3 px-3 pt-5 pb-26 sm:px-4 lg:px-5 lg:pt-8 lg:pb-8">
      <PageHeader title="客户管理" description="统一管理客户资源，持续跟进客户关系，驱动业务增长。" actions={<Button type="button" size="lg" className="h-10 rounded-xl px-4 shadow-[0_10px_24px_rgba(47,125,246,0.24)]" onClick={() => setIsCreateOpen(true)}><Plus data-icon="inline-start" />新建客户</Button>} />
      {feedback ? <p role="status" className="rounded-xl bg-success-soft px-3 py-2 text-xs font-medium text-success">{feedback}</p> : null}
      <CustomerSummary stats={stats} />
      <section className="grid min-w-0 gap-3 2xl:grid-cols-12">
        <div className="2xl:col-span-8"><CustomerList customers={filteredCustomers} filters={filters} onFiltersChange={setFilters} onOpenCustomer={openCustomer} /></div>
        <div className="grid gap-3 sm:grid-cols-2 2xl:col-span-4 2xl:grid-cols-2"><div className="sm:col-span-2"><SalesFunnelCard customers={customers} /></div><CustomerReminderCard customers={customers} onShowAll={() => { setFilters((current) => ({ ...current, status: "following" })); setFeedback("已筛选需要持续跟进的客户"); }} /><CustomerActivityCard customers={customers} onShowAll={() => setFeedback("已展示最近全部客户动态")} /></div>
      </section>
      <CustomerDistributions source={getCustomerDistribution(customers, "source")} industry={getCustomerDistribution(customers, "industry")} region={getCustomerDistribution(customers, "region")} />
      <CreateCustomerDialog open={isCreateOpen} onOpenChange={setIsCreateOpen} onCreate={createCustomer} />
      <CustomerDetailDialog customer={selectedCustomer} projects={projects} open={isDetailOpen} onOpenChange={setIsDetailOpen} onAddFollowUp={addFollowUp} onAdvance={advanceCustomer} />
    </main>
  );
}
