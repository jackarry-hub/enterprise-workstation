import { afterEach, describe, expect, it, vi } from "vitest";

import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import {
  deleteProjectFileBlob,
  readProjectFileBlob,
  storeProjectFileBlob,
  storeOperationFile,
} from "@/features/operations/file-storage";
import {
  downloadVerifiedProjectFile,
  uploadVerifiedProjectFile,
} from "@/features/files/verified-project-file-client";
import { createOperationFixtureContext } from "@/features/operations/operation-actor-compat";
import { executiveWorkspaceSession } from "@/test/workspace-session-test-utils";

afterEach(() => vi.unstubAllEnvs());

const formalProjectId = "40000000-0000-4000-8000-000000000001";
const formalUploadId = "41000000-0000-4000-8000-000000000001";
const formalObjectPath = `tenants/49000000-0000-4000-8000-000000000001/organizations/47000000-0000-4000-8000-000000000001/projects/${formalProjectId}/uploads/${formalUploadId}/${formalUploadId}.pdf`;

function unboundContext(overrides: Partial<WorkspaceSession> = {}) {
  const authUserId = overrides.authUserId ?? "10000000-0000-4000-8000-000000000099";
  const member = overrides.member ?? { ...executiveWorkspaceSession.member, id: 99 };
  return createOperationFixtureContext({
    ...executiveWorkspaceSession,
    ...overrides,
    authUserId,
    member,
    actor: {
      ...executiveWorkspaceSession.actor,
      id: authUserId,
      memberId: String(member.id),
      ...overrides.actor,
    },
  });
}

describe("file blob identity isolation", () => {
  it("keeps a bound file inside its workspace identity namespace", async () => {
    const context = createOperationFixtureContext(executiveWorkspaceSession);
    const file = new File(["private-data"], "private.txt", { type: "text/plain" });

    await storeProjectFileBlob(context, "shared-file-id", file);

    expect(await readProjectFileBlob(context, "shared-file-id")).toBe(file);
    await deleteProjectFileBlob(context, "shared-file-id");
    expect(await readProjectFileBlob(context, "shared-file-id")).toBeUndefined();
  });

  it.each([
    ["same role, different user", unboundContext()],
    ["same role, different tenant", unboundContext({ tenantId: "10000000-0000-4000-8000-000000000098" })],
  ])("rejects blob read, write, and delete for an unbound %s", async (_label, context) => {
    const file = new File(["private-data"], "private.txt", { type: "text/plain" });

    await expect(storeProjectFileBlob(context, "shared-file-id", file)).rejects.toThrow(
      "当前真实身份未绑定本地文件夹具",
    );
    await expect(readProjectFileBlob(context, "shared-file-id")).rejects.toThrow(
      "当前真实身份未绑定本地文件夹具",
    );
    await expect(deleteProjectFileBlob(context, "shared-file-id")).rejects.toThrow(
      "当前真实身份未绑定本地文件夹具",
    );
  });
});

describe("formal project file transport", () => {
  it("normalizes the browser Markdown MIME alias to the admitted text MIME type", async () => {
    const file = new File(["# Runbook"], "runbook.md", { type: "text/markdown" });
    const digest = "a".repeat(64);
    const objectPath = `tenants/49000000-0000-4000-8000-000000000001/organizations/47000000-0000-4000-8000-000000000001/projects/${formalProjectId}/uploads/${formalUploadId}/${formalUploadId}.md`;
    const uploadSignedObject = vi.fn().mockResolvedValue(undefined);
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({
        state: "pending",
        uploadId: formalUploadId,
        uploadUrl: "https://storage.test/signed",
        uploadToken: "token",
        objectPath,
        expiresAt: "2099-08-27T02:10:00.000Z",
      }, { status: 201 }))
      .mockResolvedValueOnce(Response.json({ file: {
        id: "42000000-0000-4000-8000-000000000001",
        organizationId: "47000000-0000-4000-8000-000000000001",
        projectId: formalProjectId,
        taskId: null,
        bucket: "workbench-files",
        objectPath,
        originalName: "runbook.md",
        mimeType: "text/plain",
        sizeBytes: file.size,
        sha256: digest,
        accessScope: "restricted",
        uploadedById: "48000000-0000-4000-8000-000000000001",
        verifiedAt: "2026-08-27T02:00:00.000Z",
        createdAt: "2026-08-27T02:00:00.000Z",
      } }, { status: 201 }));

    await uploadVerifiedProjectFile({
      projectId: formalProjectId,
      file,
      idempotencyKey: "43000000-0000-4000-8000-000000000001",
      fetcher,
      digestFile: async () => digest,
      uploadSignedObject,
    });

    const request = fetcher.mock.calls[0]?.[1] as RequestInit;
    expect(JSON.parse(String(request.body))).toMatchObject({
      fileName: "runbook.md",
      mimeType: "text/plain",
    });
    expect((uploadSignedObject.mock.calls[0]?.[0] as { file: File }).file.type).toBe("text/plain");
  });

  it("uses reservation, signed upload, and verified completion without local fallback", async () => {
    const digest = "152ba48a5b9e6b520145a5c283027319cba9ebfbc46f6d6603280e4af57f6502";
    const file = new File(["commercial file"], "plan.pdf", { type: "application/pdf" });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        state: "pending",
        uploadId: formalUploadId,
        uploadUrl: "https://storage.test/signed",
        uploadToken: "token",
        objectPath: formalObjectPath,
        expiresAt: "2099-08-27T02:10:00.000Z",
      }), { status: 201, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ file: {
        id: "42000000-0000-4000-8000-000000000001",
        organizationId: "47000000-0000-4000-8000-000000000001",
        projectId: formalProjectId,
        taskId: null,
        bucket: "workbench-files",
        objectPath: formalObjectPath,
        originalName: "plan.pdf",
        mimeType: "application/pdf",
        sizeBytes: file.size,
        sha256: digest,
        accessScope: "restricted",
        uploadedById: "48000000-0000-4000-8000-000000000001",
        verifiedAt: "2026-08-27T02:00:00.000Z",
        createdAt: "2026-08-27T02:00:00.000Z",
      } }), { status: 201, headers: { "content-type": "application/json" } }));

    const result = await uploadVerifiedProjectFile({
      projectId: formalProjectId,
      file,
      idempotencyKey: "43000000-0000-4000-8000-000000000001",
      fetcher,
      digestFile: async () => digest,
      uploadSignedObject: vi.fn().mockResolvedValue(undefined),
    });

    expect(result.id).toBe("42000000-0000-4000-8000-000000000001");
    expect(fetcher).toHaveBeenNthCalledWith(1, "/api/workstation/files/upload-url", expect.objectContaining({ method: "POST" }));
    expect(fetcher).toHaveBeenNthCalledWith(2, "/api/workstation/files/complete", expect.objectContaining({ method: "POST" }));
  });

  it("rejects a replay DTO that belongs to another project", async () => {
    const otherProjectId = "40000000-0000-4000-8000-000000000002";
    const file = new File(["commercial file"], "plan.pdf", { type: "application/pdf" });
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      state: "completed",
      file: {
        id: "42000000-0000-4000-8000-000000000001",
        organizationId: "47000000-0000-4000-8000-000000000001",
        projectId: otherProjectId,
        taskId: null,
        bucket: "workbench-files",
        objectPath: `tenants/49000000-0000-4000-8000-000000000001/organizations/47000000-0000-4000-8000-000000000001/projects/${otherProjectId}/uploads/${formalUploadId}/${formalUploadId}.pdf`,
        originalName: "plan.pdf",
        mimeType: "application/pdf",
        sizeBytes: file.size,
        sha256: "a".repeat(64),
        accessScope: "restricted",
        uploadedById: "48000000-0000-4000-8000-000000000001",
        verifiedAt: "2026-08-27T02:00:00.000Z",
        createdAt: "2026-08-27T02:00:00.000Z",
      },
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(uploadVerifiedProjectFile({
      projectId: formalProjectId,
      file,
      idempotencyKey: "43000000-0000-4000-8000-000000000001",
      fetcher,
      digestFile: async () => "a".repeat(64),
    })).rejects.toMatchObject({ code: "invalid_server_response" });
  });

  it("rejects a pending upload credential whose path belongs to another upload id", async () => {
    const otherUploadId = "41000000-0000-4000-8000-000000000099";
    const otherObjectPath = `tenants/49000000-0000-4000-8000-000000000001/organizations/47000000-0000-4000-8000-000000000001/projects/${formalProjectId}/uploads/${otherUploadId}/${otherUploadId}.pdf`;
    const file = new File(["commercial file"], "plan.pdf", { type: "application/pdf" });
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      state: "pending",
      uploadId: formalUploadId,
      uploadToken: "token",
      objectPath: otherObjectPath,
      expiresAt: "2099-08-27T02:10:00.000Z",
    }), { status: 201, headers: { "content-type": "application/json" } }));
    const uploadSignedObject = vi.fn();

    await expect(uploadVerifiedProjectFile({
      projectId: formalProjectId,
      file,
      idempotencyKey: "43000000-0000-4000-8000-000000000001",
      fetcher,
      digestFile: async () => "a".repeat(64),
      uploadSignedObject,
    })).rejects.toMatchObject({ code: "invalid_server_response" });

    expect(uploadSignedObject).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("keeps the same reservation key available after an ambiguous response", async () => {
    const file = new File(["commercial file"], "plan.pdf", { type: "application/pdf" });
    const fetcher = vi.fn().mockRejectedValue(new TypeError("network lost"));
    await expect(uploadVerifiedProjectFile({
      projectId: "40000000-0000-4000-8000-000000000001",
      file,
      idempotencyKey: "43000000-0000-4000-8000-000000000001",
      fetcher,
      digestFile: async () => "152ba48a5b9e6b520145a5c283027319cba9ebfbc46f6d6603280e4af57f6502",
    })).rejects.toMatchObject({ code: "upload_unconfirmed", retryable: true });
  });

  it("treats a server-side completion outage as retryable and supports extension-derived MIME", async () => {
    const file = new File(["commercial file"], "plan.pdf");
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        state: "pending", uploadId: formalUploadId,
        uploadUrl: "https://storage.test/signed", uploadToken: "token",
        objectPath: formalObjectPath, expiresAt: "2099-08-27T02:10:00.000Z",
      }), { status: 201, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "command_failed" }), {
        status: 503, headers: { "content-type": "application/json" },
      }));

    await expect(uploadVerifiedProjectFile({
      projectId: formalProjectId,
      file,
      idempotencyKey: "43000000-0000-4000-8000-000000000001",
      fetcher,
      digestFile: async () => "a".repeat(64),
      uploadSignedObject: vi.fn().mockResolvedValue(undefined),
    })).rejects.toMatchObject({ code: "command_failed", retryable: true });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toMatchObject({
      mimeType: "application/pdf",
    });
  });

  it("keeps the original upload key when another server instance is already verifying", async () => {
    const file = new File(["commercial file"], "plan.pdf", { type: "application/pdf" });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        state: "pending", uploadId: formalUploadId,
        uploadUrl: "https://storage.test/signed", uploadToken: "token",
        objectPath: formalObjectPath, expiresAt: "2099-08-27T02:10:00.000Z",
      }), { status: 201, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "verification_in_progress" }), {
        status: 409, headers: { "content-type": "application/json" },
      }));

    await expect(uploadVerifiedProjectFile({
      projectId: formalProjectId,
      file,
      idempotencyKey: "43000000-0000-4000-8000-000000000001",
      fetcher,
      digestFile: async () => "a".repeat(64),
      uploadSignedObject: vi.fn().mockResolvedValue(undefined),
    })).rejects.toMatchObject({ code: "verification_in_progress", retryable: true });
  });

  it("authorizes formal downloads through the server route", async () => {
    const triggerDownload = vi.fn();
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      downloadUrl: "https://storage.test/download", fileName: "plan.pdf", expiresIn: 60,
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await downloadVerifiedProjectFile("42000000-0000-4000-8000-000000000001", { fetcher, triggerDownload });

    expect(fetcher).toHaveBeenCalledWith(
      "/api/workstation/files/42000000-0000-4000-8000-000000000001/download-url",
      expect.objectContaining({ method: "POST" }),
    );
    expect(triggerDownload).toHaveBeenCalledWith("https://storage.test/download", "plan.pdf");
  });

  it("fails closed instead of silently persisting operation fixtures in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const context = createOperationFixtureContext(executiveWorkspaceSession);
    const file = new File(["sensitive"], "evidence.pdf", { type: "application/pdf" });

    await expect(storeOperationFile({
      context,
      file,
      commandId: "fixture-command",
      entityType: "knowledge",
      entityId: "fixture-knowledge",
      uploadedById: context.actor!.id,
      version: 1,
    })).rejects.toMatchObject({ code: "business_file_api_unavailable" });
    expect(await readProjectFileBlob(context, "fixture-knowledge")).toBeUndefined();
  });
});
