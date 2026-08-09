import { BriefcaseBusiness, Building2, CalendarClock, UserRoundCheck } from "lucide-react";

import { GlassCard } from "@/components/ui/glass-card";
import type { EmployeeDirectoryItem, EmploymentType } from "@/features/hr/employee-types";

const employmentTypeLabels: Record<EmploymentType, string> = {
  full_time: "全职员工",
  part_time: "兼职员工",
  contractor: "外部协作",
  intern: "实习员工",
};

export function EmployeeOrganizationInfo({ employee }: { employee: EmployeeDirectoryItem }) {
  const { profile, department, manager } = employee;
  const rows = [
    { label: "所属部门", value: department?.name ?? "待分配", icon: Building2 },
    { label: "当前岗位", value: profile.jobTitle, icon: BriefcaseBusiness },
    { label: "直属负责人", value: manager?.displayName ?? "无", icon: UserRoundCheck },
    { label: "用工类型", value: employmentTypeLabels[profile.employmentType], icon: CalendarClock },
  ];

  return (
    <GlassCard className="p-5 sm:p-6">
      <h2 className="text-lg font-semibold text-foreground">组织关系</h2>
      <p className="mt-1 text-xs text-muted-foreground">部门归属、岗位与汇报关系</p>
      <dl className="mt-5 divide-y divide-border/60">
        {rows.map(({ label, value, icon: Icon }) => (
          <div key={label} className="grid gap-1 py-3 first:pt-0 sm:grid-cols-[8rem_1fr] sm:items-center">
            <dt className="flex items-center gap-2 text-sm text-muted-foreground">
              <Icon aria-hidden="true" className="size-4 text-chart-3" />
              {label}
            </dt>
            <dd className="text-sm font-medium text-foreground sm:text-right">{value}</dd>
          </div>
        ))}
      </dl>
    </GlassCard>
  );
}
