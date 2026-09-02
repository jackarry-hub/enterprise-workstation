import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getLocalPreviewAccessPendingRedirect,
  isLocalPreviewWorkstationPath,
  isStandaloneAuthorizedPath,
} from "@/middleware";

describe("standalone workstation middleware boundary", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("protects the fused workstation with Feishu while self-authorizing APIs stay reachable", () => {
    expect(isStandaloneAuthorizedPath("/quantxy-ai-workbench-fused.html")).toBe(false);
    expect(isStandaloneAuthorizedPath("/api/demo-auth/login")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/demo-auth/session")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/demo-auth/logout")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/ai/config")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/ai/chat")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/internal/file-upload-cleanup")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/internal/task-notification-recovery")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/internal/knowledge-processing")).toBe(true);
    expect(isStandaloneAuthorizedPath("/workstation-server-adapter.js")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/bootstrap")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/directory-sync")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/approvals")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/approvals/approval-1/actions")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/expenses")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/expenses/expense-1/submit")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/expenses/expense-1/payment")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/projects")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/projects/project-1")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/notifications/notification-1/read")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/notifications/notification-1/retry")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/files/upload-url")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/files/file-1/download-url")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/knowledge/search")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/knowledge/documents/document-1/publish")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/ai/conversations")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/ai/conversations/conversation-1/messages")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/agents")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/agents/agent-1/runs")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/agent-orchestrations/orchestration-1/runs")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/agent-workflows")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/agent-workflows/family-portrait/runs")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/scheduling/goals")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/scheduling/goals/goal-1/plans")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/scheduling/plans/plan-1/overrides")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/scheduling/plans/plan-1/dispatch")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/tasks")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/tasks/task-1")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/payroll")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/payroll/policy")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/payroll/preview")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/work-profile")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/auth/logout")).toBe(true);
    expect(isStandaloneAuthorizedPath("/api/workstation/admin")).toBe(false);
    expect(isStandaloneAuthorizedPath("/dashboard")).toBe(false);
    expect(isStandaloneAuthorizedPath("/login")).toBe(false);
  });

  it("lets only an explicitly enabled development local preview use preview auth", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WORKSTATION_DEMO_ENABLED", "true");
    expect(
      isLocalPreviewWorkstationPath(
        new URL("http://localhost:3030/quantxy-ai-workbench-fused.html?v=salary-grade"),
      ),
    ).toBe(true);
    expect(
      isLocalPreviewWorkstationPath(
        new URL("https://work.quantumgalaxy.top/quantxy-ai-workbench-fused.html?v=salary-grade"),
      ),
    ).toBe(false);
    expect(
      isLocalPreviewWorkstationPath(
        new URL("http://localhost:3030/quantxy-ai-workbench-fused.html?formal=1"),
      ),
    ).toBe(false);
  });

  it("rejects localhost preview when the server preview gate is disabled or production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WORKSTATION_DEMO_ENABLED", "false");
    expect(
      isLocalPreviewWorkstationPath(
        new URL("http://localhost:3030/quantxy-ai-workbench-fused.html?v=salary-grade"),
      ),
    ).toBe(false);

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("WORKSTATION_DEMO_ENABLED", "true");
    vi.stubEnv("NEXT_PUBLIC_WORKSTATION_ALLOW_MOCK_DATA", "true");
    expect(
      isLocalPreviewWorkstationPath(
        new URL("http://localhost:3030/quantxy-ai-workbench-fused.html?v=salary-grade"),
      ),
    ).toBe(false);
  });

  it("rescues local preview tabs stuck on auth_error access pending", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("WORKSTATION_DEMO_ENABLED", "true");

    expect(
      getLocalPreviewAccessPendingRedirect(
        new URL("http://localhost:3030/access-pending?reason=auth_error"),
      )?.pathname,
    ).toBe("/quantxy-ai-workbench-fused.html");
    expect(
      getLocalPreviewAccessPendingRedirect(
        new URL("http://127.0.0.1:3030/access-pending?reason=auth_error"),
      )?.searchParams.get("v"),
    ).toBe("local-preview");
    expect(
      getLocalPreviewAccessPendingRedirect(
        new URL("https://work.quantumgalaxy.top/access-pending?reason=auth_error"),
      ),
    ).toBeNull();
    expect(
      getLocalPreviewAccessPendingRedirect(
        new URL("http://localhost:3030/access-pending?reason=not_provisioned"),
      ),
    ).toBeNull();
  });
});
