export type SalaryStatus = "draft" | "processing" | "paid";

export type SalaryEmployee = {
  id: string;
  employeeNo: string;
  displayName: string;
  jobTitle: string;
  avatarUrl?: string;
};

export type SalaryBreakdownItem = {
  label: string;
  amount: number;
  kind: "income" | "deduction";
};

export type SalaryHistoryItem = {
  month: string;
  netSalary: number;
  status: SalaryStatus;
};

export type SalaryRecord = {
  id: string;
  employee: SalaryEmployee;
  department: { id: string; name: string };
  month: string;
  baseSalary: number;
  bonus: number;
  deductions: number;
  netSalary: number;
  status: SalaryStatus;
  paidAt?: string;
  breakdown: SalaryBreakdownItem[];
  history: SalaryHistoryItem[];
};

export type SalaryStats = {
  totalSalary: number;
  employeeCount: number;
  averageSalary: number;
};

export type SalaryFilters = {
  query: string;
  departmentId: string | "all";
  month: string | "all";
  status: SalaryStatus | "all";
};

export type SalaryResult = {
  source: "mock" | "supabase";
  data: {
    records: SalaryRecord[];
    departments: Array<{ id: string; name: string }>;
    stats: SalaryStats;
    loadError?: string;
  };
};
