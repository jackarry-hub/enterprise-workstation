import { type NextResponse } from "next/server";

import { type SupabaseServerCookieMutation } from "@/lib/supabase/server";

export function attachSupabaseAuthCookies(
  response: NextResponse,
  cookies: SupabaseServerCookieMutation[],
  headers: Record<string, string>,
) {
  for (const cookie of cookies) {
    response.cookies.set(cookie.name, cookie.value, cookie.options);
  }
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== "set-cookie") response.headers.set(name, value);
  }
  return response;
}
