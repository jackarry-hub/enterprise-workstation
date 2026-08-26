import { RotateCcw, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  Department,
  EmployeeDirectoryFilters,
  EmploymentStatus,
} from "@/features/hr/employee-types";

const statusOptions: Array<{ value: EmploymentStatus | "all"; label: string }> = [
  { value: "all", label: "全部状态" },
  { value: "active", label: "在职" },
  { value: "probation", label: "试用期" },
  { value: "on_leave", label: "休假中" },
  { value: "departed", label: "已离职" },
];

type EmployeeFiltersProps = {
  departments: Department[];
  filters: EmployeeDirectoryFilters;
  onFiltersChange: (filters: EmployeeDirectoryFilters) => void;
  onReset: () => void;
};

export function EmployeeFilters({
  departments,
  filters,
  onFiltersChange,
  onReset,
}: EmployeeFiltersProps) {
  const hasFilters = filters.query !== ""
    || filters.departmentId !== "all"
    || filters.status !== "all";

  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
      <div className="relative min-w-0 flex-1">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={filters.query}
          onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })}
          aria-label="搜索员工"
          placeholder="搜索姓名、工号或岗位"
          className="h-10 rounded-xl border-input/80 bg-background/75 pl-9 shadow-none"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:flex">
        <Select
          value={filters.departmentId}
          onValueChange={(value) => onFiltersChange({ ...filters, departmentId: value })}
        >
          <SelectTrigger aria-label="筛选部门" className="h-10 w-full bg-background/75 sm:w-40">
            <SelectValue placeholder="全部部门" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部部门</SelectItem>
            {departments.map((department) => (
              <SelectItem key={department.id} value={department.id}>
                {department.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={filters.status}
          onValueChange={(value) => onFiltersChange({
            ...filters,
            status: value as EmployeeDirectoryFilters["status"],
          })}
        >
          <SelectTrigger aria-label="筛选员工状态" className="h-10 w-full bg-background/75 sm:w-34">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            {statusOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onReset}
        disabled={!hasFilters}
        className="h-10 justify-center rounded-xl px-3 text-muted-foreground"
      >
        <RotateCcw data-icon="inline-start" aria-hidden="true" />
        重置筛选
      </Button>
    </div>
  );
}
