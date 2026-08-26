import Link from "next/link";
import { ArrowLeft, BriefcaseBusiness, Building2, IdCard, ShieldCheck } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
import { StatusBadge } from "@/components/ui/status-badge";
import type {
  EmployeeDirectoryItem,
  EmploymentStatus,
} from "@/features/hr/employee-types";

const statusMeta: Record<EmploymentStatus, {
  label: string;
  tone: "active" | "success" | "warning" | "neutral";
}> = {
  active: { label: "在职", tone: "success" },
  probation: { label: "试用期", tone: "active" },
  on_leave: { label: "休假中", tone: "warning" },
  departed: { label: "已离职", tone: "neutral" },
};

export function EmployeeDetailHeader({ employee }: { employee: EmployeeDirectoryItem }) {
  const { profile, department } = employee;
  const status = statusMeta[profile.employmentStatus];

  return (
    <>
      <Link
        href="/people"
        aria-label="返回员工目录"
        className="inline-flex w-fit items-center gap-1.5 rounded-xl px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-background/70 hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        返回员工目录
      </Link>

      <GlassCard className="relative overflow-hidden p-5 sm:p-7">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[url('/dashboard/welcome-space-bg.png')] bg-cover bg-[position:72%_center] opacity-70"
        />
        <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center">
          <Avatar className="size-20 ring-4 ring-background/80 sm:size-24" size="lg">
            {profile.avatarUrl ? <AvatarImage src={profile.avatarUrl} alt={profile.displayName} /> : null}
            <AvatarFallback className="bg-linear-to-br from-primary to-chart-3 text-2xl font-semibold text-primary-foreground">
              {profile.displayName.slice(-2)}
            </AvatarFallback>
          </Avatar>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                {profile.displayName}
              </h1>
              <StatusBadge status={status.tone}>{status.label}</StatusBadge>
              {profile.account ? (
                <Badge variant="info" className="gap-1 rounded-lg">
                  <ShieldCheck aria-hidden="true" className="size-3" />
                  账号已开通
                </Badge>
              ) : null}
            </div>
            <p className="mt-1.5 text-base text-muted-foreground">{profile.jobTitle}</p>

            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Building2 aria-hidden="true" className="size-4 text-primary" />
                {department?.name ?? "待分配部门"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <IdCard aria-hidden="true" className="size-4 text-primary" />
                {profile.employeeNo}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <BriefcaseBusiness aria-hidden="true" className="size-4 text-primary" />
                {profile.employmentType === "full_time" ? "全职" : "非全职"}
              </span>
            </div>
          </div>
        </div>
      </GlassCard>
    </>
  );
}
