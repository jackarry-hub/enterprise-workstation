export type KnowledgeDocumentType = "pdf" | "docx" | "pptx" | "xlsx" | "other";

export interface KnowledgeCategory {
  id: string;
  name: string;
  documentCount: number;
  tone: "blue" | "purple" | "green" | "orange" | "cyan";
}

export interface KnowledgeDocument {
  id: string;
  title: string;
  summary: string;
  categoryId: string;
  type: KnowledgeDocumentType;
  author: string;
  updatedAt: string;
  views: number;
  tags: string[];
  status?: "draft" | "published" | "archived";
  versionId?: string | null;
  sourceId?: string | null;
  sourceName?: string | null;
}

export interface KnowledgeActivity {
  id: string;
  actor: string;
  content: string;
  createdAt: string;
}

export interface KnowledgeFilters {
  query: string;
  categoryId: string;
  tag: string;
}

export interface KnowledgeFileOption {
  id: string;
  name: string;
  mimeType: string;
}

export interface KnowledgeDataResult {
  source: "supabase";
  documents: KnowledgeDocument[];
  categories: KnowledgeCategory[];
  activities: KnowledgeActivity[];
  files: KnowledgeFileOption[];
  canManage: boolean;
  loadError?: string;
  requestId?: string;
}
