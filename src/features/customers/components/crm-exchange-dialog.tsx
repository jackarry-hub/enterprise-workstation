"use client";

import { useEffect, useRef, useState } from "react";
import { Download, FileJson, LoaderCircle, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const MAX_IMPORT_BYTES = 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CUSTOMER_SOURCES = new Set(["consulting", "referral", "event", "outbound", "other"]);
const CUSTOMER_STATUSES = new Set(["lead", "following", "proposal", "negotiating", "won", "lost"]);
const IMPORT_ERRORS = new Set([
  "rows_required", "invalid_row_count", "invalid_row", "untrusted_scope_field", "unknown_field",
  "invalid_name", "invalid_registration_code", "invalid_owner", "invalid_industry", "invalid_source",
  "invalid_region", "invalid_contact_shape", "invalid_contact_name", "invalid_contact_title",
  "invalid_contact_phone", "invalid_contact_email", "contact_channel_required", "invalid_contact_visibility",
  "invalid_contact_primary_flag", "duplicate_name_in_batch", "duplicate_registration_in_batch",
  "conflict", "not_found", "scope_conflict", "invalid_request", "command_failed",
]);

type Mode = "import" | "export";
type ExportArtifact = {
  exportId: string;
  watermark: string;
  includeContactPii: boolean;
  rowCount: number;
  sha256: string;
  exportedAt: string;
  expiresAt: string;
  downloadUrl: string;
};

function exactKeys(value: Record<string, unknown>, expected: readonly string[]) {
  const actual = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return actual.length === sorted.length && actual.every((key, index) => key === sorted[index]);
}

function isAmbiguousStatus(status: number) {
  return status >= 500 || status === 408 || status === 425 || status === 429;
}

function importRejections(value: unknown, totalRows: number) {
  if (!Array.isArray(value)) return null;
  const parsed: Array<{ index: number; errors: string[] }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const rejection = item as Record<string, unknown>;
    if (!exactKeys(rejection, ["index", "errors"]) || !Number.isSafeInteger(rejection.index)
      || Number(rejection.index) < 0 || Number(rejection.index) >= totalRows || !Array.isArray(rejection.errors)
      || rejection.errors.length < 1 || rejection.errors.length > 16
      || rejection.errors.some((error) => typeof error !== "string" || !IMPORT_ERRORS.has(error))) return null;
    parsed.push({ index: Number(rejection.index), errors: rejection.errors as string[] });
  }
  return parsed;
}

function validText(value: unknown, maximum: number, required = false) {
  return typeof value === "string" && value.length <= maximum && (!required || value.trim().length > 0);
}

function canonicalExportRows(value: unknown, includeContactPii: boolean) {
  if (!Array.isArray(value)) return null;
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const row = item as Record<string, unknown>;
    const keys = ["id", "name", "registrationCode", "industry", "source", "region", "status", "ownerEmployeePublicId"];
    if (!exactKeys(row, includeContactPii ? [...keys, "primaryContact"] : keys)
      || typeof row.id !== "string" || !UUID_PATTERN.test(row.id)
      || !validText(row.name, 160, true)
      || !(row.registrationCode === null || validText(row.registrationCode, 80, true))
      || !validText(row.industry, 80, true) || !validText(row.region, 120)
      || typeof row.source !== "string" || !CUSTOMER_SOURCES.has(row.source)
      || typeof row.status !== "string" || !CUSTOMER_STATUSES.has(row.status)
      || typeof row.ownerEmployeePublicId !== "string" || !UUID_PATTERN.test(row.ownerEmployeePublicId)) return null;
    if (includeContactPii && row.primaryContact !== null) {
      if (!row.primaryContact || typeof row.primaryContact !== "object" || Array.isArray(row.primaryContact)) return null;
      const contact = row.primaryContact as Record<string, unknown>;
      if (!exactKeys(contact, ["id", "name", "title", "phone", "email"])
        || typeof contact.id !== "string" || !UUID_PATTERN.test(contact.id)
        || !validText(contact.name, 120, true) || !validText(contact.title, 120)
        || !(contact.phone === null || validText(contact.phone, 80, true))
        || !(contact.email === null || validText(contact.email, 320, true) && EMAIL_PATTERN.test(contact.email as string))
        || contact.phone === null && contact.email === null) return null;
    }
  }
  return value as Record<string, unknown>[];
}

export function CrmExchangeDialog({
  open, onOpenChange, canImport, canExport, canExportPii, onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canImport: boolean;
  canExport: boolean;
  canExportPii: boolean;
  onComplete: (message: string) => void;
}) {
  const [mode, setMode] = useState<Mode>(canImport ? "import" : "export");
  const [rows, setRows] = useState<unknown[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [reason, setReason] = useState("");
  const [includePii, setIncludePii] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [rejectionDetails, setRejectionDetails] = useState<Array<{ index: number; errors: string[] }>>([]);
  const [exportArtifact, setExportArtifact] = useState<ExportArtifact | null>(null);
  const attemptKey = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode(canImport ? "import" : "export"); setRows(null); setFileName(""); setReason("");
    setIncludePii(false); setBusy(false); setError(""); setResult(""); setRejectionDetails([]); setExportArtifact(null);
    attemptKey.current = null;
  }, [open, canImport]);

  function changeMode(next: Mode) {
    if (busy) return;
    setMode(next); setError(""); setResult(""); setReason(""); setRejectionDetails([]); setExportArtifact(null);
    attemptKey.current = null;
  }

  async function chooseFile(file: File | undefined) {
    setError(""); setResult(""); setRejectionDetails([]); setRows(null); setFileName(""); attemptKey.current = null;
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) { setError("导入文件不能超过 1 MB。"); return; }
    try {
      const parsed = JSON.parse(await file.text());
      if (!Array.isArray(parsed) || parsed.length < 1 || parsed.length > 200) {
        setError("文件必须是包含 1–200 条客户记录的 JSON 数组。"); return;
      }
      setRows(parsed); setFileName(file.name);
    } catch {
      setError("无法解析 JSON 文件，请检查文件格式。");
    }
  }

  async function post(path: string, body: Record<string, unknown>) {
    const key = attemptKey.current ?? crypto.randomUUID();
    attemptKey.current = key;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 45_000);
    try {
      return await fetch(path, { method: "POST", signal: controller.signal,
        headers: { "Content-Type": "application/json", "Idempotency-Key": key },
        body: JSON.stringify(body) });
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function runImport() {
    if (!rows || !reason.trim()) { setError("请选择客户 JSON 文件并填写导入原因。"); return; }
    setBusy(true); setError(""); setResult(""); setRejectionDetails([]);
    try {
      let cursor = 0;
      let importJobId: string | null = null;
      let expectedValidRows: number | null = null;
      let expectedValidationRejectedRows: number | null = null;
      const rejectedByRow = new Map<number, string[]>();
      for (let requestNumber = 0; requestNumber <= 10; requestNumber += 1) {
        const response = await post("/api/workstation/customers/import", { rows, reason: reason.trim(), cursor });
        const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
        if (response.status === 202) {
          const nextCursor = payload.nextCursor;
          const jobId = typeof payload.jobId === "string" && UUID_PATTERN.test(payload.jobId) ? payload.jobId : null;
          const validRows = payload.validRows;
          const validationRejectedRows = payload.validationRejectedRows;
          const rejected = importRejections(payload.rejected, rows.length);
          if (!exactKeys(payload, ["outcome", "resource", "jobId", "nextCursor", "processedRows", "validRows", "validationRejectedRows", "totalRows", "rejected"])
            || payload.outcome !== "processing" || payload.resource !== "crm_import"
            || !jobId || importJobId !== null && jobId !== importJobId
            || !Number.isSafeInteger(validRows) || Number(validRows) < 1 || Number(validRows) > rows.length
            || !Number.isSafeInteger(validationRejectedRows) || Number(validationRejectedRows) < 0
            || expectedValidRows !== null && validRows !== expectedValidRows
            || expectedValidationRejectedRows !== null && validationRejectedRows !== expectedValidationRejectedRows
            || !Number.isSafeInteger(nextCursor) || Number(nextCursor) !== Math.min(cursor + 20, Number(validRows))
            || Number(nextCursor) <= cursor || Number(nextCursor) >= Number(validRows)
            || payload.processedRows !== nextCursor || payload.totalRows !== rows.length
            || Number(validRows) + Number(validationRejectedRows) !== rows.length || !rejected) {
            setError("导入状态响应无法确认，请保持文件与原因不变后重试。");
            return;
          }
          importJobId = jobId;
          expectedValidRows = Number(validRows);
          expectedValidationRejectedRows = Number(validationRejectedRows);
          rejected.forEach((entry) => rejectedByRow.set(entry.index, entry.errors));
          cursor = Number(nextCursor);
          continue;
        }
        const acceptedRows = payload.acceptedRows;
        const rejectedRows = payload.rejectedRows;
        const jobId = typeof payload.jobId === "string" && UUID_PATTERN.test(payload.jobId) ? payload.jobId : null;
        const rejected = importRejections(payload.rejected, rows.length);
        const mergedRejectedCount = rejected
          ? new Set([...rejectedByRow.keys(), ...rejected.map((entry) => entry.index)]).size
          : -1;
        const validOutcome = payload.outcome === "success" || payload.outcome === "partial" || payload.outcome === "failure";
        const terminalStatusMatches = response.status === 200
          ? payload.outcome === "success" && rejectedRows === 0
          : response.status === 207 && Number(rejectedRows) > 0
            && (Number(acceptedRows) > 0 ? payload.outcome === "partial" : payload.outcome === "failure");
        if (!terminalStatusMatches
          || !exactKeys(payload, ["outcome", "resource", "jobId", "acceptedRows", "rejectedRows", "totalRows", "rejected"])
          || !validOutcome || payload.resource !== "crm_import"
          || !jobId || importJobId !== null && jobId !== importJobId
          || !Number.isSafeInteger(acceptedRows) || !Number.isSafeInteger(rejectedRows)
          || Number(acceptedRows) < 0 || Number(rejectedRows) < 0
          || Number(acceptedRows) + Number(rejectedRows) !== rows.length || payload.totalRows !== rows.length
          || expectedValidRows !== null && Number(acceptedRows) > expectedValidRows
          || expectedValidationRejectedRows !== null
            && Number(rejectedRows) < expectedValidationRejectedRows
          || mergedRejectedCount !== Number(rejectedRows)
          || (payload.outcome === "success") !== (rejectedRows === 0)
          || (payload.outcome === "failure") !== (acceptedRows === 0 && Number(rejectedRows) > 0)
          || expectedValidRows !== null && cursor + 20 < expectedValidRows || !rejected) {
          if (!isAmbiguousStatus(response.status) && response.status >= 400) attemptKey.current = null;
          setError(isAmbiguousStatus(response.status) || response.ok
            ? "导入状态尚未确认，请保持文件与原因不变后重试。"
            : "导入未通过校验，请检查文件内容与权限。");
          return;
        }
        rejected.forEach((entry) => rejectedByRow.set(entry.index, entry.errors));
        attemptKey.current = null;
        const message = `导入完成：成功 ${acceptedRows} 条，拒绝 ${rejectedRows} 条。`;
        setRejectionDetails([...rejectedByRow.entries()].sort(([left], [right]) => left - right)
          .map(([index, errors]) => ({ index, errors })));
        setResult(message); onComplete(message);
        return;
      }
      setError("导入批次状态尚未确认，请保持文件与原因不变后重试。");
    } catch {
      setError("网络中断，导入状态尚未确认；请保持文件与原因不变后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function downloadExport(artifact: ExportArtifact) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await fetch(artifact.downloadUrl, {
        method: "GET", signal: controller.signal, headers: { Accept: "application/json" },
      });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      const exportRows = canonicalExportRows(payload.rows, artifact.includeContactPii);
      if (!response.ok || !exactKeys(payload, ["exportId", "watermark", "includeContactPii", "sha256", "exportedAt", "rows"])
        || payload.exportId !== artifact.exportId || payload.watermark !== artifact.watermark
        || payload.includeContactPii !== artifact.includeContactPii
        || payload.sha256 !== artifact.sha256 || payload.exportedAt !== artifact.exportedAt
        || !exportRows || exportRows.length !== artifact.rowCount
        || response.headers.get("X-CRM-Export-SHA256") !== artifact.sha256) {
        if (response.status === 410 || response.status === 403) setExportArtifact(null);
        setError(response.status === 410 ? "导出快照已过期，请重新生成。"
          : response.status === 403 ? "客户权限范围已变化，请重新申请导出。"
            : "下载未完成，可使用下方按钮重试现有快照。");
        return false;
      }
      const blobUrl = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = blobUrl; anchor.download = `quantxy-crm-${artifact.exportId}.json`;
      document.body.append(anchor); anchor.click(); anchor.remove(); URL.revokeObjectURL(blobUrl);
      setError("");
      return true;
    } catch {
      setError("下载未完成，可使用下方按钮重试现有快照。");
      return false;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function runExport() {
    if (!reason.trim()) { setError("请填写导出用途或审批依据。"); return; }
    setBusy(true); setError(""); setResult("");
    try {
      const response = await post("/api/workstation/customers/export", {
        customerId: null, includeContactPii: includePii, reason: reason.trim(),
      });
      const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
      const exportId = typeof payload.exportId === "string" && UUID_PATTERN.test(payload.exportId) ? payload.exportId : null;
      const watermark = typeof payload.watermark === "string" && UUID_PATTERN.test(payload.watermark) ? payload.watermark : null;
      const downloadUrl = typeof payload.downloadUrl === "string" ? payload.downloadUrl : null;
      const rowCount = payload.rowCount;
      const exportedAt = typeof payload.exportedAt === "string" ? Date.parse(payload.exportedAt) : Number.NaN;
      const expiresAt = typeof payload.expiresAt === "string" ? Date.parse(payload.expiresAt) : Number.NaN;
      if (response.status !== 202 || !exactKeys(payload, ["outcome", "resource", "exportId", "watermark", "includeContactPii", "exportedAt", "expiresAt", "rowCount", "sha256", "downloadUrl"])
        || payload.outcome !== "success" || payload.resource !== "crm_export" || !exportId || !watermark
        || payload.includeContactPii !== includePii
        || downloadUrl !== `/api/workstation/customers/export/${exportId}`
        || !Number.isSafeInteger(rowCount) || Number(rowCount) < 0 || Number(rowCount) > 5000
        || typeof payload.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(payload.sha256)
        || !Number.isFinite(exportedAt) || !Number.isFinite(expiresAt)
        || expiresAt <= exportedAt || expiresAt <= Date.now()) {
        if (!isAmbiguousStatus(response.status) && response.status >= 400) attemptKey.current = null;
        setError(isAmbiguousStatus(response.status) || response.ok
          ? "导出快照状态尚未确认，请保持条件不变后重试。"
          : "导出请求未通过权限或业务校验。");
        return;
      }
      const artifact: ExportArtifact = { exportId, watermark, includeContactPii: includePii,
        rowCount: Number(rowCount),
        sha256: payload.sha256, exportedAt: payload.exportedAt as string,
        expiresAt: payload.expiresAt as string, downloadUrl };
      attemptKey.current = null;
      setExportArtifact(artifact);
      const message = `已生成 ${rowCount} 条客户记录的审计快照，有效期 15 分钟。`;
      setResult(message); onComplete(message);
      if (await downloadExport(artifact)) setResult(`${message} 下载已完成。`);
    } catch {
      setError("网络中断，导出快照状态尚未确认；请保持条件不变后重试。");
    } finally {
      setBusy(false);
    }
  }

  async function retryDownload() {
    if (!exportArtifact) return;
    setBusy(true); setError("");
    try {
      if (await downloadExport(exportArtifact)) {
        setResult(`已下载 ${exportArtifact.rowCount} 条客户记录的审计快照。`);
      }
    } finally {
      setBusy(false);
    }
  }

  return <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
    <DialogContent className="max-h-[100dvh] overflow-y-auto max-sm:top-0 max-sm:left-0 max-sm:h-[100dvh] max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none sm:max-w-xl">
      <DialogHeader><DialogTitle>客户数据交换</DialogTitle><DialogDescription>导入逐行原子落库；导出先生成 15 分钟有效的审计快照，再独立下载。</DialogDescription></DialogHeader>
      {canImport && canExport ? <div className="grid grid-cols-2 rounded-xl bg-muted p-1"><Button type="button" variant={mode === "import" ? "default" : "ghost"} onClick={() => changeMode("import")}><Upload />导入</Button><Button type="button" variant={mode === "export" ? "default" : "ghost"} onClick={() => changeMode("export")}><Download />导出</Button></div> : null}
      {error ? <p role="alert" className="rounded-xl bg-danger-soft px-3 py-2 text-sm text-destructive">{error}</p> : null}
      {result ? <p role="status" className="rounded-xl bg-success-soft px-3 py-2 text-sm text-success">{result}</p> : null}
      {rejectionDetails.length ? <div aria-label="导入拒绝明细" className="rounded-xl border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-warning"><p className="font-medium">请修正后重新导入</p><ul className="mt-1 space-y-1">{rejectionDetails.slice(0, 5).map((entry) => <li key={entry.index}>第 {entry.index + 1} 行：{entry.errors.join("、")}</li>)}</ul>{rejectionDetails.length > 5 ? <details className="mt-2"><summary className="cursor-pointer font-medium">查看全部 {rejectionDetails.length} 行</summary><ul className="mt-2 max-h-48 space-y-1 overflow-y-auto border-t border-warning/25 pt-2">{rejectionDetails.map((entry) => <li key={entry.index}>第 {entry.index + 1} 行：{entry.errors.join("、")}</li>)}</ul></details> : null}</div> : null}
      {mode === "import" && canImport ? <div className="space-y-4"><label className="block rounded-2xl border border-dashed border-border p-5 text-center"><FileJson className="mx-auto size-7 text-primary" /><span className="mt-2 block text-sm font-medium">选择客户 JSON 文件</span><span className="mt-1 block text-xs text-muted-foreground">最多 200 条、1 MB；服务端会再次逐字段校验</span><Input className="mt-3" type="file" accept=".json,application/json" aria-label="客户导入文件" disabled={busy} onChange={(event) => void chooseFile(event.target.files?.[0])} /></label>{rows ? <p className="rounded-xl bg-muted px-3 py-2 text-sm">{fileName} · 待校验 {rows.length} 条</p> : null}<label className="space-y-1.5 text-sm"><span>导入原因 *</span><Textarea aria-label="导入原因" maxLength={500} value={reason} disabled={busy} onChange={(event) => { setReason(event.target.value); attemptKey.current = null; }} placeholder="例如：历史 CRM 数据迁移，经销售负责人确认" /></label><Button type="button" className="w-full" disabled={busy || !rows} onClick={() => void runImport()}>{busy ? <><LoaderCircle className="animate-spin" />正在导入</> : <><Upload />开始导入</>}</Button></div> : null}
      {mode === "export" && canExport ? <div className="space-y-4"><div className="rounded-2xl border border-border/70 bg-muted/35 p-4"><p className="font-medium">当前权限范围内的客户台账</p><p className="mt-1 text-xs text-muted-foreground">固定列、最多 5,000 条；快照带水印、SHA-256 与下载审计。</p></div>{canExportPii ? <label className="flex items-start gap-3 rounded-xl border border-border/70 p-3 text-sm"><input type="checkbox" className="mt-0.5 size-4" checked={includePii} disabled={busy} onChange={(event) => { setIncludePii(event.target.checked); attemptKey.current = null; }} /><span><strong className="block">包含主联系人电话与邮箱</strong><span className="mt-0.5 block text-xs text-muted-foreground">仅拥有联系人隐私导出权限时可用，每次下载都会审计。</span></span></label> : null}<label className="space-y-1.5 text-sm"><span>导出用途 *</span><Textarea aria-label="导出用途" maxLength={500} value={reason} disabled={busy} onChange={(event) => { setReason(event.target.value); attemptKey.current = null; }} placeholder="例如：季度客户台账归档，审批单号…" /></label><Button type="button" className="w-full" disabled={busy} onClick={() => void runExport()}>{busy ? <><LoaderCircle className="animate-spin" />正在处理</> : <><Download />生成并下载快照</>}</Button>{exportArtifact ? <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={() => void retryDownload()}><Download />重新下载已生成快照</Button> : null}</div> : null}
    </DialogContent>
  </Dialog>;
}
