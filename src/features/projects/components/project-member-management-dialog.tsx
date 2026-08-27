"use client";

import { useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, Save, Trash2, UserPlus, UsersRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { MemberSummary, ProjectDetailData, ProjectMember } from "@/features/projects/types";

type Mutation = {
  command: "add" | "change_role" | "remove";
  employeePublicId: string;
  role?: "manager" | "member" | "viewer";
  allocationPercent?: number;
  expectedMembershipVersion: number;
  reason: string;
};

function ExistingMemberEditor({ membership, busy, onSave, onRemove }: {
  membership: ProjectMember;
  busy: boolean;
  onSave: (role: "manager" | "member" | "viewer", allocation: number) => void;
  onRemove: () => void;
}) {
  const immutableOwner = membership.role === "owner";
  const [nextRole, setNextRole] = useState<"manager" | "member" | "viewer">(
    membership.role === "owner" ? "manager" : membership.role,
  );
  const [nextAllocation, setNextAllocation] = useState(membership.allocationPercent);
  const validAllocation = Number.isFinite(nextAllocation) && nextAllocation >= 0 && nextAllocation <= 100;
  const dirty = !immutableOwner && (nextRole !== membership.role || nextAllocation !== membership.allocationPercent);
  return (
    <article className="grid gap-3 rounded-2xl border border-border/70 p-3 sm:grid-cols-[minmax(0,1fr)_8rem_7rem_auto]">
      <div><p className="text-sm font-semibold">{membership.member.displayName}{immutableOwner ? " · 负责人" : ""}</p><p className="mt-1 text-xs text-muted-foreground">{membership.member.department} · {membership.member.title}</p></div>
      <select aria-label={`${membership.member.displayName}项目角色`} value={immutableOwner ? "owner" : nextRole} disabled={immutableOwner || busy} className="h-9 rounded-xl border border-input bg-background px-2 text-sm" onChange={(event) => setNextRole(event.target.value as typeof nextRole)}><option value="owner">负责人</option><option value="manager">项目经理</option><option value="member">协作成员</option><option value="viewer">只读成员</option></select>
      <Input aria-label={`${membership.member.displayName}投入比例`} type="number" min="0" max="100" step="1" value={nextAllocation} disabled={immutableOwner || busy} onChange={(event) => setNextAllocation(Number(event.target.value))} />
      <div className="grid grid-cols-2 gap-1 sm:flex"><Button size="sm" variant="outline" disabled={!dirty || !validAllocation || busy} onClick={() => onSave(nextRole, nextAllocation)}><Save />保存</Button><Button size="sm" variant="ghost" className="text-destructive" disabled={immutableOwner || busy} onClick={onRemove}><Trash2 />移除</Button></div>
    </article>
  );
}

export function ProjectMemberManagementDialog({ detail, availableMembers, open, onOpenChange, onMutate }: {
  detail: ProjectDetailData;
  availableMembers: readonly MemberSummary[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMutate: (mutation: Mutation, idempotencyKey: string) => Promise<void>;
}) {
  const [employeePublicId, setEmployeePublicId] = useState("");
  const [role, setRole] = useState<"manager" | "member" | "viewer">("member");
  const [allocation, setAllocation] = useState(100);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "error" | "success"; message: string } | null>(null);
  const attemptRef = useRef<{ signature: string; key: string } | null>(null);
  const candidates = useMemo(() => {
    const currentEmployeeIds = new Set(detail.members.flatMap(({ member }) => (
      member.employeePublicId ? [member.employeePublicId] : []
    )));
    return availableMembers.filter(({ employeePublicId: id }) => id && !currentEmployeeIds.has(id));
  }, [availableMembers, detail.members]);

  async function mutate(signature: string, key: string, mutation: Mutation) {
    if (busy) return;
    if (attemptRef.current?.signature !== signature) attemptRef.current = { signature, key };
    try {
      setBusy(signature); setFeedback(null);
      await onMutate(mutation, attemptRef.current.key);
      attemptRef.current = null;
      setFeedback({ tone: "success", message: "成员变更已提交并写入项目历史" });
      onOpenChange(false);
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : "成员变更失败，请稍后重试" });
    } finally { setBusy(null); }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="h-[100dvh] w-screen max-w-none overflow-y-auto rounded-none sm:h-auto sm:max-h-[88vh] sm:max-w-2xl sm:rounded-2xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><UsersRound className="size-5 text-primary" />管理项目成员</DialogTitle><DialogDescription>角色与投入比例将通过版本校验、权限检查和不可变审计后生效。</DialogDescription></DialogHeader>
        <section className="rounded-2xl border border-primary/15 bg-brand-soft/35 p-4"><h3 className="text-sm font-semibold">添加成员</h3><div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem_7rem_auto]"><select aria-label="待添加成员" value={employeePublicId} onChange={(event) => setEmployeePublicId(event.target.value)} className="h-10 rounded-xl border border-input bg-background px-3 text-sm"><option value="">选择企业成员</option>{candidates.map((member) => <option key={member.employeePublicId} value={member.employeePublicId}>{member.displayName} · {member.department}</option>)}</select><select aria-label="项目角色" value={role} onChange={(event) => setRole(event.target.value as typeof role)} className="h-10 rounded-xl border border-input bg-background px-3 text-sm"><option value="manager">项目经理</option><option value="member">协作成员</option><option value="viewer">只读成员</option></select><Input aria-label="投入比例" type="number" min="0" max="100" step="1" value={allocation} onChange={(event) => setAllocation(Number(event.target.value))} /><Button disabled={!employeePublicId || busy !== null} onClick={() => void mutate(`add:${employeePublicId}:${role}:${allocation}`, crypto.randomUUID(), { command: "add", employeePublicId, role, allocationPercent: allocation, expectedMembershipVersion: 0, reason: "从项目详情添加成员" })}><UserPlus />添加</Button></div>{candidates.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">当前没有可添加的有效企业成员。</p> : null}</section>
        <section className="grid gap-2"><h3 className="text-sm font-semibold">当前成员</h3>{detail.members.map((membership) => {
          const employeeId = membership.member.employeePublicId;
          const version = membership.version;
          return <ExistingMemberEditor key={`${membership.id}:${version ?? 0}`} membership={membership} busy={!employeeId || !version || busy !== null} onSave={(nextRole, nextAllocation) => { if (employeeId && version) void mutate(`role:${employeeId}:${nextRole}:${nextAllocation}:${version}`, crypto.randomUUID(), { command: "change_role", employeePublicId: employeeId, role: nextRole, allocationPercent: nextAllocation, expectedMembershipVersion: version, reason: "从项目详情调整成员角色与投入比例" }); }} onRemove={() => { if (employeeId && version) void mutate(`remove:${employeeId}:${version}`, crypto.randomUUID(), { command: "remove", employeePublicId: employeeId, expectedMembershipVersion: version, reason: "从项目详情移除成员" }); }} />;
        })}</section>
        {feedback ? <p role={feedback.tone === "error" ? "alert" : "status"} className={feedback.tone === "error" ? "flex items-center gap-1.5 text-xs font-medium text-destructive" : "flex items-center gap-1.5 text-xs font-medium text-success"}>{feedback.tone === "error" ? <AlertCircle className="size-4" /> : <CheckCircle2 className="size-4" />}{feedback.message}</p> : null}
      </DialogContent>
    </Dialog>
  );
}
