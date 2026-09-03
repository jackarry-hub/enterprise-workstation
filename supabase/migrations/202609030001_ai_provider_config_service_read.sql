-- The AI configuration endpoint reads the encrypted row only on the server
-- through the Supabase service role, then returns a sanitized public shape.
-- Browser roles remain fully denied.
revoke all on table public.ai_provider_configs from service_role;
grant select on table public.ai_provider_configs to service_role;

revoke all on table public.ai_provider_configs from anon, authenticated;
