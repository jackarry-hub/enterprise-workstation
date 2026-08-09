import { ChevronRight, Search } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Customer, CustomerFilters, CustomerIndustry, CustomerSource, CustomerStatus } from "@/features/customers/customer-types";

const statusLabels = { lead: "初步沟通", following: "跟进中", proposal: "方案报价", negotiating: "谈判中", won: "成交" } as const;
const statusVariants = { lead: "info", following: "info", proposal: "secondary", negotiating: "warning", won: "success" } as const;
const sourceLabels = { consulting: "官网咨询", referral: "客户推荐", event: "市场活动", outbound: "行业展会" } as const;
const industryLabels = { technology: "信息技术", manufacturing: "制造业", finance: "金融服务", retail: "零售消费" } as const;

type CustomerListProps = {
  customers: readonly Customer[];
  filters: CustomerFilters;
  onFiltersChange: (filters: CustomerFilters) => void;
  onOpenCustomer: (customer: Customer) => void;
};

export function CustomerList({ customers, filters, onFiltersChange, onOpenCustomer }: CustomerListProps) {
  function patchFilters(patch: Partial<CustomerFilters>) {
    onFiltersChange({ ...filters, ...patch });
  }
  return (
    <GlassCard className="min-w-0 overflow-hidden p-3 sm:p-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div><h2 className="text-base font-semibold">客户列表</h2><p className="mt-1 text-xs text-muted-foreground">当前显示 {customers.length} 家客户</p></div>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-[8rem_8rem_8rem_14rem]">
          <Select value={filters.status} onValueChange={(status) => patchFilters({ status: status as CustomerStatus | "all" })}><SelectTrigger aria-label="客户状态" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部状态</SelectItem>{Object.entries(statusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
          <Select value={filters.source} onValueChange={(source) => patchFilters({ source: source as CustomerSource | "all" })}><SelectTrigger aria-label="客户来源" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部来源</SelectItem>{Object.entries(sourceLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
          <Select value={filters.industry} onValueChange={(industry) => patchFilters({ industry: industry as CustomerIndustry | "all" })}><SelectTrigger aria-label="客户行业" className="w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">全部行业</SelectItem>{Object.entries(industryLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
          <label className="relative"><Search aria-hidden="true" className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" /><Input type="search" aria-label="搜索客户" placeholder="搜索客户名称、联系人" value={filters.query} onChange={(event) => patchFilters({ query: event.target.value })} className="h-9 rounded-xl pl-9" /></label>
        </div>
      </div>

      <div className="mt-3 hidden xl:block">
        <Table>
          <TableHeader><TableRow><TableHead>客户名称</TableHead><TableHead>联系人</TableHead><TableHead>来源渠道</TableHead><TableHead>跟进状态</TableHead><TableHead>负责人</TableHead><TableHead>最后联系</TableHead><TableHead className="w-36">成交进度</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>{customers.map((customer) => <TableRow key={customer.id}><TableCell><p className="font-medium">{customer.name}</p><p className="text-xs text-muted-foreground">{industryLabels[customer.industry]}</p></TableCell><TableCell><p>{customer.contact.name}</p><p className="text-xs text-muted-foreground">{customer.contact.phone}</p></TableCell><TableCell>{sourceLabels[customer.source]}</TableCell><TableCell><Badge variant={statusVariants[customer.status]}>{statusLabels[customer.status]}</Badge></TableCell><TableCell><div className="flex items-center gap-2"><Avatar size="sm"><AvatarFallback className="bg-brand-soft text-primary">{customer.owner.displayName.slice(0, 1)}</AvatarFallback></Avatar>{customer.owner.displayName}</div></TableCell><TableCell>{customer.lastContactAt}</TableCell><TableCell><div className="flex items-center gap-2"><span className="text-xs">{customer.dealProgress}%</span><ProgressBar value={customer.dealProgress} className="h-1.5 flex-1" /></div></TableCell><TableCell><Button type="button" variant="ghost" size="icon-sm" aria-label={`查看客户详情：${customer.name}`} onClick={() => onOpenCustomer(customer)}><ChevronRight /></Button></TableCell></TableRow>)}</TableBody>
        </Table>
      </div>
      <div className="mt-3 grid gap-2 xl:hidden">{customers.map((customer) => <button key={customer.id} type="button" aria-label={`查看客户详情：${customer.name}`} onClick={() => onOpenCustomer(customer)} className="rounded-2xl border border-border/70 bg-white/55 p-3 text-left"><div className="flex items-center gap-2"><Avatar><AvatarFallback className="bg-brand-soft text-primary">{customer.name.slice(0, 1)}</AvatarFallback></Avatar><div className="min-w-0"><p className="truncate font-medium">{customer.name}</p><p className="text-xs text-muted-foreground">{customer.contact.name} · {customer.owner.displayName}</p></div><Badge className="ml-auto" variant={statusVariants[customer.status]}>{statusLabels[customer.status]}</Badge></div><div className="mt-3 flex items-center gap-2"><ProgressBar value={customer.dealProgress} className="h-1.5 flex-1" /><span className="text-xs font-medium">{customer.dealProgress}%</span></div></button>)}</div>
    </GlassCard>
  );
}
