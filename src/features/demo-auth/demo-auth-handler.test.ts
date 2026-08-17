import { describe, expect, it } from "vitest";

import type { DemoAuthEnv } from "@/features/demo-auth/demo-auth-env";
import {
  handleDemoLogin,
  handleDemoLogout,
  handleDemoSession,
} from "@/features/demo-auth/demo-auth-handler";
import { DEMO_SESSION_COOKIE } from "@/features/demo-auth/demo-session";

const env: DemoAuthEnv = {
  username: "admin",
  password: "correct-horse-battery",
  tenantId: "10000000-0000-4000-8000-000000000000",
  signingKey: new Uint8Array(32).fill(5),
};

describe("demo auth handlers", () => {
  it("rejects wrong credentials without reflecting the submitted password", async () => {
    const response = await handleDemoLogin(
      jsonRequest("/api/demo-auth/login", {
        username: "admin",
        password: "must-not-appear-in-response",
        remember: false,
      }),
      env,
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(JSON.stringify(await response.json())).toBe('{"error":"invalid_credentials"}');
  });

  it("issues an HttpOnly cookie that restores a server session", async () => {
    const login = await handleDemoLogin(
      jsonRequest("/api/demo-auth/login", {
        username: "admin",
        password: env.password,
        remember: false,
      }),
      env,
      { now: new Date("2026-08-17T08:00:00.000Z"), secure: false },
    );

    expect(login.status).toBe(200);
    const setCookie = login.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${DEMO_SESSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("Max-Age=28800");
    expect(setCookie).not.toContain(env.password);

    const cookie = setCookie.split(";", 1)[0];
    const restored = await handleDemoSession(
      new Request("https://workspace.test/api/demo-auth/session", {
        headers: { cookie },
      }),
      env,
      new Date("2026-08-17T08:01:00.000Z"),
    );

    expect(await restored.json()).toEqual({ authenticated: true });
  });

  it("clears the session cookie on logout", async () => {
    const response = handleDemoLogout(false);

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});

function jsonRequest(pathname: string, body: unknown) {
  return new Request(`https://workspace.test${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
