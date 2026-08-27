import { createHash } from "node:crypto";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  cleanupExpiredFileUploads,
  createFileCompleteHandler,
  createFileDownloadHandler,
  createFileUploadReservationHandler,
} from "@/features/files/file-command-handler";

const projectId = "40000000-0000-4000-8000-000000000001";
const uploadId = "41000000-0000-4000-8000-000000000001";
const fileId = "42000000-0000-4000-8000-000000000001";
const idempotencyKey = "43000000-0000-4000-8000-000000000001";
const sha256 = createHash("sha256").update("verified content").digest("hex");
const objectPath = `tenants/49000000-0000-4000-8000-000000000001/organizations/47000000-0000-4000-8000-000000000001/projects/${projectId}/uploads/${uploadId}/${uploadId}.pdf`;
const activeSession = { member: { status: "active" } };
const canonicalFile = {
  id: fileId,
  organizationId: "47000000-0000-4000-8000-000000000001",
  projectId,
  taskId: null,
  bucket: "workbench-files",
  objectPath,
  originalName: "contract.pdf",
  mimeType: "application/pdf",
  sizeBytes: 16,
  sha256,
  accessScope: "restricted",
  uploadedById: "48000000-0000-4000-8000-000000000001",
  verifiedAt: "2026-08-27T02:00:00.000Z",
  createdAt: "2026-08-27T02:00:00.000Z",
};
const reservation = {
  outcome: "success",
  state: "pending",
  uploadId,
  projectId,
  bucket: "workbench-files",
  objectPath,
  originalName: "contract.pdf",
  mimeType: "application/pdf",
  sizeBytes: 16,
  sha256,
  accessScope: "restricted",
  expiresAt: "2026-08-27T02:10:00.000Z",
};

function verificationClaim(args: Record<string, unknown>) {
  return {
    ...reservation,
    verificationToken: args.p_verification_token,
    verificationLeaseExpiresAt: "2026-08-27T02:08:00.000Z",
  };
}

function uploadRequest(body: unknown = {
  projectId,
  fileName: "contract.pdf",
  mimeType: "application/pdf",
  sizeBytes: 16,
  sha256,
  accessScope: "restricted",
}) {
  return new Request("https://workspace.test/api/workstation/files/upload-url", {
    method: "POST",
    headers: { "content-type": "application/json", "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(body),
  });
}

function completeRequest(body: unknown = { uploadId }) {
  return new Request("https://workspace.test/api/workstation/files/complete", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("verified project file commands", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects unauthenticated, dangerous, oversized, and spoofed upload requests before storage", async () => {
    const rpc = vi.fn();
    const createSignedUploadUrl = vi.fn();
    const build = (session: typeof activeSession | null) => createFileUploadReservationHandler({
      loadSession: async () => session,
      rpc,
      storage: { createSignedUploadUrl },
      createRequestId: () => "44000000-0000-4000-8000-000000000001",
    });

    expect((await build(null)(uploadRequest())).status).toBe(401);
    expect((await build(activeSession)(uploadRequest({
      projectId, fileName: "payload.exe", mimeType: "application/x-msdownload",
      sizeBytes: 16, sha256, accessScope: "restricted",
    }))).status).toBe(415);
    expect((await build(activeSession)(uploadRequest({
      projectId, fileName: "large.pdf", mimeType: "application/pdf",
      sizeBytes: 30 * 1024 * 1024 + 1, sha256, accessScope: "restricted",
    }))).status).toBe(413);
    expect((await build(activeSession)(uploadRequest({
      projectId, fileName: "contract.pdf", mimeType: "application/pdf",
      sizeBytes: 16, sha256, accessScope: "restricted", objectPath: "spoofed/path",
    }))).status).toBe(400);
    expect((await build(activeSession)(uploadRequest({
      projectId, fileName: "contract.pdf", mimeType: "application/pdf",
      sizeBytes: 16, sha256, accessScope: ["restricted"],
    }))).status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("defers project ACLs to the database and maps cross-project access without signing", async () => {
    const createSignedUploadUrl = vi.fn();
    const handler = createFileUploadReservationHandler({
      loadSession: async () => activeSession,
      rpc: vi.fn().mockResolvedValue({ data: { outcome: "failure", error: "not_found" }, error: null }),
      storage: { createSignedUploadUrl },
    });

    const response = await handler(uploadRequest());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("creates a short-lived signed URL only for the canonical reservation path", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: reservation, error: null });
    const signedReservation = {
      ...reservation,
      expiresAt: "2026-08-27T04:15:00.000Z",
      uploadTokenExpiresAt: "2026-08-27T04:10:00.000Z",
    };
    const verifiedRpc = vi.fn().mockResolvedValue({ data: signedReservation, error: null });
    const createSignedUploadUrl = vi.fn().mockResolvedValue({
      signedUrl: "https://storage.test/signed-upload",
      token: "signed-upload-token",
    });
    const handler = createFileUploadReservationHandler({
      loadSession: async () => activeSession,
      rpc,
      verifiedRpc,
      storage: { createSignedUploadUrl },
      createRequestId: () => "44000000-0000-4000-8000-000000000001",
    });

    const response = await handler(uploadRequest());

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      state: "pending", uploadId, uploadUrl: "https://storage.test/signed-upload",
      uploadToken: "signed-upload-token", objectPath, expiresAt: signedReservation.uploadTokenExpiresAt,
    });
    expect(rpc).toHaveBeenCalledWith("reserve_current_project_file_upload", expect.objectContaining({
      p_project_public_id: projectId,
      p_original_name: "contract.pdf",
      p_expected_sha256: sha256,
      p_idempotency_key: idempotencyKey,
    }));
    expect(verifiedRpc).toHaveBeenCalledWith("record_current_file_upload_signed", {
      p_upload_public_id: uploadId,
      p_request_id: "44000000-0000-4000-8000-000000000001",
    });
    expect(verifiedRpc.mock.invocationCallOrder[0]).toBeLessThan(createSignedUploadUrl.mock.invocationCallOrder[0]);
    expect(createSignedUploadUrl).toHaveBeenCalledWith("workbench-files", objectPath);
  });

  it("never creates or exposes a storage token when the durable signing horizon cannot be recorded", async () => {
    const createSignedUploadUrl = vi.fn();
    const handler = createFileUploadReservationHandler({
      loadSession: async () => activeSession,
      rpc: vi.fn().mockResolvedValue({ data: reservation, error: null }),
      verifiedRpc: vi.fn().mockResolvedValue({ data: null, error: { code: "57014" } }),
      storage: { createSignedUploadUrl },
    });

    const response = await handler(uploadRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "command_failed" });
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects a reservation whose canonical payload drifts from the upload command", async () => {
    const verifiedRpc = vi.fn();
    const createSignedUploadUrl = vi.fn();
    const handler = createFileUploadReservationHandler({
      loadSession: async () => activeSession,
      rpc: vi.fn().mockResolvedValue({
        data: { ...reservation, originalName: "different.pdf" }, error: null,
      }),
      verifiedRpc,
      storage: { createSignedUploadUrl },
    });

    const response = await handler(uploadRequest());

    expect(response.status).toBe(503);
    expect(verifiedRpc).not.toHaveBeenCalled();
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("rejects a canonical-looking reservation path bound to a different upload id", async () => {
    const otherUploadId = "41000000-0000-4000-8000-000000000099";
    const verifiedRpc = vi.fn();
    const createSignedUploadUrl = vi.fn();
    const handler = createFileUploadReservationHandler({
      loadSession: async () => activeSession,
      rpc: vi.fn().mockResolvedValue({
        data: {
          ...reservation,
          objectPath: `tenants/49000000-0000-4000-8000-000000000001/organizations/47000000-0000-4000-8000-000000000001/projects/${projectId}/uploads/${otherUploadId}/${otherUploadId}.pdf`,
        },
        error: null,
      }),
      verifiedRpc,
      storage: { createSignedUploadUrl },
    });

    const response = await handler(uploadRequest());

    expect(response.status).toBe(503);
    expect(verifiedRpc).not.toHaveBeenCalled();
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("fails closed when the signing ledger changes the canonical storage path", async () => {
    const createSignedUploadUrl = vi.fn();
    const handler = createFileUploadReservationHandler({
      loadSession: async () => activeSession,
      rpc: vi.fn().mockResolvedValue({ data: reservation, error: null }),
      verifiedRpc: vi.fn().mockResolvedValue({
        data: {
          ...reservation,
          objectPath: `${objectPath}.swapped`,
          uploadTokenExpiresAt: "2026-08-27T04:10:00.000Z",
        },
        error: null,
      }),
      storage: { createSignedUploadUrl },
    });

    const response = await handler(uploadRequest());

    expect(response.status).toBe(503);
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("keeps the reservation pending when the storage provider cannot issue a token", async () => {
    const verifiedRpc = vi.fn().mockResolvedValue({
      data: { ...reservation, uploadTokenExpiresAt: "2026-08-27T04:10:00.000Z" },
      error: null,
    });
    const handler = createFileUploadReservationHandler({
      loadSession: async () => activeSession,
      rpc: vi.fn().mockResolvedValue({ data: reservation, error: null }),
      verifiedRpc,
      storage: { createSignedUploadUrl: vi.fn().mockRejectedValue(new Error("provider outage")) },
    });

    const response = await handler(uploadRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "storage_unavailable" });
    expect(verifiedRpc).toHaveBeenCalledTimes(1);
    expect(verifiedRpc).not.toHaveBeenCalledWith("fail_current_file_upload", expect.anything());
  });

  it("marks an object-missing reservation as failed without writing file metadata", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: reservation, error: null });
    const verifiedRpc = vi.fn(async (name: string, args: Record<string, unknown>) => name === "claim_current_file_upload_verification"
      ? { data: verificationClaim(args), error: null }
      : { data: { outcome: "failure", error: "missing_object" }, error: null });
    const complete = vi.fn();
    const handler = createFileCompleteHandler({
      loadSession: async () => activeSession,
      rpc,
      verifiedRpc: async (name, args) => name === "complete_current_project_file_upload"
        ? complete(name, args) : verifiedRpc(name, args),
      storage: {
        inspectObject: vi.fn().mockResolvedValue(null),
        downloadObject: vi.fn(),
        removeObjects: vi.fn().mockResolvedValue(undefined),
      },
    });

    const response = await handler(completeRequest());

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "missing_object" });
    expect(complete).not.toHaveBeenCalled();
    expect(verifiedRpc).toHaveBeenLastCalledWith("fail_current_file_upload", expect.objectContaining({
      p_upload_public_id: uploadId, p_failure: "missing_object",
      p_verification_token: expect.any(String),
    }));
  });

  it("downloads and hashes the stored bytes before atomically completing metadata and relation writes", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: reservation, error: null });
    const verifiedRpc = vi.fn(async (name: string, args: Record<string, unknown>) => name === "claim_current_file_upload_verification"
      ? { data: verificationClaim(args), error: null }
      : { data: { outcome: "success", state: "completed", file: canonicalFile }, error: null });
    const handler = createFileCompleteHandler({
      loadSession: async () => activeSession,
      rpc,
      verifiedRpc,
      storage: {
        inspectObject: vi.fn().mockResolvedValue({
          id: "45000000-0000-4000-8000-000000000001",
          version: "version-1", size: 16, mimeType: "application/pdf", etag: "etag-1",
        }),
        downloadObject: vi.fn().mockResolvedValue(new TextEncoder().encode("verified content")),
        removeObjects: vi.fn(),
      },
      createRequestId: () => "44000000-0000-4000-8000-000000000001",
    });

    const response = await handler(completeRequest());

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ file: canonicalFile });
    expect(verifiedRpc).toHaveBeenLastCalledWith("complete_current_project_file_upload", expect.objectContaining({
      p_upload_public_id: uploadId,
      p_verification_token: expect.any(String),
      p_verified_sha256: sha256,
      p_storage_object_id: "45000000-0000-4000-8000-000000000001",
      p_verified_size_bytes: 16,
      p_verified_mime_type: "application/pdf",
    }));
  });

  it("rejects hash mismatch, removes the untrusted object, and records a terminal failure", async () => {
    const removeObjects = vi.fn().mockResolvedValue(undefined);
    const downloadObject = vi.fn().mockResolvedValue(new TextEncoder().encode("wrong bytes"));
    const rpc = vi.fn().mockResolvedValue({ data: reservation, error: null });
    const verifiedRpc = vi.fn(async (name: string, args: Record<string, unknown>) => name === "claim_current_file_upload_verification"
      ? { data: verificationClaim(args), error: null }
      : { data: { outcome: "failure", error: "object_mismatch" }, error: null });
    const handler = createFileCompleteHandler({
      loadSession: async () => activeSession,
      rpc,
      verifiedRpc,
      storage: {
        inspectObject: vi.fn().mockResolvedValue({
          id: "45000000-0000-4000-8000-000000000001",
          version: "version-1", size: 12, mimeType: "application/pdf", etag: "etag-1",
        }),
        downloadObject,
        removeObjects,
      },
    });

    const response = await handler(completeRequest());

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "object_mismatch" });
    expect(removeObjects).toHaveBeenCalledWith("workbench-files", [objectPath]);
    expect(downloadObject).not.toHaveBeenCalled();
    expect(verifiedRpc).toHaveBeenLastCalledWith("fail_current_file_upload", expect.objectContaining({
      p_failure: "object_mismatch",
    }));
  });

  it("authorizes each download before signing and never accepts a client path", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: {
      outcome: "success", fileId, bucket: "workbench-files", objectPath,
      originalName: "contract.pdf",
    }, error: null });
    const createSignedDownloadUrl = vi.fn().mockResolvedValue("https://storage.test/download");
    const handler = createFileDownloadHandler({
      loadSession: async () => activeSession,
      rpc,
      storage: { createSignedDownloadUrl },
      createRequestId: () => "44000000-0000-4000-8000-000000000001",
    });
    const request = new Request(`https://workspace.test/api/workstation/files/${fileId}/download-url`, { method: "POST" });

    const response = await handler(request, { params: Promise.resolve({ fileId }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      downloadUrl: "https://storage.test/download", fileName: "contract.pdf", expiresIn: 60,
    });
    expect(createSignedDownloadUrl).toHaveBeenCalledWith("workbench-files", objectPath, 60, "contract.pdf");
  });

  it("keeps a reservation retryable when storage inspection is temporarily unavailable", async () => {
    const verifiedRpc = vi.fn(async (name: string, args: Record<string, unknown>) => name === "claim_current_file_upload_verification"
      ? { data: verificationClaim(args), error: null }
      : { data: true, error: null });
    const handler = createFileCompleteHandler({
      loadSession: async () => activeSession,
      rpc: vi.fn().mockResolvedValue({ data: reservation, error: null }),
      verifiedRpc,
      storage: {
        inspectObject: vi.fn().mockRejectedValue(new Error("temporary provider outage")),
        downloadObject: vi.fn(),
        removeObjects: vi.fn(),
      },
    });

    const response = await handler(completeRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "storage_unavailable" });
    expect(verifiedRpc).not.toHaveBeenCalledWith("fail_current_file_upload", expect.anything());
    expect(verifiedRpc).toHaveBeenCalledWith("release_current_file_upload_verification", expect.objectContaining({
      p_upload_public_id: uploadId,
    }));
  });

  it("fences concurrent verification before any storage egress", async () => {
    const inspectObject = vi.fn();
    const downloadObject = vi.fn();
    const handler = createFileCompleteHandler({
      loadSession: async () => activeSession,
      rpc: vi.fn().mockResolvedValue({ data: reservation, error: null }),
      verifiedRpc: vi.fn().mockResolvedValue({
        data: { outcome: "failure", error: "verification_in_progress" }, error: null,
      }),
      storage: { inspectObject, downloadObject, removeObjects: vi.fn() },
    });

    const response = await handler(completeRequest());

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "verification_in_progress" });
    expect(inspectObject).not.toHaveBeenCalled();
    expect(downloadObject).not.toHaveBeenCalled();
  });

  it("never reads storage when a verification claim does not match the inspected reservation", async () => {
    const inspectObject = vi.fn();
    const verifiedRpc = vi.fn(async (name: string, args: Record<string, unknown>) => name === "claim_current_file_upload_verification"
      ? { data: { ...verificationClaim(args), objectPath: `${objectPath}.swapped` }, error: null }
      : { data: true, error: null });
    const handler = createFileCompleteHandler({
      loadSession: async () => activeSession,
      rpc: vi.fn().mockResolvedValue({ data: reservation, error: null }),
      verifiedRpc,
      storage: { inspectObject, downloadObject: vi.fn(), removeObjects: vi.fn() },
    });

    const response = await handler(completeRequest());

    expect(response.status).toBe(503);
    expect(inspectObject).not.toHaveBeenCalled();
    expect(verifiedRpc).toHaveBeenCalledWith("release_current_file_upload_verification", expect.anything());
  });

  it("releases its token when a committed verification claim response is lost", async () => {
    const verifiedRpc = vi.fn()
      .mockRejectedValueOnce(new Error("response lost after commit"))
      .mockResolvedValueOnce({ data: true, error: null });
    const handler = createFileCompleteHandler({
      loadSession: async () => activeSession,
      rpc: vi.fn().mockResolvedValue({ data: reservation, error: null }),
      verifiedRpc,
      storage: { inspectObject: vi.fn(), downloadObject: vi.fn(), removeObjects: vi.fn() },
    });

    const response = await handler(completeRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "command_failed" });
    expect(verifiedRpc).toHaveBeenNthCalledWith(2, "release_current_file_upload_verification", {
      p_upload_public_id: uploadId,
      p_verification_token: expect.any(String),
    });
  });

  it("releases the verification lease after an ambiguous completion failure", async () => {
    const verifiedRpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_current_file_upload_verification") {
        return { data: verificationClaim(args), error: null };
      }
      if (name === "complete_current_project_file_upload") {
        return { data: null, error: { code: "57014" } };
      }
      return { data: true, error: null };
    });
    const handler = createFileCompleteHandler({
      loadSession: async () => activeSession,
      rpc: vi.fn().mockResolvedValue({ data: reservation, error: null }),
      verifiedRpc,
      storage: {
        inspectObject: vi.fn().mockResolvedValue({
          id: "45000000-0000-4000-8000-000000000001",
          version: "version-1", size: 16, mimeType: "application/pdf", etag: "etag-1",
        }),
        downloadObject: vi.fn().mockResolvedValue(new TextEncoder().encode("verified content")),
        removeObjects: vi.fn(),
      },
    });

    const response = await handler(completeRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "command_failed" });
    expect(verifiedRpc).toHaveBeenCalledWith("release_current_file_upload_verification", expect.objectContaining({
      p_upload_public_id: uploadId,
      p_verification_token: expect.any(String),
    }));
  });

  it("rejects a completed DTO whose object path drifts from the verified claim", async () => {
    const verifiedRpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      if (name === "claim_current_file_upload_verification") {
        return { data: verificationClaim(args), error: null };
      }
      if (name === "complete_current_project_file_upload") {
        return { data: {
          outcome: "success", state: "completed",
          file: { ...canonicalFile, objectPath: `${objectPath}.swapped` },
        }, error: null };
      }
      return { data: true, error: null };
    });
    const handler = createFileCompleteHandler({
      loadSession: async () => activeSession,
      rpc: vi.fn().mockResolvedValue({ data: reservation, error: null }),
      verifiedRpc,
      storage: {
        inspectObject: vi.fn().mockResolvedValue({
          id: "45000000-0000-4000-8000-000000000001",
          version: "version-1", size: 16, mimeType: "application/pdf", etag: "etag-1",
        }),
        downloadObject: vi.fn().mockResolvedValue(new TextEncoder().encode("verified content")),
        removeObjects: vi.fn(),
      },
    });

    const response = await handler(completeRequest());

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "command_failed" });
    expect(verifiedRpc).toHaveBeenCalledWith("release_current_file_upload_verification", expect.anything());
  });
});

describe("expired upload cleanup", () => {
  it("claims with the service role, removes exact paths, and acknowledges every result", async () => {
    const serviceRpc = vi.fn()
      .mockResolvedValueOnce({ data: [
        { uploadId, bucket: "workbench-files", objectPath },
        { uploadId: "41000000-0000-4000-8000-000000000002", bucket: "workbench-files", objectPath: `${objectPath}-2` },
      ], error: null })
      .mockResolvedValue({ data: true, error: null });
    const removeObjects = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("provider detail must stay private"));

    const result = await cleanupExpiredFileUploads({
      serviceRpc,
      storage: { removeObjects },
      createWorkerToken: () => "46000000-0000-4000-8000-000000000001",
    }, 20);

    expect(result).toEqual({ claimed: 2, removed: 1, failed: 1 });
    expect(serviceRpc).toHaveBeenNthCalledWith(1, "claim_file_upload_cleanup", {
      p_limit: 20, p_worker_token: "46000000-0000-4000-8000-000000000001",
    });
    expect(serviceRpc).toHaveBeenCalledWith("complete_file_upload_cleanup", expect.objectContaining({
      p_upload_public_id: uploadId, p_removed: true, p_error: null,
    }));
    expect(serviceRpc).toHaveBeenCalledWith("complete_file_upload_cleanup", expect.objectContaining({
      p_removed: false, p_error: "remove_failed",
    }));
  });
});
