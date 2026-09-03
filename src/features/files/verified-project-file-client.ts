"use client";

import type { ProjectFile } from "@/features/projects/types";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";

const STORAGE_BUCKET = "workbench-files";
const MAX_PROJECT_FILE_BYTES = 30 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const FORMAL_FILE_TYPES = new Map<string, ReadonlySet<string>>([
  ["application/pdf", new Set(["pdf"])],
  ["text/plain", new Set(["txt", "md"])],
  ["text/csv", new Set(["csv"])],
  ["image/jpeg", new Set(["jpg", "jpeg"])],
  ["image/png", new Set(["png"])],
  ["image/webp", new Set(["webp"])],
  ["application/zip", new Set(["zip"])],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", new Set(["docx"])],
  ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", new Set(["xlsx"])],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", new Set(["pptx"])],
]);
const FORMAL_EXTENSION_TYPES = new Map(
  Array.from(FORMAL_FILE_TYPES.entries()).flatMap(([mimeType, extensions]) => (
    Array.from(extensions, (extension) => [extension, mimeType] as const)
  )),
);
const FORMAL_BROWSER_MIME_ALIASES = new Map([
  ["md", new Map([["text/markdown", "text/plain"]])],
]);

export class ProjectFileTransportError extends Error {
  constructor(
    public readonly code: string,
    public readonly retryable = false,
    message = "文件服务暂时不可用",
  ) {
    super(message);
    this.name = "ProjectFileTransportError";
  }
}

export type VerifiedFileUploadPhase =
  | "hashing"
  | "reserving"
  | "uploading"
  | "verifying"
  | "completed";

function fileExtension(name: string) {
  return name.includes(".") ? name.split(".").pop()?.toLowerCase() ?? "" : "";
}

function validateFormalFile(file: File) {
  if (file.size <= 0) throw new ProjectFileTransportError("empty_file", false, "不能上传空文件");
  if (file.size > MAX_PROJECT_FILE_BYTES) {
    throw new ProjectFileTransportError("file_too_large", false, "单个文件不能超过 30MB");
  }
  if (file.name.length > 180 || /[\\/\u0000-\u001f\u007f]/.test(file.name)) {
    throw new ProjectFileTransportError("invalid_file_name", false, "文件名不符合企业存储规则");
  }
  const extension = fileExtension(file.name);
  const browserMimeType = file.type.toLowerCase();
  const mimeType = FORMAL_BROWSER_MIME_ALIASES.get(extension)?.get(browserMimeType)
    ?? (browserMimeType || FORMAL_EXTENSION_TYPES.get(extension) || "");
  const allowedExtensions = FORMAL_FILE_TYPES.get(mimeType);
  if (!allowedExtensions?.has(extension)) {
    throw new ProjectFileTransportError(
      "unsupported_media_type",
      false,
      "仅支持 PDF、Office 文档、文本、CSV、常用图片和 ZIP 文件",
    );
  }
  return mimeType;
}

async function defaultDigestFile(file: File) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function readJson(response: Response) {
  try {
    return await response.json() as Record<string, unknown>;
  } catch {
    return {};
  }
}

function formalError(code: unknown, fallback: string, retryable = false) {
  const safeCode = typeof code === "string" ? code : "file_service_unavailable";
  const messages: Record<string, string> = {
    forbidden: "你没有向该项目上传文件的权限",
    not_found: "项目或文件已变更，请刷新后重试",
    upload_expired: "上传凭证已过期，请重新选择文件",
    missing_object: "存储服务未收到完整文件，请重新上传",
    object_mismatch: "文件完整性核验失败，请重新上传原文件",
    verification_in_progress: "服务端正在核验该文件，请稍后继续确认",
    unsupported_media_type: "该文件类型不在企业安全白名单中",
    file_too_large: "单个文件不能超过 30MB",
  };
  return new ProjectFileTransportError(safeCode, retryable, messages[safeCode] ?? fallback);
}

function validTimestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}

function validCanonicalObjectPath(
  value: unknown,
  projectId: string,
  extension: string,
  expectedUploadId?: string,
) {
  if (typeof value !== "string" || value.length > 1024 || /[\\\u0000-\u001f\u007f]/.test(value)) return false;
  const parts = value.split("/");
  const pathUploadId = parts[7]?.toLowerCase() ?? "";
  return parts.length === 9
    && parts[0] === "tenants" && UUID_PATTERN.test(parts[1] ?? "")
    && parts[2] === "organizations" && UUID_PATTERN.test(parts[3] ?? "")
    && parts[4] === "projects" && parts[5]?.toLowerCase() === projectId.toLowerCase()
    && parts[6] === "uploads" && UUID_PATTERN.test(pathUploadId)
    && (!expectedUploadId || pathUploadId === expectedUploadId.toLowerCase())
    && parts[8]?.toLowerCase() === `${pathUploadId}.${extension}`;
}

function parseProjectFile(value: unknown, expectedProjectId: string): ProjectFile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const projectId = typeof source.projectId === "string" ? source.projectId.toLowerCase() : "";
  const originalName = typeof source.originalName === "string" ? source.originalName.trim() : "";
  const extension = originalName.includes(".") ? originalName.split(".").pop()?.toLowerCase() ?? "" : "";
  const mimeType = typeof source.mimeType === "string" ? source.mimeType.toLowerCase() : "";
  const allowedExtensions = FORMAL_FILE_TYPES.get(mimeType);
  const sha256 = typeof source.sha256 === "string" ? source.sha256.toLowerCase() : "";
  const taskId = source.taskId == null ? undefined : source.taskId;
  if (!UUID_PATTERN.test(String(source.id)) || !UUID_PATTERN.test(projectId)
      || projectId !== expectedProjectId.toLowerCase()
      || !UUID_PATTERN.test(String(source.organizationId))
      || (taskId !== undefined && (typeof taskId !== "string" || !UUID_PATTERN.test(taskId)))
      || source.bucket !== STORAGE_BUCKET
      || !originalName || originalName.length > 180 || /[\\/\u0000-\u001f\u007f]/.test(originalName)
      || !allowedExtensions?.has(extension)
      || !validCanonicalObjectPath(source.objectPath, projectId, extension)
      || !Number.isSafeInteger(source.sizeBytes) || Number(source.sizeBytes) <= 0
      || Number(source.sizeBytes) > MAX_PROJECT_FILE_BYTES || !SHA256_PATTERN.test(sha256)
      || !UUID_PATTERN.test(String(source.uploadedById))
      || !validTimestamp(source.verifiedAt) || !validTimestamp(source.createdAt)
      || typeof source.accessScope !== "string"
      || !["organization", "restricted", "private"].includes(source.accessScope)) return null;
  return {
    id: String(source.id).toLowerCase(),
    organizationId: String(source.organizationId).toLowerCase(),
    projectId,
    taskId: typeof taskId === "string" ? taskId.toLowerCase() : undefined,
    bucket: STORAGE_BUCKET,
    objectPath: String(source.objectPath),
    originalName,
    mimeType,
    sizeBytes: Number(source.sizeBytes),
    sha256,
    accessScope: source.accessScope as ProjectFile["accessScope"],
    uploadedById: String(source.uploadedById).toLowerCase(),
    verifiedAt: String(source.verifiedAt),
    createdAt: String(source.createdAt),
  };
}

export async function uploadVerifiedProjectFile({
  projectId,
  file,
  idempotencyKey,
  accessScope = "restricted",
  fetcher = fetch,
  digestFile = defaultDigestFile,
  uploadSignedObject,
  onProgress,
}: {
  projectId: string;
  file: File;
  idempotencyKey: string;
  accessScope?: ProjectFile["accessScope"];
  fetcher?: typeof fetch;
  digestFile?: (file: File) => Promise<string>;
  uploadSignedObject?: (input: {
    bucket: string;
    objectPath: string;
    uploadToken: string;
    file: File;
  }) => Promise<void>;
  onProgress?: (phase: VerifiedFileUploadPhase) => void;
}): Promise<ProjectFile> {
  const mimeType = validateFormalFile(file);
  onProgress?.("hashing");
  const sha256 = await digestFile(file);
  onProgress?.("reserving");
  let reservationResponse: Response;
  try {
    onProgress?.("uploading");
    reservationResponse = await fetcher("/api/workstation/files/upload-url", {
      method: "POST",
      headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        projectId,
        fileName: file.name,
        mimeType,
        sizeBytes: file.size,
        sha256,
        accessScope,
      }),
    });
  } catch {
    throw formalError("upload_unconfirmed", "未能确认上传凭证，请使用原请求重试", true);
  }
  const reservation = await readJson(reservationResponse);
  if (!reservationResponse.ok) {
    throw formalError(
      reservation.error,
      reservationResponse.status >= 500 ? "未能确认上传凭证，请使用原请求重试" : "无法申请企业文件上传凭证",
      reservationResponse.status >= 500,
    );
  }
  if (reservation.state === "completed") {
    const replay = parseProjectFile(reservation.file, projectId);
    if (replay) return replay;
    throw formalError("invalid_server_response", "文件服务返回了无效结果");
  }
  const uploadId = typeof reservation.uploadId === "string" ? reservation.uploadId : "";
  const uploadToken = typeof reservation.uploadToken === "string" ? reservation.uploadToken : "";
  const objectPath = typeof reservation.objectPath === "string" ? reservation.objectPath : "";
  const expiresAt = typeof reservation.expiresAt === "string"
    ? new Date(reservation.expiresAt).getTime()
    : Number.NaN;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (reservation.state !== "pending"
      || !UUID_PATTERN.test(uploadId)
      || !uploadToken || uploadToken.length > 4096 || /[\u0000-\u001f\u007f]/.test(uploadToken)
      || !Number.isFinite(expiresAt) || expiresAt <= Date.now()
      || !validCanonicalObjectPath(objectPath, projectId, extension, uploadId)) {
    throw formalError("invalid_server_response", "文件服务返回了无效上传凭证");
  }

  try {
    if (uploadSignedObject) {
      await uploadSignedObject({ bucket: STORAGE_BUCKET, objectPath, uploadToken, file });
    } else {
      const client = getSupabaseBrowserClient();
      const { error } = await client.storage.from(STORAGE_BUCKET).uploadToSignedUrl(
        objectPath,
        uploadToken,
        file,
        { contentType: mimeType, upsert: false, cacheControl: "3600" },
      );
      if (error) throw error;
    }
  } catch {
    // Completion reconciles a lost upload response by inspecting the object.
  }

  let completionResponse: Response;
  try {
    onProgress?.("verifying");
    completionResponse = await fetcher("/api/workstation/files/complete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadId }),
    });
  } catch {
    throw formalError("upload_unconfirmed", "文件已传输，但核验结果尚未确认，请使用原请求重试", true);
  }
  const completion = await readJson(completionResponse);
  if (!completionResponse.ok) {
    const retryable = completionResponse.status >= 500 || completion.error === "verification_in_progress";
    throw formalError(
      completion.error,
      completionResponse.status >= 500 ? "未能确认文件核验结果，请使用原请求重试" : "企业文件核验失败",
      retryable,
    );
  }
  const result = parseProjectFile(completion.file, projectId);
  if (!result) throw formalError("invalid_server_response", "文件服务返回了无效核验结果");
  onProgress?.("completed");
  return result;
}

export async function downloadVerifiedProjectFile(
  fileId: string,
  {
    fetcher = fetch,
    triggerDownload = (url, fileName) => {
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      anchor.rel = "noopener noreferrer";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    },
  }: {
    fetcher?: typeof fetch;
    triggerDownload?: (url: string, fileName: string) => unknown;
  } = {},
) {
  let response: Response;
  try {
    response = await fetcher(`/api/workstation/files/${fileId}/download-url`, {
      method: "POST",
      headers: { "content-type": "application/json" },
    });
  } catch {
    throw formalError("download_unavailable", "无法连接企业文件服务");
  }
  const result = await readJson(response);
  if (!response.ok || typeof result.downloadUrl !== "string") {
    throw formalError(result.error, "无法生成安全下载地址");
  }
  const fileName = typeof result.fileName === "string" ? result.fileName : "download";
  triggerDownload(result.downloadUrl, fileName);
}
