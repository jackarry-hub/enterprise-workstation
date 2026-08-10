import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CookieBridge = {
  getAll(): { name: string; value: string }[];
  setAll(
    cookies: {
      name: string;
      value: string;
      options: {
        httpOnly: boolean;
        maxAge: number;
        path: string;
        sameSite: "lax";
        secure: boolean;
      };
    }[],
  ): void;
};

const dependency = vi.hoisted(() => ({
  createServerClient: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: dependency.createServerClient,
}));

import { updateSupabaseSession } from "@/lib/supabase/middleware";

describe("Supabase middleware client", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_example");
    dependency.createServerClient.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads request cookies, refreshes with getUser, and preserves cookie attributes", async () => {
    dependency.createServerClient.mockImplementation(
      (_url: string, _key: string, options: { cookies: CookieBridge }) => ({
        auth: {
          getUser: async () => {
            const authenticated = options.cookies
              .getAll()
              .some(({ name, value }) => name === "sb-session" && value === "stale");
            options.cookies.setAll([
              {
                name: "sb-session",
                value: "fresh",
                options: {
                  httpOnly: true,
                  maxAge: 7200,
                  path: "/",
                  sameSite: "lax",
                  secure: true,
                },
              },
            ]);
            return {
              data: { user: authenticated ? { id: authUserId } : null },
              error: null,
            };
          },
        },
      }),
    );
    const request = new NextRequest("https://brain.example/tasks", {
      headers: { cookie: "sb-session=stale" },
    });

    const result = await updateSupabaseSession(request);
    const cookie = result.response.cookies.get("sb-session");

    expect(result.subject).toBe(authUserId);
    expect(cookie).toMatchObject({
      value: "fresh",
      httpOnly: true,
      maxAge: 7200,
      path: "/",
      sameSite: "lax",
      secure: true,
    });
  });

  it("treats a failed user refresh as unauthenticated without exposing provider details", async () => {
    dependency.createServerClient.mockImplementation(() => ({
      auth: {
        getUser: async () => ({
          data: { user: null },
          error: { message: "provider token detail must stay private" },
        }),
      },
    }));

    const result = await updateSupabaseSession(
      new NextRequest("https://brain.example/tasks"),
    );

    expect(result.subject).toBeNull();
    expect(JSON.stringify(result)).not.toContain("provider token detail");
  });

  it("keeps the refresh boundary safe when user verification throws", async () => {
    dependency.createServerClient.mockImplementation(() => ({
      auth: {
        getUser: async () => {
          throw new Error("provider transport detail must stay private");
        },
      },
    }));

    const result = await updateSupabaseSession(
      new NextRequest("https://brain.example/tasks"),
    );

    expect(result.subject).toBeNull();
    expect(JSON.stringify(result)).not.toContain("provider transport detail");
  });
});

const authUserId = "10000000-0000-4000-8000-000000000001";
