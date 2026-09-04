import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

import { getSupabaseEnv } from "@/lib/supabase/env";

export type SupabaseServerCookieMutation = {
  name: string;
  value: string;
  options: CookieOptions;
};

export type SupabaseServerCookieObserver = (
  cookies: SupabaseServerCookieMutation[],
  headers: Record<string, string>,
) => void;

export async function getSupabaseServerClient(options?: {
  onSetAll?: SupabaseServerCookieObserver;
}) {
  const { url, publishableKey } = getSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet, headers) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Middleware owns refresh writes; Server Components can only read cookies.
        }
        options?.onSetAll?.(cookiesToSet, headers);
      },
    },
  });
}

export function getSupabaseServiceRoleClient() {
  const { url } = getSupabaseEnv();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!serviceRoleKey) throw new Error("supabase_service_role_missing");

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
