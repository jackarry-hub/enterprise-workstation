"use client";

import Link from "next/link";
import { BookOpenCheck, CheckCircle2, ChevronRight, Database, Printer, Route, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { PageHeader } from "@/components/ui/page-header";
import { getVisibleNavigationItems } from "@/config/navigation";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import type { WorkspaceRole } from "@/features/auth/workspace-session-types";

const roleSteps: Record<WorkspaceRole, readonly string[]> = {
  executive: ["在 AI 决策调度台输入目标、期限、预算和约束", "审核 AI 拆解出的部门、人员、依赖与验收标准", "处理升级风险、负责人验收和薪资批准", "查看周度摘要，完成总验收和成果归档"],
  department_head: ["在负责人推进台承接部门目标", "检查 AI 分配人员，协调阻塞和跨部门支持", "验收员工成果并填写明确意见", "审批团队请假、补卡和加班"],
  employee: ["在我的执行台查看已解锁任务", "开始任务、更新进度，遇到问题立即上报阻塞", "上传真实成果文件并提交验收", "处理考勤、请假并查看本人工资单"],
  finance: ["在财务执行中心处理预算协同", "等待人事完成考勤封账", "执行薪资核算和最终发放", "保留财务结果并回流发起任务"],
  hr: ["在人事协同中心处理人员与培训请求", "维护考勤制度并复核异常", "完成人员与薪资复核", "维护组织档案和审批记录"],
};

const flow = ["领导输入决策", "AI 拆成部门与个人任务", "员工执行并上传成果", "负责人验收与跨部门协同", "领导处理升级风险", "总验收并归档"];

export function HelpCenter() {
  const session = useWorkspaceSession();
  const { actor } = session;
  const modules = getVisibleNavigationItems(session);
  return <main className="mx-auto flex w-full max-w-380 flex-col gap-4 px-3 pt-5 pb-26 sm:px-4 lg:px-5 lg:pt-8 lg:pb-8"><PageHeader title="使用帮助" description={`当前身份：${actor.name} · ${actor.roleLabel}。本页只说明你有权限使用的功能。`} actions={<Button type="button" variant="outline" onClick={() => window.print()}><Printer />打印说明</Button>} /><section className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"><GlassCard className="p-5 sm:p-6"><div className="flex items-center gap-2"><BookOpenCheck className="size-5 text-primary" /><h2 className="text-lg font-semibold">第一次使用</h2></div><ol className="mt-5 grid gap-3">{roleSteps[actor.role].map((step, index) => <li key={step} className="flex gap-3 rounded-2xl bg-muted/45 p-3"><span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary text-xs font-semibold text-white">{index + 1}</span><p className="pt-1 text-sm leading-5">{step}</p></li>)}</ol></GlassCard><GlassCard className="p-5 sm:p-6"><div className="flex items-center gap-2"><Route className="size-5 text-primary" /><h2 className="text-lg font-semibold">企业任务完整闭环</h2></div><div className="mt-5 grid gap-2 sm:grid-cols-2">{flow.map((item, index) => <div key={item} className="flex items-center gap-3 rounded-xl border border-border/70 bg-white/55 p-3"><CheckCircle2 className="size-4 shrink-0 text-success" /><span className="text-sm"><span className="mr-1 text-xs text-muted-foreground">{index + 1}.</span>{item}</span></div>)}</div><div className="mt-4 rounded-2xl border border-warning/20 bg-warning-soft/55 p-4 text-sm leading-6 text-muted-foreground"><strong className="text-foreground">关键规则：</strong>前置任务未完成时，下游不能启动；成果必须上传后才能提交验收；部门负责人本人执行的任务由领导验收；超时事项自动升级。</div></GlassCard></section><GlassCard className="p-5 sm:p-6"><div><h2 className="text-lg font-semibold">我的功能入口</h2><p className="mt-1 text-sm text-muted-foreground">以下模块均按当前角色过滤，点击可直接进入。</p></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{modules.map((item) => { const Icon = item.icon; return <Link key={item.href} href={item.href} className="group flex items-center gap-3 rounded-2xl border border-border/70 bg-white/55 p-3 transition hover:border-primary/25 hover:bg-brand-soft/45"><span className="grid size-9 place-items-center rounded-xl bg-brand-soft text-primary"><Icon className="size-4" /></span><span className="flex-1 text-sm font-medium">{item.label}</span><ChevronRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></Link>; })}</div></GlassCard><section className="grid gap-4 lg:grid-cols-2"><GlassCard className="p-5"><div className="flex items-center gap-2"><Database className="size-4 text-primary" /><h2 className="font-semibold">数据与文件保存</h2></div><p className="mt-3 text-sm leading-6 text-muted-foreground">当前本地交付版把业务数据保存在浏览器中，上传文件保存在浏览器文件存储中；刷新页面不会丢失。清除浏览器数据或更换电脑前，请先备份重要成果。配置 Supabase 后，项目与文件可切换到企业云端。</p></GlassCard><GlassCard className="p-5"><div className="flex items-center gap-2"><ShieldCheck className="size-4 text-primary" /><h2 className="font-semibold">权限与审批原则</h2></div><p className="mt-3 text-sm leading-6 text-muted-foreground">每个人只看到与岗位有关的模块。任务执行人与验收人分离，考勤、薪资按照负责人、人事、领导和财务逐级流转，任何页面都不能绕过主流程直接改成完成。</p></GlassCard></section></main>;
}
