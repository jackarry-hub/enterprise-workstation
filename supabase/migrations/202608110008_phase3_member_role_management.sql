create or replace function public.set_current_member_role(
  p_member_id bigint,
  p_role_code text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id bigint := (select public.current_tenant_id());
  v_actor_member_id bigint;
  v_organization_id bigint;
  v_role_id bigint;
begin
  if v_tenant_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if p_member_id is null or p_role_code not in ('admin', 'department_head', 'employee', 'finance', 'hr') then
    raise exception 'Member role input is invalid' using errcode = '22023';
  end if;

  select member.id, member.organization_id
  into v_actor_member_id, v_organization_id
  from public.organization_members member
  where member.tenant_id = v_tenant_id
    and member.user_id = (select auth.uid())
    and member.status = 'active';
  if v_actor_member_id is null or not exists (
    select 1
    from public.member_roles assignment
    join public.roles role
      on role.tenant_id = assignment.tenant_id and role.id = assignment.role_id
    where assignment.tenant_id = v_tenant_id
      and assignment.member_id = v_actor_member_id
      and role.code in ('owner', 'admin')
      and role.is_enabled
  ) then
    raise exception 'Only an owner or administrator can manage roles' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.organization_members member
    where member.tenant_id = v_tenant_id
      and member.organization_id = v_organization_id
      and member.id = p_member_id
      and member.status <> 'suspended'
  ) then
    raise exception 'Target member is unavailable' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.member_roles assignment
    join public.roles role
      on role.tenant_id = assignment.tenant_id and role.id = assignment.role_id
    where assignment.tenant_id = v_tenant_id
      and assignment.member_id = p_member_id
      and role.code = 'owner'
  ) then
    raise exception 'Owner role cannot be changed here' using errcode = '42501';
  end if;

  select role.id into v_role_id
  from public.roles role
  where role.tenant_id = v_tenant_id
    and role.organization_id is null
    and role.code = p_role_code
    and role.is_enabled
  order by role.id
  limit 1;
  if v_role_id is null then
    raise exception 'Requested role is unavailable' using errcode = '22023';
  end if;

  delete from public.member_roles assignment
  using public.roles role
  where assignment.tenant_id = v_tenant_id
    and assignment.member_id = p_member_id
    and role.tenant_id = assignment.tenant_id
    and role.id = assignment.role_id
    and role.code <> 'owner';

  insert into public.member_roles (tenant_id, member_id, role_id, assignment_source)
  values (v_tenant_id, p_member_id, v_role_id, 'manual')
  on conflict (tenant_id, member_id, role_id)
  do update set assignment_source = 'manual';

  return jsonb_build_object('status', 'updated', 'memberId', p_member_id, 'roleCode', p_role_code);
end;
$$;

revoke all on function public.set_current_member_role(bigint, text)
  from public, anon;
grant execute on function public.set_current_member_role(bigint, text)
  to authenticated;
