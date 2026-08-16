"use client";

import { Search, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";

import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { customerDemoSessions } from "@/features/demo/customer-demo-data";
import type { EmployeeDirectoryItem, EmployeeDirectoryResult } from "@/features/hr/employee-types";
import { MobileMemberRow } from "@/features/mobile-workstation/components/mobile-member-row";
import { getActor } from "@/features/operations/operations-data";
import { useOperations } from "@/features/operations/use-operations";

function sessionFor(employee: EmployeeDirectoryItem) {
  return customerDemoSessions.find(({ member }) => member.employeeProfileId === employee.profile.id);
}

export function MobileTeamPage({ result }: { result: EmployeeDirectoryResult }) {
  const session = useWorkspaceSession();
  const { actor, state } = useOperations(session);
  const [query, setQuery] = useState("");
  const scoped = useMemo(() => {
    const employees = result.data.employees;
    if (actor.role === "executive" || actor.role === "finance" || actor.role === "hr") return employees;
    if (actor.role === "department_head") {
      const self = employees.find(({ profile }) => profile.displayName === actor.name);
      return self ? employees.filter(({ profile }) => profile.id === self.profile.id || profile.managerEmployeeId === self.profile.id) : [];
    }
    return employees.filter(({ department }) => department?.name === actor.department);
  }, [actor.department, actor.name, actor.role, result.data.employees]);
  const visible = scoped.filter(({ profile, department }) => `${profile.displayName} ${profile.jobTitle} ${department?.name ?? ""}`.includes(query.trim()));
  const statusFor = (employee: EmployeeDirectoryItem) => {
    const personSession = sessionFor(employee);
    const personActor = personSession ? getActor(personSession.actor.id) : undefined;
    const active = personActor ? state.tasks.filter((task) => task.assigneeId === personActor.id && !["done"].includes(task.status)) : [];
    const status = active.some(({ status: taskStatus }) => taskStatus === "blocked")
      ? "暂不可用" as const
      : active.length >= 3
        ? "满负荷" as const
        : active.some(({ status: taskStatus }) => ["in_progress", "review"].includes(taskStatus))
          ? "执行中" as const
          : "可接受任务" as const;
    return { status, activeTaskCount: active.length };
  };
  const statuses = scoped.map(statusFor);
  const summaries = [
    ["团队成员", `${scoped.length} 人`],
    ["可接受任务", `${statuses.filter(({ status }) => status === "可接受任务").length} 人`],
    ["覆盖部门", `${new Set(scoped.flatMap(({ department }) => department ? [department.id] : [])).size} 个`],
  ] as const;

  return (
    <main className="mobile-page">
      <header className="mobile-page-header"><div><h1>团队</h1><p>查看权限范围内的成员与工作状态</p></div><span className="mobile-icon-button"><UsersRound aria-hidden="true" className="size-5" /></span></header>
      <section aria-label="团队概览" className="grid grid-cols-3 gap-2">
        {summaries.map(([label, value]) => <div data-testid="mobile-team-summary" key={label} className="mobile-team-summary"><strong>{value}</strong><span>{label}</span></div>)}
      </section>
      <label className="mobile-search-field mt-3"><Search aria-hidden="true" className="size-4" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名、岗位或部门" aria-label="搜索团队成员" /></label>
      <section aria-label="成员列表" className="mobile-list-surface mt-3">
        {visible.map((employee) => {
          const status = statusFor(employee);
          return <MobileMemberRow key={employee.profile.id} employee={employee} session={sessionFor(employee)} {...status} />;
        })}
        {!visible.length ? <p className="mobile-empty-state">没有找到相关成员</p> : null}
      </section>
    </main>
  );
}
