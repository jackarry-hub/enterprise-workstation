"use client";

import { hasSupabaseEnv } from "@/lib/supabase/env";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { OperationFile } from "@/features/operations/operations-types";

const DATABASE_NAME = "enterprise-workstation-files";
const STORE_NAME = "files";
const STORAGE_BUCKET = "workbench-files";
const memoryFiles = new Map<string, Blob>();

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

async function putLocalFile(id: string, file: File) {
  if (typeof indexedDB === "undefined") {
    memoryFiles.set(id, file);
    return;
  }
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(file, id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("文件保存失败"));
  });
  database.close();
}

async function getLocalFile(id: string) {
  if (typeof indexedDB === "undefined") return memoryFiles.get(id);
  const database = await openDatabase();
  const file = await new Promise<Blob | undefined>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result as Blob | undefined);
    request.onerror = () => reject(request.error ?? new Error("文件读取失败"));
  });
  database.close();
  return file;
}

export async function storeProjectFileBlob(fileId: string, file: File) {
  if (file.size > 30 * 1024 * 1024) throw new Error("单个文件不能超过 30MB");
  await putLocalFile(fileId, file);
  return fileId;
}

export async function downloadProjectFileBlob(fileId: string, fileName: string) {
  const blob = await getLocalFile(fileId);
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
  file,
  commandId,
  entityType,
  entityId,
  uploadedById,
  version,
}: {
  file: File;
  commandId: string;
  entityType: OperationFile["entityType"];
  entityId: string;
  uploadedById: string;
  version: number;
}): Promise<OperationFile> {
  if (file.size > 30 * 1024 * 1024) throw new Error("单个文件不能超过 30MB");
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `file-${Date.now()}`;
  const createdAt = new Date().toISOString();
  const relativePath = `${commandId}/${entityType}/${entityId}/${id}-${safeFileName(file.name)}`;

  if (hasSupabaseEnv()) {
    try {
      const client = getSupabaseBrowserClient();
      const { data: sessionData } = await client.auth.getSession();
      if (sessionData.session) {
        const objectPath = `${sessionData.session.user.id}/${relativePath}`;
        const { error } = await client.storage.from(STORAGE_BUCKET).upload(objectPath, file, { upsert: false, contentType: file.type || undefined });
        if (!error) return { id, commandId, entityType, entityId, name: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, version, uploadedById, provider: "supabase", objectPath, createdAt };
      }
    } catch {
      // The interactive demo remains usable before a Supabase session is configured.
    }
  }

  await putLocalFile(id, file);
  return { id, commandId, entityType, entityId, name: file.name, mimeType: file.type || "application/octet-stream", sizeBytes: file.size, version, uploadedById, provider: "indexeddb", objectPath: id, createdAt };
}

export async function downloadOperationFile(file: OperationFile) {
  if (file.provider === "supabase") {
    const client = getSupabaseBrowserClient();
    const { data, error } = await client.storage.from(STORAGE_BUCKET).createSignedUrl(file.objectPath, 60);
    if (error || !data.signedUrl) throw error ?? new Error("无法生成下载地址");
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
    return;
  }

  const blob = await getLocalFile(file.objectPath);
  if (!blob) throw new Error("未找到本地文件，请重新上传");
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
