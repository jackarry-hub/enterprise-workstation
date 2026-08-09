import { Eye, FileText, Tag, UserRound } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { KnowledgeCategory, KnowledgeDocument } from "@/features/knowledge/knowledge-types";

export function DocumentPreviewDialog({ document, category, open, onOpenChange }: { document: KnowledgeDocument | null; category?: KnowledgeCategory; open: boolean; onOpenChange: (open: boolean) => void }) {
  if (!document) return null;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader><div className="flex items-center gap-2 pr-10"><Badge variant="info">{category?.name ?? "知识文档"}</Badge><Badge variant="outline">{document.type.toUpperCase()}</Badge></div><DialogTitle className="pt-1 text-xl leading-7">{document.title}</DialogTitle><DialogDescription>{document.summary}</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-2xl bg-muted/55 p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><UserRound className="size-3.5" />作者</p><p className="mt-1.5 font-medium">{document.author}</p></div>
          <div className="rounded-2xl bg-muted/55 p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><FileText className="size-3.5" />更新时间</p><p className="mt-1.5 font-medium">{document.updatedAt.slice(0, 10)}</p></div>
          <div className="rounded-2xl bg-muted/55 p-3"><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Eye className="size-3.5" />浏览量</p><p className="mt-1.5 font-medium">{document.views.toLocaleString()}</p></div>
        </div>
        <div className="rounded-2xl border border-border/70 bg-white/55 p-4"><p className="flex items-center gap-1.5 text-sm font-medium"><Tag className="size-4 text-primary" />文档标签</p><div className="mt-3 flex flex-wrap gap-2">{document.tags.map((tag) => <Badge key={tag} variant="secondary">{tag}</Badge>)}</div></div>
      </DialogContent>
    </Dialog>
  );
}
