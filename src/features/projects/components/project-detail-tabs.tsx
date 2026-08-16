import { Check, ChevronDown } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export const projectDetailTabs = [
  { value: "overview", label: "概览" },
  { value: "milestones", label: "里程碑" },
  { value: "tasks", label: "任务" },
  { value: "gantt", label: "甘特图" },
  { value: "files", label: "文件" },
  { value: "reports", label: "日报" },
  { value: "retrospective", label: "复盘" },
] as const;

export type ProjectDetailTab = (typeof projectDetailTabs)[number]["value"];

const mobilePrimaryTabs = [
  { value: "overview", label: "概览" },
  { value: "tasks", label: "任务" },
  { value: "reports", label: "动态" },
] as const satisfies ReadonlyArray<{ value: ProjectDetailTab; label: string }>;

const mobileMoreTabs = [
  { value: "milestones", label: "里程碑" },
  { value: "gantt", label: "计划进度" },
  { value: "files", label: "项目文件" },
  { value: "retrospective", label: "项目复盘" },
] as const satisfies ReadonlyArray<{ value: ProjectDetailTab; label: string }>;

export function ProjectDetailTabs({
  activeTab,
  onTabChange,
}: {
  activeTab: ProjectDetailTab;
  onTabChange: (tab: ProjectDetailTab) => void;
}) {
  const activeMoreTab = mobileMoreTabs.find(({ value }) => value === activeTab);

  return (
    <>
      <nav aria-label="移动端项目导航" className="project-detail-mobile-tabs md:hidden">
        {mobilePrimaryTabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            aria-current={activeTab === tab.value ? "page" : undefined}
            onClick={() => onTabChange(tab.value)}
          >
            {tab.label}
          </button>
        ))}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-current={activeMoreTab ? "page" : undefined}>
              <span>{activeMoreTab?.label ?? "更多"}</span>
              <ChevronDown aria-hidden="true" className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40 rounded-2xl border-border/80 p-1.5">
            {mobileMoreTabs.map((tab) => (
              <DropdownMenuItem
                key={tab.value}
                onSelect={() => onTabChange(tab.value)}
                className="min-h-11 rounded-xl px-3"
              >
                <span className="flex-1">{tab.label}</span>
                <Check aria-hidden="true" className={cn("size-4 text-primary", activeTab === tab.value ? "opacity-100" : "opacity-0")} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </nav>

      <div className="hidden rounded-2xl border border-glass-border bg-glass p-2 shadow-[0_12px_32px_rgba(44,84,142,0.06)] backdrop-blur-xl md:block lg:px-4">
        <TabsList variant="line" aria-label="项目详情导航" className="grid h-auto w-full grid-cols-7 gap-0.5 lg:flex lg:h-13 lg:gap-3">
          {projectDetailTabs.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="h-10 min-w-0 px-0 text-[11px] lg:h-11 lg:min-w-18 lg:px-4 lg:text-sm">
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
    </>
  );
}
