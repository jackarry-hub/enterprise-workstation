"use client";

import { useState } from "react";
import { Download, File, FileArchive, FileImage, FileSpreadsheet, FileText, LoaderCircle, Upload } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { downloadProjectFileBlob } from "@/features/operations/file-storage";
import type { WorkspaceIdentityContext } from "@/features/operations/operation-actor-compat";
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

export function ProjectFilesTab({ context, detail, onUpload }: { context: WorkspaceIdentityContext; detail: ProjectDetailData; onUpload: (file: globalThis.File) => Promise<void> }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function upload(file?: globalThis.File) {
    if (!file) return;
    setBusy(true);
    try {
      await onUpload(file);
      setMessage(`已添加文件：${file.name}；内容已保存，可以下载使用`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "文件上传失败");
    } finally {
      setBusy(false);
    }
  }

  async function download(file: ProjectFile) {
    try {
      await downloadProjectFileBlob(context, file.objectPath, file.originalName);
      setMessage(`已开始下载：${file.originalName}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "文件下载失败");
    }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
      <GlassCard className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-lg font-semibold">项目文件</h2><p className="mt-1 text-sm text-muted-foreground">集中展示项目协作过程中的文件资料</p></div><Badge variant="info">{detail.files.length} 个文件</Badge></div>
        <div className="mt-5 divide-y divide-border/70">
          {detail.files.length ? detail.files.map((file) => {
            const uploader = detail.members.find(({ member }) => member.id === file.uploadedById)?.member;
            return <article key={file.id} className="flex items-center gap-3 py-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><FileTypeIcon file={file} /></span><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{file.originalName}</p><p className="mt-0.5 text-xs text-muted-foreground">{formatSize(file.sizeBytes)} · {uploader?.displayName ?? "项目成员"} · {new Date(file.createdAt).toLocaleDateString("zh-CN")}</p></div><Badge variant="outline">{file.accessScope === "organization" ? "企业可见" : "项目可见"}</Badge><Button type="button" size="sm" variant="ghost" onClick={() => download(file)}><Download />下载</Button></article>;
          }) : <p className="py-14 text-center text-sm text-muted-foreground">还没有项目文件，可从右侧上传第一个文件。</p>}
        </div>
      </GlassCard>

      <GlassCard className="self-start p-5">
        <span className="grid size-11 place-items-center rounded-2xl bg-brand-soft text-primary"><Upload className="size-5" /></span>
        <h2 className="mt-3 font-semibold">上传项目文件</h2>
        <p className="mt-1 text-sm leading-6 text-muted-foreground">文件内容保存在当前浏览器的安全存储中，支持重新打开页面后下载。</p>
        <label className="mt-4 block cursor-pointer rounded-2xl border border-dashed border-primary/30 bg-primary/5 p-5 text-center transition-colors hover:bg-primary/10">
          <input type="file" aria-label="选择项目文件" className="sr-only" disabled={busy} onChange={(event) => { void upload(event.target.files?.[0]); event.currentTarget.value = ""; }} />
          {busy ? <LoaderCircle className="mx-auto size-6 animate-spin text-primary" /> : <Upload className="mx-auto size-6 text-primary" />}
          <span className="mt-2 block text-sm font-medium">选择本地文件</span>
          <span className="mt-1 block text-xs text-muted-foreground">支持文档、图片、表格及压缩包</span>
          <Button type="button" size="sm" className="pointer-events-none mt-3" disabled={busy}>{busy ? "保存中…" : "上传文件"}</Button>
        </label>
        {message ? <p role="status" className="mt-3 rounded-xl bg-success-soft px-3 py-2 text-xs font-medium text-success">{message}</p> : null}
      </GlassCard>
    </div>
  );
}
