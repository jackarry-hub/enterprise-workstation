export type KnowledgeDocumentType = "pdf" | "docx" | "pptx" | "xlsx";

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
