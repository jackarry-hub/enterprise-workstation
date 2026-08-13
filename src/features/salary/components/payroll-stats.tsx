import { Banknote, Calculator, UsersRound } from "lucide-react";

import { formatSalaryCurrency } from "@/features/salary/salary-meta";
import type { SalaryStats } from "@/features/salary/salary-types";

const statsMeta = [
  { key: "totalSalary", icon: Banknote, label: "本月工资总额", tone: "blue" },
  { key: "employeeCount", icon: UsersRound, label: "员工数量", tone: "purple" },
  { key: "averageSalary", icon: Calculator, label: "平均工资", tone: "green" },
] as const;

export function PayrollStats({ stats }: { stats: SalaryStats }) {
  return (
    <section aria-label="薪资统计" data-mobile-layout="three-column" className="payroll-summary-grid">
      {statsMeta.map(({ key, icon: Icon, label, tone }) => {
        const rawValue = stats[key];
        const value = key === "employeeCount" ? String(rawValue) : formatSalaryCurrency(rawValue);
        const accessibleValue = key === "employeeCount" ? `${rawValue}人` : `${rawValue}元`;
        return (
          <article key={key} aria-label={`${label} ${accessibleValue}`} className={`payroll-summary-card is-${tone}`}>
            <span className="payroll-summary-card__icon"><Icon aria-hidden="true" className="size-4.5" /></span>
            <span className="min-w-0"><span className="block text-[11px] text-muted-foreground">{label}</span><strong title={value} className="mt-1 block truncate text-[15px] text-foreground">{value}</strong></span>
          </article>
        );
      })}
    </section>
  );
}
