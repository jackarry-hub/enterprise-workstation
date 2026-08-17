create table public.ai_provider_configs (
  tenant_id uuid not null references public.tenants(public_id) on delete cascade,
  provider text not null default 'deepseek' check (provider = 'deepseek'),
  model_name text not null default 'deepseek-v4-flash'
    check (model_name in ('deepseek-v4-flash', 'deepseek-chat', 'deepseek-reasoner')),
  api_base_url text not null default 'https://api.deepseek.com'
    check (api_base_url = 'https://api.deepseek.com'),
  encrypted_api_key text,
  api_key_iv text,
  key_hint text check (key_hint is null or length(key_hint) = 4),
  updated_at timestamptz not null default now(),
  updated_by uuid not null,
  primary key (tenant_id, provider),
  check (
    (encrypted_api_key is null and api_key_iv is null and key_hint is null)
    or
    (encrypted_api_key is not null and api_key_iv is not null and key_hint is not null)
  )
);

alter table public.ai_provider_configs enable row level security;

revoke all on public.ai_provider_configs from anon;
revoke all on public.ai_provider_configs from authenticated;

comment on table public.ai_provider_configs is
  'Server-only encrypted model provider settings. Access through service role APIs only.';
