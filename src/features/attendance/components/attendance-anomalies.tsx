import { AlertTriangle, Clock3 } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { attendanceStatusMeta } from "@/features/attendance/attendance-meta";
import type { AttendanceRecord } from "@/features/attendance/attendance-types";

function anomalyDetail(record: AttendanceRecord) {
  if (record.status === "late") return `迟到 ${record.lateMinutes} 分钟 · ${record.checkIn}`;
  if (record.status === "early_leave") return `早退 ${record.earlyLeaveMinutes} 分钟 · ${record.checkOut}`;
  return record.note ?? "请假记录";
}

export function AttendanceAnomalies({ records }: { records: AttendanceRecord[] }) {
  return (
    <section aria-label="异常提醒">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-foreground">异常提醒</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">需要关注的考勤记录</p>
        </div>
        <span className="grid size-9 place-items-center rounded-xl bg-warning/12 text-warning"><AlertTriangle aria-hidden="true" className="size-4" /></span>
      </div>
      <div className="mt-3 grid gap-2">
        {records.slice(0, 4).map((record) => {
          const meta = attendanceStatusMeta[record.status];
          return (
            <article key={record.id} className="flex items-center gap-3 rounded-2xl border border-glass-border bg-background/65 px-3 py-2.5">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/8 text-primary"><Clock3 aria-hidden="true" className="size-4" /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{record.employee.displayName} · {record.department?.name}</p>
                <p className="mt-0.5 truncate text-xs text-muted-foreground">{anomalyDetail(record)}</p>
              </div>
              <StatusBadge status={meta.tone}>{meta.label}</StatusBadge>
            </article>
          );
        })}
      </div>
    </section>
  );
}
