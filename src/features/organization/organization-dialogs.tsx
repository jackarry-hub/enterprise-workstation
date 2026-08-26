"use client";

import { useState, type FormEvent } from "react";
import { Building2, RefreshCw, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { OrganizationCommand } from "@/features/organization/organization-command-types";
import type { RoleCommandTarget } from "@/features/organization/organization-command-data";

type CommandState = "idle" | "submitting" | "success" | "error";

function idempotencyKey() {
  return globalThis.crypto.randomUUID();
}

async function postOrganizationCommand(command: OrganizationCommand) {
  const response = await fetch(
    command.type === "assign_member_role"
      ? "/api/workstation/organization/roles"
      : "/api/workstation/organization",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": command.idempotencyKey,
      },
      body: JSON.stringify(command),
    },
  );
  if (response.ok) return { ok: true as const };

  try {
    const body = await response.json() as { error?: unknown };
    return { ok: false as const, error: typeof body.error === "string" ? body.error : "command_failed" };
  } catch {
    return { ok: false as const, error: "command_failed" };
  }
}

function commandErrorMessage(code: string) {
  if (code === "stale_version" || code === "conflict" || code === "scope_conflict") {
    return "目录已更新，请刷新后重试。";
  }
  if (code === "forbidden") return "当前账号没有执行此操作的权限。";
  return "未能提交变更，请刷新后重试。";
}

function CreateDepartmentDialog() {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<CommandState>("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setState("submitting");
    const outcome = await postOrganizationCommand({
      type: "create_department",
      code: String(data.get("code") ?? "").trim().toUpperCase(),
      name: String(data.get("name") ?? "").trim(),
      description: String(data.get("description") ?? "").trim(),
      sortOrder: Number(data.get("sortOrder") ?? 0),
      version: 0,
      reason: String(data.get("reason") ?? "").trim(),
      idempotencyKey: idempotencyKey(),
    });
    setState(outcome.ok ? "success" : "error");
    setError(outcome.ok ? null : commandErrorMessage(outcome.error));
    if (outcome.ok) {
      event.currentTarget.reset();
      window.location.reload();
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={() => setOpen(true)}>
        <Building2 data-icon="inline-start" aria-hidden="true" />
        新建部门
      </Button>
      <DialogContent aria-label="新建部门" className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>新建部门</DialogTitle>
          <DialogDescription>部门基础信息会由服务器验证、写入审计并在下次目录读取时展示。</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <label className="grid gap-1.5 text-sm font-medium">部门名称<Input name="name" required maxLength={120} /></label>
          <label className="grid gap-1.5 text-sm font-medium">部门编码<Input name="code" required maxLength={80} pattern="[A-Z0-9_-]+" /></label>
          <label className="grid gap-1.5 text-sm font-medium">排序<Input name="sortOrder" type="number" min="0" defaultValue="0" required /></label>
          <label className="grid gap-1.5 text-sm font-medium">说明<Textarea name="description" maxLength={1000} /></label>
          <label className="grid gap-1.5 text-sm font-medium">业务理由<Textarea name="reason" required maxLength={500} /></label>
          {state === "error" ? <p role="status" className="text-sm text-destructive">{error}</p> : null}
          {state === "success" ? <p role="status" className="text-sm text-success">部门变更已提交，刷新目录以查看最新结果。</p> : null}
          <DialogFooter><Button type="submit" className="h-11" disabled={state === "submitting"}>{state === "submitting" ? "提交中…" : "提交部门"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssignRoleDialog({ roleTargets }: { roleTargets: readonly RoleCommandTarget[] }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<CommandState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [targetMemberId, setTargetMemberId] = useState(String(roleTargets[0]?.memberId ?? ""));
  const [roleCode, setRoleCode] = useState<"admin" | "department_head" | "employee" | "finance" | "hr">("employee");
  const selectedTarget = roleTargets.find((target) => String(target.memberId) === targetMemberId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTarget) {
      setState("error");
      setError("请选择目录中的员工后再提交。");
      return;
    }
    const data = new FormData(event.currentTarget);
    setState("submitting");
    const outcome = await postOrganizationCommand({
      type: "assign_member_role",
      memberId: selectedTarget.memberId,
      roleCode,
      version: selectedTarget.roleVersion,
      reason: String(data.get("reason") ?? "").trim(),
      idempotencyKey: idempotencyKey(),
    });
    setState(outcome.ok ? "success" : "error");
    setError(outcome.ok ? null : commandErrorMessage(outcome.error));
    if (outcome.ok) window.location.reload();
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={() => setOpen(true)}>
        <ShieldCheck data-icon="inline-start" aria-hidden="true" />
        分配系统角色
      </Button>
      <DialogContent aria-label="分配系统角色" className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>分配系统角色</DialogTitle>
          <DialogDescription>提交时携带版本、幂等键和业务理由；服务器会再次校验权限和目标范围。</DialogDescription>
        </DialogHeader>
        {roleTargets.length === 0 ? <p role="status" className="text-sm text-muted-foreground">暂无可分配角色的员工。</p> : (
          <form className="grid gap-4" onSubmit={submit}>
            <label className="grid gap-1.5 text-sm font-medium">选择员工
              <select aria-label="选择员工" value={targetMemberId} onChange={(event) => setTargetMemberId(event.target.value)} className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm">
                {roleTargets.map((target) => <option key={target.memberId} value={target.memberId}>{target.displayName} · {target.employeeNo} · {target.jobTitle}</option>)}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">角色
              <select aria-label="选择角色" value={roleCode} onChange={(event) => setRoleCode(event.target.value as typeof roleCode)} className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm">
                <option value="admin">管理员</option><option value="department_head">部门负责人</option><option value="employee">普通员工</option><option value="finance">财务</option><option value="hr">人事</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">业务理由<Textarea name="reason" required maxLength={500} /></label>
            {state === "error" ? <p role="status" className="text-sm text-destructive">{error}</p> : null}
            {state === "success" ? <p role="status" className="text-sm text-success">角色变更已提交，已刷新服务器数据。</p> : null}
            <DialogFooter><Button type="submit" className="h-11" disabled={state === "submitting"}>{state === "submitting" ? "提交中…" : "提交角色变更"}</Button></DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DirectorySyncButton() {
  const [state, setState] = useState<CommandState>("idle");

  async function sync() {
    setState("submitting");
    try {
      const response = await fetch("/api/workstation/directory-sync", { method: "POST" });
      setState(response.ok ? "success" : "error");
      if (response.ok) window.location.reload();
    } catch {
      setState("error");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={sync} disabled={state === "submitting"}>
        <RefreshCw data-icon="inline-start" aria-hidden="true" className={state === "submitting" ? "animate-spin" : undefined} />
        {state === "submitting" ? "同步中…" : "同步通讯录"}
      </Button>
      {state === "error" ? <span role="status" className="text-xs text-destructive">同步未完成</span> : null}
      {state === "success" ? <span role="status" className="text-xs text-success">同步已提交</span> : null}
    </div>
  );
}

export function OrganizationDialogs({
  canManageOrganization,
  canManageRoles,
  roleTargets,
}: {
  canManageOrganization: boolean;
  canManageRoles: boolean;
  roleTargets: readonly RoleCommandTarget[];
}) {
  if (!canManageOrganization && !canManageRoles) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canManageOrganization ? <DirectorySyncButton /> : null}
      {canManageOrganization ? <CreateDepartmentDialog /> : null}
      {canManageRoles ? <AssignRoleDialog roleTargets={roleTargets} /> : null}
    </div>
  );
}
