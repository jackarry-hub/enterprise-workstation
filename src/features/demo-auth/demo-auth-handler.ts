import type { DemoAuthEnv } from "@/features/demo-auth/demo-auth-env";
import { verifyDemoCredentials } from "@/features/demo-auth/demo-auth-env";
import {
  createDemoSessionToken,
  DEMO_SESSION_COOKIE,
  readDemoSessionToken,
  verifyDemoSessionToken,
} from "@/features/demo-auth/demo-session";

type LoginOptions = {
  now?: Date;
  secure?: boolean;
};

const SESSION_SECONDS = 8 * 60 * 60;
const REMEMBERED_SESSION_SECONDS = 30 * 24 * 60 * 60;

export async function handleDemoLogin(
  request: Request,
  env: DemoAuthEnv,
  options: LoginOptions = {},
) {
  const body = await readObject(request);
  const username = typeof body?.username === "string" ? body.username : "";
  const password = typeof body?.password === "string" ? body.password : "";
  const remember = body?.remember === true;

  if (
    username.length > 100
    || password.length > 300
    || !verifyDemoCredentials(username, password, env)
  ) {
    return json({ error: "invalid_credentials" }, 401);
  }

  const now = options.now ?? new Date();
  const token = await createDemoSessionToken(env, remember, now);
  const maxAge = remember ? REMEMBERED_SESSION_SECONDS : SESSION_SECONDS;
  const response = json({ authenticated: true });
  response.headers.set(
    "Set-Cookie",
    serializeCookie(token, maxAge, options.secure ?? false),
  );
  return response;
}

export async function handleDemoSession(
  request: Request,
  env: DemoAuthEnv,
  now = new Date(),
) {
  const token = readDemoSessionToken(request.headers.get("cookie"));
  const claims = await verifyDemoSessionToken(token, env, now);
  return json({ authenticated: Boolean(claims) });
}

export function handleDemoLogout(secure = false) {
  const response = json({ authenticated: false });
  response.headers.set("Set-Cookie", serializeCookie("", 0, secure));
  return response;
}

function serializeCookie(value: string, maxAge: number, secure: boolean) {
  return [
    `${DEMO_SESSION_COOKIE}=${value}`,
    "Path=/",
    `Max-Age=${maxAge}`,
    "HttpOnly",
    "SameSite=Lax",
    secure ? "Secure" : "",
  ].filter(Boolean).join("; ");
}

async function readObject(request: Request) {
  try {
    const body: unknown = await request.json();
    return body && typeof body === "object" && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
