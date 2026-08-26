"use client";

import { CalendarDays, Mail, Phone } from "lucide-react";

import { GlassCard } from "@/components/ui/glass-card";
import { EmployeeAccountInfo } from "@/features/hr/components/employee-account-info";
import { EmployeeBasicInfo } from "@/features/hr/components/employee-basic-info";
import { EmployeeDetailHeader } from "@/features/hr/components/employee-detail-header";
import { EmployeeOrganizationInfo } from "@/features/hr/components/employee-organization-info";
import type { EmployeeDirectoryItem, EmployeePrivateProfile } from "@/features/hr/employee-types";

function EmployeePrivateInfo({ privateProfile }: { privateProfile: EmployeePrivateProfile }) {
  const rows = [
    { label: "私人邮箱", value: privateProfile.privateEmail, icon: Mail },
    { label: "联系电话", value: privateProfile.phone, icon: Phone },
    { label: "入职日期", value: privateProfile.hireDate, icon: CalendarDays },
    { label: "离职日期", value: privateProfile.departureDate, icon: CalendarDays },
  ].filter((row): row is { label: string; value: string; icon: typeof Mail } => Boolean(row.value));

  if (rows.length === 0) return null;

  return (
    <GlassCard className="p-5 sm:p-6 xl:col-span-2">
      <h2 className="text-lg font-semibold text-foreground">私密人事资料</h2>
      <p className="mt-1 text-xs text-muted-foreground">仅展示服务器已授权的资料</p>
      <dl className="mt-5 divide-y divide-border/60">
        {rows.map(({ label, value, icon: Icon }) => (
          <div key={label} className="grid gap-1 py-3 first:pt-0 sm:grid-cols-[8rem_1fr] sm:items-center">
            <dt className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon aria-hidden="true" className="size-4 text-primary" />
              {label}
            </dt>
            <dd className="break-all text-sm font-medium text-foreground sm:text-right">{value}</dd>
          </div>
        ))}
      </dl>
    </GlassCard>
  );
}

export function EmployeeDetailPage({
  employee,
  privateProfile,
}: {
  employee: EmployeeDirectoryItem;
  privateProfile?: EmployeePrivateProfile;
}) {
  return (
    <main className="mx-auto flex w-full max-w-420 flex-col gap-4 px-3 pt-5 pb-10 sm:px-4 lg:px-5 lg:pt-7 lg:pb-6">
      <EmployeeDetailHeader employee={employee} />
      <div className="grid gap-4 xl:grid-cols-2">
        <EmployeeBasicInfo employee={employee} />
        <EmployeeOrganizationInfo employee={employee} />
        {employee.profile.account ? <EmployeeAccountInfo employee={employee} /> : null}
        {privateProfile ? <EmployeePrivateInfo privateProfile={privateProfile} /> : null}
      </div>
    </main>
  );
}
