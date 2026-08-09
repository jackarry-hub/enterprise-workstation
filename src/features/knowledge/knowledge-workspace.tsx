"use client";

import { useMemo, useState } from "react";
import { SearchX } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { GlassCard } from "@/components/ui/glass-card";
import { CategoryGrid } from "@/features/knowledge/components/category-grid";
import { DocumentListCard, KnowledgeActivityCard } from "@/features/knowledge/components/document-panels";
import { DocumentPreviewDialog } from "@/features/knowledge/components/document-preview-dialog";
import { KnowledgeHero } from "@/features/knowledge/components/knowledge-hero";
import { KnowledgeOverview } from "@/features/knowledge/components/knowledge-overview";
import { knowledgeActivities, knowledgeCategories, knowledgeDocuments } from "@/features/knowledge/knowledge-mock-data";
import { filterKnowledgeDocuments, getPopularKnowledgeDocuments, getRecentKnowledgeDocuments } from "@/features/knowledge/knowledge-selectors";
import type { KnowledgeDocument, KnowledgeFilters } from "@/features/knowledge/knowledge-types";
import { OperationalKnowledgePanel } from "@/features/operations/operational-knowledge-panel";

const defaultFilters: KnowledgeFilters = { query: "", categoryId: "all", tag: "all" };

export function KnowledgeWorkspace() {
  const [filters, setFilters] = useState<KnowledgeFilters>(defaultFilters);
  const [selectedDocument, setSelectedDocument] = useState<KnowledgeDocument | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [feedback, setFeedback] = useState("");
  const filteredDocuments = useMemo(() => filterKnowledgeDocuments(knowledgeDocuments, filters), [filters]);

  function openPreview(document: KnowledgeDocument) {
    setSelectedDocument(document);
    setIsPreviewOpen(true);
  }

  function clearFilters() {
    setFilters(defaultFilters);
    setFeedback("");
  }

  function showAll(scope: string) {
    setFilters((current) => ({ ...current, categoryId: "all", tag: "all" }));
    setFeedback(`已展开${scope}`);
  }

  return (
    <main className="mx-auto flex w-full max-w-420 flex-col gap-3 px-3 pt-4 pb-26 sm:px-4 lg:px-5 lg:pt-6 lg:pb-8">
      <KnowledgeHero query={filters.query} onQueryChange={(query) => setFilters((current) => ({ ...current, query }))} onSearch={() => setFeedback(`已找到 ${filteredDocuments.length} 篇相关文档`)} />
      <OperationalKnowledgePanel />
      {feedback ? <p role="status" className="rounded-xl bg-brand-soft px-3 py-2 text-xs font-medium text-primary">{feedback}</p> : null}
      <CategoryGrid categories={knowledgeCategories} selectedId={filters.categoryId} onSelect={(categoryId) => setFilters((current) => ({ ...current, categoryId }))} />

      {filteredDocuments.length === 0 ? (
        <GlassCard>
          <Empty className="min-h-60">
            <EmptyHeader><EmptyMedia variant="icon"><SearchX /></EmptyMedia><EmptyTitle>没有找到相关文档</EmptyTitle><EmptyDescription>尝试更换关键词、分类或标签。</EmptyDescription></EmptyHeader>
            <Button type="button" variant="outline" onClick={clearFilters}>清除搜索与筛选</Button>
          </Empty>
        </GlassCard>
      ) : (
        <section className="grid gap-3 xl:grid-cols-3">
          <DocumentListCard title="最近查看" documents={getRecentKnowledgeDocuments(filteredDocuments)} mode="recent" onPreview={openPreview} onShowAll={() => showAll("全部最近文档")} />
          <DocumentListCard title="热门文档" documents={getPopularKnowledgeDocuments(filteredDocuments)} mode="popular" onPreview={openPreview} onShowAll={() => showAll("全部热门文档")} />
          <KnowledgeActivityCard activities={knowledgeActivities} />
        </section>
      )}

      <KnowledgeOverview categories={knowledgeCategories} documents={knowledgeDocuments} selectedTag={filters.tag} onTagSelect={(tag) => setFilters((current) => ({ ...current, tag }))} />
      <DocumentPreviewDialog document={selectedDocument} category={knowledgeCategories.find(({ id }) => id === selectedDocument?.categoryId)} open={isPreviewOpen} onOpenChange={setIsPreviewOpen} />
    </main>
  );
}
