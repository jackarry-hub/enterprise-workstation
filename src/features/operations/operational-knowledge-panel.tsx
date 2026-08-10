"use client";

import { useState, type ChangeEvent } from "react";
import { Archive, CheckCircle2, Download, FileClock, FileUp, LoaderCircle, Network, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { useWorkspaceSession } from "@/features/auth/workspace-session-provider";
import { downloadOperationFile, storeOperationFile } from "@/features/operations/file-storage";
import { addKnowledgeEntry, addOperationFile, getActor, publishKnowledgeEntry } from "@/features/operations/operations-data";
import { useOperations } from "@/features/operations/use-operations";
import { cn } from "@/lib/utils";

function titleFromFile(name: string) {
  return name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
}

export function OperationalKnowledgePanel() {
  const session = useWorkspaceSession();
  const { state, context, actor } = useOperations(session);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ message: string; error?: boolean } | null>(null);

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setBusy(true);
    const entryId = `knowledge-manual-${Date.now()}`;
    try {
      const stored = await storeOperationFile({ file, commandId: state.command.id, entityType: "knowledge", entityId: entryId, uploadedById: actor.id, version: 1 });
      addKnowledgeEntry(context, { id: entryId, commandId: state.command.id, title: titleFromFile(file.name), summary: `由 ${actor.name} 直接上传并纳入“${state.command.title}”知识资产。`, category: "项目成果", tags: ["用户上传", "AI试点"], fileIds: [stored.id], status: "published", createdById: actor.id, updatedAt: stored.createdAt });
      addOperationFile(context, stored);
      setFeedback({ message: `${file.name} 已上传、发布并关联到当前命令` });
    } catch (error) {
      setFeedback({ message: error instanceof Error ? error.message : "知识文件上传失败", error: true });
    } finally {
      setBusy(false);
    }
  }

  async function download(fileId: string) {
    const file = state.files.find(({ id }) => id === fileId);
    if (!file) {
      setFeedback({ message: "该演示知识仅有摘要，尚未附加文件", error: true });
      return;
    }
    try {
      await downloadOperationFile(file);
    } catch (error) {
      setFeedback({ message: error instanceof Error ? error.message : "文件下载失败", error: true });
    }
  }

  return (
    <GlassCard className="overflow-hidden border-primary/20">
      <div className="flex flex-col gap-3 border-b border-border/70 bg-brand-soft/55 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div><div className="flex flex-wrap items-center gap-2"><Network className="size-5 text-primary" /><h2 className="text-lg font-semibold">业务闭环知识</h2><Badge variant="info">与任务实时关联</Badge></div><p className="mt-1 text-sm text-muted-foreground">任务验收后自动生成知识条目，也可以直接上传可下载的真实文件。</p></div>
        <Button asChild type="button" disabled={busy}><label className="cursor-pointer">{busy ? <LoaderCircle className="animate-spin" /> : <FileUp />}{busy ? "上传中…" : "上传并发布"}<input className="sr-only" type="file" onChange={upload} disabled={busy} /></label></Button>
      </div>
      {feedback ? <p role="status" className={cn("mx-4 mt-3 rounded-xl px-3 py-2 text-xs font-medium sm:mx-5", feedback.error ? "bg-danger-soft text-destructive" : "bg-success-soft text-success")}>{feedback.message}</p> : null}
      <div className="grid gap-3 p-4 sm:p-5 xl:grid-cols-2">
        {state.knowledge.map((entry) => {
          const sourceTask = state.tasks.find(({ id }) => id === entry.sourceTaskId);
          return (
            <article key={entry.id} className="rounded-2xl border border-border/70 bg-white/60 p-4">
              <div className="flex items-start gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-success-soft text-success">{entry.status === "published" ? <CheckCircle2 /> : <FileClock />}</span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><Badge variant={entry.status === "published" ? "success" : "warning"}>{entry.status === "published" ? "已发布" : "待发布"}</Badge><Badge variant="outline">{entry.category}</Badge>{sourceTask ? <span className="text-[11px] text-muted-foreground">来自 {sourceTask.code}</span> : null}</div><h3 className="mt-1.5 font-semibold">{entry.title}</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">{entry.summary}</p></div></div>
              <div className="mt-3 flex flex-wrap gap-1.5">{entry.tags.map((tag) => <span key={tag} className="rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground">#{tag}</span>)}</div>
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border/70 pt-3">
                <span className="mr-auto text-[11px] text-muted-foreground">维护人：{getActor(entry.createdById).name} · {entry.fileIds.length} 个文件</span>
                {entry.fileIds.map((fileId) => { const file = state.files.find(({ id }) => id === fileId); return <Button key={fileId} type="button" size="sm" variant="outline" onClick={() => download(fileId)}><Download />{file?.name ?? "下载成果"}</Button>; })}
                {entry.status === "draft" ? <Button type="button" size="sm" onClick={() => { publishKnowledgeEntry(context, entry.id, actor.id); setFeedback({ message: `“${entry.title}”已发布` }); }}><Archive />审核发布</Button> : null}
              </div>
            </article>
          );
        })}
        {!state.knowledge.length ? <div className="col-span-full rounded-2xl border border-dashed border-border p-10 text-center"><Sparkles className="mx-auto text-primary" /><p className="mt-2 font-medium">等待首个成果验收</p><p className="mt-1 text-xs text-muted-foreground">负责人通过任务验收后，知识条目会自动生成在这里。</p></div> : null}
      </div>
    </GlassCard>
  );
}

