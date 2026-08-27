import { ChevronRight, Search } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Customer, CustomerFilters, CustomerSource, CustomerStatus } from "@/features/customers/customer-types";

const statusLabels: Record<CustomerStatus, string> = {
  lead: "线索", following: "跟进中", proposal: "方案报价", negotiating: "商务谈判", won: "已成交", lost: "已流失",
};
const statusVariants = {
  lead: "info", following: "info", proposal: "secondary", negotiating: "warning", won: "success", lost: "destructive",
} as const;
const sourceLabels: Record<CustomerSource, string> = {
  consulting: "官网咨询", referral: "客户推荐", event: "市场活动", outbound: "主动拓展", other: "其他",
};

type CustomerListProps = {
  customers: readonly Customer[];
  industryOptions: readonly string[];
  total: number;
  filters: CustomerFilters;
  onFiltersChange: (filters: CustomerFilters) => void;
  onOpenCustomer: (customer: Customer) => void;
};

function shortDate(value: string | null) {
  return value ? new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(value)) : "尚未跟进";
}

export function CustomerList({ customers, industryOptions, total, filters, onFiltersChange, onOpenCustomer }: CustomerListProps) {
  function patchFilters(patch: Partial<CustomerFilters>) {
    onFiltersChange({ ...filters, ...patch });
  }
  return (
    <GlassCard className="min-w-0 overflow-hidden p-3 sm:p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div><h2 className="text-base font-semibold">客户列表</h2><p className="mt-1 text-xs text-muted-foreground">当前页 {customers.length} 家 · 全部结果 {total} 家</p></div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[8rem_8rem_8rem_14rem]">
          <Select value={filters.status} onValueChange={(status) => patchFilters({ status: status as CustomerStatus | "all" })}><SelectTrigger aria-label="客户状态" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem>{Object.entries(statusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
          <Select value={filters.source} onValueChange={(source) => patchFilters({ source: source as CustomerSource | "all" })}><SelectTrigger aria-label="客户来源" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部来源</SelectItem>{Object.entries(sourceLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
          <Select value={filters.industry} onValueChange={(industry) => patchFilters({ industry })}><SelectTrigger aria-label="客户行业" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部行业</SelectItem>{industryOptions.map((industry) => <SelectItem key={industry} value={industry}>{industry}</SelectItem>)}</SelectContent></Select>
          <label className="relative"><Search aria-hidden="true" className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input type="search" aria-label="搜索客户" placeholder="搜索客户名称" value={filters.query} onChange={(event) => patchFilters({ query: event.target.value })} className="h-9 rounded-xl pl-9" /></label>
        </div>
      </div>

      {customers.length === 0 ? <div className="mt-4 rounded-2xl border border-dashed border-border p-8 text-center"><p className="font-medium">没有符合条件的客户</p><p className="mt-1 text-sm text-muted-foreground">调整筛选条件，或新建第一份真实客户档案。</p></div> : null}
      <div className="mt-3 hidden xl:block">
        <Table>
          <TableHeader><TableRow><TableHead>客户名称</TableHead><TableHead>主联系人</TableHead><TableHead>来源</TableHead><TableHead>状态</TableHead><TableHead>负责人</TableHead><TableHead>最后联系</TableHead><TableHead className="w-36">商机进度</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>{customers.map((customer) => <TableRow key={customer.id}><TableCell><p className="font-medium">{customer.name}</p><p className="text-xs text-muted-foreground">{customer.industry || "未设置行业"}</p></TableCell><TableCell><p>{customer.contact?.name ?? "未配置或当前权限不可见"}</p><p className="text-xs text-muted-foreground">{customer.contact?.phone ?? customer.contact?.email ?? "暂无可见联系方式"}</p></TableCell><TableCell>{sourceLabels[customer.source]}</TableCell><TableCell><Badge variant={statusVariants[customer.status]}>{statusLabels[customer.status]}</Badge></TableCell><TableCell><div className="flex items-center gap-2"><Avatar size="sm"><AvatarFallback className="bg-brand-soft text-primary">{customer.owner.displayName.slice(0, 1)}</AvatarFallback></Avatar>{customer.owner.displayName}</div></TableCell><TableCell>{shortDate(customer.lastContactAt)}</TableCell><TableCell><div className="flex items-center gap-2"><span className="text-xs">{customer.dealProgress}%</span><ProgressBar value={customer.dealProgress} className="h-1.5 flex-1" /></div></TableCell><TableCell><Button type="button" variant="ghost" size="icon-sm" aria-label={`查看客户详情：${customer.name}`} onClick={() => onOpenCustomer(customer)}><ChevronRight /></Button></TableCell></TableRow>)}</TableBody>
        </Table>
      </div>
      <div className="mt-3 grid gap-2 xl:hidden">{customers.map((customer) => <button key={customer.id} type="button" aria-label={`查看客户详情：${customer.name}`} onClick={() => onOpenCustomer(customer)} className="rounded-2xl border border-border/70 bg-white/70 p-3 text-left shadow-sm transition active:scale-[0.99]"><div className="flex items-center gap-2"><Avatar><AvatarFallback className="bg-brand-soft text-primary">{customer.name.slice(0, 1)}</AvatarFallback></Avatar><div className="min-w-0"><p className="truncate font-medium">{customer.name}</p><p className="truncate text-xs text-muted-foreground">{customer.contact?.name ?? "联系人未配置或不可见"} · {customer.owner.displayName}</p></div><Badge className="ml-auto shrink-0" variant={statusVariants[customer.status]}>{statusLabels[customer.status]}</Badge></div><div className="mt-3 flex items-center gap-2"><ProgressBar value={customer.dealProgress} className="h-1.5 flex-1" /><span className="text-xs font-medium">{customer.dealProgress}%</span><ChevronRight className="size-4 text-muted-foreground" /></div><p className="mt-2 text-xs text-muted-foreground">最后联系：{shortDate(customer.lastContactAt)}</p></button>)}</div>
    </GlassCard>
  );
}
