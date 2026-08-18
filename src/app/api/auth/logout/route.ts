import { NextResponse } from "next/server";

import { getSupabaseServerClient } from "@/lib/supabase/server";

export async function POST() {
  try {
    const supabase = await getSupabaseServerClient();
    await supabase.auth.signOut({ scope: "local" });
  } catch {
    // Clearing an absent or expired local session is still a successful logout.
  }
  return NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
