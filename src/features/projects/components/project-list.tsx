import {
  CalendarDays,
  FolderKanban,
  MoreHorizontal,
  SearchX,
  UsersRound,
} from "lucide-react";
import Link from "next/link";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getProjectHref } from "@/features/projects/project-navigation";
import type { MemberSummary, ProjectListItem } from "@/features/projects/types";

const statusLabels = {
  planning: "规划中",
  active: "进行中",
  on_hold: "已暂停",
  completed: "已完成",
  cancelled: "已取消",
} as const;

const statusTones = {
  planning: "neutral",
  active: "active",
  on_hold: "warning",
  completed: "success",
  cancelled: "neutral",
} as const;

const priorityLabels = {
  critical: "紧急",
  high: "高",
  medium: "中",
  low: "低",
} as const;

const priorityVariants = {
  critical: "destructive",
  high: "warning",
  medium: "info",
  low: "neutral",
} as const;

function formatDate(date: string) {
  return date.slice(5).replace("-", "/");
}

function initials(name: string) {
  return name.slice(-2);
}

function MemberAvatars({ members }: { members: readonly MemberSummary[] }) {
  const visibleMembers = members.slice(0, 3);

  return (
    <div className="flex items-center">
      {visibleMembers.map((member, index) => (
        <Avatar key={member.id} size="sm" className={index === 0 ? "" : "-ml-2 ring-2 ring-background"}>
          <AvatarFallback className="bg-brand-soft text-[10px] font-semibold text-primary">
            {initials(member.displayName)}
          </AvatarFallback>
        </Avatar>
      ))}
      {members.length > visibleMembers.length ? (
        <span className="-ml-1.5 grid size-7 place-items-center rounded-full bg-muted text-[10px] text-muted-foreground ring-2 ring-background">
          +{members.length - visibleMembers.length}
        </span>
      ) : null}
    </div>
  );
}

function ProjectEmpty() {
  return (
    <Empty className="min-h-64">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <SearchX aria-hidden="true" />
        </EmptyMedia>
        <EmptyTitle>没有匹配的项目</EmptyTitle>
        <EmptyDescription>调整搜索或筛选条件后再试。</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

type ProjectListProps = {
  projects: readonly ProjectListItem[];
};

export function ProjectList({ projects }: ProjectListProps) {
  if (projects.length === 0) {
    return <ProjectEmpty />;
  }

  return (
    <>
      <div className="hidden md:block">
        <Table aria-label="项目列表" className="border-separate border-spacing-y-1.5">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="min-w-70">项目名称</TableHead>
              <TableHead>负责人</TableHead>
              <TableHead>成员</TableHead>
              <TableHead>项目周期</TableHead>
              <TableHead className="min-w-40">进度</TableHead>
              <TableHead>优先级</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="w-12"><span className="sr-only">操作</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {projects.map((project, index) => (
              <TableRow key={project.id} className="h-19 border-0 bg-background/60 shadow-[inset_0_0_0_1px_rgba(213,225,244,0.8)] hover:bg-background/80">
                <TableCell className="rounded-l-xl">
                  <div className="flex items-center gap-3">
                    <div className={index % 3 === 0 ? "project-icon project-icon-blue" : index % 3 === 1 ? "project-icon project-icon-green" : "project-icon project-icon-purple"}>
                      <FolderKanban aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <Link
                        href={getProjectHref(project.id)}
                        aria-label={`查看${project.name}详情`}
                        className="font-semibold text-foreground transition-colors hover:text-primary"
                      >
                        {project.name}
                      </Link>
                      <p className="mt-1 text-xs text-muted-foreground">{project.code}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Avatar size="sm">
                      <AvatarFallback className="bg-linear-to-br from-primary to-chart-3 text-[10px] text-primary-foreground">
                        {initials(project.owner.displayName)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="font-medium text-foreground">{project.owner.displayName}</span>
                  </div>
                </TableCell>
                <TableCell><MemberAvatars members={project.members} /></TableCell>
                <TableCell>
                  <p className="text-xs text-muted-foreground">{formatDate(project.startDate)} 开始</p>
                  <p className="mt-1 text-xs font-medium text-foreground">{formatDate(project.dueDate)} 截止</p>
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Progress value={project.progress} className="h-1.5" />
                    <span className="w-9 text-right text-xs font-semibold text-foreground">{project.progress}%</span>
                  </div>
                </TableCell>
                <TableCell>
                  <Badge variant={priorityVariants[project.priority]}>{priorityLabels[project.priority]}</Badge>
                </TableCell>
                <TableCell>
                  <StatusBadge status={statusTones[project.status]}>{statusLabels[project.status]}</StatusBadge>
                </TableCell>
                <TableCell className="rounded-r-xl">
                  <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" aria-label={`打开${project.name}操作`}><MoreHorizontal aria-hidden="true" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem asChild><Link href={getProjectHref(project.id)}>查看项目详情</Link></DropdownMenuItem></DropdownMenuContent></DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="mt-3 border-t border-glass-border pt-3 text-xs text-muted-foreground">
          当前显示 {projects.length} 个项目
        </div>
      </div>

      <div className="flex flex-col gap-3 md:hidden">
        {projects.map((project, index) => (
          <article key={project.id} className="rounded-2xl border border-glass-border bg-background/70 p-4 shadow-[0_12px_32px_rgba(44,84,142,0.06)]">
            <div className="flex items-start gap-3">
              <div className={index % 3 === 0 ? "project-icon project-icon-blue" : index % 3 === 1 ? "project-icon project-icon-green" : "project-icon project-icon-purple"}>
                <FolderKanban aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold leading-6 text-foreground">
                      <Link
                        href={getProjectHref(project.id)}
                        aria-label={`查看${project.name}详情`}
                        className="transition-colors hover:text-primary"
                      >
                        {project.name}
                      </Link>
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">{project.code}</p>
                  </div>
                  <StatusBadge status={statusTones[project.status]}>{statusLabels[project.status]}</StatusBadge>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5"><UsersRound aria-hidden="true" className="size-3.5" />{project.owner.displayName} · {project.memberCount} 人</span>
                  <Badge variant={priorityVariants[project.priority]}>{priorityLabels[project.priority]}</Badge>
                </div>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <Progress value={project.progress} className="h-1.5" />
              <span className="text-sm font-semibold text-foreground">{project.progress}%</span>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><CalendarDays aria-hidden="true" className="size-3.5" />截止 {formatDate(project.dueDate)}</span>
              <MemberAvatars members={project.members} />
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
