import { randomUUID } from "node:crypto";

import type { KnowledgeDataResult, KnowledgeDocumentType } from "@/features/knowledge/knowledge-types";
import { getSupabaseServerClient } from "@/lib/supabase/server";

type Client = Awaited<ReturnType<typeof getSupabaseServerClient>>;
export type KnowledgeClientFactory = () => Promise<Client>;

type DirectoryRow = { id: number; public_id: string; name: string };
type DocumentRow = {
  id: number; public_id: string; directory_id: number | null; current_version_id: number | null;
  owner_member_id: number; title: string; summary: string; category: string; tags: string[] | null;
  status: "draft" | "published" | "archived"; updated_at: string;
};
type VersionRow = { id: number; public_id: string; source_file_id: number | null };
type SourceRow = { public_id: string; version_id: number };
type FileRow = { id: number; public_id: string; original_name: string; mime_type: string };
type ProfileRow = { organization_member_id: number; display_name: string };

function documentType(name: string): KnowledgeDocumentType {
  const extension = name.split(".").pop()?.toLowerCase();
  return extension === "pdf" || extension === "docx" || extension === "pptx" || extension === "xlsx" ? extension : "other";
}

function unavailable(canManage: boolean, requestId = randomUUID()): KnowledgeDataResult {
  return {
    source: "supabase", documents: [], categories: [], activities: [], files: [], canManage,
    loadError: "知识库数据暂不可用，请稍后重试。", requestId,
  };
}

export async function loadKnowledgeData(
  canManage: boolean,
  clientFactory: KnowledgeClientFactory = getSupabaseServerClient,
): Promise<KnowledgeDataResult> {
  try {
    const client = await clientFactory();
    const [directoryResponse, documentResponse, fileOptionResponse] = await Promise.all([
      client.from("knowledge_directories").select("id, public_id, name").is("archived_at", null).order("name").limit(200),
      client.from("knowledge_documents").select("id, public_id, directory_id, current_version_id, owner_member_id, title, summary, category, tags, status, updated_at").is("archived_at", null).order("updated_at", { ascending: false }).order("public_id", { ascending: false }).limit(500),
      client.from("files").select("id, public_id, original_name, mime_type").not("verified_at", "is", null).is("deleted_at", null).order("created_at", { ascending: false }).order("public_id", { ascending: false }).limit(100),
    ]);
    if (directoryResponse.error || documentResponse.error || fileOptionResponse.error) throw new Error("knowledge_query_failed");
    const directories = (directoryResponse.data ?? []) as DirectoryRow[];
    const documentRows = (documentResponse.data ?? []) as DocumentRow[];
    const fileOptions = (fileOptionResponse.data ?? []) as FileRow[];
    const versionIds = documentRows.flatMap((row) => row.current_version_id == null ? [] : [row.current_version_id]);
    const ownerIds = [...new Set(documentRows.map((row) => row.owner_member_id))];
    const [versionResponse, profileResponse] = await Promise.all([
      versionIds.length ? client.from("knowledge_document_versions").select("id, public_id, source_file_id").in("id", versionIds) : Promise.resolve({ data: [], error: null }),
      ownerIds.length ? client.from("employee_profiles").select("organization_member_id, display_name").in("organization_member_id", ownerIds).is("deleted_at", null) : Promise.resolve({ data: [], error: null }),
    ]);
    if (versionResponse.error || profileResponse.error) throw new Error("knowledge_relation_failed");
    const versions = (versionResponse.data ?? []) as VersionRow[];
    const sourceFileIds = versions.flatMap((row) => row.source_file_id == null ? [] : [row.source_file_id]);
    const [sourceResponse, sourceFileResponse] = await Promise.all([
      versionIds.length ? client.from("knowledge_sources").select("public_id, version_id").in("version_id", versionIds) : Promise.resolve({ data: [], error: null }),
      sourceFileIds.length ? client.from("files").select("id, public_id, original_name, mime_type").in("id", sourceFileIds).is("deleted_at", null) : Promise.resolve({ data: [], error: null }),
    ]);
    if (sourceResponse.error || sourceFileResponse.error) throw new Error("knowledge_source_failed");
    const versionById = new Map(versions.map((row) => [row.id, row]));
    const sourceByVersion = new Map(((sourceResponse.data ?? []) as SourceRow[]).map((row) => [row.version_id, row]));
    const fileById = new Map(((sourceFileResponse.data ?? []) as FileRow[]).map((row) => [row.id, row]));
    const profileByMember = new Map(((profileResponse.data ?? []) as ProfileRow[]).map((row) => [row.organization_member_id, row]));
    const directoryById = new Map(directories.map((row) => [row.id, row]));
    const documents = documentRows.map((row) => {
      const version = row.current_version_id == null ? undefined : versionById.get(row.current_version_id);
      const source = version ? sourceByVersion.get(version.id) : undefined;
      const file = version?.source_file_id == null ? undefined : fileById.get(version.source_file_id);
      return {
        id: row.public_id,
        title: row.title,
        summary: row.summary,
        categoryId: row.directory_id == null ? "unfiled" : directoryById.get(row.directory_id)?.public_id ?? "unfiled",
        type: documentType(file?.original_name ?? ""),
        author: profileByMember.get(row.owner_member_id)?.display_name ?? "企业成员",
        updatedAt: row.updated_at,
        views: 0,
        tags: Array.isArray(row.tags) ? row.tags : [],
        status: row.status,
        versionId: version?.public_id ?? null,
        sourceId: source?.public_id ?? null,
        sourceName: file?.original_name ?? null,
      };
    });
    const categories = directories.map((directory, index) => ({
      id: directory.public_id,
      name: directory.name,
      documentCount: documents.filter((document) => document.categoryId === directory.public_id).length,
      tone: (["blue", "purple", "green", "orange", "cyan"] as const)[index % 5],
    }));
    if (documents.some((document) => document.categoryId === "unfiled")) {
      categories.push({ id: "unfiled", name: "未归档", documentCount: documents.filter((document) => document.categoryId === "unfiled").length, tone: "blue" });
    }
    return {
      source: "supabase", documents, categories, activities: [], canManage,
      files: fileOptions.map((file) => ({ id: file.public_id, name: file.original_name, mimeType: file.mime_type })),
    };
  } catch {
    return unavailable(canManage);
  }
}
