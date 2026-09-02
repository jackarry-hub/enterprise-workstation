"use client";

import { useRef, useState, type FormEvent } from "react";
import { Building2, RefreshCw, ShieldCheck, UserRoundCog } from "lucide-react";

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
import type {
  AssignMemberManagerCommand,
  OrganizationCommand,
} from "@/features/organization/organization-command-types";
import type {
  ManagerCommandTargetsResult,
  RoleCommandTarget,
} from "@/features/organization/organization-command-data";

type CommandState = "idle" | "submitting" | "success" | "error";

function idempotencyKey() {
  return globalThis.crypto.randomUUID();
}

async function postOrganizationCommand(command: OrganizationCommand) {
  let response: Response;
  try {
    response = await fetch(
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
  } catch {
    return { ok: false as const, error: "transport_failure" };
  }
  if (response.ok) return { ok: true as const };

  try {
    const body = await response.json() as { error?: unknown };
    return { ok: false as const, error: typeof body.error === "string" ? body.error : "command_failed" };
  } catch {
    return { ok: false as const, error: "command_failed" };
  }
}

async function postManagerCommand(command: AssignMemberManagerCommand) {
  let response: Response;
  try {
    response = await fetch(
      `/api/workstation/organization/members/${command.targetEmployeeId}/manager`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": command.idempotencyKey,
        },
        body: JSON.stringify({
          managerEmployeeId: command.managerEmployeeId,
          expectedVersion: command.expectedVersion,
          reason: command.reason,
        }),
      },
    );
  } catch {
    return { ok: false as const, error: "transport_failure" };
  }
  if (response.ok) return { ok: true as const };

  try {
    const body = await response.json() as { error?: unknown };
    return {
      ok: false as const,
      error: typeof body.error === "string" ? body.error : "command_failed",
    };
  } catch {
    return { ok: false as const, error: "command_failed" };
  }
}

export function organizationCommandErrorMessage(code: string) {
  if (code === "unauthorized") return "登录状态已失效，请重新登录后再试。";
  if (code === "forbidden") return "当前账号没有执行此操作的权限。";
  if (code === "invalid_request") return "提交内容不符合要求，请检查后重试。";
  if (code === "not_found") return "目标员工或组织记录不存在，无法继续操作。";
  if (code === "stale_version" || code === "conflict" || code === "scope_conflict") {
    return "目录已更新，请刷新后重试。";
  }
  if (code === "duplicate_request") return "该变更正在处理中，请勿重复提交。";
  if (code === "directory_role_owned") return "该角色由目录同步管理，不能在此处修改。";
  if (code === "directory_manager_owned") return "该汇报关系由通讯录同步管理，不能手动覆盖。";
  if (code === "manager_cycle") return "该设置会形成循环汇报关系，请调整主管。";
  if (code === "transport_failure") return "网络连接未完成，请检查连接后重试。";
  return "未能提交变更，请稍后重试。";
}

export function directorySyncErrorMessage(code: string) {
  if (code === "unauthorized") return "登录状态已失效，请重新登录后再试。";
  if (code === "forbidden") return "当前账号没有同步通讯录的权限。";
  if (code === "directory_configuration_invalid") return "飞书同步配置不完整，请联系管理员检查应用配置。";
  if (code === "directory_provider_unavailable") return "飞书通讯录暂时不可用，请稍后重试。";
  if (code === "directory_payload_invalid" || code === "directory_pagination_invalid" || code === "directory_pagination_limit") {
    return "飞书通讯录返回的数据格式异常，请联系管理员检查同步日志。";
  }
  if (code === "retry") return "本次同步暂未完成，系统已记录重试任务。";
  if (code === "no_connection") return "通讯录连接尚未初始化，请联系管理员完成连接配置。";
  if (code === "active_lease" || code === "locked") return "已有同步任务正在执行，请稍后刷新。";
  if (code === "backoff") return "同步任务正在等待重试，请稍后刷新。";
  return "同步未完成，请稍后重试；若持续失败，请联系管理员查看同步日志。";
}

type DirectorySyncResponse = {
  status?: unknown;
  reason?: unknown;
  error?: unknown;
};

function directorySyncFailureCode(body: DirectorySyncResponse | null) {
  if (!body) return "directory_sync_failed";
  if (typeof body.reason === "string") return body.reason;
  if (typeof body.error === "string") return body.error;
  if (body.error && typeof body.error === "object" && !Array.isArray(body.error)) {
    const code = (body.error as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  if (body.status === "retry") return "retry";
  return "directory_sync_failed";
}

function stableIdempotencyKey(
  keys: Map<string, string>,
  logicalPayload: Record<string, unknown>,
) {
  const payloadKey = JSON.stringify(logicalPayload);
  const existing = keys.get(payloadKey);
  if (existing) return existing;
  const next = idempotencyKey();
  keys.set(payloadKey, next);
  return next;
}

function CreateDepartmentDialog({ onAuthoritativeRefresh }: { onAuthoritativeRefresh: () => void }) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<CommandState>("idle");
  const [error, setError] = useState<string | null>(null);
  const isSubmitting = useRef(false);
  const idempotencyKeys = useRef(new Map<string, string>());

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting.current) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const logicalPayload = {
      type: "create_department" as const,
      code: String(data.get("code") ?? "").trim().toUpperCase(),
      name: String(data.get("name") ?? "").trim(),
      description: String(data.get("description") ?? "").trim(),
      sortOrder: Number(data.get("sortOrder") ?? 0),
      version: 0 as const,
      reason: String(data.get("reason") ?? "").trim(),
    };
    isSubmitting.current = true;
    setState("submitting");
    const outcome = await postOrganizationCommand({
      ...logicalPayload,
      idempotencyKey: stableIdempotencyKey(idempotencyKeys.current, logicalPayload),
    });
    isSubmitting.current = false;
    setState(outcome.ok ? "success" : "error");
    setError(outcome.ok ? null : organizationCommandErrorMessage(outcome.error));
    if (outcome.ok) {
      form.reset();
      onAuthoritativeRefresh();
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
          <label className="grid gap-1.5 text-sm font-medium">部门名称<Input className="h-11" name="name" required maxLength={120} /></label>
          <label className="grid gap-1.5 text-sm font-medium">部门编码<Input className="h-11" name="code" required maxLength={80} pattern="[A-Z0-9_-]+" /></label>
          <label className="grid gap-1.5 text-sm font-medium">排序<Input className="h-11" name="sortOrder" type="number" min="0" defaultValue="0" required /></label>
          <label className="grid gap-1.5 text-sm font-medium">说明<Textarea className="min-h-11" name="description" maxLength={1000} /></label>
          <label className="grid gap-1.5 text-sm font-medium">业务理由<Textarea className="min-h-11" name="reason" required maxLength={500} /></label>
          {state === "error" ? <p role="status" className="text-sm text-destructive">{error}</p> : null}
          {state === "success" ? <p role="status" className="text-sm text-success">部门变更已提交，刷新目录以查看最新结果。</p> : null}
          <DialogFooter><Button type="submit" className="h-11" disabled={state === "submitting"}>{state === "submitting" ? "提交中…" : "提交部门"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function AssignRoleDialog({
  roleTargets,
  onAuthoritativeRefresh,
}: {
  roleTargets: readonly RoleCommandTarget[];
  onAuthoritativeRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<CommandState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [targetMemberId, setTargetMemberId] = useState(String(roleTargets[0]?.memberId ?? ""));
  const [roleCode, setRoleCode] = useState<"admin" | "department_head" | "supervisor" | "employee" | "finance" | "hr">("employee");
  const isSubmitting = useRef(false);
  const idempotencyKeys = useRef(new Map<string, string>());
  const selectedTarget = roleTargets.find((target) => String(target.memberId) === targetMemberId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting.current) return;
    if (!selectedTarget) {
      setState("error");
      setError("请选择目录中的员工后再提交。");
      return;
    }
    const form = event.currentTarget;
    const data = new FormData(form);
    const logicalPayload = {
      type: "assign_member_role" as const,
      memberId: selectedTarget.memberId,
      roleCode,
      version: selectedTarget.roleVersion,
      reason: String(data.get("reason") ?? "").trim(),
    };
    isSubmitting.current = true;
    setState("submitting");
    const outcome = await postOrganizationCommand({
      ...logicalPayload,
      idempotencyKey: stableIdempotencyKey(idempotencyKeys.current, logicalPayload),
    });
    isSubmitting.current = false;
    setState(outcome.ok ? "success" : "error");
    setError(outcome.ok ? null : organizationCommandErrorMessage(outcome.error));
    if (outcome.ok) {
      form.reset();
      onAuthoritativeRefresh();
    }
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
              <select aria-label="选择员工" value={targetMemberId} onChange={(event) => setTargetMemberId(event.target.value)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">
                {roleTargets.map((target) => <option key={target.memberId} value={target.memberId}>{target.displayName} · {target.employeeNo} · {target.jobTitle}</option>)}
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">角色
              <select aria-label="选择角色" value={roleCode} onChange={(event) => setRoleCode(event.target.value as typeof roleCode)} className="h-11 w-full rounded-xl border border-input bg-background px-3 text-sm">
                <option value="admin">管理员</option><option value="department_head">部门负责人</option><option value="supervisor">主管</option><option value="employee">普通员工</option><option value="finance">财务</option><option value="hr">人事</option>
              </select>
            </label>
            <label className="grid gap-1.5 text-sm font-medium">业务理由<Textarea className="min-h-11" name="reason" required maxLength={500} /></label>
            {state === "error" ? <p role="status" className="text-sm text-destructive">{error}</p> : null}
            {state === "success" ? <p role="status" className="text-sm text-success">角色变更已提交，已刷新服务器数据。</p> : null}
            <DialogFooter><Button type="submit" className="h-11" disabled={state === "submitting"}>{state === "submitting" ? "提交中…" : "提交角色变更"}</Button></DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AssignManagerDialog({
  managerTargets,
  onAuthoritativeRefresh,
}: {
  managerTargets: Extract<ManagerCommandTargetsResult, { status: "ready" }>;
  onAuthoritativeRefresh: () => void;
}) {
  const assignableTargets = managerTargets.targets.filter(
    (target) => target.managerSource !== "directory",
  );
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<CommandState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [targetEmployeeId, setTargetEmployeeId] = useState(
    assignableTargets[0]?.employeeId ?? "",
  );
  const [managerEmployeeId, setManagerEmployeeId] = useState("");
  const isSubmitting = useRef(false);
  const idempotencyKeys = useRef(new Map<string, string>());
  const selectedTarget = assignableTargets.find(
    (target) => target.employeeId === targetEmployeeId,
  );
  const eligibleManagers = managerTargets.targets.filter(
    (candidate) => selectedTarget
      && candidate.employeeId !== selectedTarget.employeeId
      && candidate.departmentPublicId === selectedTarget.departmentPublicId,
  );
  const effectiveManagerEmployeeId = eligibleManagers.some(
    (candidate) => candidate.employeeId === managerEmployeeId,
  )
    ? managerEmployeeId
    : eligibleManagers.some(
      (candidate) => candidate.employeeId === selectedTarget?.currentManagerEmployeeId,
    )
      ? selectedTarget?.currentManagerEmployeeId ?? ""
      : eligibleManagers[0]?.employeeId ?? "";

  function selectTarget(nextTargetEmployeeId: string) {
    setTargetEmployeeId(nextTargetEmployeeId);
    const nextTarget = assignableTargets.find(
      (target) => target.employeeId === nextTargetEmployeeId,
    );
    const eligibleNextManagers = managerTargets.targets.filter(
      (candidate) => nextTarget
        && candidate.employeeId !== nextTarget.employeeId
        && candidate.departmentPublicId === nextTarget.departmentPublicId,
    );
    const nextManager = eligibleNextManagers.find(
      (candidate) => candidate.employeeId === nextTarget?.currentManagerEmployeeId,
    ) ?? eligibleNextManagers[0];
    setManagerEmployeeId(nextManager?.employeeId ?? "");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSubmitting.current) return;
    if (!selectedTarget || !effectiveManagerEmployeeId) {
      setState("error");
      setError("请选择同一部门的员工和主管后再提交。");
      return;
    }
    const form = event.currentTarget;
    const reason = String(new FormData(form).get("reason") ?? "").trim();
    const logicalPayload = {
      targetEmployeeId: selectedTarget.employeeId,
      managerEmployeeId: effectiveManagerEmployeeId,
      expectedVersion: selectedTarget.managerVersion,
      reason,
    };
    isSubmitting.current = true;
    setState("submitting");
    const outcome = await postManagerCommand({
      ...logicalPayload,
      idempotencyKey: stableIdempotencyKey(
        idempotencyKeys.current,
        logicalPayload,
      ),
    });
    isSubmitting.current = false;
    setState(outcome.ok ? "success" : "error");
    setError(outcome.ok ? null : organizationCommandErrorMessage(outcome.error));
    if (outcome.ok) onAuthoritativeRefresh();
  }

  if (assignableTargets.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={() => setOpen(true)}>
        <UserRoundCog data-icon="inline-start" aria-hidden="true" />
        分配直属主管
      </Button>
      <DialogContent aria-label="分配直属主管" className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>分配直属主管</DialogTitle>
          <DialogDescription>仅显示同一组织的在职员工，并使用服务器读取的主管版本提交审计变更。</DialogDescription>
        </DialogHeader>
        <form className="grid gap-4" onSubmit={submit}>
          <label className="grid gap-1.5 text-sm font-medium">选择员工
            <select aria-label="选择员工" value={targetEmployeeId} onChange={(event) => selectTarget(event.target.value)} className="h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-sm">
              {assignableTargets.map((target) => <option key={target.employeeId} value={target.employeeId}>{target.displayLabel} · {target.departmentName}</option>)}
            </select>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">选择主管
            <select aria-label="选择主管" value={effectiveManagerEmployeeId} onChange={(event) => setManagerEmployeeId(event.target.value)} className="h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-sm" required>
              {eligibleManagers.map((target) => <option key={target.employeeId} value={target.employeeId}>{target.displayLabel}</option>)}
            </select>
          </label>
          {eligibleManagers.length === 0 ? <p role="status" className="text-sm text-destructive">当前员工没有可选的同部门主管。</p> : null}
          <label className="grid gap-1.5 text-sm font-medium">主管调整理由<Textarea aria-label="主管调整理由" className="min-h-11" name="reason" required maxLength={500} /></label>
          {state === "error" ? <p role="status" className="text-sm text-destructive">{error}</p> : null}
          {state === "success" ? <p role="status" className="text-sm text-success">直属主管已更新，正在刷新服务器数据。</p> : null}
          <DialogFooter><Button type="submit" className="h-11" disabled={state === "submitting" || eligibleManagers.length === 0}>{state === "submitting" ? "提交中…" : "提交主管变更"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DirectorySyncButton({ onAuthoritativeRefresh }: { onAuthoritativeRefresh: () => void }) {
  const [state, setState] = useState<CommandState>("idle");
  const [message, setMessage] = useState<string | null>(null);

  async function sync() {
    setState("submitting");
    setMessage(null);
    try {
      const response = await fetch("/api/workstation/directory-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "full" }),
      });
      const body = await response.json().catch(() => null) as DirectorySyncResponse | null;
      if (response.ok && body?.status === "completed") {
        setState("success");
        setMessage("同步已完成，正在刷新员工目录。");
        onAuthoritativeRefresh();
        return;
      }
      setState("error");
      setMessage(directorySyncErrorMessage(directorySyncFailureCode(body)));
    } catch {
      setState("error");
      setMessage("网络连接未完成，请检查连接后重试。");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={sync} disabled={state === "submitting"}>
        <RefreshCw data-icon="inline-start" aria-hidden="true" className={state === "submitting" ? "animate-spin" : undefined} />
        {state === "submitting" ? "同步中…" : "同步通讯录"}
      </Button>
      {state === "error" ? <span role="status" className="text-xs text-destructive">{message}</span> : null}
      {state === "success" ? <span role="status" className="text-xs text-success">{message}</span> : null}
    </div>
  );
}

export function OrganizationDialogs({
  canManageOrganization,
  canManageRoles,
  roleTargets,
  managerTargets,
  onAuthoritativeRefresh = () => window.location.reload(),
}: {
  canManageOrganization: boolean;
  canManageRoles: boolean;
  roleTargets: readonly RoleCommandTarget[];
  managerTargets: ManagerCommandTargetsResult;
  onAuthoritativeRefresh?: () => void;
}) {
  if (!canManageOrganization && !canManageRoles) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canManageOrganization ? <DirectorySyncButton onAuthoritativeRefresh={onAuthoritativeRefresh} /> : null}
      {canManageOrganization ? <CreateDepartmentDialog onAuthoritativeRefresh={onAuthoritativeRefresh} /> : null}
      {canManageOrganization && managerTargets.status === "ready" ? <AssignManagerDialog managerTargets={managerTargets} onAuthoritativeRefresh={onAuthoritativeRefresh} /> : null}
      {canManageOrganization && managerTargets.status === "unavailable" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span role="status" className="text-sm text-destructive">主管数据暂不可用，请刷新页面后重试。</span>
          <Button type="button" variant="outline" className="h-11 rounded-xl" onClick={onAuthoritativeRefresh}>
            重试加载主管数据
          </Button>
        </div>
      ) : null}
      {canManageRoles ? <AssignRoleDialog roleTargets={roleTargets} onAuthoritativeRefresh={onAuthoritativeRefresh} /> : null}
    </div>
  );
}
