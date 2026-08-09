import { ArrowRight, Eye, FileSpreadsheet, FileText, Presentation } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import type { KnowledgeActivity, KnowledgeDocument } from "@/features/knowledge/knowledge-types";

const typeIcons = { pdf: FileText, docx: FileText, pptx: Presentation, xlsx: FileSpreadsheet } as const;
const typeTones = { pdf: "bg-danger-soft text-destructive", docx: "bg-brand-soft text-primary", pptx: "bg-warning-soft text-warning", xlsx: "bg-success-soft text-success" } as const;

export function DocumentListCard({ title, documents, mode, onPreview, onShowAll }: { title: string; documents: readonly KnowledgeDocument[]; mode: "recent" | "popular"; onPreview: (document: KnowledgeDocument) => void; onShowAll: () => void }) {
  return (
    <GlassCard className="p-4 sm:p-5">
      <div className="flex items-center justify-between"><h2 className="text-base font-semibold">{title}</h2><Button type="button" variant="link" size="sm" onClick={onShowAll}>查看全部<ArrowRight data-icon="inline-end" /></Button></div>
      <div className="mt-2 divide-y divide-border/70">
        {documents.slice(0, 5).map((document) => {
          const Icon = typeIcons[document.type];
          return (
            <button key={document.id} type="button" aria-label={`预览文档：${document.title}`} onClick={() => onPreview(document)} className="group flex w-full items-center gap-3 py-2.5 text-left">
              <span className={`grid size-8 shrink-0 place-items-center rounded-lg ${typeTones[document.type]}`}><Icon aria-hidden="true" className="size-4" /></span>
              <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium group-hover:text-primary">{document.title}</p><p className="mt-0.5 truncate text-xs text-muted-foreground">{mode === "recent" ? document.updatedAt.slice(5, 16).replace("T", " ") : document.tags.join(" · ")}</p></div>
              {mode === "recent" ? <Avatar size="sm"><AvatarFallback className="bg-brand-soft text-primary">{document.author.slice(0, 1)}</AvatarFallback></Avatar> : <span className="flex items-center gap-1 text-xs text-muted-foreground"><Eye className="size-3" />{document.views.toLocaleString()}</span>}
            </button>
          );
        })}
      </div>
    </GlassCard>
  );
}

export function KnowledgeActivityCard({ activities }: { activities: readonly KnowledgeActivity[] }) {
  return (
    <GlassCard className="p-4 sm:p-5">
      <div className="flex items-center justify-between"><h2 className="text-base font-semibold">知识库动态</h2><span className="text-xs text-primary">持续更新</span></div>
      <div className="mt-3 divide-y divide-border/70">
        {activities.map((activity, index) => (
          <div key={activity.id} className="relative flex gap-3 py-2.5 pl-4 before:absolute before:top-4 before:left-0 before:size-1.5 before:rounded-full before:bg-primary" style={{ opacity: 1 - index * 0.1 }}>
            <div><p className="text-sm leading-5"><strong>{activity.actor}</strong> {activity.content}</p><p className="mt-0.5 text-xs text-muted-foreground">{activity.createdAt}</p></div>
          </div>
        ))}
      </div>
    </GlassCard>
  );
}
