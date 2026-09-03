-- These functions intentionally use an empty search_path, but several older
-- definitions call the trusted public.digest wrapper without qualifying it.
-- Keep resolution deterministic by exposing only pg_catalog and the locked
-- public schema to the affected SECURITY DEFINER functions.

revoke create on schema public from public, anon, authenticated, service_role;

alter function public.execute_knowledge_command(text, jsonb, uuid, uuid)
  set search_path = pg_catalog, public;

alter function public.search_current_knowledge(text, integer, uuid)
  set search_path = pg_catalog, public;

alter function public.queue_knowledge_reindex(uuid, uuid, uuid)
  set search_path = pg_catalog, public;

alter function public.complete_knowledge_processing_job(uuid, uuid, boolean, jsonb, text)
  set search_path = pg_catalog, public;

alter function public.enqueue_ai_runtime_job(
  uuid, uuid, bigint, uuid, uuid, text, jsonb, integer, integer,
  timestamptz, integer, text[], bigint, numeric
)
  set search_path = pg_catalog, public;

alter function public.get_feishu_offboarding_proof(text)
  set search_path = pg_catalog, public;

alter function public.task8_legacy_revoke_departed_member_access(uuid, text)
  set search_path = pg_catalog, public;
