import { TabsList, TabsTrigger } from "@/components/ui/tabs";

export const projectDetailTabs = [
  { value: "overview", label: "概览" },
  { value: "milestones", label: "里程碑" },
  { value: "tasks", label: "任务" },
  { value: "sop", label: "SOP" },
  { value: "decisions", label: "决策板" },
  { value: "gantt", label: "甘特图" },
  { value: "files", label: "文件" },
  { value: "reports", label: "日报" },
  { value: "retrospective", label: "复盘" },
] as const;

export type ProjectDetailTab = (typeof projectDetailTabs)[number]["value"];

export function ProjectDetailTabs() {
  return (
    <div className="scrollbar-none overflow-x-auto rounded-2xl border border-glass-border bg-glass px-2 shadow-[0_12px_32px_rgba(44,84,142,0.06)] backdrop-blur-xl sm:px-4">
      <TabsList variant="line" aria-label="项目详情导航" className="h-13 min-w-max gap-1 sm:gap-3">
        {projectDetailTabs.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value} className="h-11 min-w-18 px-4 text-sm">
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
    </div>
  );
}
