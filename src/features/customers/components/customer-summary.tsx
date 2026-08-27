import { CircleDollarSign, TrendingUp, UserPlus, UsersRound } from "lucide-react";

import { DataCard } from "@/components/ui/data-card";
import type { CustomerStats } from "@/features/customers/customer-types";

export function CustomerSummary({ stats }: { stats: CustomerStats }) {
  const [integer, fraction] = stats.dealAmount.split(".");
  const formattedAmount = `¥${BigInt(integer).toLocaleString("zh-CN")}.${fraction}`;
  return (
    <section aria-label="客户统计" className="grid grid-cols-2 gap-2 sm:gap-3 2xl:grid-cols-4">
      <div data-testid="customer-total"><DataCard compact icon={UsersRound} label="客户总数" value={String(stats.total)} trendLabel="实时客户档案" tone="blue" /></div>
      <DataCard compact icon={UserPlus} label="当前页客户" value={String(stats.pageCount)} trendLabel="每页最多 30 家" tone="indigo" />
      <DataCard compact icon={TrendingUp} label="本页跟进中" value={String(stats.following)} trendLabel="当前页有效阶段" tone="cyan" />
      <DataCard compact icon={CircleDollarSign} label="本页赢单（CNY）" value={formattedAmount} trendLabel="按赢单商机精确汇总" tone="green" />
    </section>
  );
}
