import { CircleDollarSign, TrendingUp, UserPlus, UsersRound } from "lucide-react";

import { DataCard } from "@/components/ui/data-card";
import type { CustomerStats } from "@/features/customers/customer-types";

export function CustomerSummary({ stats }: { stats: CustomerStats }) {
  return (
    <section aria-label="客户统计" className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
      <div data-testid="customer-total"><DataCard compact icon={UsersRound} label="客户总数" value={String(stats.total)} trend="+8.6%" trendLabel="较上月" tone="blue" /></div>
      <DataCard compact icon={UserPlus} label="本月新增" value={String(stats.addedThisMonth)} trend="+15.3%" trendLabel="较上月" tone="indigo" />
      <DataCard compact icon={TrendingUp} label="跟进中" value={String(stats.following)} trend="+6.1%" trendLabel="较上月" tone="cyan" />
      <DataCard compact icon={CircleDollarSign} label="已成交金额" value={`¥${(stats.dealAmount / 10000).toFixed(1)}万`} trend="+22.7%" trendLabel="较上月" tone="green" />
    </section>
  );
}
