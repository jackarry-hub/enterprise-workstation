"use client";

import { hasSupabaseEnv } from "@/lib/supabase/env";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { OperationFile } from "@/features/operations/operations-types";
import type { WorkspaceIdentityContext } from "@/features/operations/operation-actor-compat";

const DATABASE_NAME = "enterprise-workstation-files";
const STORE_NAME = "files";
const STORAGE_BUCKET = "workbench-files";
const memoryFiles = new Map<string, Blob>();

function fileStorageKey(context: WorkspaceIdentityContext, id: string) {
  if (!context.actor || !context.storageNamespace) {
    throw new Error("当前真实身份未绑定本地文件夹具");
  }
  return `${context.storageNamespace}:${id}`;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("当前浏览器不支持本地文件存储"));
      return;
    }
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("无法打开文件存储"));
  });
}

async function putLocalFile(context: WorkspaceIdentityContext, id: string, file: File) {
  const storageKey = fileStorageKey(context, id);
  if (typeof indexedDB === "undefined") {
    memoryFiles.set(storageKey, file);
    return;
  }
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(file, storageKey);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("文件保存失败"));
  });
  database.close();
}

async function getLocalFile(context: WorkspaceIdentityContext, id: string) {
  const storageKey = fileStorageKey(context, id);
  if (typeof indexedDB === "undefined") return memoryFiles.get(storageKey);
  const database = await openDatabase();
  const file = await new Promise<Blob | undefined>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(storageKey);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error ?? new Error("文件读取失败"));
  });
  database.close();
  return file;
}

async function deleteLocalFile(context: WorkspaceIdentityContext, id: string) {
  const storageKey = fileStorageKey(context, id);
  if (typeof indexedDB === "undefined") {
    memoryFiles.delete(storageKey);
    return;
  }
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(storageKey);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("文件删除失败"));
  });
  database.close();
}

export async function storeProjectFileBlob(context: WorkspaceIdentityContext, fileId: string, file: File) {
  fileStorageKey(context, fileId);
  if (file.size > 30 * 1024 * 1024) throw new Error("单个文件不能超过 30MB");
  await putLocalFile(context, fileId, file);
  return fileId;
}

export function readProjectFileBlob(context: WorkspaceIdentityContext, fileId: string) {
  return getLocalFile(context, fileId);
}

export function deleteProjectFileBlob(context: WorkspaceIdentityContext, fileId: string) {
  return deleteLocalFile(context, fileId);
}

export async function downloadProjectFileBlob(context: WorkspaceIdentityContext, fileId: string, fileName: string) {
  const blob = await getLocalFile(context, fileId);
  if (!blob) throw new Error("未找到文件内容；内置示例文件仅保留元数据，请上传本地文件后下载");
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function safeFileName(name: string) {
  return name.replace(/[^\w.\-\u4e00-\u9fa5]+/g, "-").slice(0, 90) || "file";
}

export async function storeOperationFile({
  context,
  file,
  commandId,
  entityType,
  entityId,
  uploadedById,
  version,
}: {
  context: WorkspaceIdentityContext;
  file: File;
  commandId: string;
  entityType: OperationFile["entityType"];
  entityId: string;
  uploadedById: string;
  version: number;
}): Promise<OperationFile> {
  fileStorageKey(context, "operation-file-access");
  if (uploadedById !== context.actor?.id) {
    throw new Error("当前真实身份无权代表其他夹具身份上传文件");
  }
  if (file.size > 30 * 1024 * 1024) throw new Error("单个文件不能超过 30MB");
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `file-${Date.now()}`;
  const createdAt = new Date().toISOString();
  const relativePath = `${commandId}/${entityType}/${entityId}/${id}-${safeFileName(file.name)}`;

  if (hasSupabaseEnv()) {
    try {
      const client = getSupabaseBrowserClient();
      const { data: sessionData } = await client.auth.getSession();
      if (sessionData.session) {
        const objectPath = `${context.storageNamespace}/${relativePath}`;
        const { error } = await client.storage.from(STORAGE_BUCKET).upload(objectPath, file, { upsert: false, contentType: file.type || undefined });
        if (!error) return { id, commandId, entityType, entityId, name: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, version, uploadedById, provider: "supabase", objectPath, createdAt };
      }
    } catch {
      // The interactive demo remains usable before a Supabase session is configured.
    }
  }

  await putLocalFile(context, id, file);
  return { id, commandId, entityType, entityId, name: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, version, uploadedById, provider: "indexeddb", objectPath: id, createdAt };
}

export async function downloadOperationFile(context: WorkspaceIdentityContext, file: OperationFile) {
  fileStorageKey(context, file.objectPath);
  if (file.provider === "supabase") {
    const client = getSupabaseBrowserClient();
    const { data, error } = await client.storage.from(STORAGE_BUCKET).createSignedUrl(file.objectPath, 60);
    if (error || !data.signedUrl) throw error ?? new Error("无法生成下载地址");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    return;
  }

  const blob = await getLocalFile(context, file.objectPath);
  if (!blob) throw new Error("未找到本地文件，请重新上传");
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
