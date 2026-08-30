export type KnowledgeVersionStatus = "draft" | "published" | "superseded" | "archived";
export type KnowledgeProcessingState = "quarantined" | "scanning" | "ready" | "rejected";

export type KnowledgeDirectoryDto = {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
};

export type KnowledgeDocumentDto = {
  id: string;
  directoryId: string | null;
  versionId: string | null;
  versionNumber: number | null;
  title: string;
  summary: string;
  category: string;
  tags: string[];
  status: "draft" | "published" | "archived";
  ownerMemberId: string;
  sourceFileId: string | null;
  sourceName: string | null;
  sourceMimeType: string | null;
  updatedAt: string;
};

export type KnowledgeCitationDto = {
  documentId: string;
  versionId: string;
  sourceId: string;
  title: string;
  excerpt: string;
  rank: number;
};
