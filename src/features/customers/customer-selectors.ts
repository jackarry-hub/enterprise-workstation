import type { Customer, CustomerDistributionItem, CustomerFilters } from "@/features/customers/customer-types";

const labels = {
  consulting: "官网咨询", referral: "客户推荐", event: "市场活动", outbound: "行业展会",
  technology: "信息技术", manufacturing: "制造业", finance: "金融服务", retail: "零售消费",
} as const;

export function filterCustomers(customers: readonly Customer[], filters: CustomerFilters) {
  const query = filters.query.trim().toLocaleLowerCase("zh-CN");
  return customers.filter((customer) => {
    const searchText = [customer.name, customer.contact.name, customer.contact.phone, customer.owner.displayName].join(" ").toLocaleLowerCase("zh-CN");
    return (query === "" || searchText.includes(query))
      && (filters.status === "all" || customer.status === filters.status)
      && (filters.source === "all" || customer.source === filters.source)
      && (filters.industry === "all" || customer.industry === filters.industry);
  });
}

export function buildCustomerStats(customers: readonly Customer[]) {
  return {
    total: customers.length,
    addedThisMonth: customers.filter(({ createdAt }) => createdAt.startsWith("2026-08")).length,
    following: customers.filter(({ status }) => ["following", "proposal", "negotiating"].includes(status)).length,
    won: customers.filter(({ status }) => status === "won").length,
    dealAmount: customers.filter(({ status }) => status === "won").reduce((sum, customer) => sum + customer.dealAmount, 0),
  };
}

export function getCustomerDistribution(
  customers: readonly Customer[],
  key: "source" | "industry" | "region",
): CustomerDistributionItem[] {
  const groups = new Map<string, number>();
  for (const customer of customers) {
    groups.set(customer[key], (groups.get(customer[key]) ?? 0) + 1);
  }
  return [...groups.entries()]
    .map(([value, count]) => ({
      label: value in labels ? labels[value as keyof typeof labels] : value,
      value: count,
      percentage: customers.length ? Math.round((count / customers.length) * 100) : 0,
    }))
    .sort((left, right) => right.value - left.value);
}
