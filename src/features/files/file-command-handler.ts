import { createHash, randomUUID } from "node:crypto";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { getSupabaseServerClient, getSupabaseServiceRoleClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_BODY_BYTES = 16_384;
export const MAX_PROJECT_FILE_BYTES = 30 * 1024 * 1024;
export const MAX_KNOWLEDGE_FILE_BYTES = 30 * 1024 * 1024;
export const KNOWLEDGE_MIME_TYPES = new Set([
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export function isTenantScopedStoragePath(value: string) {
  const parts = value.split("/");
  return parts.length >= 4 && parts[0] === "tenants" && UUID_PATTERN.test(parts[1])
    && parts[2] === "organizations" && UUID_PATTERN.test(parts[3])
    && !parts.some((part) => part === ".." || part === "." || part.includes("\\"));
}

export function validateKnowledgeFileAdmission(input: { objectPath: string; mimeType: string; sizeBytes: number; sha256: string }) {
  return isTenantScopedStoragePath(input.objectPath)
    && KNOWLEDGE_MIME_TYPES.has(input.mimeType.toLowerCase())
    && Number.isSafeInteger(input.sizeBytes) && input.sizeBytes > 0 && input.sizeBytes <= MAX_KNOWLEDGE_FILE_BYTES
    && SHA256_PATTERN.test(input.sha256);
}
const STORAGE_BUCKET = "workbench-files";
const UPLOAD_FIELDS = new Set([
  "projectId", "fileName", "mimeType", "sizeBytes", "sha256", "accessScope",
]);
const ALLOWED_FILE_TYPES = new Map<string, ReadonlySet<string>>([
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

type RpcError = { code?: string } | null;
type RpcResult = { data: unknown; error: RpcError };
type ActiveSession = { member: { status: string } };
type ObjectInfo = {
  id: string;
  version: string | null;
  size: number;
  mimeType: string;
  etag: string | null;
};

type UploadStorage = {
  createSignedUploadUrl: (bucket: string, objectPath: string) => Promise<{
    signedUrl: string;
    token: string;
  }>;
};

type CompleteStorage = {
  inspectObject: (bucket: string, objectPath: string) => Promise<ObjectInfo | null>;
  downloadObject: (bucket: string, objectPath: string) => Promise<Uint8Array | null>;
  removeObjects: (bucket: string, objectPaths: string[]) => Promise<void>;
};

type DownloadStorage = {
  createSignedDownloadUrl: (
    bucket: string,
    objectPath: string,
    expiresIn: number,
    fileName: string,
  ) => Promise<string>;
};

export type FileUploadReservationDependencies = {
  loadSession: () => Promise<ActiveSession | null>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  verifiedRpc?: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  storage: UploadStorage;
  createRequestId?: () => string;
};

export type FileCompleteDependencies = {
  loadSession: () => Promise<ActiveSession | null>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  verifiedRpc?: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  storage: CompleteStorage;
  createRequestId?: () => string;
};

export type FileDownloadDependencies = {
  loadSession: () => Promise<ActiveSession | null>;
  rpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  storage: DownloadStorage;
  createRequestId?: () => string;
};

export type FileCleanupDependencies = {
  serviceRpc: (name: string, args: Record<string, unknown>) => Promise<RpcResult>;
  storage: Pick<CompleteStorage, "removeObjects">;
  createWorkerToken?: () => string;
};

type CanonicalFile = {
  id: string;
  organizationId: string;
  projectId: string;
  taskId: string | null;
  bucket: string;
  objectPath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  accessScope: "organization" | "restricted" | "private";
  uploadedById: string;
  verifiedAt: string;
  createdAt: string;
};

type CanonicalReservation = {
  state: "pending";
  uploadId: string;
  projectId: string;
  bucket: string;
  objectPath: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  accessScope: "organization" | "restricted" | "private";
  expiresAt: string;
};

type CanonicalVerificationClaim = CanonicalReservation & {
  verificationToken: string;
  verificationLeaseExpiresAt: string;
};

type CanonicalSigningIntent = CanonicalReservation & {
  uploadTokenExpiresAt: string;
};

type ReservationExpectation = {
  uploadId?: string;
  projectId?: string;
  bucket?: string;
  objectPath?: string;
  originalName?: string;
  mimeType?: string;
  sizeBytes?: number;
  sha256?: string;
  accessScope?: CanonicalReservation["accessScope"];
};

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function canonicalUuid(value: unknown) {
  return typeof value === "string" && UUID_PATTERN.test(value)
    ? value.toLowerCase()
    : null;
}

function safeString(value: unknown, maximum: number) {
  if (typeof value !== "string") return null;
  const parsed = value.trim();
  return parsed.length > 0 && parsed.length <= maximum ? parsed : null;
}

function validTimestamp(value: unknown) {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime())
    ? value
    : null;
}

function failureStatus(code: string) {
  if (code === "forbidden") return 403;
  if (code === "not_found") return 404;
  if (code === "scope_conflict") return 409;
  if (code === "verification_in_progress") return 409;
  if (code === "upload_expired") return 410;
  if (code === "missing_object" || code === "object_mismatch") return 422;
  if (code === "invalid_request") return 400;
  return 503;
}

function publicFailure(value: unknown) {
  if (typeof value !== "string") return "command_failed";
  return [
    "forbidden", "not_found", "scope_conflict", "upload_expired",
    "missing_object", "object_mismatch", "invalid_request", "verification_in_progress",
  ].includes(value) ? value : "command_failed";
}

async function parseBody(request: Request) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return null;
  }
  try {
    const raw = await request.text();
    if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return null;
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function parseFileName(value: unknown) {
  const fileName = safeString(value, 180);
  if (!fileName || fileName === "." || fileName === ".." || /[\\/\u0000-\u001f\u007f]/.test(fileName)) {
    return null;
  }
  const extension = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() : undefined;
  return extension ? { fileName, extension } : null;
}

function validCanonicalObjectPath(
  value: string,
  projectId: string,
  extension: string,
  expectedUploadId?: string,
) {
  const parts = value.split("/");
  const pathUploadId = canonicalUuid(parts[7]);
  return parts.length === 9
    && parts[0] === "tenants" && !!canonicalUuid(parts[1])
    && parts[2] === "organizations" && !!canonicalUuid(parts[3])
    && parts[4] === "projects" && canonicalUuid(parts[5]) === projectId
    && parts[6] === "uploads" && !!pathUploadId
    && (!expectedUploadId || pathUploadId === expectedUploadId)
    && parts[8]?.toLowerCase() === `${pathUploadId}.${extension}`;
}

function parseUploadCommand(parsed: Record<string, unknown>) {
  if (Object.keys(parsed).some((field) => !UPLOAD_FIELDS.has(field))) return { error: "invalid_request" } as const;
  const projectId = canonicalUuid(parsed.projectId);
  const fileName = parseFileName(parsed.fileName);
  const mimeType = typeof parsed.mimeType === "string" ? parsed.mimeType.trim().toLowerCase() : "";
  const allowedExtensions = ALLOWED_FILE_TYPES.get(mimeType);
  const sizeBytes = parsed.sizeBytes;
  const sha256 = typeof parsed.sha256 === "string" ? parsed.sha256.toLowerCase() : "";
  const accessScope = parsed.accessScope ?? "restricted";
  if (!projectId || !fileName || !Number.isSafeInteger(sizeBytes) || Number(sizeBytes) <= 0
      || !SHA256_PATTERN.test(sha256)
      || typeof accessScope !== "string"
      || !["organization", "restricted", "private"].includes(accessScope)) {
    return { error: "invalid_request" } as const;
  }
  if (Number(sizeBytes) > MAX_PROJECT_FILE_BYTES) return { error: "file_too_large" } as const;
  if (!allowedExtensions || !allowedExtensions.has(fileName.extension)) {
    return { error: "unsupported_media_type" } as const;
  }
  return {
    projectId, fileName: fileName.fileName, mimeType, sizeBytes: Number(sizeBytes),
    sha256, accessScope: accessScope as "organization" | "restricted" | "private",
  } as const;
}

function canonicalFile(value: unknown, expected: ReservationExpectation = {}): CanonicalFile | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const id = canonicalUuid(source.id);
  const organizationId = canonicalUuid(source.organizationId);
  const projectId = canonicalUuid(source.projectId);
  const taskId = source.taskId == null ? null : canonicalUuid(source.taskId);
  const bucket = safeString(source.bucket, 80);
  const objectPath = safeString(source.objectPath, 1024);
  const originalName = safeString(source.originalName, 180);
  const mimeType = safeString(source.mimeType, 180);
  const parsedName = parseFileName(originalName);
  const sizeBytes = source.sizeBytes;
  const sha256 = typeof source.sha256 === "string" ? source.sha256.toLowerCase() : "";
  const accessScope = source.accessScope;
  const uploadedById = canonicalUuid(source.uploadedById);
  const verifiedAt = validTimestamp(source.verifiedAt);
  const createdAt = validTimestamp(source.createdAt);
  if (!id || !organizationId || !projectId
      || (expected.projectId && projectId !== expected.projectId)
      || (expected.bucket && bucket !== expected.bucket)
      || (expected.objectPath && objectPath !== expected.objectPath)
      || (expected.originalName && originalName !== expected.originalName)
      || (expected.mimeType && mimeType !== expected.mimeType)
      || (expected.sizeBytes && Number(sizeBytes) !== expected.sizeBytes)
      || (expected.sha256 && sha256 !== expected.sha256)
      || (expected.accessScope && accessScope !== expected.accessScope)
      || (source.taskId != null && !taskId) || bucket !== STORAGE_BUCKET || !objectPath || !parsedName || !mimeType
      || mimeType !== mimeType.toLowerCase() || !ALLOWED_FILE_TYPES.get(mimeType)?.has(parsedName.extension)
      || !validCanonicalObjectPath(objectPath, projectId, parsedName.extension, expected.uploadId)
      || !Number.isSafeInteger(sizeBytes) || Number(sizeBytes) <= 0
      || Number(sizeBytes) > MAX_PROJECT_FILE_BYTES || !SHA256_PATTERN.test(sha256)
      || typeof accessScope !== "string"
      || !["organization", "restricted", "private"].includes(accessScope)
      || !uploadedById || !verifiedAt || !createdAt) return null;
  return {
    id, organizationId, projectId, taskId, bucket, objectPath,
    originalName: parsedName.fileName, mimeType,
    sizeBytes: Number(sizeBytes), sha256,
    accessScope: accessScope as CanonicalFile["accessScope"], uploadedById,
    verifiedAt, createdAt,
  };
}

function parseReservation(
  value: unknown,
  expected: ReservationExpectation = {},
): CanonicalReservation | { failure: string } | { completed: CanonicalFile } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  if (source.outcome === "failure") return { failure: publicFailure(source.error) };
  if (source.outcome !== "success") return null;
  if (source.state === "completed") {
    const file = canonicalFile(source.file, expected);
    return file ? { completed: file } : null;
  }
  const uploadId = canonicalUuid(source.uploadId);
  const projectId = canonicalUuid(source.projectId);
  const bucket = safeString(source.bucket, 80);
  const objectPath = safeString(source.objectPath, 1024);
  const originalName = safeString(source.originalName, 180);
  const mimeType = safeString(source.mimeType, 180);
  const parsedName = parseFileName(originalName);
  const sizeBytes = source.sizeBytes;
  const sha256 = typeof source.sha256 === "string" ? source.sha256.toLowerCase() : "";
  const accessScope = source.accessScope;
  const expiresAt = validTimestamp(source.expiresAt);
  if (source.state !== "pending" || !uploadId || !projectId || bucket !== STORAGE_BUCKET
      || (expected.uploadId && uploadId !== expected.uploadId)
      || (expected.projectId && projectId !== expected.projectId)
      || (expected.bucket && bucket !== expected.bucket)
      || (expected.objectPath && objectPath !== expected.objectPath)
      || (expected.originalName && originalName !== expected.originalName)
      || (expected.mimeType && mimeType !== expected.mimeType)
      || (expected.sizeBytes && Number(sizeBytes) !== expected.sizeBytes)
      || (expected.sha256 && sha256 !== expected.sha256)
      || (expected.accessScope && accessScope !== expected.accessScope)
      || !objectPath || !parsedName || !mimeType || mimeType !== mimeType.toLowerCase()
      || !ALLOWED_FILE_TYPES.get(mimeType)?.has(parsedName.extension)
      || !validCanonicalObjectPath(objectPath, projectId, parsedName.extension, uploadId)
      || !Number.isSafeInteger(sizeBytes)
      || Number(sizeBytes) <= 0 || Number(sizeBytes) > MAX_PROJECT_FILE_BYTES
      || !SHA256_PATTERN.test(sha256)
      || typeof accessScope !== "string"
      || !["organization", "restricted", "private"].includes(accessScope)
      || !expiresAt) return null;
  return {
    state: "pending", uploadId, projectId, bucket, objectPath,
    originalName: parsedName.fileName, mimeType,
    sizeBytes: Number(sizeBytes), sha256,
    accessScope: accessScope as CanonicalReservation["accessScope"], expiresAt,
  };
}

function sameReservation(left: CanonicalReservation, right: CanonicalReservation) {
  return left.uploadId === right.uploadId
    && left.projectId === right.projectId
    && left.bucket === right.bucket
    && left.objectPath === right.objectPath
    && left.originalName === right.originalName
    && left.mimeType === right.mimeType
    && left.sizeBytes === right.sizeBytes
    && left.sha256 === right.sha256
    && left.accessScope === right.accessScope;
}

function parseVerificationClaim(
  value: unknown,
  expectedToken: string,
  expectedReservation: CanonicalReservation,
) {
  const parsed = parseReservation(value, {
    uploadId: expectedReservation.uploadId,
    projectId: expectedReservation.projectId,
  });
  if (!parsed || "failure" in parsed || "completed" in parsed) return parsed;
  const source = value as Record<string, unknown>;
  const verificationToken = canonicalUuid(source.verificationToken);
  const verificationLeaseExpiresAt = validTimestamp(source.verificationLeaseExpiresAt);
  if (verificationToken !== expectedToken || !verificationLeaseExpiresAt
      || !sameReservation(parsed, expectedReservation)) return null;
  return { ...parsed, verificationToken, verificationLeaseExpiresAt } satisfies CanonicalVerificationClaim;
}

function parseSigningIntent(value: unknown, expectedReservation: CanonicalReservation) {
  const parsed = parseReservation(value, {
    uploadId: expectedReservation.uploadId,
    projectId: expectedReservation.projectId,
  });
  if (!parsed || "failure" in parsed || "completed" in parsed) return parsed;
  const source = value as Record<string, unknown>;
  const uploadTokenExpiresAt = validTimestamp(source.uploadTokenExpiresAt);
  if (!uploadTokenExpiresAt || !sameReservation(parsed, expectedReservation)) return null;
  return { ...parsed, uploadTokenExpiresAt } satisfies CanonicalSigningIntent;
}

function mapRpcError(error: RpcError) {
  if (!error) return null;
  if (error.code === "42501") return json({ error: "forbidden" }, 403);
  if (error.code?.startsWith("22") || error.code === "23514") {
    return json({ error: "invalid_request" }, 400);
  }
  return json({ error: "command_failed" }, 503);
}

async function markUploadFailed(
  dependencies: FileCompleteDependencies,
  uploadId: string,
  verificationToken: string,
  failure: "missing_object" | "object_mismatch",
  requestId: string,
) {
  try {
    const result = await (dependencies.verifiedRpc ?? dependencies.rpc)("fail_current_file_upload", {
      p_upload_public_id: uploadId,
      p_verification_token: verificationToken,
      p_failure: failure,
      p_request_id: requestId,
    });
    if (result.error || !result.data || typeof result.data !== "object" || Array.isArray(result.data)) return false;
    const response = result.data as Record<string, unknown>;
    return response.outcome === "failure" && response.error === failure;
  } catch {
    return false;
  }
}

async function releaseVerification(
  dependencies: FileCompleteDependencies,
  uploadId: string,
  verificationToken: string,
) {
  try {
    await (dependencies.verifiedRpc ?? dependencies.rpc)("release_current_file_upload_verification", {
      p_upload_public_id: uploadId,
      p_verification_token: verificationToken,
    });
  } catch {
    // A durable lease fences concurrent verification and will expire automatically.
  }
}

export function createFileUploadReservationHandler(dependencies: FileUploadReservationDependencies) {
  return async function handle(request: Request) {
    const session = await dependencies.loadSession();
    if (!session) return json({ error: "unauthorized" }, 401);
    if (session.member.status !== "active") return json({ error: "forbidden" }, 403);
    const idempotencyKey = canonicalUuid(request.headers.get("Idempotency-Key"));
    if (!idempotencyKey) return json({ error: "invalid_idempotency_key" }, 400);
    const parsed = await parseBody(request);
    if (!parsed) return json({ error: "invalid_request" }, 400);
    const command = parseUploadCommand(parsed);
    if ("error" in command) {
      if (command.error === "unsupported_media_type") return json({ error: command.error }, 415);
      if (command.error === "file_too_large") return json({ error: command.error }, 413);
      return json({ error: command.error }, 400);
    }
    const requestId = dependencies.createRequestId?.() ?? randomUUID();
    try {
      const result = await dependencies.rpc("reserve_current_project_file_upload", {
        p_project_public_id: command.projectId,
        p_original_name: command.fileName,
        p_mime_type: command.mimeType,
        p_size_bytes: command.sizeBytes,
        p_expected_sha256: command.sha256,
        p_access_scope: command.accessScope,
        p_idempotency_key: idempotencyKey,
        p_request_id: requestId,
      });
      const rpcFailure = mapRpcError(result.error);
      if (rpcFailure) return rpcFailure;
      const reservation = parseReservation(result.data, {
        projectId: command.projectId,
        bucket: STORAGE_BUCKET,
        originalName: command.fileName,
        mimeType: command.mimeType,
        sizeBytes: command.sizeBytes,
        sha256: command.sha256,
        accessScope: command.accessScope,
      });
      if (!reservation) return json({ error: "command_failed" }, 503);
      if ("failure" in reservation) {
        return json({ error: reservation.failure }, failureStatus(reservation.failure));
      }
      if ("completed" in reservation) {
        return json({ state: "completed", file: reservation.completed });
      }

      const signingIntent = await (dependencies.verifiedRpc ?? dependencies.rpc)(
        "record_current_file_upload_signed",
        {
          p_upload_public_id: reservation.uploadId,
          p_request_id: requestId,
        },
      );
      const signingFailure = mapRpcError(signingIntent.error);
      if (signingFailure) return signingFailure;
      const signedReservation = parseSigningIntent(signingIntent.data, reservation);
      if (!signedReservation) return json({ error: "command_failed" }, 503);
      if ("failure" in signedReservation) {
        return json({ error: signedReservation.failure }, failureStatus(signedReservation.failure));
      }
      if ("completed" in signedReservation) {
        return json({ state: "completed", file: signedReservation.completed });
      }
      try {
        const signed = await dependencies.storage.createSignedUploadUrl(
          signedReservation.bucket,
          signedReservation.objectPath,
        );
        if (!signed.signedUrl || !signed.token) throw new Error("invalid_signed_upload");
        return json({
          state: "pending",
          uploadId: signedReservation.uploadId,
          uploadUrl: signed.signedUrl,
          uploadToken: signed.token,
          objectPath: signedReservation.objectPath,
          expiresAt: signedReservation.uploadTokenExpiresAt,
        }, 201);
      } catch {
        return json({ error: "storage_unavailable" }, 503);
      }
    } catch {
      return json({ error: "command_failed" }, 503);
    }
  };
}

async function removeUntrustedObject(storage: CompleteStorage, reservation: CanonicalReservation) {
  try {
    await storage.removeObjects(reservation.bucket, [reservation.objectPath]);
  } catch {
    // Durable cleanup retries failed object removal after the reservation expires.
  }
}

export function createFileCompleteHandler(dependencies: FileCompleteDependencies) {
  return async function handle(request: Request) {
    const session = await dependencies.loadSession();
    if (!session) return json({ error: "unauthorized" }, 401);
    if (session.member.status !== "active") return json({ error: "forbidden" }, 403);
    const parsed = await parseBody(request);
    const uploadId = canonicalUuid(parsed?.uploadId);
    if (!parsed || Object.keys(parsed).some((field) => field !== "uploadId") || !uploadId) {
      return json({ error: "invalid_request" }, 400);
    }
    const requestId = dependencies.createRequestId?.() ?? randomUUID();
    let activeVerificationToken: string | null = null;
    try {
      const inspection = await dependencies.rpc("inspect_current_file_upload", {
        p_upload_public_id: uploadId,
      });
      const rpcFailure = mapRpcError(inspection.error);
      if (rpcFailure) return rpcFailure;
      const reservation = parseReservation(inspection.data, { uploadId });
      if (!reservation) return json({ error: "command_failed" }, 503);
      if ("failure" in reservation) {
        return json({ error: reservation.failure }, failureStatus(reservation.failure));
      }
      if ("completed" in reservation) return json({ file: reservation.completed });

      const verificationToken = randomUUID();
      activeVerificationToken = verificationToken;
      const claim = await (dependencies.verifiedRpc ?? dependencies.rpc)(
        "claim_current_file_upload_verification",
        {
          p_upload_public_id: uploadId,
          p_verification_token: verificationToken,
          p_request_id: requestId,
        },
      );
      const claimFailure = mapRpcError(claim.error);
      if (claimFailure) {
        await releaseVerification(dependencies, uploadId, verificationToken);
        return claimFailure;
      }
      const claimed = parseVerificationClaim(claim.data, verificationToken, reservation);
      if (!claimed) {
        await releaseVerification(dependencies, uploadId, verificationToken);
        return json({ error: "command_failed" }, 503);
      }
      if ("failure" in claimed) {
        await releaseVerification(dependencies, uploadId, verificationToken);
        return json({ error: claimed.failure }, failureStatus(claimed.failure));
      }
      if ("completed" in claimed) {
        await releaseVerification(dependencies, uploadId, verificationToken);
        return json({ file: claimed.completed });
      }

      let info: ObjectInfo | null;
      try {
        info = await dependencies.storage.inspectObject(claimed.bucket, claimed.objectPath);
      } catch {
        await releaseVerification(dependencies, uploadId, verificationToken);
        return json({ error: "storage_unavailable" }, 503);
      }
      if (!info) {
        if (!await markUploadFailed(dependencies, uploadId, verificationToken, "missing_object", requestId)) {
          await releaseVerification(dependencies, uploadId, verificationToken);
          return json({ error: "command_failed" }, 503);
        }
        return json({ error: "missing_object" }, 422);
      }
      const verifiedMimeType = info.mimeType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
      if (info.size !== claimed.sizeBytes || verifiedMimeType !== claimed.mimeType || !canonicalUuid(info.id)) {
        await removeUntrustedObject(dependencies.storage, claimed);
        if (!await markUploadFailed(dependencies, uploadId, verificationToken, "object_mismatch", requestId)) {
          await releaseVerification(dependencies, uploadId, verificationToken);
          return json({ error: "command_failed" }, 503);
        }
        return json({ error: "object_mismatch" }, 422);
      }
      let bytes: Uint8Array | null;
      try {
        bytes = await dependencies.storage.downloadObject(claimed.bucket, claimed.objectPath);
      } catch {
        await releaseVerification(dependencies, uploadId, verificationToken);
        return json({ error: "storage_unavailable" }, 503);
      }
      if (!bytes) {
        if (!await markUploadFailed(dependencies, uploadId, verificationToken, "missing_object", requestId)) {
          await releaseVerification(dependencies, uploadId, verificationToken);
          return json({ error: "command_failed" }, 503);
        }
        return json({ error: "missing_object" }, 422);
      }
      const actualSha256 = createHash("sha256").update(bytes).digest("hex");
      if (bytes.byteLength !== claimed.sizeBytes || actualSha256 !== claimed.sha256) {
        await removeUntrustedObject(dependencies.storage, claimed);
        if (!await markUploadFailed(dependencies, uploadId, verificationToken, "object_mismatch", requestId)) {
          await releaseVerification(dependencies, uploadId, verificationToken);
          return json({ error: "command_failed" }, 503);
        }
        return json({ error: "object_mismatch" }, 422);
      }

      const completion = await (dependencies.verifiedRpc ?? dependencies.rpc)("complete_current_project_file_upload", {
        p_upload_public_id: uploadId,
        p_verification_token: verificationToken,
        p_storage_object_id: info.id,
        p_storage_version: info.version,
        p_storage_etag: info.etag,
        p_verified_size_bytes: info.size,
        p_verified_mime_type: verifiedMimeType,
        p_verified_sha256: actualSha256,
        p_request_id: requestId,
      });
      const completionFailure = mapRpcError(completion.error);
      if (completionFailure) {
        await releaseVerification(dependencies, uploadId, verificationToken);
        return completionFailure;
      }
      const result = parseReservation(completion.data, claimed);
      if (!result) {
        await releaseVerification(dependencies, uploadId, verificationToken);
        return json({ error: "command_failed" }, 503);
      }
      if ("failure" in result) {
        await releaseVerification(dependencies, uploadId, verificationToken);
        return json({ error: result.failure }, failureStatus(result.failure));
      }
      if (!("completed" in result)) {
        await releaseVerification(dependencies, uploadId, verificationToken);
        return json({ error: "command_failed" }, 503);
      }
      return json({ file: result.completed }, 201);
    } catch {
      if (activeVerificationToken) {
        await releaseVerification(dependencies, uploadId, activeVerificationToken);
      }
      return json({ error: "command_failed" }, 503);
    }
  };
}

export function createFileDownloadHandler(dependencies: FileDownloadDependencies) {
  return async function handle(
    _request: Request,
    context: { params: Promise<{ fileId: string }> },
  ) {
    const session = await dependencies.loadSession();
    if (!session) return json({ error: "unauthorized" }, 401);
    if (session.member.status !== "active") return json({ error: "forbidden" }, 403);
    const fileId = canonicalUuid((await context.params).fileId);
    if (!fileId) return json({ error: "invalid_request" }, 400);
    try {
      const result = await dependencies.rpc("authorize_current_project_file_download", {
        p_file_public_id: fileId,
        p_request_id: dependencies.createRequestId?.() ?? randomUUID(),
      });
      const rpcFailure = mapRpcError(result.error);
      if (rpcFailure) return rpcFailure;
      if (!result.data || typeof result.data !== "object" || Array.isArray(result.data)) {
        return json({ error: "command_failed" }, 503);
      }
      const source = result.data as Record<string, unknown>;
      if (source.outcome === "failure") {
        const failure = publicFailure(source.error);
        return json({ error: failure }, failureStatus(failure));
      }
      const resultFileId = canonicalUuid(source.fileId);
      const bucket = safeString(source.bucket, 80);
      const objectPath = safeString(source.objectPath, 1024);
      const originalName = safeString(source.originalName, 180);
      if (source.outcome !== "success" || resultFileId !== fileId || bucket !== STORAGE_BUCKET
          || !objectPath || !originalName) return json({ error: "command_failed" }, 503);
      const expiresIn = 60;
      const downloadUrl = await dependencies.storage.createSignedDownloadUrl(
        bucket,
        objectPath,
        expiresIn,
        originalName,
      );
      return json({ downloadUrl, fileName: originalName, expiresIn });
    } catch {
      return json({ error: "storage_unavailable" }, 503);
    }
  };
}

export async function cleanupExpiredFileUploads(
  dependencies: FileCleanupDependencies,
  limit = 100,
) {
  const workerToken = dependencies.createWorkerToken?.() ?? randomUUID();
  const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 500) : 100;
  const claim = await dependencies.serviceRpc("claim_file_upload_cleanup", {
    p_limit: safeLimit,
    p_worker_token: workerToken,
  });
  if (claim.error || !Array.isArray(claim.data)) throw new Error("file_cleanup_claim_failed");
  let removed = 0;
  let failed = 0;
  for (const raw of claim.data) {
    const source = raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : {};
    const uploadId = canonicalUuid(source.uploadId);
    const bucket = safeString(source.bucket, 80);
    const objectPath = safeString(source.objectPath, 1024);
    if (!uploadId || bucket !== STORAGE_BUCKET || !objectPath) {
      failed += 1;
      continue;
    }
    let wasRemoved = false;
    try {
      await dependencies.storage.removeObjects(bucket, [objectPath]);
      wasRemoved = true;
      removed += 1;
    } catch {
      failed += 1;
    }
    const acknowledgement = await dependencies.serviceRpc("complete_file_upload_cleanup", {
      p_upload_public_id: uploadId,
      p_worker_token: workerToken,
      p_removed: wasRemoved,
      p_error: wasRemoved ? null : "remove_failed",
    });
    if (acknowledgement.error || acknowledgement.data !== true) {
      throw new Error("file_cleanup_ack_failed");
    }
  }
  return { claimed: claim.data.length, removed, failed };
}

export function runDefaultExpiredFileUploadCleanup(limit = 20) {
  const service = getSupabaseServiceRoleClient();
  return cleanupExpiredFileUploads({
    serviceRpc: async (name, args) => {
      const result = await service.rpc(name, args);
      return { data: result.data, error: result.error };
    },
    storage: {
      async removeObjects(bucket, objectPaths) {
        const { error } = await service.storage.from(bucket).remove(objectPaths);
        if (error) throw error;
      },
    },
  }, limit);
}

function defaultRpc(client: Awaited<ReturnType<typeof getSupabaseServerClient>>) {
  return async (name: string, args: Record<string, unknown>) => {
    const result = await client.rpc(name, args);
    return { data: result.data, error: result.error };
  };
}

function defaultServiceRpc() {
  const client = getSupabaseServiceRoleClient();
  return async (name: string, args: Record<string, unknown>) => {
    const result = await client.rpc(name, args);
    return { data: result.data, error: result.error };
  };
}

function serviceStorage() {
  const service = getSupabaseServiceRoleClient();
  return {
    async createSignedUploadUrl(bucket: string, objectPath: string) {
      const { data, error } = await service.storage.from(bucket).createSignedUploadUrl(objectPath, { upsert: false });
      if (error || !data?.signedUrl || !data.token) throw error ?? new Error("signed_upload_missing");
      return { signedUrl: data.signedUrl, token: data.token };
    },
    async inspectObject(bucket: string, objectPath: string) {
      const { data, error } = await service.storage.from(bucket).info(objectPath);
      if (error) {
        const status = "status" in error ? Number(error.status) : NaN;
        if (status === 404) return null;
        throw error;
      }
      if (!data) return null;
      const size = Number(data.size ?? data.metadata?.size);
      const mimeType = data.contentType ?? data.metadata?.mimetype ?? data.metadata?.contentType;
      if (!Number.isSafeInteger(size) || size < 0 || typeof mimeType !== "string") {
        throw new Error("invalid_object_metadata");
      }
      return {
        id: data.id,
        version: data.version ?? null,
        size,
        mimeType,
        etag: data.etag ?? null,
      };
    },
    async downloadObject(bucket: string, objectPath: string) {
      const { data, error } = await service.storage.from(bucket).download(objectPath);
      if (error) {
        const status = "status" in error ? Number(error.status) : NaN;
        if (status === 404) return null;
        throw error;
      }
      if (!data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },
    async removeObjects(bucket: string, objectPaths: string[]) {
      const { error } = await service.storage.from(bucket).remove(objectPaths);
      if (error) throw error;
    },
    async createSignedDownloadUrl(bucket: string, objectPath: string, expiresIn: number, fileName: string) {
      const { data, error } = await service.storage.from(bucket).createSignedUrl(
        objectPath,
        expiresIn,
        { download: fileName },
      );
      if (error || !data?.signedUrl) throw error ?? new Error("signed_download_missing");
      return data.signedUrl;
    },
  };
}

export async function handleDefaultFileUploadReservation(request: Request) {
  try {
    const client = await getSupabaseServerClient();
    return createFileUploadReservationHandler({
      loadSession: getWorkspaceSession,
      rpc: defaultRpc(client),
      verifiedRpc: defaultServiceRpc(),
      storage: serviceStorage(),
    })(request);
  } catch {
    return json({ error: "storage_unavailable" }, 503);
  }
}

export async function handleDefaultFileComplete(request: Request) {
  try {
    const client = await getSupabaseServerClient();
    return createFileCompleteHandler({
      loadSession: getWorkspaceSession,
      rpc: defaultRpc(client),
      verifiedRpc: defaultServiceRpc(),
      storage: serviceStorage(),
    })(request);
  } catch {
    return json({ error: "storage_unavailable" }, 503);
  }
}

export async function handleDefaultFileDownload(
  request: Request,
  context: { params: Promise<{ fileId: string }> },
) {
  try {
    const client = await getSupabaseServerClient();
    return createFileDownloadHandler({
      loadSession: getWorkspaceSession,
      rpc: defaultRpc(client),
      storage: serviceStorage(),
    })(request, context);
  } catch {
    return json({ error: "storage_unavailable" }, 503);
  }
}
