import { KeyRound, ShieldCheck, UserCog } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
import { StatusBadge } from "@/components/ui/status-badge";
import type { AccountStatus, EmployeeDirectoryItem } from "@/features/hr/employee-types";

const accountStatusMeta: Record<AccountStatus, {
  label: string;
  tone: "active" | "success" | "warning" | "neutral";
}> = {
  active: { label: "正常使用", tone: "success" },
  invited: { label: "等待激活", tone: "active" },
  suspended: { label: "已暂停", tone: "warning" },
};

export function EmployeeAccountInfo({ employee }: { employee: EmployeeDirectoryItem }) {
  const account = employee.profile.account;

  return (
    <GlassCard className="p-5 sm:p-6 xl:col-span-2">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">账号与权限</h2>
          <p className="mt-1 text-xs text-muted-foreground">系统账号状态与已分配角色</p>
        </div>
        <div className="grid size-10 place-items-center rounded-2xl bg-primary/10 text-primary">
          <ShieldCheck aria-hidden="true" className="size-5" />
        </div>
      </div>

      {account ? (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-glass-border bg-background/55 p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <KeyRound aria-hidden="true" className="size-4 text-success" />
              账号状态
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className="font-medium text-foreground">账号已开通</span>
              <StatusBadge status={accountStatusMeta[account.status].tone}>
                {accountStatusMeta[account.status].label}
              </StatusBadge>
            </div>
          </div>

          <div className="rounded-2xl border border-glass-border bg-background/55 p-4">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <UserCog aria-hidden="true" className="size-4 text-chart-3" />
              系统角色
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {account.roles.length > 0 ? account.roles.map((role) => (
                <Badge key={role.code} variant="info" className="rounded-lg px-2.5">
                  {role.name}
                </Badge>
              )) : <span className="text-sm text-muted-foreground">暂未分配角色</span>}
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-5 rounded-2xl border border-dashed border-border bg-background/40 p-5 text-sm text-muted-foreground">
          该员工尚未关联量子智枢账号，员工档案仍可独立维护。
        </div>
      )}
    </GlassCard>
  );
}
