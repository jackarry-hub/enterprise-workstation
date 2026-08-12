"use client";

import { useMemo, useState } from "react";
import { Database, Search, ShieldCheck } from "lucide-react";

import { MobileWorkspaceNav } from "@/components/shell/mobile-workspace-nav";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { RealDataNotice } from "@/components/ui/real-data-boundary";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApprovalAside } from "@/features/approvals/components/approval-aside";
import { ApprovalList } from "@/features/approvals/components/approval-list";
import { ApprovalStats } from "@/features/approvals/components/approval-stats";
import { approvalTypeMeta } from "@/features/approvals/approval-meta";
import { filterApprovals, getApprovalStats } from "@/features/approvals/approval-selectors";
import type { ApprovalFilters, ApprovalQueue, ApprovalResult, ApprovalType } from "@/features/approvals/approval-types";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { OperationalApprovalQueue } from "@/features/operations/operational-approval-queue";
import { useOperations } from "@/features/operations/use-operations";

const defaultFilters: ApprovalFilters = { query: "", queue: "all", type: "all" };

export function ApprovalsWorkspace({ result }: { result: ApprovalResult }) {
  const session = useWorkspaceSession();
  const { actor } = session;
  const { isFixtureBound } = useOperations(session);
  const [filters, setFilters] = useState(defaultFilters);
  const visibleApprovals = useMemo(() => !isFixtureBound ? [] : actor.role === "employee"
    ? result.data.approvals.filter(({ applicant }) => applicant.displayName === actor.name)
    : actor.role === "finance" ? result.data.approvals.filter(({ type, applicant }) => type === "reimbursement" || type === "purchase" || applicant.displayName === actor.name)
      : actor.role === "department_head" ? result.data.approvals.filter(({ applicant, owner }) => applicant.department === actor.department || owner.displayName === actor.name) : result.data.approvals, [actor.department, actor.name, actor.role, isFixtureBound, result.data.approvals]);
  const stats = useMemo(() => getApprovalStats(visibleApprovals), [visibleApprovals]);
  const approvals = useMemo(() => filterApprovals(visibleApprovals, filters), [filters, visibleApprovals]);

  return (
    <main className="mx-auto flex w-full max-w-420 flex-col gap-4 px-3 pt-5 pb-26 sm:px-4 lg:px-5 lg:pt-9 lg:pb-6">
      <section className="relative overflow-hidden rounded-3xl border border-glass-border bg-background px-5 py-6 shadow-[0_18px_50px_rgba(60,105,170,0.08)] sm:px-7">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[url('/dashboard/welcome-space-bg.png')] bg-cover bg-[position:76%_center] opacity-75" />
        <div className="relative max-w-4xl">
          <PageHeader title="审批中心" description="高效审批，让企业流程清晰、协作顺畅。" actions={<Badge variant="info" className="h-8 gap-1.5 rounded-xl px-3"><ShieldCheck aria-hidden="true" className="size-3.5" />固定流程 V0.9</Badge>} />
        </div>
      </section>
      {isFixtureBound ? <OperationalApprovalQueue /> : <RealDataNotice message="当前账号没有可显示的真实审批数据。" />}
      <ApprovalStats stats={stats} activeQueue={filters.queue} onSelect={(queue) => setFilters({ ...filters, queue })} />
      <section className="grid min-w-0 gap-4 xl:grid-cols-12">
        <GlassCard className="min-w-0 overflow-hidden p-3 sm:p-4 xl:col-span-9">
          <Tabs value={filters.queue} onValueChange={(value) => setFilters({ ...filters, queue: value as ApprovalQueue })}>
            <div className="flex flex-col gap-3 border-b border-border/60 pb-3 lg:flex-row lg:items-center lg:justify-between">
              <TabsList variant="line" className="w-full justify-start overflow-x-auto lg:w-auto">
                <TabsTrigger value="all">全部</TabsTrigger><TabsTrigger value="pending">待我审批</TabsTrigger><TabsTrigger value="mine">我发起的</TabsTrigger><TabsTrigger value="completed">已完成</TabsTrigger>{filters.queue === "approved" ? <TabsTrigger value="approved">已通过</TabsTrigger> : null}{filters.queue === "rejected" ? <TabsTrigger value="rejected">已拒绝</TabsTrigger> : null}
              </TabsList>
              <div className="grid gap-2 sm:grid-cols-[minmax(180px,1fr)_150px] lg:w-100">
                <div className="relative"><Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input type="search" aria-label="搜索审批" placeholder="搜索申请人、编号或内容" value={filters.query} onChange={(event) => setFilters({ ...filters, query: event.target.value })} className="h-10 rounded-xl bg-background/75 pl-9" /></div>
                <Select value={filters.type} onValueChange={(value) => setFilters({ ...filters, type: value as ApprovalType | "all" })}>
                  <SelectTrigger aria-label="筛选审批类型" className="h-10 w-full bg-background/75"><SelectValue placeholder="全部类型" /></SelectTrigger>
                  <SelectContent><SelectItem value="all">全部类型</SelectItem>{(Object.keys(approvalTypeMeta) as ApprovalType[]).map((type) => <SelectItem key={type} value={type}>{approvalTypeMeta[type].label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            </div>
          </Tabs>
          <section aria-label="审批列表" className="mt-3"><ApprovalList approvals={approvals} /></section>
          <footer className="mt-3 flex items-center justify-between border-t border-border/60 px-1 pt-3 text-xs text-muted-foreground"><span>当前显示 {approvals.length} 条审批</span><span className="flex items-center gap-1"><Database aria-hidden="true" className="size-3.5" />本地业务记录</span></footer>
        </GlassCard>
        <GlassCard className="min-w-0 p-4 sm:p-5 xl:col-span-3"><ApprovalAside /></GlassCard>
      </section>
      <MobileWorkspaceNav active="messages" />
    </main>
  );
}
