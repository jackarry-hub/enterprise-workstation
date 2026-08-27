"use client";

import { useMemo, useState } from "react";
import { Database, UsersRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
import { PageHeader } from "@/components/ui/page-header";
import { RealDataNotice } from "@/components/ui/real-data-boundary";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { EmployeeFilters } from "@/features/hr/components/employee-filters";
import { EmployeeList } from "@/features/hr/components/employee-list";
import { EmployeeStats } from "@/features/hr/components/employee-stats";
import { filterEmployees } from "@/features/hr/employee-selectors";
import { OrganizationDialogs } from "@/features/organization/organization-dialogs";
import type {
  ManagerCommandTargetsResult,
  RoleCommandTarget,
} from "@/features/organization/organization-command-data";
import type {
  EmployeeDirectoryFilters,
  EmployeeDirectoryResult,
} from "@/features/hr/employee-types";

const defaultFilters: EmployeeDirectoryFilters = {
  query: "",
  departmentId: "all",
  status: "all",
};

export function PeopleWorkspace({
  result,
  roleTargets,
  managerTargets,
}: {
  result: EmployeeDirectoryResult;
  roleTargets: readonly RoleCommandTarget[];
  managerTargets: ManagerCommandTargetsResult;
}) {
  const session = useWorkspaceSession();
  const [filters, setFilters] = useState(defaultFilters);
  const employees = useMemo(
    () => filterEmployees(result.data.employees, filters),
    [filters, result.data.employees],
  );
  const canManageOrganization = session.permissionCodes.includes("organization.manage");
  const canManageRoles = session.permissionCodes.includes("role.manage");

  return (
    <main className="mx-auto flex w-full max-w-420 flex-col gap-4 px-3 pt-5 pb-10 sm:px-4 lg:px-5 lg:pt-9 lg:pb-6">
      <section className="relative overflow-hidden rounded-3xl border border-glass-border bg-background px-5 py-6 shadow-[0_18px_50px_rgba(60,105,170,0.08)] sm:px-7">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[url('/dashboard/welcome-space-bg.png')] bg-cover bg-[position:76%_center] opacity-75"
        />
        <div className="relative max-w-3xl">
          <PageHeader
            title="组织人事"
            description="统一查看企业员工档案与组织归属，让人员信息清晰、协作关系可追溯。"
            actions={(
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="info" className="h-8 gap-1.5 rounded-xl px-3">
                  <UsersRound aria-hidden="true" className="size-3.5" />
                  员工目录
                </Badge>
                <OrganizationDialogs
                  canManageOrganization={canManageOrganization}
                  canManageRoles={canManageRoles}
                  roleTargets={roleTargets}
                  managerTargets={managerTargets}
                />
              </div>
            )}
          />
        </div>
      </section>

      <EmployeeStats stats={result.data.stats} />

      {result.data.loadError ? <RealDataNotice message={result.data.loadError} /> : null}

      <GlassCard className="min-w-0 overflow-hidden p-3 sm:p-4">
        <div className="flex flex-col gap-1 px-1 pb-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold text-foreground">员工目录</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">按姓名、工号、部门和在职状态快速定位员工</p>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Database aria-hidden="true" className="size-3.5" />
            {result.source === "mock" ? "本地人员数据" : "企业云端数据"}
          </div>
        </div>

          <EmployeeFilters
          departments={result.data.departments}
          filters={filters}
          onFiltersChange={setFilters}
          onReset={() => setFilters(defaultFilters)}
        />

        <section aria-label="员工目录" className="mt-3 border-t border-border/60 pt-1">
          <EmployeeList employees={employees} />
        </section>

        <footer className="border-t border-border/60 px-2 pt-3 text-xs text-muted-foreground">
          当前显示 {employees.length} 名员工
        </footer>
      </GlassCard>
    </main>
  );
}
