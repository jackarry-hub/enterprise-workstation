import { Banknote, Calculator, UsersRound } from "lucide-react";

import { DataCard } from "@/components/ui/data-card";
import { formatSalaryCurrency } from "@/features/salary/salary-meta";
import type { SalaryStats } from "@/features/salary/salary-types";

export function PayrollStats({ stats }: { stats: SalaryStats }) {
  return (
    <section aria-label="薪资统计" className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      <DataCard compact icon={Banknote} label="本月工资总额" value={formatSalaryCurrency(stats.totalSalary)} trendLabel="当前月份" tone="blue" />
      <DataCard compact icon={UsersRound} label="员工数量" value={String(stats.employeeCount)} trendLabel="当前工资单" tone="purple" />
      <DataCard compact icon={Calculator} label="平均工资" value={formatSalaryCurrency(stats.averageSalary)} trendLabel="当前月份" tone="green" />
    </section>
  );
}
