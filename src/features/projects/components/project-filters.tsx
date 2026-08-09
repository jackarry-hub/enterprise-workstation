import {
  CalendarRange,
  RotateCcw,
  Search,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  MemberSummary,
  ProjectDeadlineFilter,
  ProjectListFilters,
  ProjectListGroup,
  ProjectListPriorityFilter,
  ProjectListStatusFilter,
} from "@/features/projects/types";

const groupItems: Array<{ value: ProjectListGroup; label: string }> = [
  { value: "all", label: "全部项目" },
  { value: "responsible", label: "我负责的" },
  { value: "involved", label: "我参与的" },
  { value: "following", label: "我关注的" },
  { value: "completed", label: "已完成" },
];

const statusFilterLabels: Record<ProjectListStatusFilter, string> = {
  all: "全部状态",
  active: "进行中",
  planning: "规划中",
  on_hold: "已暂停",
  completed: "已完成",
  cancelled: "已取消",
};

const priorityFilterLabels: Record<ProjectListPriorityFilter, string> = {
  all: "全部优先级",
  critical: "紧急",
  high: "高",
  medium: "中",
  low: "低",
};

type ProjectFiltersProps = {
  filters: ProjectListFilters;
  owners: readonly MemberSummary[];
  onFiltersChange: (filters: ProjectListFilters) => void;
  onReset: () => void;
};

export function ProjectFilters({
  filters,
  owners,
  onFiltersChange,
  onReset,
}: ProjectFiltersProps) {
  const update = <Key extends keyof ProjectListFilters>(
    key: Key,
    value: ProjectListFilters[Key],
  ) => onFiltersChange({ ...filters, [key]: value });

  return (
    <div className="flex flex-col gap-3">
      <div className="min-w-0 border-b border-glass-border pb-3">
        <div className="scrollbar-none overflow-x-auto pb-1">
          <Tabs
            value={filters.group}
            onValueChange={(value) => update("group", value as ProjectListGroup)}
          >
            <TabsList variant="line" aria-label="项目分组" className="min-w-max">
              {groupItems.map((item) => (
                <TabsTrigger key={item.value} value={item.value}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      </div>

      <div className="flex flex-col gap-2 xl:flex-row xl:items-center">
        <div className="scrollbar-none flex min-w-0 gap-2 overflow-x-auto pb-1 xl:flex-1">
          <Select
            value={filters.status}
            onValueChange={(value) => update("status", value as ProjectListStatusFilter)}
          >
            <SelectTrigger aria-label="项目状态筛选" className="min-w-31">
              {statusFilterLabels[filters.status]}
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">全部状态</SelectItem>
                <SelectItem value="active">进行中</SelectItem>
                <SelectItem value="planning">规划中</SelectItem>
                <SelectItem value="on_hold">已暂停</SelectItem>
                <SelectItem value="completed">已完成</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>

          <Select
            value={filters.priority}
            onValueChange={(value) => update("priority", value as ProjectListPriorityFilter)}
          >
            <SelectTrigger aria-label="项目优先级筛选" className="min-w-29">
              {priorityFilterLabels[filters.priority]}
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">全部优先级</SelectItem>
                <SelectItem value="critical">紧急</SelectItem>
                <SelectItem value="high">高</SelectItem>
                <SelectItem value="medium">中</SelectItem>
                <SelectItem value="low">低</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>

          <Select value={filters.ownerId} onValueChange={(value) => update("ownerId", value)}>
            <SelectTrigger aria-label="项目负责人筛选" className="min-w-31">
              {filters.ownerId === "all" ? "全部负责人" : owners.find(({ id }) => id === filters.ownerId)?.displayName}
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">全部负责人</SelectItem>
                {owners.map((owner) => (
                  <SelectItem key={owner.id} value={owner.id}>
                    {owner.displayName}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>

          <Select
            value={filters.deadline}
            onValueChange={(value) => update("deadline", value as ProjectDeadlineFilter)}
          >
            <SelectTrigger aria-label="项目截止日期筛选" className="min-w-31">
              <CalendarRange aria-hidden="true" />
              {filters.deadline === "all" ? "全部日期" : filters.deadline === "this_month" ? "本月到期" : filters.deadline === "next_month" ? "下月到期" : "已经逾期"}
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectItem value="all">全部日期</SelectItem>
                <SelectItem value="this_month">本月到期</SelectItem>
                <SelectItem value="next_month">下月到期</SelectItem>
                <SelectItem value="overdue">已经逾期</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        <div className="flex min-w-0 items-center gap-2 sm:min-w-82">
          <div className="relative min-w-0 flex-1">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="search"
              role="searchbox"
              aria-label="搜索项目"
              placeholder="搜索项目名称"
              value={filters.query}
              onChange={(event) => update("query", event.target.value)}
              className="h-9 rounded-xl bg-background/70 pl-9"
            />
          </div>
          <Button type="button" variant="ghost" aria-label="重置筛选" onClick={onReset}>
            <RotateCcw data-icon="inline-start" aria-hidden="true" />
            <span className="hidden sm:inline">重置筛选</span>
          </Button>
        </div>
      </div>
    </div>
  );
}
