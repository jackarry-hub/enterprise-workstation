"use client";

import { useState } from "react";
import {
  Bot, BriefcaseBusiness, CalendarDays, CheckCircle2, CircleDot, Clock3,
  FileCheck2, LockKeyhole, Mail, Phone, Sparkles, Target, UserRoundCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { GlassCard } from "@/components/ui/glass-card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EmployeeAccountInfo } from "@/features/hr/components/employee-account-info";
import { EmployeeBasicInfo } from "@/features/hr/components/employee-basic-info";
import { EmployeeDetailHeader } from "@/features/hr/components/employee-detail-header";
import { EmployeeOrganizationInfo } from "@/features/hr/components/employee-organization-info";
import type {
  EmployeeCapabilityCenter,
  EmployeeDirectoryItem,
  EmployeePrivateProfile,
} from "@/features/hr/employee-types";

type EmployeeDetailTab = "profile" | "capability" | "work" | "agent";

const statusLabel: Record<string, string> = {
  backlog: "待规划", todo: "待开始", in_progress: "进行中", blocked: "已阻塞",
  in_review: "待验收", done: "已完成", cancelled: "已取消",
  queued: "排队中", running: "运行中", succeeded: "已完成", failed: "失败",
};

function EmployeeCapabilityPanel({ capability }: { capability: EmployeeCapabilityCenter }) {
  const verified = capability.skills.filter(({ verificationStatus }) => verificationStatus === "verified");
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(18rem,.7fr)]">
      <GlassCard className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div><h2 className="flex items-center gap-2 text-lg font-semibold"><Sparkles className="size-5 text-primary" />能力画像</h2>
            <p className="mt-1 text-sm text-muted-foreground">能力来自员工申报、业务证据与正式验证。</p></div>
          <Badge variant="success">{verified.length} 项已验证</Badge>
        </div>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {capability.skills.length ? capability.skills.map((skill) => (
            <article key={skill.id} className="rounded-2xl border border-border/70 bg-white/55 p-4">
              <div className="flex items-start justify-between gap-2"><div><h3 className="font-medium">{skill.name}</h3><p className="mt-1 text-xs text-muted-foreground">{skill.code}</p></div>
                <Badge variant={skill.verificationStatus === "verified" ? "success" : "outline"}>{skill.verificationStatus === "verified" ? "已验证" : "待验证"}</Badge></div>
              <div className="mt-4 flex items-center gap-1" aria-label={`${skill.name} ${skill.level ?? 0}级`}>
                {Array.from({ length: 5 }, (_, index) => <span key={index} className={`h-2 flex-1 rounded-full ${index < (skill.level ?? 0) ? "bg-primary" : "bg-muted"}`} />)}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">能力等级 {skill.level ?? "待评估"}{skill.yearsExperience !== undefined ? ` · ${skill.yearsExperience} 年经验` : ""}</p>
            </article>
          )) : <p className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground sm:col-span-2">尚未维护能力标签。</p>}
        </div>
      </GlassCard>
      <div className="grid content-start gap-4">
        <GlassCard className="p-5"><h2 className="flex items-center gap-2 font-semibold"><Target className="size-4 text-primary" />成长目标</h2>
          <div className="mt-4 flex flex-wrap gap-2">{capability.workProfile?.growthGoals.length ? capability.workProfile.growthGoals.map((goal) => <Badge key={goal} variant="outline">{goal}</Badge>) : <span className="text-sm text-muted-foreground">尚未设置</span>}</div></GlassCard>
        <GlassCard className="p-5"><h2 className="flex items-center gap-2 font-semibold"><BriefcaseBusiness className="size-4 text-primary" />偏好任务</h2>
          <div className="mt-4 flex flex-wrap gap-2">{capability.workProfile?.preferredTaskTypes.length ? capability.workProfile.preferredTaskTypes.map((item) => <Badge key={item}>{item}</Badge>) : <span className="text-sm text-muted-foreground">尚未设置</span>}</div></GlassCard>
      </div>
    </div>
  );
}

function EmployeeWorkPanel({ capability }: { capability: EmployeeCapabilityCenter }) {
  if (!capability.canViewWork) return <RestrictedPanel label="工作轨迹仅对本人、直属主管和授权 HR 开放。" />;
  const stats = [
    ["进行中", capability.workload?.inProgressTasks ?? 0, CircleDot],
    ["待验收", capability.workload?.awaitingReviewTasks ?? 0, Clock3],
    ["已完成", capability.workload?.completedTasks ?? 0, CheckCircle2],
    ["当前待办", capability.workload?.openTasks ?? 0, BriefcaseBusiness],
  ] as const;
  return <div className="grid gap-4">
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{stats.map(([label, value, Icon]) => <GlassCard key={label} className="p-4 sm:p-5"><Icon className="size-5 text-primary" /><p className="mt-4 text-2xl font-semibold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{label}</p></GlassCard>)}</div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(20rem,.75fr)]">
      <GlassCard className="p-5 sm:p-6"><div className="flex items-center justify-between"><h2 className="font-semibold">真实任务负载</h2><Badge variant="outline">周容量 {capability.workProfile?.weeklyCapacityHours ?? "—"} 小时</Badge></div>
        <div className="mt-4 grid gap-3">{capability.assignments.length ? capability.assignments.map((task) => <article key={task.id} className="rounded-2xl border border-border/70 bg-white/55 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="text-sm font-medium">{task.title}</h3><p className="mt-1 text-xs text-muted-foreground">{task.projectName}{task.dueDate ? ` · 截止 ${task.dueDate}` : ""}</p></div><Badge variant={task.status === "done" ? "success" : task.status === "blocked" ? "destructive" : "outline"}>{statusLabel[task.status] ?? task.status}</Badge></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary" style={{ width: `${task.progress}%` }} /></div></article>) : <p className="rounded-2xl border border-dashed p-5 text-sm text-muted-foreground">当前没有分配任务。</p>}</div>
      </GlassCard>
      <GlassCard className="p-5 sm:p-6"><h2 className="flex items-center gap-2 font-semibold"><FileCheck2 className="size-4 text-success" />验收证据</h2><div className="mt-4 grid gap-3">{capability.evidence.length ? capability.evidence.map((event) => <article key={event.id} className="border-l-2 border-primary/30 pl-3"><div className="flex items-center gap-2"><Badge variant={event.decision === "reject" ? "destructive" : event.decision === "pass" ? "success" : "outline"}>{event.decision === "pass" ? "通过" : event.decision === "reject" ? "退回" : "提交"}</Badge><span className="text-xs text-muted-foreground">{new Date(event.occurredAt).toLocaleDateString("zh-CN")}</span></div><p className="mt-2 text-sm font-medium">{event.taskTitle}</p><p className="mt-1 text-xs text-muted-foreground">{event.projectName}</p></article>) : <p className="text-sm text-muted-foreground">尚无任务验收证据。</p>}</div></GlassCard>
    </div>
  </div>;
}

function RestrictedPanel({ label }: { label: string }) {
  return <GlassCard className="grid min-h-52 place-items-center p-8 text-center"><div><LockKeyhole className="mx-auto size-7 text-primary" /><p className="mt-3 text-sm text-muted-foreground">{label}</p></div></GlassCard>;
}

function EmployeeAgentPanel({ capability }: { capability: EmployeeCapabilityCenter }) {
  if (!capability.canViewAgent) return <RestrictedPanel label="AI 协作记录仅对本人和 Agent 管理员开放。" />;
  return <GlassCard className="p-5 sm:p-6"><div className="flex items-start justify-between gap-3"><div><h2 className="flex items-center gap-2 text-lg font-semibold"><Bot className="size-5 text-primary" />AI 协作记录</h2><p className="mt-1 text-sm text-muted-foreground">Agent 是员工的辅助工具，所有运行保留模型、成本与结果轨迹。</p></div><Badge variant="outline">{capability.agentRuns.length} 次</Badge></div>
    <div className="mt-5 grid gap-3 lg:grid-cols-2">{capability.agentRuns.length ? capability.agentRuns.map((run) => <article key={run.id} className="rounded-2xl border border-border/70 bg-white/55 p-4"><div className="flex items-start justify-between gap-3"><div><h3 className="font-medium">{run.agentName}</h3><p className="mt-1 text-xs text-muted-foreground">{run.modelCode} · {new Date(run.startedAt).toLocaleString("zh-CN")}</p></div><Badge variant={run.status === "succeeded" ? "success" : run.status === "failed" ? "destructive" : "outline"}>{statusLabel[run.status] ?? run.status}</Badge></div><p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{run.outputSummary || run.inputSummary || "运行未返回可展示摘要"}</p><div className="mt-3 flex gap-3 text-xs text-muted-foreground"><span>成本 {run.cost.toFixed(4)}</span><span>耗时 {run.latencyMs === undefined ? "—" : `${run.latencyMs}ms`}</span></div></article>) : <p className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground lg:col-span-2">尚无 Agent 协作记录。</p>}</div></GlassCard>;
}

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
  capabilityCenter,
  capabilityLoadError,
}: {
  employee: EmployeeDirectoryItem;
  privateProfile?: EmployeePrivateProfile;
  capabilityCenter?: EmployeeCapabilityCenter;
  capabilityLoadError?: string;
}) {
  const [activeTab, setActiveTab] = useState<EmployeeDetailTab>("profile");
  return (
    <main className="mx-auto flex w-full max-w-420 flex-col gap-4 px-3 pt-5 pb-10 sm:px-4 lg:px-5 lg:pt-7 lg:pb-6">
      <EmployeeDetailHeader employee={employee} />
      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as EmployeeDetailTab)}>
        <div className="scrollbar-none overflow-x-auto rounded-2xl border border-glass-border bg-glass px-2 shadow-[0_12px_32px_rgba(44,84,142,0.06)] backdrop-blur-xl sm:px-4"><TabsList variant="line" className="h-13 min-w-max gap-1 sm:gap-3">
          <TabsTrigger value="profile" className="h-11 min-w-20"><UserRoundCheck className="size-4" />档案</TabsTrigger>
          <TabsTrigger value="capability" className="h-11 min-w-20"><Sparkles className="size-4" />能力</TabsTrigger>
          <TabsTrigger value="work" className="h-11 min-w-20"><BriefcaseBusiness className="size-4" />工作轨迹</TabsTrigger>
          <TabsTrigger value="agent" className="h-11 min-w-20"><Bot className="size-4" />AI 协作</TabsTrigger>
        </TabsList></div>
        {activeTab === "profile" ? <div className="grid gap-4 xl:grid-cols-2"><EmployeeBasicInfo employee={employee} /><EmployeeOrganizationInfo employee={employee} />{employee.profile.account ? <EmployeeAccountInfo employee={employee} /> : null}{privateProfile ? <EmployeePrivateInfo privateProfile={privateProfile} /> : null}</div> : null}
        {activeTab !== "profile" && capabilityLoadError ? <GlassCard className="p-5 text-sm text-destructive">{capabilityLoadError}</GlassCard> : null}
        {activeTab === "capability" && capabilityCenter ? <EmployeeCapabilityPanel capability={capabilityCenter} /> : null}
        {activeTab === "work" && capabilityCenter ? <EmployeeWorkPanel capability={capabilityCenter} /> : null}
        {activeTab === "agent" && capabilityCenter ? <EmployeeAgentPanel capability={capabilityCenter} /> : null}
      </Tabs>
    </main>
  );
}
