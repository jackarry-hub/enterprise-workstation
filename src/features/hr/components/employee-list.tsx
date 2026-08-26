import Link from "next/link";
import { ChevronRight, SearchX } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { StatusBadge } from "@/components/ui/status-badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

function EmployeeAvatar({ employee, large = false }: {
  employee: EmployeeDirectoryItem;
  large?: boolean;
}) {
  const { profile } = employee;

  return (
    <Avatar className={large ? "size-12" : "size-10"} size="lg">
      {profile.avatarUrl ? <AvatarImage src={profile.avatarUrl} alt={profile.displayName} /> : null}
      <AvatarFallback className="bg-linear-to-br from-primary/95 to-chart-3 text-sm font-semibold text-primary-foreground">
        {profile.displayName.slice(-2)}
      </AvatarFallback>
    </Avatar>
  );
}

function EmployeeStatusBadge({ status }: { status: EmploymentStatus }) {
  const meta = statusMeta[status];
  return <StatusBadge status={meta.tone}>{meta.label}</StatusBadge>;
}

export function EmployeeList({ employees }: { employees: EmployeeDirectoryItem[] }) {
  if (employees.length === 0) {
    return (
      <Empty className="min-h-80 border-0">
        <EmptyHeader>
          <EmptyMedia variant="icon"><SearchX aria-hidden="true" /></EmptyMedia>
          <EmptyTitle>没有找到匹配的员工</EmptyTitle>
          <EmptyDescription>请调整关键词、部门或员工状态后重试。</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <>
      <div className="hidden md:block">
        <Table>
          <TableHeader>
            <TableRow className="border-border/65 hover:bg-transparent">
              <TableHead className="pl-4">员工</TableHead>
              <TableHead>工号</TableHead>
              <TableHead>部门 / 岗位</TableHead>
              <TableHead>直属负责人</TableHead>
              <TableHead>状态</TableHead>
              <TableHead><span className="sr-only">查看详情</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {employees.map((employee) => {
              const { profile, department, manager } = employee;
              return (
                <TableRow key={profile.id} className="group border-border/55 hover:bg-primary/[0.035]">
                  <TableCell className="pl-4">
                    <div className="flex min-w-44 items-center gap-3">
                      <EmployeeAvatar employee={employee} />
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{profile.displayName}</p>
                        <p className="truncate text-xs text-muted-foreground">{profile.employeeNo}</p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{profile.employeeNo}</TableCell>
                  <TableCell>
                    <p className="font-medium text-foreground">{department?.name ?? "待分配"}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{profile.jobTitle}</p>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{manager?.displayName ?? "—"}</TableCell>
                  <TableCell><EmployeeStatusBadge status={profile.employmentStatus} /></TableCell>
                  <TableCell className="pr-4 text-right">
                    <Link
                      href={`/people/${profile.id}`}
                      aria-label={`查看${profile.displayName}的员工档案`}
                      className="inline-grid size-8 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ChevronRight aria-hidden="true" className="size-4" />
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <div className="grid gap-2 md:hidden">
        {employees.map((employee) => {
          const { profile, department, manager } = employee;
          return (
            <Link
              key={profile.id}
              href={`/people/${profile.id}`}
              aria-label={`查看${profile.displayName}的员工档案`}
              className="flex items-center gap-3 rounded-2xl border border-glass-border bg-background/65 p-3 transition-colors hover:bg-background/90"
            >
              <EmployeeAvatar employee={employee} large />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-foreground">{profile.displayName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{department?.name ?? "待分配"} · {profile.jobTitle}</p>
                  </div>
                  <EmployeeStatusBadge status={profile.employmentStatus} />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{profile.employeeNo}</span>
                  <span>负责人 {manager?.displayName ?? "—"}</span>
                </div>
              </div>
              <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
            </Link>
          );
        })}
      </div>
    </>
  );
}
