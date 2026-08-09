import { RotateCcw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { salaryStatusMeta } from "@/features/salary/salary-meta";
import type { SalaryFilters, SalaryStatus } from "@/features/salary/salary-types";

export function PayrollFilters({ departments, filters, onChange, onReset }: {
  departments: Array<{ id: string; name: string }>;
  filters: SalaryFilters;
  onChange: (filters: SalaryFilters) => void;
  onReset: () => void;
}) {
  const hasFilters = filters.query !== "" || filters.departmentId !== "all" || filters.month !== "2026-08" || filters.status !== "all";
  return (
    <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_150px_160px_140px_auto] lg:items-center">
      <div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input type="search" aria-label="搜索工资员工" placeholder="搜索姓名、工号或部门" value={filters.query} onChange={(event) => onChange({ ...filters, query: event.target.value })} className="h-10 rounded-xl bg-background/75 pl-9" /></div>
      <Input type="month" aria-label="选择工资月份" value={filters.month === "all" ? "" : filters.month} onChange={(event) => onChange({ ...filters, month: event.target.value || "all" })} className="h-10 rounded-xl bg-background/75" />
      <Select value={filters.departmentId} onValueChange={(value) => onChange({ ...filters, departmentId: value })}>
        <SelectTrigger aria-label="筛选工资部门" className="h-10 w-full bg-background/75"><SelectValue placeholder="全部部门" /></SelectTrigger>
        <SelectContent><SelectItem value="all">全部部门</SelectItem>{departments.map((department) => <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>)}</SelectContent>
      </Select>
      <Select value={filters.status} onValueChange={(value) => onChange({ ...filters, status: value as SalaryFilters["status"] })}>
        <SelectTrigger aria-label="筛选工资状态" className="h-10 w-full bg-background/75"><SelectValue placeholder="全部状态" /></SelectTrigger>
        <SelectContent><SelectItem value="all">全部状态</SelectItem>{(Object.keys(salaryStatusMeta) as SalaryStatus[]).map((status) => <SelectItem key={status} value={status}>{salaryStatusMeta[status].label}</SelectItem>)}</SelectContent>
      </Select>
      <Button type="button" variant="ghost" size="sm" onClick={onReset} disabled={!hasFilters} className="h-10 rounded-xl text-muted-foreground"><RotateCcw data-icon="inline-start" aria-hidden="true" />重置</Button>
    </div>
  );
}
