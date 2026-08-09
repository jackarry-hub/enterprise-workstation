"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getSupabaseEnv } from "@/lib/supabase/env";

export function getSupabaseBrowserClient() {
  const { url, publishableKey } = getSupabaseEnv();

  return createBrowserClient(url, publishableKey);
}
