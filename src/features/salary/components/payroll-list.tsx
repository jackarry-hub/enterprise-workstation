import Link from "next/link";
import { ChevronRight, SearchX } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatSalaryCurrency, salaryStatusMeta } from "@/features/salary/salary-meta";
import type { SalaryRecord } from "@/features/salary/salary-types";

function EmployeeAvatar({ record }: { record: SalaryRecord }) {
  return <Avatar className="size-10">{record.employee.avatarUrl ? <AvatarImage src={record.employee.avatarUrl} alt={record.employee.displayName} /> : null}<AvatarFallback className="bg-linear-to-br from-primary/95 to-chart-3 text-primary-foreground">{record.employee.displayName.slice(-2)}</AvatarFallback></Avatar>;
}

function SalaryBadge({ status }: { status: SalaryRecord["status"] }) {
  const meta = salaryStatusMeta[status];
  return <StatusBadge status={meta.tone}>{meta.label}</StatusBadge>;
}

export function PayrollList({ records }: { records: SalaryRecord[] }) {
  if (records.length === 0) return <Empty className="min-h-72 border-0"><EmptyHeader><EmptyMedia variant="icon"><SearchX aria-hidden="true" /></EmptyMedia><EmptyTitle>没有匹配的工资记录</EmptyTitle><EmptyDescription>请调整员工、月份、部门或状态筛选。</EmptyDescription></EmptyHeader></Empty>;
  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader><TableRow className="border-border/65 hover:bg-transparent"><TableHead className="pl-4">员工</TableHead><TableHead>部门</TableHead><TableHead>月份</TableHead><TableHead>基础工资</TableHead><TableHead>奖金</TableHead><TableHead>扣款</TableHead><TableHead>实发工资</TableHead><TableHead>状态</TableHead><TableHead><span className="sr-only">详情</span></TableHead></TableRow></TableHeader>
          <TableBody>{records.map((record) => <TableRow key={record.id} className="border-border/55 hover:bg-primary/[0.035]"><TableCell className="pl-4"><div className="flex min-w-40 items-center gap-3"><EmployeeAvatar record={record} /><div><p className="font-medium text-foreground">{record.employee.displayName}</p><p className="text-xs text-muted-foreground">{record.employee.employeeNo}</p></div></div></TableCell><TableCell><p className="font-medium text-foreground">{record.department.name}</p><p className="text-xs text-muted-foreground">{record.employee.jobTitle}</p></TableCell><TableCell className="text-muted-foreground">{record.month.replace("-", "年")}月</TableCell><TableCell>{formatSalaryCurrency(record.baseSalary)}</TableCell><TableCell className="text-success">+{formatSalaryCurrency(record.bonus)}</TableCell><TableCell className="text-warning">-{formatSalaryCurrency(record.deductions)}</TableCell><TableCell className="font-semibold text-foreground">{formatSalaryCurrency(record.netSalary)}</TableCell><TableCell><SalaryBadge status={record.status} /></TableCell><TableCell className="pr-4 text-right"><Link href={`/payroll/${record.id}`} aria-label={`查看${record.employee.displayName}的工资详情`} className="inline-grid size-8 place-items-center rounded-xl text-muted-foreground hover:bg-primary/10 hover:text-primary"><ChevronRight aria-hidden="true" className="size-4" /></Link></TableCell></TableRow>)}</TableBody>
        </Table>
      </div>
      <div className="grid gap-2 md:hidden">{records.map((record) => <Link key={record.id} href={`/payroll/${record.id}`} aria-label={`查看${record.employee.displayName}的工资详情`} className="rounded-2xl border border-glass-border bg-background/65 p-3"><div className="flex items-center gap-3"><EmployeeAvatar record={record} /><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div><p className="font-semibold text-foreground">{record.employee.displayName}</p><p className="text-xs text-muted-foreground">{record.department.name} · {record.month}</p></div><SalaryBadge status={record.status} /></div></div><ChevronRight aria-hidden="true" className="size-4 text-muted-foreground" /></div><div className="mt-3 grid grid-cols-2 gap-3 rounded-xl bg-muted/45 px-3 py-2"><div><p className="text-xs text-muted-foreground">基础 + 奖金</p><p className="mt-1 text-sm font-medium text-foreground">{formatSalaryCurrency(record.baseSalary + record.bonus)}</p></div><div className="border-l border-border/60 pl-3"><p className="text-xs text-muted-foreground">实发工资</p><p className="mt-1 text-sm font-semibold text-primary">{formatSalaryCurrency(record.netSalary)}</p></div></div></Link>)}</div>
    </>
  );
}
