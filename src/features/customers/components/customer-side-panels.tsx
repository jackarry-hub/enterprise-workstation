import { CalendarClock, MessageSquareText, Target } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import type { Customer } from "@/features/customers/customer-types";

export function SalesFunnelCard({ customers }: { customers: readonly Customer[] }) {
  const opportunities = customers.flatMap(({ opportunities: entries }) => entries);
  const stages = [
    { label: "线索", count: opportunities.filter(({ stage }) => stage === "lead").length, color: "bg-primary" },
    { label: "已确认", count: opportunities.filter(({ stage }) => stage === "qualified").length, color: "bg-chart-5" },
    { label: "方案中", count: opportunities.filter(({ stage }) => stage === "proposal").length, color: "bg-chart-3" },
    { label: "赢单", count: opportunities.filter(({ stage }) => stage === "won").length, color: "bg-success" },
    { label: "输单", count: opportunities.filter(({ stage }) => stage === "lost").length, color: "bg-warning" },
  ];
  const maximum = Math.max(...stages.map(({ count }) => count), 1);
  return (
    <GlassCard className="p-4 sm:p-5">
      <div className="flex items-center gap-2"><Target className="size-4 text-primary" /><h2 className="text-base font-semibold">销售漏斗</h2><Badge variant="info" className="ml-auto">本月</Badge></div>
      <div className="mt-4 space-y-3">{stages.map((stage) => <div key={stage.label} className="grid grid-cols-[5rem_1fr_2rem] items-center gap-2 text-sm"><span className="text-muted-foreground">{stage.label}</span><div className="h-3 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${stage.color}`} style={{ width: `${stage.count === 0 ? 0 : Math.max(8, (stage.count / maximum) * 100)}%` }} /></div><strong className="text-right">{stage.count}</strong></div>)}</div>
    </GlassCard>
  );
}

export function CustomerReminderCard({ customers, onShowAll }: { customers: readonly Customer[]; onShowAll: () => void }) {
  const reminders = customers.filter(({ nextFollowUpAt }) => nextFollowUpAt)
    .sort((left, right) => String(left.nextFollowUpAt).localeCompare(String(right.nextFollowUpAt)));
  return (
    <GlassCard className="p-4 sm:p-5"><div className="flex items-center gap-2"><CalendarClock className="size-4 text-warning" /><h2 className="text-base font-semibold">待跟进提醒</h2><Button type="button" variant="link" size="sm" className="ml-auto" onClick={onShowAll}>查看全部</Button></div><div className="mt-2 divide-y divide-border/70">{reminders.length ? reminders.slice(0, 3).map((customer) => { const overdue = Date.parse(customer.nextFollowUpAt!) < Date.now(); return <div key={customer.id} className="py-2.5"><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-medium">{customer.name}</p><Badge variant={overdue ? "destructive" : "warning"}>{overdue ? "已逾期" : "待跟进"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">{overdue ? "应跟进" : "下次跟进"}：{new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(customer.nextFollowUpAt!))}</p></div>; }) : <p className="py-5 text-center text-sm text-muted-foreground">暂无已安排的跟进</p>}</div></GlassCard>
  );
}

export function CustomerActivityCard({ customers, onShowAll }: { customers: readonly Customer[]; onShowAll: () => void }) {
  const activities = customers.flatMap((customer) => customer.activities.map((activity) => ({ ...activity, customerName: customer.name })))
    .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt));
  return (
    <GlassCard className="p-4 sm:p-5"><div className="flex items-center gap-2"><MessageSquareText className="size-4 text-primary" /><h2 className="text-base font-semibold">客户动态</h2><Button type="button" variant="link" size="sm" className="ml-auto" onClick={onShowAll}>查看全部</Button></div><div className="mt-2 divide-y divide-border/70">{activities.length ? activities.slice(0, 4).map((activity) => <div key={activity.id} className="py-2.5"><p className="truncate text-sm font-medium">{activity.customerName}</p><p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{activity.content} · {new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(activity.occurredAt))}</p></div>) : <p className="py-5 text-center text-sm text-muted-foreground">暂无跟进动态</p>}</div></GlassCard>
  );
}
