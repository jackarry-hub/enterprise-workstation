import { getDemoAuthEnv } from "@/features/demo-auth/demo-auth-env";
import { handleDemoLogin } from "@/features/demo-auth/demo-auth-handler";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    return handleDemoLogin(request, getDemoAuthEnv(), {
      secure: process.env.NODE_ENV === "production",
    });
  } catch {
    return Response.json(
      { error: "server_misconfigured" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
