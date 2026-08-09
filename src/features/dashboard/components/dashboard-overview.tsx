import {
  CircleGauge,
  FolderKanban,
  ListChecks,
  Sun,
  UsersRound,
} from "lucide-react";

import { DataCard } from "@/components/ui/data-card";
import { PageHeader } from "@/components/ui/page-header";

export function DashboardOverview() {
  return (
    <section className="relative overflow-hidden rounded-3xl border border-glass-border bg-background px-4 py-5 shadow-[0_18px_50px_rgba(60,105,170,0.08)] sm:px-6 lg:px-7">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[url('/dashboard/welcome-space-bg.png')] bg-cover bg-[position:68%_center] opacity-95"
      />
      <div className="relative">
        <PageHeader
          title={
            <span className="flex items-center gap-2 [&>svg]:size-7">
              早上好，李总
              <Sun aria-hidden="true" className="text-warning" />
            </span>
          }
          description="祝您今天工作顺利，企业各项业务运行良好！"
        />
        <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <DataCard icon={UsersRound} label="企业员工" value="128" trend="+6.7%" trendLabel="较上月" tone="blue" />
          <DataCard icon={FolderKanban} label="进行项目" value="26" trend="+2" trendLabel="较上月" tone="cyan" />
          <DataCard icon={ListChecks} label="今日任务" value="86" trend="+12" trendLabel="较昨日" tone="indigo" />
          <DataCard icon={CircleGauge} label="整体完成率" value="92%" trend="+7.3%" trendLabel="较上周" tone="green" />
        </div>
      </div>
    </section>
  );
}
