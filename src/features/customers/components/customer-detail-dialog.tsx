"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Building2, Mail, Phone, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { Customer } from "@/features/customers/customer-types";
import { getProjectHref } from "@/features/projects/project-navigation";
import type { ProjectDetailData } from "@/features/projects/types";

export function CustomerDetailDialog({ customer, projects, open, onOpenChange, onAddFollowUp, onAdvance }: { customer: Customer | null; projects: readonly ProjectDetailData[]; open: boolean; onOpenChange: (open: boolean) => void; onAddFollowUp: (customerId: string, content: string) => void; onAdvance: (customerId: string) => void }) {
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { if (open) { setNote(""); setError(""); } }, [open]);
  if (!customer) return null;
  const relatedProjects = projects.filter(({ project }) => customer.relatedProjectIds.includes(project.id));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><Badge variant="info" className="mb-1">客户档案</Badge><DialogTitle className="text-xl">{customer.name}</DialogTitle><DialogDescription>{customer.industry} · {customer.region} · 成交进度 {customer.dealProgress}%</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2"><div className="rounded-2xl bg-muted/55 p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><UserRound className="size-3.5" />联系人</p><p className="mt-1.5 font-medium">{customer.contact.name} · {customer.contact.title}</p></div><div className="rounded-2xl bg-muted/55 p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Phone className="size-3.5" />电话</p><p className="mt-1.5 font-medium">{customer.contact.phone}</p></div><div className="rounded-2xl bg-muted/55 p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Mail className="size-3.5" />邮箱</p><p className="mt-1.5 font-medium">{customer.contact.email}</p></div><div className="rounded-2xl bg-muted/55 p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Building2 className="size-3.5" />负责人</p><p className="mt-1.5 font-medium">{customer.owner.displayName}</p></div></div>
        <div className="rounded-2xl border border-border/70 bg-white/55 p-4"><h3 className="font-semibold">关联项目</h3><div className="mt-3 space-y-2">{relatedProjects.length ? relatedProjects.map(({ project }) => <Button key={project.id} asChild variant="outline" className="w-full justify-between"><Link href={getProjectHref(project.id)}>{project.name}<span>{project.progress}%</span></Link></Button>) : <p className="text-sm text-muted-foreground">暂无关联项目</p>}</div></div>
        <div className="rounded-2xl border border-border/70 bg-white/55 p-4"><div className="flex items-center justify-between gap-2"><h3 className="font-semibold">跟进记录</h3>{customer.status === "won" ? <Badge variant="success">已成交</Badge> : <Button type="button" size="sm" onClick={() => onAdvance(customer.id)}>推进阶段</Button>}</div><div className="mt-3 flex gap-2"><Textarea aria-label="新增客户跟进记录" value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录本次沟通结果和下一步动作" className="min-h-10 flex-1" /><Button type="button" variant="outline" onClick={() => { if (!note.trim()) { setError("请先填写跟进内容"); return; } onAddFollowUp(customer.id, note.trim()); setNote(""); setError(""); }}>保存跟进</Button></div>{error ? <p role="alert" className="mt-2 text-xs text-destructive">{error}</p> : null}<div className="mt-4 space-y-3">{customer.activities.map((activity) => <div key={activity.id}><p className="text-sm">{activity.content}</p><p className="mt-0.5 text-xs text-muted-foreground">{activity.createdAt}</p></div>)}</div></div>
      </DialogContent>
    </Dialog>
  );
}
