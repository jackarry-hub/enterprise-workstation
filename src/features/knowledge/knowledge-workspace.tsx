"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CategoryGrid } from "@/features/knowledge/components/category-grid";
import { DocumentListCard, KnowledgeActivityCard } from "@/features/knowledge/components/document-panels";
import { DocumentPreviewDialog } from "@/features/knowledge/components/document-preview-dialog";
import { KnowledgeHero } from "@/features/knowledge/components/knowledge-hero";
import { KnowledgeOverview } from "@/features/knowledge/components/knowledge-overview";
import { filterKnowledgeDocuments, getPopularKnowledgeDocuments, getRecentKnowledgeDocuments } from "@/features/knowledge/knowledge-selectors";
import type { KnowledgeDataResult, KnowledgeDocument, KnowledgeFilters } from "@/features/knowledge/knowledge-types";

const defaultFilters: KnowledgeFilters = { query: "", categoryId: "all", tag: "all" };

export function KnowledgeWorkspace({ result }: { result: KnowledgeDataResult }) {
  const router = useRouter();
  const [filters, setFilters] = useState<KnowledgeFilters>(defaultFilters);
  const [selectedDocument, setSelectedDocument] = useState<KnowledgeDocument | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [fileId, setFileId] = useState("");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState("");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [serverMatches, setServerMatches] = useState<ReadonlySet<string> | null>(null);
  const filteredDocuments = useMemo(() => {
    const locallyFiltered = filterKnowledgeDocuments(result.documents, filters);
    return serverMatches ? locallyFiltered.filter((document) => serverMatches.has(document.id)) : locallyFiltered;
  }, [filters, result.documents, serverMatches]);

  function openPreview(document: KnowledgeDocument) {
    setSelectedDocument(document);
    setIsPreviewOpen(true);
  }

  function clearFilters() {
    setFilters(defaultFilters);
    setServerMatches(null);
    setFeedback("");
  }

  async function search() {
    const query = filters.query.trim();
    if (!query) {
      setServerMatches(null);
      setFeedback(`当前账号可查看 ${result.documents.length} 篇文档`);
      return;
    }
    setPending(true);
    try {
      const response = await fetch(`/api/workstation/knowledge/search?q=${encodeURIComponent(query)}`, { cache: "no-store" });
      const payload = await response.json() as { results?: Array<{ documentId: string }>; error?: string };
      if (!response.ok || !Array.isArray(payload.results)) throw new Error(payload.error ?? "search_failed");
      const matches = new Set(payload.results.map((item) => item.documentId));
      setServerMatches(matches);
      setFeedback(`权限范围内找到 ${matches.size} 篇相关文档`);
    } catch {
      setServerMatches(null);
      setFeedback("知识检索暂不可用，请稍后重试。");
    } finally {
      setPending(false);
    }
  }

  async function createDraft() {
    if (!fileId || !title.trim()) {
      setFeedback("请选择已核验文件并填写文档标题。");
      return;
    }
    setPending(true);
    try {
      const response = await fetch("/api/workstation/knowledge/documents", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({
          fileId,
          title: title.trim(),
          summary: summary.trim(),
          category: category.trim() || "未分类",
          tags: tags.split(/[，,]/).map((tag) => tag.trim()).filter(Boolean),
        }),
      });
      if (!response.ok) throw new Error("create_failed");
      setCreateOpen(false);
      setFeedback("知识草稿已保存到服务器。");
      router.refresh();
    } catch {
      setFeedback("知识草稿保存失败，请检查文件状态和当前权限。");
    } finally {
      setPending(false);
    }
  }

  async function publish(document: KnowledgeDocument) {
    if (!document.versionId) return;
    setPending(true);
    try {
      const response = await fetch(`/api/workstation/knowledge/documents/${encodeURIComponent(document.id)}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ versionId: document.versionId }),
      });
      if (!response.ok) throw new Error("publish_failed");
      setIsPreviewOpen(false);
      setFeedback("知识版本已发布并进入权限过滤检索。");
      router.refresh();
    } catch {
      setFeedback("知识发布失败，请刷新后确认版本和权限。");
    } finally {
      setPending(false);
    }
  }

  if (result.loadError) {
    return <main className="mx-auto w-full max-w-420 px-3 pt-5"><GlassCard className="p-6"><h1 className="text-xl font-semibold">知识库暂不可用</h1><p className="mt-2 text-sm text-muted-foreground">{result.loadError}</p>{result.requestId ? <p className="mt-3 text-xs text-muted-foreground">请求编号：{result.requestId}</p> : null}</GlassCard></main>;
  }

  return (
    <main className="mx-auto flex w-full max-w-420 flex-col gap-3 px-3 pt-4 pb-26 sm:px-4 lg:px-5 lg:pt-6 lg:pb-8">
      <KnowledgeHero query={filters.query} onQueryChange={(query) => { setFilters((current) => ({ ...current, query })); setServerMatches(null); }} onSearch={() => void search()} />
      {result.canManage ? <div className="flex justify-end"><Button type="button" onClick={() => setCreateOpen(true)}><Plus data-icon="inline-start" />从已核验文件新建知识</Button></div> : null}
      {feedback ? <p role="status" className="rounded-xl bg-brand-soft px-3 py-2 text-xs font-medium text-primary">{feedback}</p> : null}
      <CategoryGrid categories={result.categories} selectedId={filters.categoryId} onSelect={(categoryId) => setFilters((current) => ({ ...current, categoryId }))} />

      {filteredDocuments.length === 0 ? (
        <GlassCard><Empty className="min-h-60"><EmptyHeader><EmptyMedia variant="icon"><SearchX /></EmptyMedia><EmptyTitle>{result.documents.length ? "没有找到相关文档" : "暂无可查看的知识文档"}</EmptyTitle><EmptyDescription>{result.documents.length ? "尝试更换关键词、分类或标签。" : "新建并发布首个真实知识版本后将在这里显示。"}</EmptyDescription></EmptyHeader>{result.documents.length ? <Button type="button" variant="outline" onClick={clearFilters}>清除搜索与筛选</Button> : null}</Empty></GlassCard>
      ) : (
        <section className="grid gap-3 xl:grid-cols-3">
          <DocumentListCard title="最近更新" documents={getRecentKnowledgeDocuments(filteredDocuments)} mode="recent" onPreview={openPreview} onShowAll={() => setFeedback("已显示全部当前可见文档")} />
          <DocumentListCard title="已发布文档" documents={getPopularKnowledgeDocuments(filteredDocuments)} mode="popular" onPreview={openPreview} onShowAll={() => setFeedback("已显示全部当前可见文档")} />
          <KnowledgeActivityCard activities={result.activities} />
        </section>
      )}

      <KnowledgeOverview categories={result.categories} documents={result.documents} selectedTag={filters.tag} onTagSelect={(tag) => setFilters((current) => ({ ...current, tag }))} />
      <DocumentPreviewDialog document={selectedDocument} category={result.categories.find(({ id }) => id === selectedDocument?.categoryId)} open={isPreviewOpen} onOpenChange={setIsPreviewOpen} onPublish={result.canManage ? publish : undefined} publishing={pending} />

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-sm:h-[100dvh] max-sm:max-w-none max-sm:rounded-none max-sm:overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>新建知识草稿</DialogTitle><DialogDescription>只允许选择当前账号可见且已完成存储核验的文件。</DialogDescription></DialogHeader>
          <div className="grid gap-4">
            <label className="grid gap-1.5 text-sm font-medium">已核验文件<select value={fileId} onChange={(event) => setFileId(event.target.value)} className="h-11 rounded-xl border border-input bg-background px-3"><option value="">请选择文件</option>{result.files.map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}</select></label>
            <label className="grid gap-1.5 text-sm font-medium">标题<Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={200} /></label>
            <label className="grid gap-1.5 text-sm font-medium">摘要<Textarea value={summary} onChange={(event) => setSummary(event.target.value)} maxLength={2000} rows={4} /></label>
            <label className="grid gap-1.5 text-sm font-medium">分类<Input value={category} onChange={(event) => setCategory(event.target.value)} maxLength={80} /></label>
            <label className="grid gap-1.5 text-sm font-medium">标签<Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="用逗号分隔" /></label>
          </div>
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>取消</Button><Button type="button" disabled={pending || result.files.length === 0} onClick={() => void createDraft()}>{pending ? "保存中…" : "保存草稿"}</Button></div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
