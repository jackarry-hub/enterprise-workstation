"use client";

import { useRef, useState } from "react";
import { CheckCircle2, Download, File, FileArchive, FileImage, FileSpreadsheet, FileText, LoaderCircle, RefreshCw, ShieldCheck, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { ProjectFileTransportError, type VerifiedFileUploadPhase } from "@/features/files/verified-project-file-client";
import type { ProjectDetailData, ProjectFile } from "@/features/projects/types";

function formatSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function FileTypeIcon({ file }: { file: ProjectFile }) {
  if (file.mimeType.startsWith("image/")) return <FileImage className="size-5" />;
  if (file.mimeType.includes("sheet") || file.mimeType.includes("excel")) return <FileSpreadsheet className="size-5" />;
  if (file.mimeType.includes("zip") || file.mimeType.includes("archive")) return <FileArchive className="size-5" />;
  if (file.mimeType.includes("pdf") || file.mimeType.includes("document") || file.mimeType.startsWith("text/")) return <FileText className="size-5" />;
  return <File className="size-5" />;
}

const phaseLabels: Record<VerifiedFileUploadPhase, string> = {
  hashing: "正在计算文件完整性…",
  reserving: "正在申请安全上传通道…",
  uploading: "正在传输到企业对象存储…",
  verifying: "正在由服务端核验文件…",
  completed: "文件已核验并入库",
};

export function ProjectFilesTab({
  detail,
  formal,
  onUpload,
  onDownload,
}: {
  detail: ProjectDetailData;
  formal: boolean;
  onUpload: (
    file: globalThis.File,
    idempotencyKey: string,
    onProgress: (phase: VerifiedFileUploadPhase) => void,
  ) => Promise<void>;
  onDownload: (file: ProjectFile) => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState<"neutral" | "success" | "error">("neutral");
  const [busy, setBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string>();
  const retryFile = useRef<globalThis.File | undefined>(undefined);
  const retryKey = useRef<string | undefined>(undefined);

  async function upload(file?: globalThis.File, retry = false) {
    if (!file) return;
    if (!retry) {
      retryFile.current = file;
      retryKey.current = crypto.randomUUID();
    }
    const idempotencyKey = retryKey.current ?? crypto.randomUUID();
    setBusy(true);
    setMessageTone("neutral");
    try {
      await onUpload(file, idempotencyKey, (phase) => setMessage(phaseLabels[phase]));
      setMessage(formal ? `已核验并保存：${file.name}` : `已添加文件：${file.name}`);
      setMessageTone("success");
      retryFile.current = undefined;
      retryKey.current = undefined;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "文件上传失败");
      setMessageTone("error");
      if (!(error instanceof ProjectFileTransportError) || !error.retryable) {
        retryFile.current = undefined;
        retryKey.current = undefined;
      }
    } finally {
      setBusy(false);
    }
  }

  async function download(file: ProjectFile) {
    setDownloadingId(file.id);
    try {
      await onDownload(file);
      setMessage(`已开始下载：${file.originalName}`);
      setMessageTone("success");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "文件下载失败");
      setMessageTone("error");
    } finally {
      setDownloadingId(undefined);
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <GlassCard className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">项目文件</h2><p className="mt-1 text-sm text-muted-foreground">集中展示项目协作过程中的文件资料</p></div><Badge variant="info">{detail.files.length} 个文件</Badge></div>
        <div className="mt-5 grid gap-2 sm:divide-y sm:divide-border/70 sm:gap-0">
          {detail.files.length ? detail.files.map((file) => {
            const uploader = detail.members.find(({ member }) => member.id === file.uploadedById)?.member;
            const pendingVerification = formal && !file.verifiedAt;
            return <article key={file.id} className="rounded-2xl border border-border/60 bg-background/55 p-3 sm:flex sm:items-center sm:gap-3 sm:rounded-none sm:border-0 sm:bg-transparent sm:py-3"><div className="flex min-w-0 items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><FileTypeIcon file={file} /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{file.originalName}</p><p className="mt-0.5 text-xs text-muted-foreground">{formatSize(file.sizeBytes)} · {uploader?.displayName ?? "项目成员"} · {new Date(file.createdAt).toLocaleDateString("zh-CN")}</p></div></div><div className="mt-3 flex items-center gap-2 sm:mt-0"><Badge variant="outline">{file.accessScope === "organization" ? "企业可见" : file.accessScope === "private" ? "仅本人" : "项目可见"}</Badge>{formal ? file.verifiedAt ? <Badge variant="success"><ShieldCheck />已核验</Badge> : <Badge variant="warning">待核验</Badge> : null}<Button type="button" size="sm" variant="ghost" className="ml-auto min-h-11 sm:min-h-9" disabled={pendingVerification || downloadingId === file.id} onClick={() => download(file)}>{downloadingId === file.id ? <LoaderCircle className="animate-spin" /> : <Download />}{pendingVerification ? "不可下载" : "下载"}</Button></div></article>;
          }) : <p className="py-14 text-center text-sm text-muted-foreground">还没有项目文件，可从右侧上传第一个文件。</p>}
        </div>
      </GlassCard>

      <GlassCard className="self-start p-5">
        <span className="grid size-11 place-items-center rounded-2xl bg-brand-soft text-primary">{formal ? <ShieldCheck className="size-5" /> : <Upload className="size-5" />}</span>
        <h2 className="mt-3 font-semibold">上传项目文件</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">{formal ? "私有对象存储，完成内容核验与操作审计后才会进入项目。" : "演示数据仅保存在当前浏览器，不会进入企业存储。"}</p>
        <label className="mt-4 block min-h-44 cursor-pointer rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-5 text-center transition-colors hover:bg-primary/10">
          <input type="file" aria-label="选择项目文件" accept=".pdf,.docx,.xlsx,.pptx,.txt,.md,.csv,.jpg,.jpeg,.png,.webp,.zip" className="sr-only" disabled={busy} onChange={(event) => { void upload(event.target.files?.[0]); event.currentTarget.value = ""; }} />
          {busy ? <LoaderCircle className="mx-auto size-6 animate-spin text-primary" /> : <Upload className="mx-auto size-6 text-primary" />}
          <span className="mt-2 block text-sm font-medium">选择本地文件</span>
          <span className="mt-1 block text-xs text-muted-foreground">PDF、Office、文本、图片、ZIP · 最大 30MB</span>
          <Button type="button" size="sm" className="pointer-events-none mt-3 min-h-11" disabled={busy}>{busy ? "处理中…" : "上传文件"}</Button>
        </label>
        {message ? <div className={`mt-3 rounded-xl px-3 py-2 text-xs font-medium ${messageTone === "error" ? "bg-destructive/10 text-destructive" : messageTone === "success" ? "bg-success-soft text-success" : "bg-primary/10 text-primary"}`} role={messageTone === "error" ? "alert" : "status"}><span className="flex items-center gap-2">{messageTone === "success" ? <CheckCircle2 className="size-4" /> : busy ? <LoaderCircle className="size-4 animate-spin" /> : null}{message}</span>{messageTone === "error" && retryFile.current && retryKey.current ? <Button type="button" size="sm" variant="outline" className="mt-2 min-h-11 w-full" disabled={busy} onClick={() => void upload(retryFile.current, true)}><RefreshCw />继续核验</Button> : null}</div> : null}
      </GlassCard>
    </div>
  );
}
