import type { SalaryStatus } from "@/features/salary/salary-types";

export const salaryStatusMeta: Record<SalaryStatus, {
  label: string;
  tone: "active" | "success" | "warning" | "neutral";
}> = {
  draft: { label: "待处理", tone: "neutral" },
  processing: { label: "处理中", tone: "warning" },
  paid: { label: "已发放", tone: "success" },
};

export function formatSalaryCurrency(amount: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    minimumFractionDigits: 2,
  }).format(amount);
}
