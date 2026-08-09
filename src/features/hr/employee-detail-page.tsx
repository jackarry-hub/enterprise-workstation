"use client";

import Link from "next/link";
import { LockKeyhole } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { EmployeeAccountInfo } from "@/features/hr/components/employee-account-info";
import { EmployeeBasicInfo } from "@/features/hr/components/employee-basic-info";
import { EmployeeDetailHeader } from "@/features/hr/components/employee-detail-header";
import { EmployeeOrganizationInfo } from "@/features/hr/components/employee-organization-info";
import type { EmployeeDirectoryItem } from "@/features/hr/employee-types";
import { useDemoSession } from "@/features/operations/demo-session";

export function EmployeeDetailPage({ employee }: { employee: EmployeeDirectoryItem }) {
  const { actor } = useDemoSession();
  const isOwnProfile = employee.profile.displayName === actor.name;
  const isDirectReport = employee.manager?.displayName === actor.name;
  const canView = actor.role === "executive" || actor.role === "hr" || (actor.role === "department_head" && (isOwnProfile || isDirectReport));

  if (!canView) {
    return <main className="mx-auto w-full max-w-3xl px-4 py-16"><GlassCard className="p-8 text-center"><LockKeyhole className="mx-auto size-8 text-primary" /><h1 className="mt-3 text-xl font-semibold">该员工不在你的管理范围内</h1><p className="mt-2 text-sm text-muted-foreground">只能查看本人或直属团队成员的档案。</p><Button asChild className="mt-5"><Link href={actor.landingPath}>返回我的工作台</Link></Button></GlassCard></main>;
  }

  return (
    <main className="mx-auto flex w-full max-w-420 flex-col gap-4 px-3 pt-5 pb-10 sm:px-4 lg:px-5 lg:pt-7 lg:pb-6">
      <EmployeeDetailHeader employee={employee} />
      <div className="grid gap-4 xl:grid-cols-2">
        <EmployeeBasicInfo employee={employee} />
        <EmployeeOrganizationInfo employee={employee} />
        <EmployeeAccountInfo employee={employee} />
      </div>
    </main>
  );
}
