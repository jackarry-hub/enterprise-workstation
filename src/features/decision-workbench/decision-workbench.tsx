"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Bot,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock3,
  GitBranch,
  ListChecks,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Send,
  Sparkles,
  Target,
  UserRound,
  UsersRound,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { ProgressBar } from "@/components/ui/progress-bar";
import { Textarea } from "@/components/ui/textarea";
import {
  clearStoredDecision,
  createDecisionPlan,
  createDraftDecision,
  dispatchDecisionPlan,
  findDecisionProject,
  getDecisionCandidateRanking,
  getDecisionProgress,
  getDecisionTalentProfile,
  hydrateDecisionPlan,
  readStoredDecision,
  saveStoredDecision,
} from "@/features/decision-workbench/decision-workbench-data";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { useOperationFixtureContext } from "@/features/operations/use-operations";
import type {
  DecisionInput,
  DecisionPlan,
  DecisionStage,
  DecisionTask,
  DecisionTaskStatus,
  DepartmentPlan,
  StoredDecision,
  WorkTag,
} from "@/features/decision-workbench/decision-workbench-types";
import { PROJECTS_CHANGED_EVENT } from "@/features/projects/data/mock-project-repository";
import type { ProjectDetailData } from "@/features/projects/types";
import { cn } from "@/lib/utils";

const workflowSteps = [
  { label: "决策输入", description: "目标与约束" },
  { label: "AI 拆解", description: "部门与个人" },
  { label: "协同执行", description: "任务与反馈" },
  { label: "汇总复盘", description: "结果回流" },
] as const;

const statusLabels: Record<DecisionTaskStatus, string> = {
  pending: "待开始",
  in_progress: "进行中",
  in_review: "待验收",
  done: "已完成",
};

const statusVariants: Record<DecisionTaskStatus, "neutral" | "info" | "warning" | "success"> = {
  pending: "neutral",
  in_progress: "info",
  in_review: "warning",
  done: "success",
};

const priorityLabels = { low: "低", medium: "中", high: "高", urgent: "紧急" } as const;

const workTagClasses: Record<WorkTag["tone"], string> = {
  strength: "bg-success-soft text-success",
  watch: "bg-warning-soft text-warning",
  capacity: "bg-brand-soft text-primary",
  skill: "bg-chart-3/10 text-chart-3",
};

function WorkTagChip({ tag }: { tag: WorkTag }) {
  return (
    <span title={tag.evidence} className={cn("inline-flex rounded-full px-2 py-1 text-[10px] font-semibold", workTagClasses[tag.tone])}>
      {tag.label}
    </span>
  );
}

function WorkflowStepper({ currentStep }: { currentStep: number }) {
  return (
    <GlassCard className="overflow-x-auto p-1.5 sm:p-2">
      <ol aria-label="决策推进流程" className="flex min-w-172 items-center">
        {workflowSteps.map((step, index) => {
          const completed = index < currentStep;
          const active = index === currentStep;
          return (
            <li key={step.label} className="flex min-w-0 flex-1 items-center">
              <div
                aria-current={active ? "step" : undefined}
                className={cn(
                  "flex min-w-0 items-center gap-2 rounded-xl px-2 py-1.5",
                  active && "bg-brand-soft",
                )}
              >
                <span className={cn(
                  "grid size-7 shrink-0 place-items-center rounded-full border text-xs font-semibold",
                  completed && "border-success bg-success text-white",
                  active && "border-primary bg-primary text-white",
                  !completed && !active && "border-border bg-white text-muted-foreground",
                )}>
                  {completed ? <Check aria-hidden="true" className="size-4" /> : index + 1}
                </span>
                <span className="min-w-0">
                  <span className={cn("block truncate text-sm font-semibold", !active && !completed && "text-muted-foreground")}>{step.label}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">{step.description}</span>
                </span>
              </div>
              {index < workflowSteps.length - 1 ? <ArrowRight aria-hidden="true" className="mx-1 size-4 shrink-0 text-border" /> : null}
            </li>
          );
        })}
      </ol>
    </GlassCard>
  );
}

function DecisionInputCard({
  stage,
  input,
  busy,
  feedback,
  onChange,
  onGenerate,
  onEdit,
}: {
  stage: DecisionStage;
  input: DecisionInput;
  busy: boolean;
  feedback: string;
  onChange: (input: DecisionInput) => void;
  onGenerate: () => void;
  onEdit: () => void;
}) {
  const update = (key: keyof DecisionInput, value: string) => onChange({ ...input, [key]: value });
  const readonly = stage !== "draft";

  return (
    <GlassCard className="h-fit p-4 sm:p-5 md:sticky md:top-22">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-brand-soft text-primary"><Target aria-hidden="true" className="size-5" /></span>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold">决策输入</h2>
            <Badge variant="info">公司级</Badge>
          </div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">决策人只定义问题、边界和成功标准。</p>
        </div>
      </div>

      {readonly ? (
        <div className="mt-5 grid gap-3">
          <div className="rounded-2xl border border-border/70 bg-background/65 p-3.5">
            <p className="text-[11px] font-medium text-muted-foreground">战略问题 / 目标</p>
            <p className="mt-1.5 text-sm font-semibold leading-6">{input.goal}</p>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-muted/65 p-3"><p className="text-[11px] text-muted-foreground">硬性截止</p><p className="mt-1 text-sm font-semibold">{input.deadline}</p></div>
            <div className="rounded-xl bg-muted/65 p-3"><p className="text-[11px] text-muted-foreground">预算上限</p><p className="mt-1 text-sm font-semibold">{input.budget} 万元</p></div>
          </div>
          <div className="rounded-xl bg-muted/65 p-3"><p className="text-[11px] text-muted-foreground">关键约束</p><p className="mt-1 text-xs leading-5">{input.constraints || "暂无额外约束"}</p></div>
          {stage === "review" ? <Button type="button" variant="outline" onClick={onEdit}><RotateCcw data-icon="inline-start" aria-hidden="true" />重新编辑目标</Button> : null}
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          <label className="grid gap-1.5 text-xs font-medium">
            战略问题 / 目标
            <Textarea aria-label="战略问题或目标" value={input.goal} onChange={(event) => update("goal", event.target.value)} className="min-h-24 max-h-24 resize-none bg-white/75 text-sm leading-6" placeholder="例如：在 30 天内完成企业 AI 工作站试点上线" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="grid gap-1.5 text-xs font-medium">硬性截止日期<Input aria-label="硬性截止日期" type="date" value={input.deadline} onChange={(event) => update("deadline", event.target.value)} className="bg-white/75" /></label>
            <label className="grid gap-1.5 text-xs font-medium">预算上限（万元）<Input aria-label="预算上限" type="number" min="1" value={input.budget} onChange={(event) => update("budget", event.target.value)} className="bg-white/75" /></label>
          </div>
          <label className="grid gap-1.5 text-xs font-medium">关键约束<Input aria-label="关键约束" value={input.constraints} onChange={(event) => update("constraints", event.target.value)} className="bg-white/75" placeholder="人数、合规、稳定性等硬性条件" /></label>
          {feedback ? <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-xs font-medium text-destructive">{feedback}</p> : null}
          <Button type="button" onClick={onGenerate} disabled={busy} className="h-10 rounded-xl shadow-[0_12px_26px_rgba(47,125,246,0.22)]">
            {busy ? <LoaderCircle data-icon="inline-start" aria-hidden="true" className="animate-spin" /> : <Sparkles data-icon="inline-start" aria-hidden="true" />}
            {busy ? "AI 正在拆解并匹配责任人…" : "让 AI 拆解并分工"}
          </Button>
          <p className="hidden items-start gap-1.5 text-[11px] leading-5 text-muted-foreground xl:flex"><CheckCircle2 aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-success" />生成后先由决策人确认，不会直接下发。</p>
        </div>
      )}
    </GlassCard>
  );
}

function DraftPreview() {
  const capabilities = [
    { icon: GitBranch, title: "拆成可执行任务", text: "目标、依赖、优先级和验收标准" },
    { icon: Building2, title: "分到具体部门", text: "每个部门都有明确承接目标" },
    { icon: UsersRound, title: "落到唯一负责人", text: "每项任务只有一位最终责任人" },
    { icon: RefreshCw, title: "持续回流结果", text: "进度、阻塞和待决策项自动汇总" },
  ] as const;
  return (
    <GlassCard className="min-h-108 p-5 sm:p-6">
      <div className="mx-auto max-w-3xl py-8 text-center sm:py-12">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-linear-to-br from-primary to-chart-3 text-white shadow-[0_16px_36px_rgba(47,125,246,0.24)]"><Bot aria-hidden="true" className="size-7" /></span>
        <Badge variant="info" className="mt-5">AI 调度中枢</Badge>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight">把一个决策，清楚地落到每个人头上</h2>
        <p className="mx-auto mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">填写左侧目标与约束。AI 会先给出责任方案，确认后再同步到项目和任务中心。</p>
        <div className="mt-8 grid gap-3 text-left sm:grid-cols-2">
          {capabilities.map(({ icon: Icon, title, text }) => (
            <div key={title} className="flex gap-3 rounded-2xl border border-border/70 bg-white/55 p-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-primary"><Icon aria-hidden="true" className="size-4.5" /></span>
              <div><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p></div>
            </div>
          ))}
        </div>
      </div>
    </GlassCard>
  );
}

function FlowNode({ icon: Icon, eyebrow, title, tone = "blue" }: { icon: typeof Target; eyebrow: string; title: string; tone?: "blue" | "purple" | "green" }) {
  const classes = tone === "green" ? "bg-success-soft text-success" : tone === "purple" ? "bg-chart-3/10 text-chart-3" : "bg-brand-soft text-primary";
  return (
    <div className="min-w-31 flex-1 rounded-2xl border border-border/70 bg-white/62 p-3">
      <span className={cn("grid size-8 place-items-center rounded-xl", classes)}><Icon aria-hidden="true" className="size-4" /></span>
      <p className="mt-2 text-[10px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{eyebrow}</p>
      <p className="mt-0.5 text-sm font-semibold">{title}</p>
    </div>
  );
}

function ResponsibilityFlow({ plan }: { plan: DecisionPlan }) {
  const people = new Set(plan.departments.flatMap(({ tasks }) => tasks.map(({ assignee }) => assignee.id))).size;
  const tasks = plan.departments.flatMap(({ tasks: departmentTasks }) => departmentTasks).length;
  return (
    <GlassCard className="min-w-0 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <div><h2 className="text-base font-semibold">责任链路</h2><p className="mt-1 text-xs text-muted-foreground">从决策到回流，责任逐层展开但不失去归口。</p></div>
        <Badge variant="success">唯一责任人已匹配</Badge>
      </div>
      <div className="scrollbar-none mt-4 flex items-stretch gap-2 overflow-x-auto pb-1">
        <FlowNode icon={UserRound} eyebrow="决策人" title="李总 · 最终把关" />
        <ArrowRight aria-hidden="true" className="my-auto size-4 shrink-0 text-border" />
        <FlowNode icon={Bot} eyebrow="AI 调度中枢" title="目标 → WBS" tone="purple" />
        <ArrowRight aria-hidden="true" className="my-auto size-4 shrink-0 text-border" />
        <FlowNode icon={Building2} eyebrow={`${plan.departments.length} 个部门`} title="部门负责人承接" />
        <ArrowRight aria-hidden="true" className="my-auto size-4 shrink-0 text-border" />
        <FlowNode icon={UsersRound} eyebrow={`${people} 位负责人`} title={`${tasks} 项个人任务`} />
        <ArrowRight aria-hidden="true" className="my-auto size-4 shrink-0 text-border" />
        <FlowNode icon={RefreshCw} eyebrow="结果回流" title="进度 · 阻塞 · 决策" tone="green" />
      </div>
    </GlassCard>
  );
}

function DepartmentCard({ department, onSelectTask }: { department: DepartmentPlan; onSelectTask: (task: DecisionTask) => void }) {
  const done = department.tasks.filter(({ status }) => status === "done").length;
  const rate = department.tasks.length ? Math.round((done / department.tasks.length) * 100) : 0;
  return (
    <article className="rounded-2xl border border-border/75 bg-white/66 p-4 shadow-[0_8px_24px_rgba(44,84,142,0.05)]">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-brand-soft text-primary"><Building2 aria-hidden="true" className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold">{department.name}</h3><Badge variant="outline">{department.tasks.length} 项</Badge></div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{department.objective}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-xl bg-muted/55 px-3 py-2.5">
        <Avatar size="sm"><AvatarFallback className="bg-white text-primary">{department.owner.displayName.slice(0, 1)}</AvatarFallback></Avatar>
        <div className="min-w-0"><p className="truncate text-xs font-semibold">部门负责人 · {department.owner.displayName}</p><p className="truncate text-[11px] text-muted-foreground">{department.owner.title}</p></div>
        <span className="ml-auto text-xs font-semibold text-primary">{rate}%</span>
      </div>
      <div className="mt-2 divide-y divide-border/65">
        {department.tasks.map((task) => (
          <button key={task.id} type="button" onClick={() => onSelectTask(task)} aria-label={`查看任务详情：${task.title}`} className="group flex w-full items-center gap-2.5 py-3 text-left">
            <span className={cn("size-2 shrink-0 rounded-full", task.status === "done" ? "bg-success" : task.status === "in_progress" ? "bg-primary" : task.status === "in_review" ? "bg-warning" : "bg-border")} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium group-hover:text-primary">{task.title}</span>
              <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="truncate">{task.assignee.displayName} · 截止 {task.dueDate.slice(5)}</span>
                <span className="shrink-0 rounded-full bg-chart-3/10 px-1.5 py-0.5 font-semibold text-chart-3">AI {getDecisionCandidateRanking(task).find(({ member }) => member.id === task.assignee.id)?.score ?? 0} 分</span>
                <span className="hidden shrink-0 rounded-full bg-success-soft px-1.5 py-0.5 font-semibold text-success sm:inline">{getDecisionTalentProfile(task.assignee.id).tags[0].label}</span>
              </span>
            </span>
            <Badge variant={statusVariants[task.status]}>{statusLabels[task.status]}</Badge>
            <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground group-hover:text-primary" />
          </button>
        ))}
      </div>
    </article>
  );
}

function PlanWorkspace({
  stage,
  plan,
  projectId,
  onDispatch,
  onSelectTask,
}: {
  stage: DecisionStage;
  plan: DecisionPlan;
  projectId?: string;
  onDispatch: () => void;
  onSelectTask: (task: DecisionTask) => void;
}) {
  const tasks = plan.departments.flatMap(({ tasks: departmentTasks }) => departmentTasks);
  const people = new Set(tasks.map(({ assignee }) => assignee.id)).size;
  const progress = getDecisionProgress(plan);
  const metrics = [
    { label: "承接部门", value: `${plan.departments.length} 个`, icon: Building2, tone: "bg-brand-soft text-primary" },
    { label: "直接负责人", value: `${people} 人`, icon: UsersRound, tone: "bg-chart-3/10 text-chart-3" },
    { label: "个人任务", value: `${tasks.length} 项`, icon: ListChecks, tone: "bg-success-soft text-success" },
    { label: "计划周期", value: `${plan.expectedDays} 天`, icon: Clock3, tone: "bg-warning-soft text-warning" },
  ] as const;

  return (
    <div className="grid min-w-0 gap-3">
      {stage === "issued" ? (
        <GlassCard className="flex flex-col gap-3 border-success/25 bg-success-soft/80 p-4 sm:flex-row sm:items-center">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-success text-white"><Check aria-hidden="true" className="size-5" /></span>
          <div className="min-w-0 flex-1"><p className="font-semibold text-foreground">任务已下发到部门和个人工作台</p><p className="mt-1 text-xs text-muted-foreground">任务状态变化会自动回流到本页，供李总统一把关。</p></div>
          <div className="flex gap-2"><Button asChild variant="outline"><Link href={projectId ? `/projects/${projectId}` : "/projects"}>查看专项项目</Link></Button><Button asChild><Link href="/tasks">查看个人任务<ArrowRight data-icon="inline-end" aria-hidden="true" /></Link></Button></div>
        </GlassCard>
      ) : null}

      <section aria-label="AI 调度摘要" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {metrics.map(({ label, value, icon: Icon, tone }) => (
          <GlassCard key={label} className="flex items-center gap-3 p-3.5">
            <span className={cn("grid size-10 shrink-0 place-items-center rounded-2xl", tone)}><Icon aria-hidden="true" className="size-5" /></span>
            <div><p className="text-[11px] text-muted-foreground">{label}</p><p className="mt-0.5 text-lg font-semibold">{value}</p></div>
          </GlassCard>
        ))}
      </section>

      <ResponsibilityFlow plan={plan} />

      <GlassCard className="p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold">责任分工图</h2><Badge variant={stage === "review" ? "warning" : "success"}>{stage === "review" ? "待决策人确认" : "执行中"}</Badge></div><p className="mt-1 text-xs text-muted-foreground">部门目标、负责人和个人任务在同一层级对齐。</p></div>
          {stage === "review" ? <Button type="button" onClick={onDispatch} className="h-10 rounded-xl"><Send data-icon="inline-start" aria-hidden="true" />确认方案并下发 {tasks.length} 项任务</Button> : null}
        </div>
        <div className="mt-4 grid gap-3 2xl:grid-cols-2">
          {plan.departments.map((department) => <DepartmentCard key={department.id} department={department} onSelectTask={onSelectTask} />)}
        </div>
      </GlassCard>

      <section className="grid gap-3 xl:grid-cols-2">
        <GlassCard className="p-4 sm:p-5">
          <div className="flex items-center gap-2"><Sparkles aria-hidden="true" className="size-4.5 text-chart-3" /><h2 className="text-base font-semibold">AI 调度建议</h2></div>
          <div className="mt-3 grid gap-2">
            {[
              ["并行推进", "场景访谈、角色权限和工作流原型可同步启动，减少前期等待。"],
              ["关键路径", "任务中心打通是试点能否真实运行的关键节点，建议由张伟直接把关。"],
              ["验收口径", "所有个人任务均配置可判定标准，避免只报进度、不报结果。"],
            ].map(([title, text], index) => (
              <div key={title} className="flex gap-3 rounded-xl bg-muted/55 p-3"><span className="grid size-6 shrink-0 place-items-center rounded-full bg-white text-[11px] font-semibold text-primary">{index + 1}</span><div><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{text}</p></div></div>
            ))}
          </div>
        </GlassCard>

        <GlassCard className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3"><div className="flex items-center gap-2"><RefreshCw aria-hidden="true" className="size-4.5 text-success" /><h2 className="text-base font-semibold">回流到决策人</h2></div><Badge variant={stage === "issued" ? "success" : "neutral"}>{stage === "issued" ? "实时同步" : "下发后开启"}</Badge></div>
          <div className="mt-4 flex items-end justify-between"><div><p className="text-3xl font-semibold tracking-tight">{progress.completionRate}%</p><p className="mt-1 text-xs text-muted-foreground">整体任务完成率</p></div><p className="text-xs text-muted-foreground">{progress.done}/{progress.total} 项完成</p></div>
          <ProgressBar value={progress.completionRate} className="mt-3 h-2" />
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="rounded-xl bg-muted/55 p-3"><p className="text-[11px] text-muted-foreground">待开始</p><p className="mt-1 text-lg font-semibold">{progress.pending}</p></div>
            <div className="rounded-xl bg-brand-soft p-3"><p className="text-[11px] text-primary">推进中</p><p className="mt-1 text-lg font-semibold text-primary">{progress.inProgress}</p></div>
            <div className="rounded-xl bg-warning-soft p-3"><p className="text-[11px] text-warning">待验收</p><p className="mt-1 text-lg font-semibold text-warning">{progress.inReview}</p></div>
          </div>
          <div className="mt-3 rounded-xl border border-border/70 bg-white/55 p-3"><p className="text-xs font-semibold">下一检查点</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{stage === "issued" ? "首轮任务更新后，AI 将汇总阻塞和需李总决策的事项。" : "确认方案后，系统开始自动采集部门与个人的执行结果。"}</p></div>
        </GlassCard>
      </section>
    </div>
  );
}

function TaskDetail({
  task,
  department,
  stage,
  open,
  onOpenChange,
  onAssigneeChange,
}: {
  task: DecisionTask | null;
  department?: DepartmentPlan;
  stage: DecisionStage;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAssigneeChange: (memberId: string) => void;
}) {
  if (!task) return null;
  const candidates = getDecisionCandidateRanking(task);
  const current = candidates.find(({ member }) => member.id === task.assignee.id) ?? candidates[0];
  const aiFirstChoice = candidates[0].member.id === task.assignee.id;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2 pr-10"><Badge variant={statusVariants[task.status]}>{statusLabels[task.status]}</Badge><Badge variant={task.priority === "urgent" ? "destructive" : "outline"}>{priorityLabels[task.priority]}优先级</Badge><Badge variant="info"><Sparkles aria-hidden="true" />AI 拆解</Badge><Badge variant={aiFirstChoice ? "success" : "warning"}>{aiFirstChoice ? `AI 首选 · ${current.score} 分` : `领导已改选 · ${current.score} 分`}</Badge></div>
          <DialogTitle className="pt-1 text-xl">{task.title}</DialogTitle>
          <DialogDescription>{task.description}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-muted/55 p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Building2 className="size-3.5" />承接部门</p><p className="mt-1.5 font-medium">{department?.name}</p></div>
          <div className="rounded-2xl bg-muted/55 p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><UserRound className="size-3.5" />唯一负责人</p><p className="mt-1.5 font-medium">{task.assignee.displayName} · {task.assignee.title}</p><div className="mt-2 flex flex-wrap gap-1.5">{current.profile.tags.map((tag) => <WorkTagChip key={tag.label} tag={tag} />)}</div></div>
          <div className="rounded-2xl bg-muted/55 p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays className="size-3.5" />计划周期</p><p className="mt-1.5 font-medium">{task.startDate} → {task.dueDate}</p></div>
          <div className="rounded-2xl bg-muted/55 p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><GitBranch className="size-3.5" />前置依赖</p><p className="mt-1.5 font-medium">{task.dependencies.length ? task.dependencies.join("、") : "无，可立即开始"}</p></div>
        </div>
        <section className="rounded-2xl border border-chart-3/20 bg-chart-3/5 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold"><Sparkles aria-hidden="true" className="size-4 text-chart-3" />AI 人选判断</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">先按岗位归属、关键能力、交付稳定性和当前负荷评分，再由领导最终确认。</p>
            </div>
            <div className="shrink-0 rounded-xl bg-white/80 px-3 py-2 text-right"><p className="text-[10px] text-muted-foreground">当前匹配度</p><p className="text-xl font-semibold text-chart-3">{current.score}<span className="ml-0.5 text-xs">/ 99</span></p></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">{(task.requiredSkills ?? []).map((skill) => <span key={skill} className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-foreground">需要 · {skill}</span>)}</div>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            {current.reasons.map((reason) => <p key={reason} className="rounded-xl bg-white/70 px-3 py-2 text-xs leading-5">{reason}</p>)}
          </div>
          <div className="mt-3 grid gap-1.5 sm:grid-cols-3">
            {current.profile.tags.map((tag) => <p key={tag.label} className="text-[11px] leading-5 text-muted-foreground"><span className="font-semibold text-foreground">{tag.label}：</span>{tag.evidence}</p>)}
          </div>
          {current.risks.length ? <div className="mt-3 rounded-xl border border-warning/20 bg-warning-soft p-3"><p className="text-xs font-semibold text-warning">风险提示 · {current.risks.join("；")}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">建议：{current.mitigation}</p></div> : <div className="mt-3 rounded-xl bg-success-soft p-3 text-xs font-medium text-success">暂无明显交付风险 · {current.mitigation}</div>}
        </section>
        <section>
          <div className="flex items-end justify-between gap-3"><div><h3 className="text-sm font-semibold">候选人对比</h3><p className="mt-1 text-xs text-muted-foreground">标签来自近期任务数据；悬停可查看依据，下发后锁定负责人。</p></div><Badge variant={stage === "review" ? "warning" : "neutral"}>{stage === "review" ? "领导可调整" : "已下发锁定"}</Badge></div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {candidates.map((candidate, index) => {
              const selected = candidate.member.id === task.assignee.id;
              return (
                <article key={candidate.member.id} className={cn("rounded-2xl border p-3", selected ? "border-primary/35 bg-brand-soft/55" : "border-border/70 bg-white/55")}>
                  <div className="flex items-start gap-3">
                    <Avatar size="sm"><AvatarFallback className="bg-white text-primary">{candidate.member.displayName.slice(0, 1)}</AvatarFallback></Avatar>
                    <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-1.5"><p className="font-semibold">{candidate.member.displayName}</p>{index === 0 ? <Badge variant="success">AI 推荐</Badge> : null}{candidate.isDepartmentMatch ? <Badge variant="outline">本部门</Badge> : null}</div><p className="mt-0.5 truncate text-[11px] text-muted-foreground">{candidate.member.department} · {candidate.member.title}</p></div>
                    <p className="shrink-0 text-lg font-semibold text-chart-3">{candidate.score}<span className="text-[10px] text-muted-foreground"> 分</span></p>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">{candidate.profile.tags.map((tag) => <WorkTagChip key={tag.label} tag={tag} />)}</div>
                  <p className="mt-2 text-[11px] leading-5 text-muted-foreground">{candidate.reasons[0]}；按时率 {candidate.profile.onTimeRate}%；负荷 {candidate.profile.workload}%</p>
                  <Button type="button" size="sm" variant={selected ? "outline" : "ghost"} disabled={selected || stage !== "review"} onClick={() => onAssigneeChange(candidate.member.id)} className="mt-2 w-full">{selected ? <><Check data-icon="inline-start" aria-hidden="true" />当前负责人</> : "改选此人"}</Button>
                </article>
              );
            })}
          </div>
        </section>
        <div className="rounded-2xl border border-success/20 bg-success-soft/70 p-4"><p className="flex items-center gap-2 text-sm font-semibold"><CheckCircle2 aria-hidden="true" className="size-4 text-success" />验收标准</p><p className="mt-2 text-sm leading-6 text-foreground">{task.acceptance}</p></div>
      </DialogContent>
    </Dialog>
  );
}

export function DecisionWorkbench() {
  const session = useWorkspaceSession();
  const operationContext = useOperationFixtureContext(session);
  const [decision, setDecision] = useState<StoredDecision>(() => createDraftDecision());
  const [project, setProject] = useState<ProjectDetailData>();
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [selectedTask, setSelectedTask] = useState<DecisionTask | null>(null);

  useEffect(() => {
    const stored = readStoredDecision(operationContext);
    if (stored) {
      setDecision(stored);
      setProject(findDecisionProject(operationContext, stored.projectId));
    }
    setReady(true);
  }, [operationContext]);

  useEffect(() => {
    if (ready && operationContext.actor) saveStoredDecision(operationContext, decision);
  }, [decision, operationContext, ready]);

  useEffect(() => {
    const refresh = () => setProject(findDecisionProject(operationContext, decision.projectId));
    window.addEventListener(PROJECTS_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(PROJECTS_CHANGED_EVENT, refresh);
  }, [decision.projectId, operationContext]);

  const plan = useMemo(
    () => decision.plan ? hydrateDecisionPlan(decision.plan, project) : undefined,
    [decision.plan, project],
  );
  const progress = getDecisionProgress(plan);
  const currentStep = decision.stage === "draft" ? 0 : decision.stage === "review" ? 1 : progress.completionRate === 100 ? 3 : 2;
  const selectedDepartment = plan?.departments.find(({ id }) => id === selectedTask?.departmentId);

  function updateInput(input: DecisionInput) {
    setDecision((current) => ({ ...current, input }));
    setFeedback("");
  }

  function generatePlan() {
    if (!decision.input.goal.trim()) {
      setFeedback("请先输入需要推进的战略问题或目标。");
      return;
    }
    if (!decision.input.deadline) {
      setFeedback("请设置硬性截止日期。");
      return;
    }
    setBusy(true);
    setFeedback("");
    window.setTimeout(() => {
      const nextPlan = createDecisionPlan(decision.input);
      setDecision((current) => ({ ...current, stage: "review", plan: nextPlan, projectId: undefined }));
      setBusy(false);
    }, 550);
  }

  function editGoal() {
    setDecision((current) => ({ ...current, stage: "draft", plan: undefined, projectId: undefined }));
    setProject(undefined);
  }

  function dispatch() {
    if (!plan) return;
    try {
      const dispatched = dispatchDecisionPlan(operationContext, decision.input, plan);
      setProject(dispatched);
      setDecision((current) => ({ ...current, stage: "issued", plan, projectId: dispatched.project.id }));
    } catch {
      setFeedback("任务下发失败，请检查截止日期后重试。");
    }
  }

  function changeAssignee(taskId: string, memberId: string) {
    if (decision.stage !== "review" || !decision.plan) return;
    const sourceTask = decision.plan.departments.flatMap(({ tasks }) => tasks).find(({ id }) => id === taskId);
    if (!sourceTask) return;
    const candidate = getDecisionCandidateRanking(sourceTask).find(({ member }) => member.id === memberId);
    if (!candidate) return;
    const updatedTask = { ...sourceTask, assignee: candidate.member };
    const updatedPlan = {
      ...decision.plan,
      departments: decision.plan.departments.map((department) => ({
        ...department,
        tasks: department.tasks.map((task) => task.id === taskId ? updatedTask : task),
      })),
    };
    setDecision((current) => ({ ...current, plan: updatedPlan }));
    setSelectedTask(updatedTask);
  }

  function resetDecision() {
    if (operationContext.actor) clearStoredDecision(operationContext);
    setDecision(createDraftDecision());
    setProject(undefined);
    setSelectedTask(null);
    setFeedback("");
  }

  return (
    <main className="mx-auto flex w-full max-w-420 flex-col gap-3 px-3 pb-26 pt-4 sm:px-4 lg:px-5 lg:pb-8 lg:pt-5">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">AI 决策调度台</h1>
            <Badge variant="info"><Sparkles aria-hidden="true" />AI 决策调度</Badge>
            {decision.stage === "issued" ? <Badge variant="success">执行结果实时回流</Badge> : null}
          </div>
          <p className="mt-1.5 text-sm text-muted-foreground">决策人提出问题，AI 拆成部门目标与个人任务，结果统一回到这里。</p>
        </div>
        {decision.stage !== "draft" ? <Button type="button" variant="outline" onClick={resetDecision}><RotateCcw data-icon="inline-start" aria-hidden="true" />发起新决策</Button> : null}
      </header>

      <WorkflowStepper currentStep={currentStep} />

      <section className="grid min-w-0 gap-3 md:grid-cols-[22rem_minmax(0,1fr)]">
        <DecisionInputCard stage={decision.stage} input={decision.input} busy={busy} feedback={feedback} onChange={updateInput} onGenerate={generatePlan} onEdit={editGoal} />
        {plan ? <PlanWorkspace stage={decision.stage} plan={plan} projectId={decision.projectId} onDispatch={dispatch} onSelectTask={setSelectedTask} /> : <DraftPreview />}
      </section>

      <TaskDetail task={selectedTask} department={selectedDepartment} stage={decision.stage} open={Boolean(selectedTask)} onOpenChange={(open) => !open && setSelectedTask(null)} onAssigneeChange={(memberId) => selectedTask && changeAssignee(selectedTask.id, memberId)} />
    </main>
  );
}
