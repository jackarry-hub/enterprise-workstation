import { handleDemoLogout } from "@/features/demo-auth/demo-auth-handler";

export const dynamic = "force-dynamic";

export function POST() {
  return handleDemoLogout(process.env.NODE_ENV === "production");
}
