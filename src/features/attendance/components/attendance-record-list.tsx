import { Clock3, SearchX } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { attendanceStatusMeta } from "@/features/attendance/attendance-meta";
import type { AttendanceRecord } from "@/features/attendance/attendance-types";

function EmployeeAvatar({ record }: { record: AttendanceRecord }) {
  return (
    <Avatar size="lg" className="size-10">
      {record.employee.avatarUrl ? <AvatarImage src={record.employee.avatarUrl} alt={record.employee.displayName} /> : null}
      <AvatarFallback className="bg-linear-to-br from-primary/95 to-chart-3 font-semibold text-primary-foreground">
        {record.employee.displayName.slice(-2)}
      </AvatarFallback>
    </Avatar>
  );
}

function AttendanceBadge({ record }: { record: AttendanceRecord }) {
  const meta = attendanceStatusMeta[record.status];
  return <StatusBadge status={meta.tone}>{meta.label}</StatusBadge>;
}

function formatDate(date: string) {
  const [, month, day] = date.split("-");
  return `${month}月${day}日`;
}

export function AttendanceRecordList({ records }: { records: AttendanceRecord[] }) {
  if (records.length === 0) {
    return (
      <Empty className="min-h-72 border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon"><SearchX aria-hidden="true" /></EmptyMedia>
          <EmptyTitle>没有匹配的考勤记录</EmptyTitle>
          <EmptyDescription>请调整员工、日期、部门或状态筛选。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="border-border/65 hover:bg-transparent">
              <TableHead className="pl-4">员工</TableHead>
              <TableHead>部门</TableHead>
              <TableHead>日期</TableHead>
              <TableHead>上班时间</TableHead>
              <TableHead>下班时间</TableHead>
              <TableHead>状态</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {records.map((record) => (
              <TableRow key={record.id} className="border-border/55 hover:bg-primary/[0.035]">
                <TableCell className="pl-4">
                  <div className="flex min-w-42 items-center gap-3">
                    <EmployeeAvatar record={record} />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">{record.employee.displayName}</p>
                      <p className="truncate text-xs text-muted-foreground">{record.employee.employeeNo}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <p className="font-medium text-foreground">{record.department?.name ?? "待分配"}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{record.employee.jobTitle}</p>
                </TableCell>
                <TableCell className="text-muted-foreground">{formatDate(record.attendanceDate)}</TableCell>
                <TableCell className="font-medium text-foreground">{record.checkIn ?? "—"}</TableCell>
                <TableCell className="font-medium text-foreground">{record.checkOut ?? "—"}</TableCell>
                <TableCell><AttendanceBadge record={record} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-2 md:hidden">
        {records.map((record) => (
          <article key={record.id} className="rounded-2xl border border-glass-border bg-background/65 p-3">
            <div className="flex items-center gap-3">
              <EmployeeAvatar record={record} />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-foreground">{record.employee.displayName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{record.department?.name ?? "待分配"} · {formatDate(record.attendanceDate)}</p>
                  </div>
                  <AttendanceBadge record={record} />
                </div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-muted/45 px-3 py-2 text-sm">
              <div className="flex items-center gap-2"><Clock3 aria-hidden="true" className="size-3.5 text-primary" /><span className="text-muted-foreground">上班</span><strong className="ml-auto text-foreground">{record.checkIn ?? "—"}</strong></div>
              <div className="flex items-center gap-2 border-l border-border/60 pl-3"><span className="text-muted-foreground">下班</span><strong className="ml-auto text-foreground">{record.checkOut ?? "—"}</strong></div>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
