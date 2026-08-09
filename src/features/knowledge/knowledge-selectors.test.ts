import { describe, expect, it } from "vitest";

import { knowledgeDocuments } from "@/features/knowledge/knowledge-mock-data";
import {
  filterKnowledgeDocuments,
  getPopularKnowledgeDocuments,
  getRecentKnowledgeDocuments,
} from "@/features/knowledge/knowledge-selectors";

describe("knowledge selectors", () => {
  it("searches title, summary, and tags case-insensitively", () => {
    const titleResult = filterKnowledgeDocuments(knowledgeDocuments, { query: "项目", categoryId: "all", tag: "all" });
    const summaryResult = filterKnowledgeDocuments(knowledgeDocuments, { query: "客户交付", categoryId: "all", tag: "all" });
    const tagResult = filterKnowledgeDocuments(knowledgeDocuments, { query: "OKR", categoryId: "all", tag: "all" });

    expect(titleResult.length).toBeGreaterThan(0);
    expect(summaryResult.length).toBeGreaterThan(0);
    expect(tagResult.length).toBeGreaterThan(0);
  });

  it("combines category and tag filters", () => {
    const target = knowledgeDocuments.find(({ categoryId, tags }) => categoryId === "projects" && tags.includes("项目管理"));
    expect(target).toBeDefined();

    const result = filterKnowledgeDocuments(knowledgeDocuments, {
      query: "",
      categoryId: "projects",
      tag: "项目管理",
    });

    expect(result.every(({ categoryId, tags }) => categoryId === "projects" && tags.includes("项目管理"))).toBe(true);
  });

  it("sorts recent and popular documents deterministically", () => {
    const recent = getRecentKnowledgeDocuments(knowledgeDocuments);
    const popular = getPopularKnowledgeDocuments(knowledgeDocuments);

    expect(recent.map(({ updatedAt }) => updatedAt)).toEqual([...recent.map(({ updatedAt }) => updatedAt)].sort().reverse());
    expect(popular.map(({ views }) => views)).toEqual([...popular.map(({ views }) => views)].sort((left, right) => right - left));
  });
});
