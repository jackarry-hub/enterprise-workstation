import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { AnalyticsExecutionRow } from "@/features/analytics/analytics-types";

export function ExecutionTable({ rows }: { rows: readonly AnalyticsExecutionRow[] }) {
  return (
    <GlassCard className="min-w-0 overflow-hidden p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div><h2 className="text-base font-semibold">员工执行情况</h2><p className="mt-1 text-xs text-muted-foreground">按任务完成率与当前工作量综合排序</p></div>
        <Badge variant="info">{rows.length} 人活跃</Badge>
      </div>
      <div className="mt-4 hidden lg:block">
        <Table>
          <TableHeader><TableRow><TableHead>员工</TableHead><TableHead>部门</TableHead><TableHead>任务</TableHead><TableHead>进行中</TableHead><TableHead>已完成</TableHead><TableHead>延期</TableHead><TableHead className="w-36">完成率</TableHead></TableRow></TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.member.id}>
                <TableCell><div className="flex items-center gap-2"><Avatar><AvatarFallback className="bg-brand-soft font-medium text-primary">{row.member.displayName.slice(0, 1)}</AvatarFallback></Avatar><div><p className="font-medium">{row.member.displayName}</p><p className="text-xs text-muted-foreground">{row.member.title}</p></div></div></TableCell>
                <TableCell className="text-muted-foreground">{row.department}</TableCell>
                <TableCell>{row.taskCount}</TableCell>
                <TableCell><Badge variant="info">{row.inProgressCount}</Badge></TableCell>
                <TableCell><Badge variant="success">{row.completedCount}</Badge></TableCell>
                <TableCell><Badge variant={row.overdueCount ? "destructive" : "neutral"}>{row.overdueCount}</Badge></TableCell>
                <TableCell><div className="flex items-center gap-2"><ProgressBar value={row.completionRate} className="h-1.5 flex-1" /><span className="w-9 text-right text-xs font-medium">{row.completionRate}%</span></div></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="mt-4 grid gap-2 lg:hidden">
        {rows.map((row) => (
          <div key={row.member.id} className="rounded-2xl border border-border/70 bg-white/55 p-3">
            <div className="flex items-center gap-2"><Avatar><AvatarFallback className="bg-brand-soft text-primary">{row.member.displayName.slice(0, 1)}</AvatarFallback></Avatar><div className="min-w-0"><p className="font-medium">{row.member.displayName}</p><p className="truncate text-xs text-muted-foreground">{row.department} · {row.taskCount} 项任务</p></div><strong className="ml-auto text-primary">{row.completionRate}%</strong></div>
            <ProgressBar value={row.completionRate} className="mt-3 h-1.5" />
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
