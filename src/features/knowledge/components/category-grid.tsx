import { BookOpenCheck, CircleHelp, FileStack, FolderKanban, GraduationCap, ScrollText } from "lucide-react";

import { GlassCard } from "@/components/ui/glass-card";
import type { KnowledgeCategory } from "@/features/knowledge/knowledge-types";

const icons = [BookOpenCheck, FolderKanban, GraduationCap, FileStack, ScrollText, CircleHelp];
const tones = {
  blue: "bg-brand-soft text-primary",
  purple: "bg-chart-3/12 text-chart-3",
  green: "bg-success-soft text-success",
  orange: "bg-warning-soft text-warning",
  cyan: "bg-chart-5/18 text-primary",
} as const;

export function CategoryGrid({ categories, selectedId, onSelect }: { categories: readonly KnowledgeCategory[]; selectedId: string; onSelect: (id: string) => void }) {
  return (
    <section aria-label="知识分类" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
      {categories.map((category, index) => {
        const Icon = icons[index % icons.length];
        return (
          <GlassCard key={category.id} className={selectedId === category.id ? "border-primary/45 bg-brand-soft/70" : undefined}>
            <button type="button" aria-pressed={selectedId === category.id} aria-label={category.name} onClick={() => onSelect(selectedId === category.id ? "all" : category.id)} className="flex w-full items-center gap-3 p-3 text-left sm:p-4">
              <span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${tones[category.tone]}`}><Icon aria-hidden="true" className="size-5" /></span>
              <span className="min-w-0"><span className="block truncate text-sm font-medium">{category.name}</span><span className="mt-1 block text-xs text-muted-foreground">{category.documentCount} 篇文档</span></span>
            </button>
          </GlassCard>
        );
      })}
    </section>
  );
}
