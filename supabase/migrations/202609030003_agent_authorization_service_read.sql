begin;

-- The server-side Agent authorization path must resolve only the identity,
-- governance and published-version columns it evaluates. Keep browser roles
-- unchanged and do not grant the service role mutation access.
grant select (id, public_id, status)
  on table public.tenants to service_role;
grant select (id, tenant_id, public_id)
  on table public.organizations to service_role;
grant select (id, tenant_id, organization_id, user_id, status)
  on table public.organization_members to service_role;
grant select (
  id, tenant_id, organization_id, organization_member_id,
  department_id, job_level, employment_status, deleted_at
)
  on table public.employee_profiles to service_role;
grant select (id, tenant_id, organization_id, deleted_at)
  on table public.departments to service_role;
grant select (role_id, tenant_id, member_id)
  on table public.member_roles to service_role;
grant select (id, tenant_id, organization_id, code, is_enabled)
  on table public.roles to service_role;
grant select (
  id, tenant_id, organization_id, public_id, status, deleted_at,
  min_job_level, current_version_id, prompt_version, system_prompt,
  model_code, tool_scope
)
  on table public.agent_definitions to service_role;
grant select (tenant_id, organization_id, kill_switch_enabled)
  on table public.agent_runtime_controls to service_role;
grant select (id, tenant_id, organization_id, lifecycle, data_scopes, limits)
  on table public.agent_versions to service_role;
grant select (tenant_id, organization_id, tool_code, enabled)
  on table public.agent_runtime_tool_allowlists to service_role;
grant select (tenant_id, organization_id, data_scope, enabled)
  on table public.agent_runtime_data_allowlists to service_role;
grant select (
  id, tenant_id, organization_id, agent_id, scope_type,
  department_id, role_code, member_id, min_job_level,
  expires_at, revoked_at, deleted_at
)
  on table public.agent_permissions to service_role;

commit;
