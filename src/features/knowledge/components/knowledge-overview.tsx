import { FileText, Folder, Tags, UsersRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import type { KnowledgeCategory, KnowledgeDocument } from "@/features/knowledge/knowledge-types";

export function KnowledgeOverview({ categories, documents, selectedTag, onTagSelect }: { categories: readonly KnowledgeCategory[]; documents: readonly KnowledgeDocument[]; selectedTag: string; onTagSelect: (tag: string) => void }) {
  const tags = Array.from(new Set(documents.flatMap(({ tags: documentTags }) => documentTags)));
  const contributors = new Set(documents.map((document) => document.author)).size;
  const today = new Date().toISOString().slice(0, 10);
  const updatedToday = documents.filter((document) => document.updatedAt.slice(0, 10) === today).length;
  return (
    <section className="grid gap-3 xl:grid-cols-3">
      <GlassCard className="p-4 sm:p-5"><h2 className="text-base font-semibold">文档文件夹</h2><div className="mt-3 grid grid-cols-2 gap-2">{categories.slice(0, 6).map((category) => <div key={category.id} className="flex items-center gap-2 rounded-xl border border-border/70 bg-white/55 p-2.5"><Folder className="size-4 text-primary" /><div className="min-w-0"><p className="truncate text-sm font-medium">{category.name}</p><p className="text-xs text-muted-foreground">{category.documentCount} 个文件</p></div></div>)}</div></GlassCard>
      <GlassCard className="p-4 sm:p-5"><h2 className="text-base font-semibold">标签云</h2><div className="mt-4 flex flex-wrap gap-2">{tags.map((tag, index) => <Button key={tag} type="button" variant={selectedTag === tag ? "default" : "outline"} size="sm" onClick={() => onTagSelect(selectedTag === tag ? "all" : tag)} className={index % 3 === 1 ? "text-success" : index % 3 === 2 ? "text-chart-3" : undefined}><Tags data-icon="inline-start" />{tag}</Button>)}</div></GlassCard>
      <GlassCard className="p-4 sm:p-5"><h2 className="text-base font-semibold">知识库概览</h2><div className="mt-5 grid grid-cols-2 divide-x divide-y divide-border/70 sm:grid-cols-4 sm:divide-y-0 xl:grid-cols-2 xl:divide-y xl:[&>*:nth-child(odd)]:border-l-0">{[
        { icon: FileText, label: "文档总数", value: documents.length.toLocaleString() }, { icon: Folder, label: "文件夹", value: categories.length.toLocaleString() }, { icon: UsersRound, label: "成员贡献", value: contributors.toLocaleString() }, { icon: Tags, label: "今日更新", value: updatedToday.toLocaleString() },
      ].map(({ icon: Icon, label, value }) => <div key={label} className="p-3 text-center"><Icon className="mx-auto size-5 text-primary" /><strong className="mt-2 block text-xl">{value}</strong><span className="text-xs text-muted-foreground">{label}</span></div>)}</div></GlassCard>
    </section>
  );
}
