alter function public.bootstrap_first_owner_from_auth_identity(
  uuid, text, text, text, text[]
) rename to bootstrap_first_owner_from_auth_identity_v1;

revoke all on function public.bootstrap_first_owner_from_auth_identity_v1(
  uuid, text, text, text, text[]
) from public, anon, authenticated, service_role;

create or replace function public.bootstrap_first_owner_from_auth_identity(
  p_auth_user_id uuid,
  p_employee_no text,
  p_department_code text,
  p_job_title text,
  p_skills text[]
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_original_auth_sub text := current_setting(
    'request.jwt.claim.sub',
    true
  );
  v_member_id bigint;
begin
  -- Administrative provisioning must not attribute pre-binding trigger events
  -- to a browser user who is not a member yet. The final bootstrap audit event
  -- remains explicitly attributable to p_auth_user_id in the guarded v1 core.
  perform set_config('request.jwt.claim.sub', '', true);

  v_member_id := public.bootstrap_first_owner_from_auth_identity_v1(
    p_auth_user_id,
    p_employee_no,
    p_department_code,
    p_job_title,
    p_skills
  );

  perform set_config(
    'request.jwt.claim.sub',
    coalesce(v_original_auth_sub, ''),
    true
  );
  return v_member_id;
exception
  when others then
    perform set_config(
      'request.jwt.claim.sub',
      coalesce(v_original_auth_sub, ''),
      true
    );
    raise;
end;
$$;

revoke all on function public.bootstrap_first_owner_from_auth_identity(
  uuid, text, text, text, text[]
) from public, anon, authenticated;
grant execute on function public.bootstrap_first_owner_from_auth_identity(
  uuid, text, text, text, text[]
) to service_role;
