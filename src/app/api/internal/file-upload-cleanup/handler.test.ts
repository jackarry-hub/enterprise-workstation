// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createFileUploadCleanupHandler } from "@/app/api/internal/file-upload-cleanup/handler";

describe("scheduled abandoned file cleanup", () => {
  it("fails closed when the scheduler secret is missing", async () => {
    const cleanup = vi.fn();
    const response = await createFileUploadCleanupHandler({ cronSecret: null, cleanup })(
      new Request("https://workspace.test/api/internal/file-upload-cleanup", { method: "POST" }),
    );
    expect(response.status).toBe(503);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("rejects an invalid bearer secret before cleanup", async () => {
    const cleanup = vi.fn();
    const response = await createFileUploadCleanupHandler({
      cronSecret: "c".repeat(32), cleanup,
    })(new Request("https://workspace.test/api/internal/file-upload-cleanup", {
      method: "POST", headers: { authorization: "Bearer invalid" },
    }));
    expect(response.status).toBe(401);
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("returns only aggregate cleanup evidence", async () => {
    const cleanup = vi.fn().mockResolvedValue({ claimed: 3, removed: 2, failed: 1 });
    const response = await createFileUploadCleanupHandler({
      cronSecret: "c".repeat(32), cleanup,
    })(new Request("https://workspace.test/api/internal/file-upload-cleanup?tenant=forged", {
      method: "POST", headers: { authorization: `Bearer ${"c".repeat(32)}` },
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ claimed: 3, removed: 2, failed: 1 });
    expect(cleanup).toHaveBeenCalledWith();
  });
});
