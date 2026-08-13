"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CalendarDays, Plane } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { PageHeader } from "@/components/ui/page-header";
import {
  AttendanceApprovalQueue,
  AttendancePolicyAndPeriod,
  AttendanceResetNotice,
  AttendanceSelfService,
  AttendanceWorkflowStrip,
  TodayClockPanel,
} from "@/features/attendance/attendance-operating-panels";
import { AttendanceAnomalies } from "@/features/attendance/components/attendance-anomalies";
import { AttendanceFilters } from "@/features/attendance/components/attendance-filters";
import { AttendanceRecordList } from "@/features/attendance/components/attendance-record-list";
import { AttendanceStats } from "@/features/attendance/components/attendance-stats";
import { AttendanceTrend } from "@/features/attendance/components/attendance-trend";
import { filterAttendanceRecords, getAttendanceAnomalies } from "@/features/attendance/attendance-selectors";
import type { AttendanceFilters as Filters, AttendanceRecord, AttendanceResult } from "@/features/attendance/attendance-types";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import type { WorkspaceRole } from "@/features/auth/workspace-session-types";
import { getActor, operationFixtureActors } from "@/features/operations/operations-data";
import { useOperations } from "@/features/operations/use-operations";
import { cn } from "@/lib/utils";

const defaultFilters: Filters = {
  query: "",
  departmentId: "all",
  date: "all",
  status: "all",
};

type View = "overview" | "self" | "approvals" | "policy" | "records";

const roleViews: Record<WorkspaceRole, Array<{ id: View; label: string }>> = {
  executive: [{ id: "overview", label: "出勤概览" }, { id: "policy", label: "制度与封账" }],
  department_head: [{ id: "approvals", label: "团队审批" }, { id: "self", label: "我的考勤" }, { id: "records", label: "团队记录" }],
  employee: [{ id: "self", label: "我的考勤" }, { id: "records", label: "我的记录" }],
  finance: [{ id: "self", label: "我的考勤" }, { id: "records", label: "我的记录" }],
  hr: [{ id: "approvals", label: "异常复核" }, { id: "policy", label: "制度与封账" }, { id: "records", label: "全员记录" }],
};

const defaultView: Record<WorkspaceRole, View> = {
  executive: "overview",
  department_head: "approvals",
  employee: "self",
  finance: "self",
  hr: "approvals",
};

const roleDescription: Record<WorkspaceRole, string> = {
  executive: "查看公司出勤风险、制度状态和薪资前置条件。",
  department_head: "处理团队补卡与加班审批，同时完成本人打卡。",
  employee: "完成本人打卡、补卡、加班申请并追踪审批结果。",
  finance: "完成本人考勤；考勤封账后接收薪资核算输入。",
  hr: "维护制度、复核异常、完成月度封账并生成薪资输入。",
};

function timeMinutes(value?: string) {
  if (!value) return undefined;
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function mergeOperationalAttendance(result: AttendanceResult, state: ReturnType<typeof useOperations>["state"]) {
  const policy = state.attendance.policy;
  const merged = result.data.records.map((record) => ({ ...record }));
  const getRecordSeed = (name: string) => merged.find(({ employee }) => employee.displayName === name);

  for (const actor of operationFixtureActors) {
    const dates = [...new Set(state.attendance.punches.filter(({ employeeId }) => employeeId === actor.id).map(({ date }) => date))];
    for (const date of dates) {
      const punches = state.attendance.punches.filter((item) => item.employeeId === actor.id && item.date === date);
      const checkIn = punches.find(({ kind }) => kind === "check_in")?.time;
      const checkOut = punches.find(({ kind }) => kind === "check_out")?.time;
      const graceEnd = (timeMinutes(policy.workStart) ?? 0) + policy.graceMinutes;
      const lateMinutes = Math.max(0, (timeMinutes(checkIn) ?? graceEnd) - graceEnd);
      const earlyLeaveMinutes = Math.max(0, (timeMinutes(policy.workEnd) ?? 0) - (timeMinutes(checkOut) ?? timeMinutes(policy.workEnd) ?? 0));
      const status: AttendanceRecord["status"] = lateMinutes > 0 ? "late" : earlyLeaveMinutes > 0 ? "early_leave" : "normal";
      const existingIndex = merged.findIndex((record) => record.employee.displayName === actor.name && record.attendanceDate === date);
      if (existingIndex >= 0) {
        merged[existingIndex] = { ...merged[existingIndex], checkIn: checkIn ?? merged[existingIndex].checkIn, checkOut: checkOut ?? merged[existingIndex].checkOut, status, lateMinutes, earlyLeaveMinutes, source: "device", note: "工作站打卡记录" };
      } else {
        const seed = getRecordSeed(actor.name);
        merged.push({ id: `operations-${actor.id}-${date}`, organizationId: seed?.organizationId ?? "10000000-0000-4000-8000-000000000001", employee: seed?.employee ?? { id: actor.id, employeeNo: actor.memberId.slice(-6), displayName: actor.name, jobTitle: actor.title }, department: seed?.department ?? { id: `department-${actor.id}`, name: actor.department }, attendanceDate: date, scheduledStart: policy.workStart, scheduledEnd: policy.workEnd, checkIn, checkOut, status, lateMinutes, earlyLeaveMinutes, source: "device", note: "工作站打卡记录" });
      }
    }
  }

  for (const correction of state.attendance.corrections.filter(({ status }) => status === "approved")) {
    const actor = getActor(correction.employeeId);
    const index = merged.findIndex((record) => record.employee.displayName === actor.name && record.attendanceDate === correction.date);
    if (index < 0) continue;
    const record = merged[index];
    merged[index] = { ...record, checkIn: ["late", "missing_in"].includes(correction.issueType) ? correction.correctedTime : record.checkIn, checkOut: ["early_leave", "missing_out"].includes(correction.issueType) ? correction.correctedTime : record.checkOut, status: "normal", lateMinutes: 0, earlyLeaveMinutes: 0, note: `补卡 ${correction.code} 已审批生效` };
  }

  for (const request of state.leaveRequests.filter(({ status }) => status === "approved")) {
    const actor = getActor(request.employeeId);
    const index = merged.findIndex((record) => record.employee.displayName === actor.name && record.attendanceDate === request.startDate);
    if (index >= 0) {
      merged[index] = { ...merged[index], checkIn: undefined, checkOut: undefined, status: "leave", lateMinutes: 0, earlyLeaveMinutes: 0, note: `请假 ${request.code} 已审批同步` };
    } else {
      const seed = getRecordSeed(actor.name);
      merged.push({ id: `leave-sync-${request.id}`, organizationId: seed?.organizationId ?? "10000000-0000-4000-8000-000000000001", employee: seed?.employee ?? { id: actor.id, employeeNo: actor.memberId.slice(-6), displayName: actor.name, jobTitle: actor.title }, department: seed?.department ?? { id: `department-${actor.id}`, name: actor.department }, attendanceDate: request.startDate, scheduledStart: policy.workStart, scheduledEnd: policy.workEnd, status: "leave", lateMinutes: 0, earlyLeaveMinutes: 0, source: "manual", note: `请假 ${request.code} 已审批同步` });
    }
  }
  return merged;
}

export function AttendanceWorkspace({ result }: { result: AttendanceResult }) {
  const searchParams = useSearchParams();
  const session = useWorkspaceSession();
  const { state, actor, isFixtureBound } = useOperations(session);
  const [filters, setFilters] = useState(defaultFilters);
  const requestedView = searchParams.get("view") as View | null;
  const initialView = requestedView && roleViews[actor.role].some(({ id }) => id === requestedView) ? requestedView : defaultView[actor.role];
  const [view, setView] = useState<View>(initialView);

  useEffect(() => {
    setView(requestedView && roleViews[actor.role].some(({ id }) => id === requestedView) ? requestedView : defaultView[actor.role]);
    setFilters(defaultFilters);
  }, [actor.role, requestedView]);

  const sourceRecords = useMemo(
    () => isFixtureBound ? mergeOperationalAttendance(result, state) : [],
    [isFixtureBound, result, state],
  );
  const ownDirectoryRecord = sourceRecords.find(({ employee }) => employee.displayName === actor.name);
  const visibleSourceRecords = useMemo(() => actor.role === "employee" || actor.role === "finance"
    ? sourceRecords.filter(({ employee }) => employee.displayName === actor.name)
    : actor.role === "department_head" ? sourceRecords.filter(({ department }) => department?.id === ownDirectoryRecord?.department?.id) : sourceRecords, [actor.name, actor.role, ownDirectoryRecord?.department?.id, sourceRecords]);
  const records = useMemo(() => filterAttendanceRecords(visibleSourceRecords, filters), [filters, visibleSourceRecords]);
  const anomalies = useMemo(() => getAttendanceAnomalies(visibleSourceRecords), [visibleSourceRecords]);
  const visibleStats = useMemo(() => isFixtureBound && (actor.role === "hr" || actor.role === "executive") ? result.data.stats : { presentToday: visibleSourceRecords.filter(({ status }) => status === "normal").length, lateToday: visibleSourceRecords.filter(({ status }) => status === "late").length, leaveToday: visibleSourceRecords.filter(({ status }) => status === "leave").length, monthlyAttendanceRate: visibleSourceRecords.length ? Math.round(visibleSourceRecords.filter(({ status }) => status === "normal").length / visibleSourceRecords.length * 1_000) / 10 : 0 }, [actor.role, isFixtureBound, result.data.stats, visibleSourceRecords]);
  const showRecords = view === "overview" || view === "records";

  return (
    <main className="mx-auto flex w-full max-w-420 flex-col gap-4 px-3 pt-5 pb-26 sm:px-4 lg:px-5 lg:pt-9 lg:pb-6">
      <section className="relative overflow-hidden rounded-3xl border border-glass-border bg-background px-5 py-6 shadow-[0_18px_50px_rgba(60,105,170,0.08)] sm:px-7">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[url('/dashboard/welcome-space-bg.png')] bg-cover bg-[position:76%_center] opacity-75" />
        <div className="relative max-w-5xl">
          <PageHeader
            title="考勤管理"
            description={roleDescription[actor.role]}
            actions={<div className="flex flex-wrap items-center gap-2"><Badge variant="neutral" className="h-8 gap-1.5 rounded-xl px-3"><CalendarDays aria-hidden="true" className="size-3.5" />考勤周期 {state.attendance.period.month}</Badge>{actor.role !== "executive" && actor.role !== "hr" ? <Button asChild size="sm"><Link href="/leave"><Plane />请假申请</Link></Button> : null}</div>}
          />
        </div>
      </section>

      <GlassCard className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"><p className="text-xs text-muted-foreground"><strong className="text-foreground">当前身份：</strong>{actor.name} · {actor.roleLabel}。{actor.role === "employee" || actor.role === "finance" ? "仅显示本人数据。" : actor.role === "department_head" ? "仅显示本人及所负责团队。" : "按管理职责显示公司汇总。"}</p><AttendanceResetNotice /></GlassCard>
      <AttendanceWorkflowStrip />

      <nav aria-label="考勤工作区" className="flex w-full gap-1 overflow-x-auto rounded-xl border border-border/70 bg-white/60 p-1 sm:w-fit">{roleViews[actor.role].map((item) => <button key={item.id} type="button" role="tab" aria-selected={view === item.id} onClick={() => setView(item.id)} className={cn("h-9 shrink-0 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors", view === item.id && "bg-primary text-primary-foreground shadow-sm")}>{item.label}</button>)}</nav>

      {view === "self" ? <><TodayClockPanel /><AttendanceSelfService /></> : null}
      {view === "approvals" ? <AttendanceApprovalQueue /> : null}
      {view === "policy" ? <AttendancePolicyAndPeriod /> : null}

      {showRecords ? <>
        <AttendanceStats stats={visibleStats} />
        <section className="grid min-w-0 gap-4 xl:grid-cols-12">
          <GlassCard className="min-w-0 overflow-hidden p-3 sm:p-4 xl:col-span-8">
            <div className="flex flex-col gap-1 px-1 pb-3 sm:flex-row sm:items-end sm:justify-between"><div><h2 className="text-lg font-semibold text-foreground">考勤记录</h2><p className="mt-0.5 text-xs text-muted-foreground">打卡、已批准请假和已批准补卡使用同一份记录</p></div><span className="text-xs text-muted-foreground">计薪人数 {state.attendance.period.headcount} 人</span></div>
            {actor.role === "hr" || actor.role === "executive" ? <AttendanceFilters departments={result.data.departments} filters={filters} onFiltersChange={setFilters} onReset={() => setFilters(defaultFilters)} /> : null}
            <section aria-label="考勤记录" className="mt-3 border-t border-border/60 pt-1"><AttendanceRecordList records={records} /></section>
            <footer className="border-t border-border/60 px-2 pt-3 text-xs text-muted-foreground">当前显示 {records.length} 条考勤记录</footer>
          </GlassCard>
          <div className="grid min-w-0 content-start gap-4 xl:col-span-4"><GlassCard className="min-w-0 overflow-hidden p-4 sm:p-5"><AttendanceTrend trend={result.data.trend} /></GlassCard><GlassCard className="min-w-0 overflow-hidden p-4 sm:p-5"><AttendanceAnomalies records={anomalies} /></GlassCard></div>
        </section>
      </> : null}
    </main>
  );
}
