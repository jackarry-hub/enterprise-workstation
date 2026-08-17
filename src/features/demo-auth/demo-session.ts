import { createHmac, timingSafeEqual } from "node:crypto";

import type { WorkspaceSession } from "@/features/auth/workspace-session-types";
import type { DemoAuthEnv } from "@/features/demo-auth/demo-auth-env";

export const DEMO_SESSION_COOKIE = "qxy_demo_session";
export const DEMO_AUTH_USER_ID = "90000000-0000-4000-8000-000000000001";

export type DemoSessionClaims = {
  version: 1;
  tenantId: string;
  authUserId: typeof DEMO_AUTH_USER_ID;
  expiresAt: number;
};

const SESSION_SECONDS = 8 * 60 * 60;
const REMEMBERED_SESSION_SECONDS = 30 * 24 * 60 * 60;

export async function createDemoSessionToken(
  env: DemoAuthEnv,
  remember: boolean,
  now = new Date(),
) {
  const claims: DemoSessionClaims = {
    version: 1,
    tenantId: env.tenantId,
    authUserId: DEMO_AUTH_USER_ID,
    expiresAt: Math.floor(now.getTime() / 1000)
      + (remember ? REMEMBERED_SESSION_SECONDS : SESSION_SECONDS),
  };
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString("base64url");
  return `${payload}.${sign(payload, env.signingKey)}`;
}

export async function verifyDemoSessionToken(
  token: string | null | undefined,
  env: DemoAuthEnv,
  now = new Date(),
): Promise<DemoSessionClaims | null> {
  if (!token || token.length > 2048) return null;
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;

  const expected = Buffer.from(sign(parts[0], env.signingKey), "utf8");
  const actual = Buffer.from(parts[1], "utf8");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return null;
  }

  try {
    const value: unknown = JSON.parse(
      Buffer.from(parts[0], "base64url").toString("utf8"),
    );
    if (!isClaims(value)) return null;
    if (value.tenantId !== env.tenantId || value.authUserId !== DEMO_AUTH_USER_ID) {
      return null;
    }
    if (value.expiresAt <= Math.floor(now.getTime() / 1000)) return null;
    return value;
  } catch {
    return null;
  }
}

export function createDemoWorkspaceSession(
  claims: DemoSessionClaims,
): WorkspaceSession {
  return {
    tenantId: claims.tenantId,
    authUserId: claims.authUserId,
    identity: {
      providerCode: "demo",
      authProvider: "custom:demo",
      providerSubject: "quantxy-demo-admin",
    },
    organization: { id: claims.tenantId, name: "量子星河" },
    member: {
      id: 1,
      employeeProfileId: "90000000-0000-4000-8000-000000000002",
      status: "active",
    },
    profile: {
      displayName: "演示管理员",
      avatarUrl: null,
      departmentName: "总经办",
      jobTitle: "企业决策人",
      skills: ["strategy"],
    },
    roleCodes: ["owner", "admin"],
    permissionCodes: ["dashboard.read", "organization.manage"],
    primaryRole: "executive",
    landingPath: "/dashboard",
    isAdmin: true,
    actor: {
      id: claims.authUserId,
      memberId: "1",
      name: "演示管理员",
      role: "executive",
      roleLabel: "CEO",
      department: "总经办",
      title: "企业决策人",
      landingPath: "/dashboard",
    },
  };
}

export function readDemoSessionToken(cookieHeader: string | null | undefined) {
  if (!cookieHeader || cookieHeader.length > 8192) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const name = part.slice(0, separator).trim();
    if (name === DEMO_SESSION_COOKIE) {
      return part.slice(separator + 1).trim() || null;
    }
  }
  return null;
}

function sign(payload: string, key: Uint8Array) {
  return createHmac("sha256", key).update(payload, "utf8").digest("base64url");
}

function isClaims(value: unknown): value is DemoSessionClaims {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const claims = value as Record<string, unknown>;
  return claims.version === 1
    && typeof claims.tenantId === "string"
    && claims.authUserId === DEMO_AUTH_USER_ID
    && Number.isSafeInteger(claims.expiresAt)
    && (claims.expiresAt as number) > 0;
}
