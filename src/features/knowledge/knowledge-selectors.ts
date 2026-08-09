import type { KnowledgeDocument, KnowledgeFilters } from "@/features/knowledge/knowledge-types";

export function filterKnowledgeDocuments(
  documents: readonly KnowledgeDocument[],
  filters: KnowledgeFilters,
) {
  const query = filters.query.trim().toLocaleLowerCase("zh-CN");
  return documents.filter((document) => {
    const searchText = [document.title, document.summary, ...document.tags]
      .join(" ")
      .toLocaleLowerCase("zh-CN");
    return (query === "" || searchText.includes(query))
      && (filters.categoryId === "all" || document.categoryId === filters.categoryId)
      && (filters.tag === "all" || document.tags.includes(filters.tag));
  });
}

export function getRecentKnowledgeDocuments(documents: readonly KnowledgeDocument[], limit = 5) {
  return [...documents].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, limit);
}

export function getPopularKnowledgeDocuments(documents: readonly KnowledgeDocument[], limit = 5) {
  return [...documents].sort((left, right) => right.views - left.views).slice(0, limit);
}
