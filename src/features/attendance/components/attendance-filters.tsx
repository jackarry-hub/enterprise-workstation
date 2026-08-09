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
import { attendanceStatusMeta } from "@/features/attendance/attendance-meta";
import type { AttendanceFilters as Filters, AttendanceStatus } from "@/features/attendance/attendance-types";

type AttendanceFiltersProps = {
  departments: Array<{ id: string; name: string }>;
  filters: Filters;
  onFiltersChange: (filters: Filters) => void;
  onReset: () => void;
};

export function AttendanceFilters({
  departments,
  filters,
  onFiltersChange,
  onReset,
}: AttendanceFiltersProps) {
  const hasFilters = filters.query !== ""
    || filters.departmentId !== "all"
    || filters.date !== "2026-08-04"
    || filters.status !== "all";

  return (
    <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_160px_160px_132px_auto] lg:items-center">
      <div className="relative min-w-0">
        <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          value={filters.query}
          onChange={(event) => onFiltersChange({ ...filters, query: event.target.value })}
          aria-label="搜索考勤员工"
          placeholder="搜索姓名、工号或部门"
          className="h-10 rounded-xl border-input/80 bg-background/75 pl-9 shadow-none"
        />
      </div>
      <Input
        type="date"
        value={filters.date === "all" ? "" : filters.date}
        onChange={(event) => onFiltersChange({ ...filters, date: event.target.value || "all" })}
        aria-label="选择考勤日期"
        className="h-10 rounded-xl border-input/80 bg-background/75 shadow-none"
      />
      <Select value={filters.departmentId} onValueChange={(value) => onFiltersChange({ ...filters, departmentId: value })}>
        <SelectTrigger aria-label="筛选考勤部门" className="h-10 w-full bg-background/75">
          <SelectValue placeholder="全部部门" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部部门</SelectItem>
          {departments.map((department) => (
            <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={filters.status} onValueChange={(value) => onFiltersChange({ ...filters, status: value as Filters["status"] })}>
        <SelectTrigger aria-label="筛选考勤状态" className="h-10 w-full bg-background/75">
          <SelectValue placeholder="全部状态" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">全部状态</SelectItem>
          {(Object.keys(attendanceStatusMeta) as AttendanceStatus[]).map((status) => (
            <SelectItem key={status} value={status}>{attendanceStatusMeta[status].label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button type="button" variant="ghost" size="sm" onClick={onReset} disabled={!hasFilters} className="h-10 rounded-xl px-3 text-muted-foreground">
        <RotateCcw data-icon="inline-start" aria-hidden="true" />
        重置
      </Button>
    </div>
  );
}
