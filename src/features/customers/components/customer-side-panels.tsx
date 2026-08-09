import { CalendarClock, MessageSquareText, Target } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import type { Customer } from "@/features/customers/customer-types";

export function SalesFunnelCard({ customers }: { customers: readonly Customer[] }) {
  const stages = [
    { label: "线索", count: customers.length, color: "bg-primary" },
    { label: "初步沟通", count: customers.filter(({ status }) => status !== "lead").length, color: "bg-chart-5" },
    { label: "需求确认", count: customers.filter(({ status }) => ["proposal", "negotiating", "won"].includes(status)).length, color: "bg-chart-3" },
    { label: "方案报价", count: customers.filter(({ status }) => ["negotiating", "won"].includes(status)).length, color: "bg-success" },
    { label: "成交", count: customers.filter(({ status }) => status === "won").length, color: "bg-warning" },
  ];
  const maximum = Math.max(...stages.map(({ count }) => count), 1);
  return (
    <GlassCard className="p-4 sm:p-5">
      <div className="flex items-center gap-2"><Target className="size-4 text-primary" /><h2 className="text-base font-semibold">销售漏斗</h2><Badge variant="info" className="ml-auto">本月</Badge></div>
      <div className="mt-4 space-y-3">{stages.map((stage) => <div key={stage.label} className="grid grid-cols-[5rem_1fr_2rem] items-center gap-2 text-sm"><span className="text-muted-foreground">{stage.label}</span><div className="h-3 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${stage.color}`} style={{ width: `${Math.max(10, (stage.count / maximum) * 100)}%` }} /></div><strong className="text-right">{stage.count}</strong></div>)}</div>
    </GlassCard>
  );
}

export function CustomerReminderCard({ customers, onShowAll }: { customers: readonly Customer[]; onShowAll: () => void }) {
  return (
    <GlassCard className="p-4 sm:p-5"><div className="flex items-center gap-2"><CalendarClock className="size-4 text-warning" /><h2 className="text-base font-semibold">待跟进提醒</h2><Button type="button" variant="link" size="sm" className="ml-auto" onClick={onShowAll}>查看全部</Button></div><div className="mt-2 divide-y divide-border/70">{customers.slice(0, 3).map((customer) => <div key={customer.id} className="py-2.5"><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-medium">{customer.name}</p><Badge variant="warning">待跟进</Badge></div><p className="mt-1 text-xs text-muted-foreground">下次跟进：{customer.nextFollowUpAt}</p></div>)}</div></GlassCard>
  );
}

export function CustomerActivityCard({ customers, onShowAll }: { customers: readonly Customer[]; onShowAll: () => void }) {
  const activities = customers.flatMap((customer) => customer.activities.map((activity) => ({ ...activity, customerName: customer.name })));
  return (
    <GlassCard className="p-4 sm:p-5"><div className="flex items-center gap-2"><MessageSquareText className="size-4 text-primary" /><h2 className="text-base font-semibold">客户动态</h2><Button type="button" variant="link" size="sm" className="ml-auto" onClick={onShowAll}>查看全部</Button></div><div className="mt-2 divide-y divide-border/70">{activities.slice(0, 4).map((activity) => <div key={activity.id} className="py-2.5"><p className="truncate text-sm font-medium">{activity.customerName}</p><p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{activity.content} · {activity.createdAt}</p></div>)}</div></GlassCard>
  );
}
