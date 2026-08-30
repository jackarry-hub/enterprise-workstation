"use client";

import { useMemo, useRef, useState } from "react";
import { FileCheck2, LoaderCircle, ReceiptText } from "lucide-react";

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
import type { ExpenseFormOptions } from "@/features/expenses/expense-data";

type ExpenseStatus = "draft" | "submitted" | "approved" | "rejected" | "paid" | "cancelled";

type ExpenseCommandResult =
  | { ok: true; expense: { id: string; version: number; status: ExpenseStatus } }
  | { ok: false; status: number; error: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const COMMAND_TIMEOUT_MS = 15_000;
const MAX_RECEIPTS = 20;

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), COMMAND_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

export type ExpenseDraftInput = {
  projectId: string | null;
  expenseType: "travel" | "meal" | "transport" | "office" | "other";
  amount: string;
  expenseDate: string;
  description: string;
  receiptFileIds: string[];
};

export type ExpenseTransport = {
  createDraft: (input: ExpenseDraftInput, idempotencyKey: string) => Promise<ExpenseCommandResult>;
  submitDraft: (expenseId: string, expectedVersion: number, idempotencyKey: string) => Promise<ExpenseCommandResult>;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

async function mapExpenseResponse(
  response: Response,
  expectation: { id?: string; version: number },
): Promise<ExpenseCommandResult> {
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, status: response.status, error: "invalid_response" };
  }
  const root = record(body);
  const expense = record(root?.expense);
  if (response.ok && root?.outcome === "success" && root.resource === "expense" && expense
    && typeof expense.id === "string" && UUID_PATTERN.test(expense.id)
    && (expectation.id === undefined || expense.id.toLowerCase() === expectation.id.toLowerCase())
    && Number.isSafeInteger(expense.version) && expense.version === expectation.version
    && typeof expense.status === "string"
    && ["draft", "submitted", "approved", "rejected", "paid", "cancelled"].includes(expense.status)) {
    return {
      ok: true,
      expense: {
        id: expense.id,
        version: Number(expense.version),
        status: expense.status as ExpenseStatus,
      },
    };
  }
  return {
    ok: false,
    status: response.status,
    error: typeof root?.error === "string" ? root.error : "expense_command_unavailable",
  };
}

const defaultTransport: ExpenseTransport = {
  async createDraft(input, idempotencyKey) {
    return mapExpenseResponse(await fetchWithTimeout("/api/workstation/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify(input),
    }), { version: 1 });
  },
  async submitDraft(expenseId, expectedVersion, idempotencyKey) {
    return mapExpenseResponse(await fetchWithTimeout(`/api/workstation/expenses/${encodeURIComponent(expenseId)}/submit`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ expectedVersion }),
    }), { id: expenseId, version: expectedVersion + 1 });
  },
};

function commandKey() {
  return crypto.randomUUID();
}

function fileSize(sizeBytes: number) {
  return sizeBytes < 1024 * 1024
    ? `${Math.max(1, Math.round(sizeBytes / 1024))} KB`
    : `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

export function ExpenseDialog({
  open,
  onOpenChange,
  options,
  transport = defaultTransport,
  onReload,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: ExpenseFormOptions;
  transport?: ExpenseTransport;
  onReload?: () => void;
}) {
  const [projectId, setProjectId] = useState("");
  const [expenseType, setExpenseType] = useState<ExpenseDraftInput["expenseType"]>("travel");
  const [amount, setAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState("");
  const [description, setDescription] = useState("");
  const [receiptIds, setReceiptIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<{ id: string; version: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const keys = useRef(new Map<string, string>());
  const selectedProject = useMemo(
    () => options.projects.find((project) => project.id === projectId),
    [options.projects, projectId],
  );

  function changeProject(value: string) {
    setProjectId(value);
    setReceiptIds([]);
  }

  function toggleReceipt(id: string, checked: boolean) {
    setReceiptIds((current) => {
      if (checked && current.length >= MAX_RECEIPTS && !current.includes(id)) {
        setMessage("每笔报销最多选择 20 张票据。");
        return current;
      }
      setMessage("");
      return checked
        ? [...new Set([...current, id])]
        : current.filter((receiptId) => receiptId !== id);
    });
  }

  function resumeDraft(selected: ExpenseFormOptions["drafts"][number]) {
    setProjectId(selected.projectId ?? "");
    setExpenseType(selected.expenseType);
    setAmount(selected.amount);
    setExpenseDate(selected.expenseDate);
    setDescription(selected.description);
    setReceiptIds(selected.receiptFileIds);
    setDraft({ id: selected.id, version: selected.version });
    setMessage("");
  }

  function keyFor(signature: string) {
    const existing = keys.current.get(signature);
    if (existing) return existing;
    const created = commandKey();
    keys.current.set(signature, created);
    return created;
  }

  function resetForm() {
    setProjectId("");
    setExpenseType("travel");
    setAmount("");
    setExpenseDate("");
    setDescription("");
    setReceiptIds([]);
    setDraft(null);
    setMessage("");
    keys.current.clear();
  }

  async function submit() {
    setMessage("");
    if (!/^\d{1,12}(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
      setMessage("请输入有效的报销金额，最多保留两位小数。");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expenseDate) || !description.trim()) {
      setMessage("请填写费用日期和费用说明。");
      return;
    }
    if (receiptIds.length > 0 && !projectId) {
      setMessage("票据必须关联到你参与的项目。");
      return;
    }
    if (receiptIds.length > MAX_RECEIPTS) {
      setMessage("每笔报销最多选择 20 张票据。");
      return;
    }

    setPending(true);
    let persisted = draft;
    try {
      if (!persisted) {
        const createSignature = JSON.stringify({
          projectId: projectId || null,
          expenseType,
          amount,
          expenseDate,
          description: description.trim(),
          receiptFileIds: receiptIds,
        });
        const created = await transport.createDraft({
          projectId: projectId || null,
          expenseType,
          amount,
          expenseDate,
          description: description.trim(),
          receiptFileIds: receiptIds,
        }, keyFor(`create:${createSignature}`));
        if (!created.ok) {
          setMessage(created.status === 409
            ? "费用状态已变化，请刷新后重试。"
            : "报销草稿保存失败，请稍后重试。");
          return;
        }
        if (created.expense.status !== "draft") {
          setMessage("服务器返回的草稿状态异常，请刷新后重试。");
          return;
        }
        persisted = { id: created.expense.id, version: created.expense.version };
        setDraft(persisted);
      }

      const submitted = await transport.submitDraft(
        persisted.id,
        persisted.version,
        keyFor(`submit:${persisted.id}:${persisted.version}`),
      );
      if (!submitted.ok) {
        setMessage(submitted.status === 409
          ? "费用状态已变化，草稿已保留，请刷新后继续。"
          : "草稿已保存，但提交审批失败，请稍后重试。");
        return;
      }
      if (submitted.expense.status !== "submitted") {
        setMessage("服务器尚未确认进入审批流程，请刷新后查看。");
        return;
      }
      resetForm();
      onReload?.();
      onOpenChange(false);
    } catch {
      setMessage(persisted
        ? "草稿已保存，但网络连接中断，请稍后重试。"
        : "报销服务暂不可用，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={pending ? undefined : onOpenChange}>
      <DialogContent className="max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] overflow-hidden p-0 sm:max-w-2xl max-sm:top-0 max-sm:left-0 max-sm:h-[100dvh] max-sm:max-h-none max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none">
        <DialogHeader className="border-b border-border/60 px-5 py-5 pr-14 sm:px-6">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <span className="grid size-9 place-items-center rounded-xl bg-primary/10 text-primary"><ReceiptText aria-hidden="true" className="size-4" /></span>
            发起费用报销
          </DialogTitle>
          <DialogDescription>先保存服务端草稿，再提交固定审批流程。</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-6">
          {options.loadError ? <div role="alert" className="mb-4 rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">{options.loadError}</div> : null}
          {!draft && options.drafts.length ? (
            <section aria-label="未提交草稿" className="mb-5 rounded-2xl border border-warning/20 bg-warning/5 p-4">
              <h3 className="font-medium text-foreground">未提交草稿</h3>
              <p className="mt-1 text-xs text-muted-foreground">草稿保存在服务器，可在刷新或重新登录后继续提交。</p>
              <div className="mt-3 grid gap-2">
                {options.drafts.map((saved) => (
                  <div key={saved.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background px-3 py-2">
                    <div className="min-w-0"><p className="truncate text-sm font-medium">{saved.description}</p><p className="text-xs text-muted-foreground">¥{saved.amount} · {saved.expenseDate}</p></div>
                    <Button type="button" size="sm" variant="outline" onClick={() => resumeDraft(saved)}>继续提交</Button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <label htmlFor="expense-project" className="text-sm font-medium">关联项目</label>
              <select id="expense-project" value={projectId} onChange={(event) => changeProject(event.target.value)} disabled={pending || Boolean(draft)} className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
                <option value="">不关联项目</option>
                {options.projects.map((project) => <option key={project.id} value={project.id}>{project.code} · {project.name}</option>)}
              </select>
            </div>
            <div className="grid gap-2">
              <label htmlFor="expense-type" className="text-sm font-medium">费用类型</label>
              <select id="expense-type" value={expenseType} onChange={(event) => setExpenseType(event.target.value as ExpenseDraftInput["expenseType"])} disabled={pending || Boolean(draft)} className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50">
                <option value="travel">差旅费</option><option value="meal">餐饮费</option><option value="transport">交通费</option><option value="office">办公费</option><option value="other">其他费用</option>
              </select>
            </div>
            <div className="grid gap-2">
              <label htmlFor="expense-amount" className="text-sm font-medium">报销金额</label>
              <Input id="expense-amount" inputMode="decimal" placeholder="0.00" value={amount} onChange={(event) => setAmount(event.target.value)} disabled={pending || Boolean(draft)} />
            </div>
            <div className="grid gap-2">
              <label htmlFor="expense-date" className="text-sm font-medium">费用日期</label>
              <Input id="expense-date" type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} disabled={pending || Boolean(draft)} />
            </div>
            <div className="grid gap-2 sm:col-span-2">
              <label htmlFor="expense-description" className="text-sm font-medium">费用说明</label>
              <Textarea id="expense-description" rows={4} maxLength={500} placeholder="说明费用用途和业务背景" value={description} onChange={(event) => setDescription(event.target.value)} disabled={pending || Boolean(draft)} />
              <p className="text-right text-xs text-muted-foreground">{description.length}/500</p>
            </div>
          </div>

          {selectedProject ? (
            <section className="mt-5 rounded-2xl border border-border/70 bg-muted/25 p-4" aria-label="可用票据">
              <div className="flex items-center gap-2"><FileCheck2 aria-hidden="true" className="size-4 text-primary" /><h3 className="font-medium text-foreground">已核验票据</h3></div>
              <p className="mt-1 text-xs text-muted-foreground">仅显示你上传且已完成存储核验的 PDF 或图片，每笔最多 20 张。</p>
              <div className="mt-3 grid gap-2">
                {selectedProject.receipts.length ? selectedProject.receipts.map((receipt) => (
                  <label key={receipt.id} className="flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border border-border/60 bg-background px-3 py-2">
                    <input type="checkbox" checked={receiptIds.includes(receipt.id)} onChange={(event) => toggleReceipt(receipt.id, event.target.checked)} disabled={pending || Boolean(draft) || (receiptIds.length >= MAX_RECEIPTS && !receiptIds.includes(receipt.id))} className="size-4 accent-primary" aria-label={`${receipt.name} ${fileSize(receipt.sizeBytes)}`} />
                    <span className="min-w-0"><span className="block truncate text-sm font-medium">{receipt.name}</span><span className="text-xs text-muted-foreground">{fileSize(receipt.sizeBytes)}</span></span>
                  </label>
                )) : <p className="rounded-xl bg-background px-3 py-3 text-sm text-muted-foreground">该项目暂无可用于报销的已核验票据。</p>}
              </div>
            </section>
          ) : null}

          {draft ? <p className="mt-4 rounded-2xl border border-warning/20 bg-warning/10 px-4 py-3 text-sm text-warning">草稿已保存，尚未进入审批流程</p> : null}
          {message ? <p role="alert" className="mt-4 rounded-2xl border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">{message}</p> : null}
        </div>

        <DialogFooter className="sticky bottom-0 border-t border-border/60 bg-background/96 px-5 py-4 sm:px-6">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={pending}>取消</Button>
          <Button type="button" onClick={submit} disabled={pending || Boolean(options.loadError)}>
            {pending ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}
            {draft ? "重新提交" : "提交报销"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
