import { describe, expect, it } from "vitest";

import {
  requiresBrowserMutationOrigin,
  validateMutationOrigin,
} from "@/features/security/csrf-origin";

describe("CSRF origin policy", () => {
  it("accepts safe reads and exact same-origin mutations", () => {
    expect(validateMutationOrigin(new Request("https://work.quantxy.test/api/workstation/tasks"))).toEqual({ allowed: true });
    expect(validateMutationOrigin(new Request("https://work.quantxy.test/api/workstation/tasks", {
      method: "POST",
      headers: { origin: "https://work.quantxy.test", "sec-fetch-site": "same-origin" },
    }))).toEqual({ allowed: true });
  });

  it("rejects cross-origin, null-origin and origin-less browser mutations", () => {
    for (const origin of ["https://evil.example", "null", undefined]) {
      const headers = origin ? { origin } : undefined;
      expect(validateMutationOrigin(new Request("https://work.quantxy.test/api/workstation/tasks", { method: "POST", headers }))).toMatchObject({ allowed: false });
    }
  });

  it("accepts a configured reverse-proxy public origin but not a credentialed variant", () => {
    const request = new Request("http://0.0.0.0:3000/api/workstation/tasks", {
      method: "PATCH",
      headers: { origin: "https://work.quantumgalaxy.top", "sec-fetch-site": "same-site" },
    });
    expect(validateMutationOrigin(request, { NEXT_PUBLIC_APP_URL: "https://work.quantumgalaxy.top" })).toEqual({ allowed: true });
    expect(validateMutationOrigin(request, { NEXT_PUBLIC_APP_URL: "https://user:password@work.quantumgalaxy.top" })).toMatchObject({ allowed: false });
  });

  it("keeps signed webhooks and bearer-only internal jobs outside the browser-origin gate", () => {
    expect(requiresBrowserMutationOrigin("/api/workstation/tasks/123")).toBe(true);
    expect(requiresBrowserMutationOrigin("/api/workstation/feishu/webhook")).toBe(false);
    expect(requiresBrowserMutationOrigin("/api/internal/task-notification-recovery")).toBe(false);
  });
});
