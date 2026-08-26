"use client";

import Link from "next/link";
import { ArrowRight, Banknote, FileCheck2, ShieldCheck, UsersRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { getModuleCapabilities } from "@/features/commercial/module-capabilities";
import { useOperations } from "@/features/operations/use-operations";

export function OperationalApprovalQueue() {
  const session = useWorkspaceSession();
  const { actor } = session;
  const { state } = useOperations(session);
  const capabilities = getModuleCapabilities(session);
  const financePending = state.supportRequests.filter(({ type, status }) => type === "finance" && !["completed", "rejected"].includes(status)).length;
  const hrPending = state.supportRequests.filter(({ type, status }) => type !== "finance" && !["completed", "rejected"].includes(status)).length;
  const entries = [
    ...(capabilities.finance ? [{ href: "/finance", label: "财务审批", detail: `${financePending} 项待办理`, icon: Banknote }] : []),
    ...(capabilities.hr ? [{ href: "/hr", label: "人事协同", detail: `${hrPending} 项待办理`, icon: UsersRound }] : []),
  ];
  return <GlassCard className="overflow-hidden border-primary/20"><div className="flex flex-col gap-2 border-b border-border/70 bg-brand-soft/55 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><ShieldCheck className="size-5 text-primary" /><h2 className="font-semibold">实时业务审批队列</h2><Badge variant="info">{actor.name} · {actor.roleLabel}</Badge></div><p className="mt-1 text-xs text-muted-foreground">预算和人员协同与角色工作台共用状态，并回流薪资或任务。</p></div></div>{entries.length ? <div className="grid gap-2 p-4 sm:grid-cols-2">{entries.map(({ href, label, detail, icon: Icon }) => <Button key={href} asChild variant="outline" className="h-auto justify-start rounded-xl p-3"><Link href={href}><span className="grid size-9 place-items-center rounded-lg bg-brand-soft text-primary"><Icon /></span><span className="min-w-0 flex-1 text-left"><span className="block text-sm font-medium">{label}</span><span className="block text-xs font-normal text-muted-foreground">{detail}</span></span><ArrowRight /></Link></Button>)}</div> : null}<div className="flex items-center gap-2 border-t border-border/70 px-4 py-2.5 text-[11px] text-muted-foreground"><FileCheck2 className="size-3.5 text-success" />所有审批动作记录处理人、意见、时间和业务回写结果。</div></GlassCard>;
}

