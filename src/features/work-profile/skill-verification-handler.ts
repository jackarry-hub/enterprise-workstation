import { randomUUID } from "node:crypto";

import { getWorkspaceSession } from "@/features/auth/workspace-session";
import { getSupabaseServerClient } from "@/lib/supabase/server";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type SkillVerificationSession = {
  member: { id: number; status: "active" };
  permissionCodes: readonly string[];
};

type SkillVerificationInput = {
  skillId: string;
  decision: "verified";
  reason: string;
  requestId: string;
};

type SkillVerificationResult =
  | { outcome: "success"; skillId: string; verificationStatus: "verified" }
  | { outcome: "failure"; error: "not_found" };

export type SkillVerificationDependencies = {
  loadSession: () => Promise<SkillVerificationSession | null>;
  verifySkill: (input: SkillVerificationInput) => Promise<SkillVerificationResult>;
  createRequestId?: () => string;
};

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function parseInput(skillId: string, value: unknown): SkillVerificationInput | null {
  if (!UUID_PATTERN.test(skillId) || !value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const body = value as Record<string, unknown>;
  if (body.decision !== "verified" || typeof body.reason !== "string") return null;
  const reason = body.reason.trim();
  if (reason.length < 1 || reason.length > 500) return null;
  return { skillId, decision: "verified", reason, requestId: "" };
}

function failure(error: unknown) {
  const code = error && typeof error === "object"
    ? (error as { code?: unknown }).code
    : undefined;
  if (code === "42501") return json({ error: "forbidden" }, 403);
  if (code === "P0002") return json({ error: "skill_not_found" }, 404);
  if (typeof code === "string" && code.startsWith("22")) {
    return json({ error: "invalid_request" }, 400);
  }
  return json({ error: "skill_verification_failed" }, 409);
}

export function createSkillVerificationHandler(
  dependencies: SkillVerificationDependencies,
) {
  return async function verifySkill(
    request: Request,
    context: { params: Promise<{ skillId: string }> },
  ) {
    const session = await dependencies.loadSession();
    if (!session) return json({ error: "unauthorized" }, 401);
    if (session.member.status !== "active" || !session.permissionCodes.includes("hr.manage")) {
      return json({ error: "forbidden" }, 403);
    }
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid_request" }, 400);
    }
    const { skillId } = await context.params;
    const input = parseInput(skillId, body);
    if (!input) return json({ error: "invalid_request" }, 400);

    try {
      const verification = await dependencies.verifySkill({
        ...input,
        requestId: dependencies.createRequestId?.() ?? randomUUID(),
      });
      if (verification.outcome === "failure") {
        return json({ error: "skill_not_found" }, 404);
      }
      return json({ verification: {
        skillId: verification.skillId,
        verificationStatus: verification.verificationStatus,
      } });
    } catch (error) {
      return failure(error);
    }
  };
}

export const defaultSkillVerificationDependencies: SkillVerificationDependencies = {
  loadSession: getWorkspaceSession,
  async verifySkill(input) {
    const client = await getSupabaseServerClient();
    const result = await client.rpc("verify_current_employee_skill", {
      skill_public_id: input.skillId,
      decision: input.decision,
      reason: input.reason,
      request_id: input.requestId,
    });
    if (result.error || !result.data || typeof result.data !== "object") {
      throw result.error ?? Object.assign(new Error("skill_verification_failed"), { code: "P0001" });
    }
    const value = result.data as Record<string, unknown>;
    if (value.outcome === "failure" && value.error === "not_found") {
      return { outcome: "failure", error: "not_found" };
    }
    if (value.outcome !== "success" || typeof value.skillId !== "string" || value.verificationStatus !== "verified") {
      throw Object.assign(new Error("skill_verification_failed"), { code: "P0001" });
    }
    return { outcome: "success", skillId: value.skillId, verificationStatus: "verified" };
  },
};
