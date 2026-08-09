import { mockDepartments, mockEmployees } from "@/features/hr/employee-mock-data";
import type { SalaryRecord, SalaryResult, SalaryStatus } from "@/features/salary/salary-types";

const seeds = [
  { employeeIndex: 0, base: 25000, bonus: 8000, deductions: 2500, status: "paid" as const },
  { employeeIndex: 1, base: 18000, bonus: 4500, deductions: 1800, status: "paid" as const },
  { employeeIndex: 2, base: 22000, bonus: 6000, deductions: 2200, status: "paid" as const },
  { employeeIndex: 3, base: 16000, bonus: 3800, deductions: 1500, status: "paid" as const },
  { employeeIndex: 4, base: 12000, bonus: 2500, deductions: 1100, status: "processing" as const },
  { employeeIndex: 5, base: 15000, bonus: 3200, deductions: 1400, status: "processing" as const },
  { employeeIndex: 6, base: 14500, bonus: 3000, deductions: 1300, status: "draft" as const },
  { employeeIndex: 7, base: 19000, bonus: 5000, deductions: 2000, status: "paid" as const },
];

function history(netSalary: number): SalaryRecord["history"] {
  const months = ["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"];
  return months.map((month, index) => ({
    month,
    netSalary: netSalary - (5 - index) * 180 + (index % 2 === 0 ? 120 : 0),
    status: index === 5 ? "paid" : "paid" as SalaryStatus,
  }));
}

const records: SalaryRecord[] = seeds.map((seed, index) => {
  const employeeItem = mockEmployees[seed.employeeIndex];
  const netSalary = seed.base + seed.bonus - seed.deductions;
  const socialInsurance = Math.round(seed.deductions * 0.62);
  return {
    id: `91000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    employee: {
      id: employeeItem.profile.id,
      employeeNo: employeeItem.profile.employeeNo,
      displayName: employeeItem.profile.displayName,
      jobTitle: employeeItem.profile.jobTitle,
      avatarUrl: employeeItem.profile.avatarUrl,
    },
    department: employeeItem.department
      ? { id: employeeItem.department.id, name: employeeItem.department.name }
      : { id: "unassigned", name: "待分配" },
    month: "2026-08",
    baseSalary: seed.base,
    bonus: seed.bonus,
    deductions: seed.deductions,
    netSalary,
    status: seed.status,
    paidAt: seed.status === "paid" ? "2026-08-25 10:00" : undefined,
    breakdown: [
      { label: "基础工资", amount: seed.base, kind: "income" },
      { label: "绩效奖金", amount: seed.bonus, kind: "income" },
      { label: "社保与公积金", amount: socialInsurance, kind: "deduction" },
      { label: "个税及其他扣款", amount: seed.deductions - socialInsurance, kind: "deduction" },
    ],
    history: history(netSalary),
  };
});

export const salaryMockResult: SalaryResult = {
  source: "mock",
  data: {
    records,
    departments: mockDepartments.map(({ id, name }) => ({ id, name })),
    stats: { totalSalary: 2568420, employeeCount: 128, averageSalary: 20065.78 },
  },
};
