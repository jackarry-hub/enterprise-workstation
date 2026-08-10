import { isPublicAuthPath, getSafeReturnPath, parseWorkspaceAccess } from "@/features/auth/workspace-access";
import { getSupabaseServerClient } from "@/lib/supabase/server";

export type IdentityClaimResult =
  | "unauthenticated"
  | "invalid_identity"
  | "not_provisioned"
  | "identity_conflict"
  | "revoked"
  | "suspended"
  | "departed"
  | "active";

type PublicAccessReason =
  | "not_provisioned"
  | "suspended"
  | "revoked"
  | "departed"
  | "identity_error"
  | "auth_error"
  | "configuration_error";

export type AuthCallbackDependencies = {
  exchangeCode: (code: string) => Promise<boolean>;
  claimIdentity: () => Promise<unknown>;
  loadSession: () => Promise<{ landingPath: string } | null>;
  signOut: () => Promise<void>;
};

const publicClaimReasons: Partial<
  Record<IdentityClaimResult, PublicAccessReason>
> = {
  unauthenticated: "auth_error",
  invalid_identity: "identity_error",
  not_provisioned: "not_provisioned",
  identity_conflict: "identity_error",
  revoked: "revoked",
  suspended: "suspended",
  departed: "departed",
};

function publicReasonForClaim(value: unknown): PublicAccessReason {
  if (
    typeof value !== "string"
    || !Object.prototype.hasOwnProperty.call(publicClaimReasons, value)
  ) {
    return "identity_error";
  }
  return publicClaimReasons[value as IdentityClaimResult] ?? "identity_error";
}

function callbackRedirect(
  url: URL,
  pathname: string,
) {
  return Response.redirect(new URL(pathname, url.origin));
}

async function rejectCallback(
  url: URL,
  reason: PublicAccessReason,
  signOut: () => Promise<void>,
) {
  try {
    await signOut();
  } catch {
    // A fixed status redirect must not expose or be blocked by cleanup errors.
  }
  return callbackRedirect(url, `/access-pending?reason=${reason}`);
}

function safeNextPath(url: URL) {
  const values = url.searchParams.getAll("next");
  if (values.length !== 1) return null;

  const safePath = getSafeReturnPath(values[0]);
  if (!safePath) return null;

  const pathname = new URL(safePath, url.origin).pathname;
  return isPublicAuthPath(pathname) ? null : safePath;
}

async function handleAuthCallback(
  request: Request,
  dependencies: AuthCallbackDependencies,
) {
  const url = new URL(request.url);
  const codes = url.searchParams.getAll("code");
  if (codes.length !== 1 || !codes[0].trim()) {
    return rejectCallback(url, "auth_error", dependencies.signOut);
  }

  try {
    if (!await dependencies.exchangeCode(codes[0])) {
      return rejectCallback(url, "auth_error", dependencies.signOut);
    }

    const claimResult = await dependencies.claimIdentity();
    if (claimResult !== "active") {
      const publicReason = publicReasonForClaim(claimResult);
      return rejectCallback(url, publicReason, dependencies.signOut);
    }

    const session = await dependencies.loadSession();
    if (!session) {
      return rejectCallback(url, "identity_error", dependencies.signOut);
    }

    return callbackRedirect(
      url,
      safeNextPath(url) ?? session.landingPath,
    );
  } catch {
    return rejectCallback(url, "auth_error", dependencies.signOut);
  }
}

async function handleGet(request: Request) {
  let supabase: Awaited<ReturnType<typeof getSupabaseServerClient>>;
  try {
    supabase = await getSupabaseServerClient();
  } catch {
    const url = new URL(request.url);
    return callbackRedirect(
      url,
      "/access-pending?reason=configuration_error",
    );
  }

  return handleAuthCallback(request, {
    exchangeCode: async (code) => {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      return !error;
    },
    claimIdentity: async () => {
      const { data, error } = await supabase.rpc("claim_current_identity");
      if (error || typeof data !== "string") {
        throw new Error("身份确认失败");
      }
      return data;
    },
    loadSession: async () => {
      const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
      if (claimsError) throw new Error("登录状态无效");

      const subject = claimsData?.claims?.sub;
      if (typeof subject !== "string" || !subject) return null;

      const { data, error } = await supabase.rpc("current_workspace_access");
      if (error) throw new Error("工作身份读取失败");

      const session = parseWorkspaceAccess(data);
      return session?.authUserId === subject ? session : null;
    },
    signOut: async () => {
      await supabase.auth.signOut({ scope: "local" });
    },
  });
}

export const GET = Object.assign(handleGet, { handleAuthCallback });
