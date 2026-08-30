"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Activity, BarChart3, Bot, CircleDollarSign, FolderKanban, RefreshCw, ShieldCheck } from "lucide-react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { GlassCard } from "@/components/ui/glass-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { parseCommercialAnalytics, formatMetricValue, type AnalyticsBreakdown, type CommercialAnalytics, type CommercialMetric } from "@/features/analytics/analytics-data";

type RangeDays = "30" | "90" | "180";
const RANGE_LABELS: Record<RangeDays, string> = { "30": "近 30 天", "90": "近 90 天", "180": "近 180 天" };
const CHART_CONFIG = { tasksCreated: { label: "新建任务", color: "var(--chart-1)" }, tasksCompleted: { label: "完成任务", color: "var(--chart-2)" }, aiInvocations: { label: "AI 调用", color: "var(--chart-3)" } } satisfies ChartConfig;
const KEY_LABELS: Record<string, string> = { on_track: "正常", at_risk: "有风险", off_track: "已偏离", backlog: "待规划", todo: "待处理", in_progress: "进行中", in_review: "审核中", done: "已完成", cancelled: "已取消", lead: "线索", qualified: "已验证", proposal: "方案", won: "赢单", lost: "丢单", draft: "草稿", pending: "待审批", approved: "已批准", rejected: "已拒绝", paid: "已支付", submitted: "已提交", succeeded: "成功", failed: "失败", timed_out: "超时", rate_limited: "限流", running: "运行中", queued: "排队中" };

function isoDate(date: Date) { return date.toISOString().slice(0, 10); }
function rangeFor(days: RangeDays) { const to = new Date(); to.setHours(0, 0, 0, 0); const from = new Date(to); from.setDate(to.getDate() - Number(days) + 1); return { from: isoDate(from), to: isoDate(to) }; }
function sourceText(metric: CommercialMetric) { return metric.denominator === null ? `分子 ${metric.numerator.toLocaleString("zh-CN")}` : `分子 ${metric.numerator.toLocaleString("zh-CN")} / 分母 ${metric.denominator.toLocaleString("zh-CN")}`; }

function MetricCard({ metric, index }: { metric: CommercialMetric; index: number }) {
  const icons = [FolderKanban, Activity, ShieldCheck, CircleDollarSign, Bot]; const Icon = icons[index % icons.length];
  return <article className="rounded-2xl border border-border/70 bg-white/88 p-4 shadow-[0_10px_30px_rgba(43,91,155,0.06)]" data-testid={`metric-${metric.definitionCode}`}>
    <div className="flex items-start justify-between gap-3"><div><p className="text-xs font-medium text-muted-foreground">{metric.label}</p><p className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{formatMetricValue(metric)}</p></div><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Icon className="size-5" aria-hidden="true" /></span></div>
    <p className="mt-3 text-[11px] text-muted-foreground">{sourceText(metric)}</p>
    <details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer font-medium text-primary">口径 {metric.definitionCode}</summary><p className="mt-1.5 leading-5">{metric.definition}</p></details>
  </article>;
}

function BreakdownCard({ title, items, value }: { title: string; items: AnalyticsBreakdown[]; value?: (item: AnalyticsBreakdown) => string }) {
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return <GlassCard className="min-w-0 p-4 sm:p-5"><div className="flex items-center justify-between gap-3"><h2 className="font-semibold">{title}</h2><span className="text-xs text-muted-foreground">{total.toLocaleString("zh-CN")} 条</span></div>
    {items.length === 0 ? <p className="mt-8 text-center text-sm text-muted-foreground">当前周期暂无数据</p> : <div className="mt-4 space-y-3">{items.map((item) => { const percentage = total === 0 ? 0 : item.count / total * 100; return <div key={`${item.key}-${item.currency ?? ""}`}><div className="mb-1.5 flex items-center justify-between gap-3 text-sm"><span>{KEY_LABELS[item.key] ?? item.key}{item.currency ? ` · ${item.currency}` : ""}</span><span className="font-medium tabular-nums">{value?.(item) ?? item.count.toLocaleString("zh-CN")}</span></div><div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.max(2, percentage)}%` }} /></div></div>; })}</div>}
  </GlassCard>;
}

function AnalyticsContent({ data }: { data: CommercialAnalytics }) {
  return <>
    <section aria-label="经营指标" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">{data.metrics.map((metric, index) => <MetricCard key={metric.definitionCode} metric={metric} index={index} />)}</section>
    <section className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1.7fr)_minmax(18rem,0.8fr)]">
      <GlassCard className="min-w-0 p-4 sm:p-5"><h2 className="font-semibold">任务与 AI 运行趋势</h2><p className="mt-1 text-xs text-muted-foreground">按真实创建、完成和调用时间逐日聚合</p>
        {data.trend.length === 0 ? <p className="py-16 text-center text-sm text-muted-foreground">当前周期暂无趋势数据</p> : <ChartContainer config={CHART_CONFIG} className="mt-3 h-70 w-full aspect-auto" initialDimension={{ width: 760, height: 280 }}><AreaChart data={data.trend} accessibilityLayer margin={{ left: -20, right: 8, top: 8 }}><CartesianGrid vertical={false} strokeDasharray="4 4" /><XAxis dataKey="date" axisLine={false} tickLine={false} minTickGap={28} tickFormatter={(value) => String(value).slice(5)} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} /><ChartTooltip content={<ChartTooltipContent />} /><Area type="monotone" dataKey="tasksCreated" stroke="var(--color-tasksCreated)" fill="var(--color-tasksCreated)" fillOpacity={0.1} strokeWidth={2} /><Area type="monotone" dataKey="tasksCompleted" stroke="var(--color-tasksCompleted)" fill="var(--color-tasksCompleted)" fillOpacity={0.08} strokeWidth={2} /><Area type="monotone" dataKey="aiInvocations" stroke="var(--color-aiInvocations)" fill="transparent" strokeWidth={2} /></AreaChart></ChartContainer>}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="图表图例"><span>● 新建任务</span><span>● 完成任务</span><span>● AI 调用</span></div>
      </GlassCard>
      <BreakdownCard title="项目健康度" items={data.projectHealth} />
    </section>
    <section className="grid min-w-0 gap-3 md:grid-cols-2 2xl:grid-cols-3"><BreakdownCard title="任务流转" items={data.taskFlow} /><BreakdownCard title="客户管道" items={data.customerPipeline} value={(item) => item.amount === undefined ? `${item.count} 条` : `${item.amount.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} ${item.currency}`} /><BreakdownCard title="业务审批周期" items={data.approvalCycle} value={(item) => item.averageHours === null || item.averageHours === undefined ? `${item.count} 条` : `${item.averageHours} 小时`} /><BreakdownCard title="费用状态" items={data.expense} value={(item) => item.amount === undefined ? `${item.count} 条` : `${item.amount.toLocaleString("zh-CN", { maximumFractionDigits: 2 })} ${item.currency}`} /><BreakdownCard title="AI 运行状态" items={data.aiUsage} value={(item) => `${item.count} 次 · ${(item.tokens ?? 0).toLocaleString("zh-CN")} tokens`} /></section>
  </>;
}

export function AnalyticsWorkspace() {
  const [range, setRange] = useState<RangeDays>("30"); const [data, setData] = useState<CommercialAnalytics | null>(null); const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const dates = useMemo(() => rangeFor(range), [range]);
  const load = useCallback(async (signal?: AbortSignal) => { setState("loading"); try { const response = await fetch(`/api/workstation/analytics?from=${dates.from}&to=${dates.to}`, { cache: "no-store", signal }); if (!response.ok) throw new Error("request_failed"); const parsed = parseCommercialAnalytics(await response.json()); if (!parsed) throw new Error("invalid_projection"); setData(parsed); setState("ready"); } catch (error) { if ((error as Error).name !== "AbortError") { setData(null); setState("error"); } } }, [dates.from, dates.to]);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  return <main className="mx-auto flex w-full max-w-420 min-w-0 flex-col gap-3 px-3 pt-4 pb-28 sm:px-4 lg:px-5 lg:pt-6 lg:pb-8">
    <header className="rounded-3xl border border-white/75 bg-[linear-gradient(135deg,rgba(255,255,255,.95),rgba(231,240,255,.86))] p-5 shadow-[0_18px_48px_rgba(43,91,155,0.08)] sm:p-7"><div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between"><div><div className="flex items-center gap-2"><BarChart3 className="size-5 text-primary" aria-hidden="true" /><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">经营数据分析</h1></div><p className="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">项目、任务、客户、审批、费用与 AI 运行数据来自当前组织的实时数据库投影。</p>{data ? <p className="mt-3 text-xs font-medium text-primary" data-testid="analytics-as-of">{data.fromDate} 至 {data.toDate} · 截止 {new Date(data.asOf).toLocaleString("zh-CN")}</p> : null}</div><div className="flex items-center gap-2"><Select value={range} onValueChange={(value) => setRange(value as RangeDays)}><SelectTrigger aria-label="时间范围" className="min-h-11 w-36 bg-white"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(RANGE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select><Button variant="outline" size="icon" className="min-h-11 min-w-11 bg-white" aria-label="刷新分析" onClick={() => void load()}><RefreshCw className={`size-4 ${state === "loading" ? "animate-spin" : ""}`} /></Button></div></div></header>
    {state === "loading" ? <section aria-label="正在加载分析" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{Array.from({ length: 4 }, (_, index) => <div key={index} className="h-32 animate-pulse rounded-2xl border bg-white/70" />)}</section> : null}
    {state === "error" ? <GlassCard className="p-8 text-center"><h2 className="font-semibold">经营数据暂时不可用</h2><p className="mt-2 text-sm text-muted-foreground">没有使用演示数据替代。请检查数据库连接或权限后重试。</p><Button className="mt-5 min-h-11" onClick={() => void load()}>重新加载</Button></GlassCard> : null}
    {state === "ready" && data ? <AnalyticsContent data={data} /> : null}
  </main>;
}
