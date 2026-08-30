type OriginEnvironment = Readonly<Record<string, string | undefined>>;

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function configuredOrigin(env: OriginEnvironment) {
  const value = env.NEXT_PUBLIC_APP_URL?.trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash
      ? null
      : parsed.origin;
  } catch {
    return null;
  }
}

export function validateMutationOrigin(
  request: Pick<Request, "method" | "url" | "headers">,
  env: OriginEnvironment = process.env,
) {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return { allowed: true as const };
  const requestOrigin = new URL(request.url).origin;
  const allowedOrigins = new Set([requestOrigin]);
  const configured = configuredOrigin(env);
  if (configured) allowedOrigins.add(configured);
  const origin = request.headers.get("origin")?.trim();
  const fetchSite = request.headers.get("sec-fetch-site")?.trim().toLowerCase();
  if (!origin || origin === "null" || !allowedOrigins.has(origin)) {
    return { allowed: false as const, reason: "origin_rejected" as const };
  }
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "same-site" && fetchSite !== "none") {
    return { allowed: false as const, reason: "fetch_site_rejected" as const };
  }
  return { allowed: true as const };
}

export function requiresBrowserMutationOrigin(pathname: string) {
  if (pathname.startsWith("/api/internal/")) return false;
  if (pathname === "/api/workstation/feishu/webhook") return false;
  if (pathname === "/api/workstation/directory-sync") return false;
  return pathname.startsWith("/api/workstation/")
    || pathname.startsWith("/api/auth/")
    || pathname.startsWith("/api/ai/")
    || pathname.startsWith("/api/demo-auth/");
}
