import { Building2, MapPinned, RadioTower } from "lucide-react";

import { GlassCard } from "@/components/ui/glass-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import type { CustomerDistributionItem } from "@/features/customers/customer-types";

function DistributionCard({ title, icon: Icon, items }: { title: string; icon: typeof RadioTower; items: readonly CustomerDistributionItem[] }) {
  return (
    <GlassCard className="p-4 sm:p-5"><div className="flex items-center gap-2"><Icon className="size-4 text-primary" /><h2 className="text-base font-semibold">{title}</h2></div><div className="mt-4 space-y-3">{items.slice(0, 5).map((item) => <div key={item.label}><div className="mb-1.5 flex items-center justify-between text-sm"><span className="text-muted-foreground">{item.label}</span><span className="font-medium">{item.percentage}%</span></div><ProgressBar value={item.percentage} className="h-1.5" /></div>)}</div></GlassCard>
  );
}

export function CustomerDistributions({ source, industry, region }: { source: readonly CustomerDistributionItem[]; industry: readonly CustomerDistributionItem[]; region: readonly CustomerDistributionItem[] }) {
  return <section className="grid gap-3 xl:grid-cols-3"><DistributionCard title="客户来源分布" icon={RadioTower} items={source} /><DistributionCard title="行业分布 TOP 5" icon={Building2} items={industry} /><DistributionCard title="地区分布" icon={MapPinned} items={region} /></section>;
}
