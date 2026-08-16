import Link from "next/link";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  CircleDot,
  FolderKanban,
  ListChecks,
  Sparkles,
  Target,
  WalletCards,
} from "lucide-react";

import { Progress } from "@/components/ui/progress";
import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import { DashboardAvatar } from "@/features/dashboard/components/dashboard-avatar";
import type {
  DashboardDataSource,
  DashboardPriority,
  DashboardTodoCategory,
  DashboardViewModel,
} from "@/features/dashboard/dashboard-view-model";
import { cn } from "@/lib/utils";

const sourceCopy: Record<DashboardDataSource, { label: string; title: string }> = {
  real: { label: "实时数据", title: "REAL DATA" },
  mock: { label: "演示数据", title: "MOCK DATA" },
  placeholder: { label: "待接入", title: "PLACEHOLDER" },
};

const priorityCopy: Record<DashboardPriority, { label: string; className: string }> = {
  urgent: { label: "紧急", className: "bg-destructive/10 text-destructive" },
  high: { label: "高", className: "bg-warning-soft text-warning" },
  medium: { label: "普通", className: "bg-brand-soft text-primary" },
};

const categoryCopy: Record<DashboardTodoCategory, string> = {
  task: "今日任务",
  deadline: "即将到期",
  acceptance: "等待验收",
  decision: "调度跟进",
  risk: "AI风险",
};

const taskStatusCopy = {
  assigned: "新任务",
  accepted: "已接受",
  todo: "待开始",
  in_progress: "进行中",
  review: "待验收",
  done: "已完成",
  blocked: "有阻塞",
} as const;

const projectHealthCopy = {
  on_track: { label: "正常", className: "text-success bg-success-soft" },
  at_risk: { label: "有风险", className: "text-warning bg-warning-soft" },
  off_track: { label: "已偏离", className: "text-destructive bg-destructive/10" },
} as const;

function SourceTag({ source }: { source: DashboardDataSource }) {
  const copy = sourceCopy[source];
  return <span data-source={source} title={copy.title} className="rounded-full border border-border/60 bg-background/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">{copy.label}</span>;
}

function SectionTitle({
  id,
  title,
  description,
  source,
  action,
}: {
  id: string;
  title: string;
  description?: string;
  source: DashboardDataSource;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2"><h2 id={id} className="text-lg font-semibold tracking-tight sm:text-xl">{title}</h2><SourceTag source={source} /></div>
        {description ? <p className="mt-1 text-xs text-muted-foreground">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

function formatDate(value: string) {
  const [, month, day] = value.split("-");
  return `${month}-${day}`;
}

export function DashboardIdentity({ session, identity, source }: {
  session: WorkspaceSession;
  identity: DashboardViewModel["identity"];
  source: DashboardDataSource;
}) {
  const statusClass = {
    available: "bg-success",
    working: "bg-primary",
    busy: "bg-warning",
    blocked: "bg-destructive",
  }[identity.status];

  return (
    <header className="relative overflow-hidden rounded-[30px] border border-glass-border bg-white/82 p-4 shadow-[0_20px_60px_rgba(56,98,157,0.09)] backdrop-blur-xl sm:p-6">
      <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-2/3 bg-[radial-gradient(circle_at_78%_18%,rgba(99,158,255,0.22),transparent_38%),linear-gradient(120deg,transparent,rgba(236,245,255,0.7))]" />
      <div className="relative flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight text-[#10213d] sm:text-2xl">量子智枢 · 我的工作台</h1>
            <SourceTag source={source} />
          </div>
          <div className="mt-5 flex items-center gap-3.5 sm:gap-4">
            <DashboardAvatar session={session} />
            <div className="min-w-0">
              <p className="truncate text-2xl font-semibold tracking-tight text-[#14223c] sm:text-[28px]">{identity.name}</p>
              <p className="mt-1 truncate text-sm text-muted-foreground">{identity.titleLine}</p>
              <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-border/65 bg-white/70 px-2.5 py-1 text-xs font-medium">
                <span aria-hidden="true" className={cn("size-2 rounded-full", statusClass)} />{identity.statusLabel}
              </span>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 self-start rounded-2xl border border-white/85 bg-white/58 px-3 py-2 text-xs text-muted-foreground sm:self-center sm:px-4 sm:py-3">
          <CalendarDays aria-hidden="true" className="size-4 text-primary" />
          <time suppressHydrationWarning>{identity.dateLabel}</time>
        </div>
      </div>
    </header>
  );
}

export function DashboardToday({ today, source }: { today: DashboardViewModel["today"]; source: DashboardDataSource }) {
  return (
    <section aria-labelledby="dashboard-today-title" data-source={source} className="h-full rounded-[30px] border border-glass-border bg-white/82 p-4 shadow-[0_18px_50px_rgba(56,98,157,0.08)] backdrop-blur-xl sm:p-6">
      <SectionTitle id="dashboard-today-title" title="今日待办" description="只展示与你有关的最高优先级事项" source={source} />
      {today.items.length ? (
        <div className="mt-4 divide-y divide-border/65">
          {today.items.map((item) => (
            <Link key={`${item.category}-${item.sourceId}`} data-testid="today-task" href={item.href} className="group flex items-center gap-3 py-3 first:pt-1 last:pb-0">
              <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", item.category === "risk" ? "bg-destructive/10 text-destructive" : item.category === "acceptance" ? "bg-warning-soft text-warning" : "bg-brand-soft text-primary")}>
                {item.category === "risk" ? <AlertTriangle aria-hidden="true" className="size-4" /> : item.category === "acceptance" ? <CheckCircle2 aria-hidden="true" className="size-4" /> : <CircleDot aria-hidden="true" className="size-4" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <strong className="truncate text-sm font-semibold">{item.title}</strong>
                  <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", priorityCopy[item.priority].className)}>{priorityCopy[item.priority].label}</span>
                </span>
                <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground"><span>{categoryCopy[item.category]}</span><span>截止 {formatDate(item.dueDate)}</span></span>
              </span>
              <span className="flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
                {item.actionLabel ?? (item.category === "acceptance" ? "去验收" : item.category === "risk" || item.category === "decision" ? "查看" : "去办理")}
                <ArrowRight aria-hidden="true" className="size-4 transition group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="mt-5 grid min-h-40 place-items-center rounded-2xl border border-dashed border-border/80 bg-muted/20 px-5 text-center">
          <div><CheckCircle2 aria-hidden="true" className="mx-auto size-8 text-success" /><p className="mt-2 font-medium">今天暂时没有待处理事项</p><p className="mt-1 text-xs text-muted-foreground">新的个人任务和验收事项会自动出现在这里</p></div>
        </div>
      )}
    </section>
  );
}

export function DashboardTasks({ tasks }: { tasks: DashboardViewModel["tasks"] }) {
  const stats = [
    ["待开始", tasks.todo],
    ["进行中", tasks.inProgress],
    ["待验收", tasks.review],
    ["已完成", tasks.done],
  ] as const;
  return (
    <section aria-labelledby="dashboard-tasks-title" data-source={tasks.source} className="h-full rounded-[30px] border border-glass-border bg-white/82 p-4 shadow-[0_18px_50px_rgba(56,98,157,0.08)] sm:p-6">
      <SectionTitle id="dashboard-tasks-title" title="我的任务" description="只显示当前登录用户负责的任务" source={tasks.source} action={<Link href="/tasks" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">查看全部任务<ArrowRight aria-hidden="true" className="size-3.5" /></Link>} />
      <div className="mt-4 grid grid-cols-4 gap-2">
        {stats.map(([label, value]) => <div key={label} className="rounded-2xl bg-muted/35 px-2 py-3 text-center"><p className="text-lg font-semibold text-[#172640]">{value}</p><p className="mt-0.5 text-[10px] text-muted-foreground sm:text-xs">{label}</p></div>)}
      </div>
      <div className="mt-4 space-y-2">
        {tasks.items.slice(0, 3).map((task) => (
          <Link key={task.sourceId} href={task.href} className="group flex items-center gap-3 rounded-2xl border border-border/65 bg-background/55 px-3 py-2.5 hover:border-primary/20 hover:bg-brand-soft/25">
            <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-primary"><ListChecks aria-hidden="true" className="size-4" /></span>
            <span className="min-w-0 flex-1"><strong className="block truncate text-sm font-medium">{task.title}</strong><span className="mt-0.5 block text-[11px] text-muted-foreground">{taskStatusCopy[task.status]} · 截止 {formatDate(task.dueDate)}</span></span>
            <span className="text-xs font-semibold text-primary">{task.progress}%</span>
          </Link>
        ))}
        {!tasks.items.length ? <p className="rounded-2xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">当前没有个人任务</p> : null}
      </div>
    </section>
  );
}

export function DashboardProjects({ projects }: { projects: DashboardViewModel["projects"] }) {
  return (
    <section aria-labelledby="dashboard-projects-title" data-source={projects.source} className="h-full rounded-[30px] border border-glass-border bg-white/82 p-4 shadow-[0_18px_50px_rgba(56,98,157,0.08)] sm:p-6">
      <SectionTitle id="dashboard-projects-title" title="我的项目" description="本人负责或参与的项目" source={projects.source} action={<Link href="/projects" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">查看全部<ArrowRight aria-hidden="true" className="size-3.5" /></Link>} />
      <div className="mt-4 space-y-3">
        {projects.items.slice(0, 3).map((project) => (
          <Link key={project.id} href={project.href} className="block rounded-2xl border border-border/65 bg-background/55 p-3 hover:border-primary/20 hover:bg-brand-soft/25">
            <div className="flex items-start gap-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-primary"><FolderKanban aria-hidden="true" className="size-4" /></span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2"><strong className="truncate text-sm font-semibold">{project.name}</strong><span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", projectHealthCopy[project.health].className)}>{projectHealthCopy[project.health].label}</span></span>
                <span className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground"><span>{project.role}</span><span>截止 {formatDate(project.deadline)}</span></span>
                <span className="mt-2 flex items-center gap-2"><Progress value={project.progress} className="h-1.5" /><span className="text-[11px] font-semibold text-primary">{project.progress}%</span></span>
              </span>
            </div>
          </Link>
        ))}
        {!projects.items.length ? <p className="rounded-2xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">当前没有参与中的项目</p> : null}
      </div>
    </section>
  );
}

export function DashboardValue({ value }: { value: DashboardViewModel["value"] }) {
  return (
    <section aria-labelledby="dashboard-value-title" data-source={value.source} className="h-full rounded-[30px] border border-glass-border bg-white/82 p-4 shadow-[0_18px_50px_rgba(56,98,157,0.08)] sm:p-6">
      <SectionTitle id="dashboard-value-title" title="我的价值" description="任务贡献与结算状态" source={value.source} />
      <div className="mt-4 flex items-center gap-3 rounded-2xl bg-[linear-gradient(135deg,rgba(235,245,255,0.9),rgba(243,240,255,0.8))] p-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-white text-primary shadow-sm"><WalletCards aria-hidden="true" className="size-5" /></span>
        <div><p className="text-2xl font-semibold">{value.completedThisMonth}</p><p className="text-xs text-muted-foreground">本月完成任务</p></div>
      </div>
      <div className="mt-3 rounded-2xl border border-dashed border-primary/20 bg-brand-soft/25 p-4 text-center">
        <Target aria-hidden="true" className="mx-auto size-5 text-primary" />
        <p className="mt-2 text-sm font-medium">{value.message}</p>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">贡献值、待结算与已结算将在价值规则启用后显示</p>
      </div>
    </section>
  );
}

export function DashboardReminders({ reminders, source }: { reminders: DashboardViewModel["reminders"]; source: DashboardDataSource }) {
  return (
    <section aria-labelledby="dashboard-reminders-title" data-source={source} className="h-full rounded-[30px] border border-glass-border bg-white/82 p-4 shadow-[0_18px_50px_rgba(56,98,157,0.08)] sm:p-6">
      <SectionTitle id="dashboard-reminders-title" title="AI提醒" description="基于现有任务与项目状态的规则提醒" source={source} />
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {reminders.map((reminder) => (
          <Link key={reminder.id} href={reminder.href} className="flex items-start gap-3 rounded-2xl border border-border/65 bg-background/55 p-3 hover:border-primary/20">
            <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", reminder.tone === "danger" ? "bg-destructive/10 text-destructive" : reminder.tone === "warning" ? "bg-warning-soft text-warning" : "bg-brand-soft text-primary")}><Sparkles aria-hidden="true" className="size-4" /></span>
            <span className="min-w-0"><strong className="block text-sm font-medium">{reminder.title}</strong><span className="mt-1 block truncate text-xs text-muted-foreground">{reminder.detail}</span></span>
          </Link>
        ))}
        {!reminders.length ? <div className="sm:col-span-2 rounded-2xl border border-dashed border-border p-5 text-center"><CheckCircle2 aria-hidden="true" className="mx-auto size-6 text-success" /><p className="mt-2 text-sm font-medium">当前没有需要提醒的风险</p></div> : null}
      </div>
    </section>
  );
}
