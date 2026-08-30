import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { validateKnowledgeFileAdmission } from "@/features/files/file-command-handler";
import { runKnowledgeProcessingJob } from "@/features/knowledge/document-processing-handler";

const job = {
  acquired: true,
  jobId: "10000000-0000-4000-8000-000000000001",
  leaseToken: "20000000-0000-4000-8000-000000000001",
  jobType: "parse",
  attempt: 1,
  documentId: "30000000-0000-4000-8000-000000000001",
  versionId: "40000000-0000-4000-8000-000000000001",
  sourceId: "50000000-0000-4000-8000-000000000001",
  file: {
    id: "60000000-0000-4000-8000-000000000001",
    bucket: "workbench-files",
    objectPath: "tenants/70000000-0000-4000-8000-000000000001/organizations/80000000-0000-4000-8000-000000000001/projects/90000000-0000-4000-8000-000000000001/uploads/a0000000-0000-4000-8000-000000000001/source.pdf",
    mimeType: "application/pdf",
    sizeBytes: 1024,
    sha256: "a".repeat(64),
  },
};

describe("governed knowledge processing", () => {
  it("persists quarantine, SKIP LOCKED jobs, vectors and archive cleanup", () => {
    const sql = fs.readFileSync(path.join(process.cwd(), "supabase/migrations/202608300004_knowledge_processing_lifecycle.sql"), "utf8").toLowerCase();
    expect(sql).toContain("security_state in ('quarantined','scanning','ready','rejected')");
    expect(sql).toContain("for update skip locked");
    expect(sql).toContain("embedding extensions.vector(1536)");
    expect(sql).toContain("cleanup_archived_knowledge_chunks");
    expect(sql).toContain("knowledge_source_scan_enqueue");
  });

  it("accepts only exact tenant paths, supported types, bounded bytes and sha256", () => {
    expect(validateKnowledgeFileAdmission(job.file)).toBe(true);
    expect(validateKnowledgeFileAdmission({ ...job.file, objectPath: "../private/source.pdf" })).toBe(false);
    expect(validateKnowledgeFileAdmission({ ...job.file, mimeType: "application/x-msdownload" })).toBe(false);
  });

  it("completes a claimed parse job with durable chunks", async () => {
    const serviceRpc = vi.fn()
      .mockResolvedValueOnce({ data: job, error: null })
      .mockResolvedValueOnce({ data: { completed: true }, error: null });
    const process = vi.fn().mockResolvedValue({ text: "验收流程", chunks: [{ ordinal: 0, content: "验收流程", tokenCount: 4 }] });
    await expect(runKnowledgeProcessingJob({ serviceRpc, process })).resolves.toMatchObject({ status: "completed", jobId: job.jobId });
    expect(serviceRpc).toHaveBeenLastCalledWith("complete_knowledge_processing_job", expect.objectContaining({ p_success: true }));
  });

  it("rejects a malformed object path before invoking the processor", async () => {
    const serviceRpc = vi.fn()
      .mockResolvedValueOnce({ data: { ...job, file: { ...job.file, objectPath: "tenants/../secret" } }, error: null })
      .mockResolvedValueOnce({ data: { completed: false }, error: null });
    const process = vi.fn();
    await expect(runKnowledgeProcessingJob({ serviceRpc, process })).resolves.toMatchObject({ status: "rejected" });
    expect(process).not.toHaveBeenCalled();
    expect(serviceRpc).toHaveBeenLastCalledWith("complete_knowledge_processing_job", expect.objectContaining({ p_error_code: "file_admission_rejected" }));
  });
});
