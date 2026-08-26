import { BriefcaseBusiness, IdCard } from "lucide-react";

import { GlassCard } from "@/components/ui/glass-card";
import type { EmployeeDirectoryItem } from "@/features/hr/employee-types";

const iconClassName = "size-4 text-primary";

export function EmployeeBasicInfo({ employee }: { employee: EmployeeDirectoryItem }) {
  const { profile } = employee;
  const rows = [
    { label: "员工工号", value: profile.employeeNo, icon: IdCard },
    { label: "当前岗位", value: profile.jobTitle, icon: BriefcaseBusiness },
  ];

  return (
    <GlassCard className="p-5 sm:p-6">
      <h2 className="text-lg font-semibold text-foreground">基本信息</h2>
      <p className="mt-1 text-xs text-muted-foreground">公开目录基础档案</p>
      <dl className="mt-5 divide-y divide-border/60">
        {rows.map(({ label, value, icon: Icon }) => (
          <div key={label} className="grid gap-1 py-3 first:pt-0 sm:grid-cols-[8rem_1fr] sm:items-center">
            <dt className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon aria-hidden="true" className={iconClassName} />
              {label}
            </dt>
            <dd className="break-all text-sm font-medium text-foreground sm:text-right">{value}</dd>
          </div>
        ))}
      </dl>
    </GlassCard>
  );
}
