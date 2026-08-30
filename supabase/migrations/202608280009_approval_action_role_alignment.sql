begin;

insert into public.permissions(code,name,module,action)
values ('approval.act','处理当前审批','approvals','act')
on conflict(code) do update
set name=excluded.name,module=excluded.module,action=excluded.action;

create or replace function public.is_approval_action_baseline_role(
  p_is_system boolean,p_is_enabled boolean,p_organization_id bigint,p_code text
)
returns boolean
language sql
immutable
set search_path=''
as $$
  select coalesce(p_is_system,false) and coalesce(p_is_enabled,false)
    and p_organization_id is null
    and p_code in ('owner','admin','department_head','supervisor','employee','finance','hr');
$$;

create or replace function public.revoke_approval_action_before_role_update()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if public.is_approval_action_baseline_role(
    old.is_system,old.is_enabled,old.organization_id,old.code
  ) then
    delete from public.role_permissions assignment using public.permissions permission
    where assignment.tenant_id=old.tenant_id and assignment.role_id=old.id
      and assignment.permission_id=permission.id and permission.code='approval.act';
  end if;
  return new;
end;
$$;

create or replace function public.grant_approval_action_after_role_change()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if public.is_approval_action_baseline_role(
    new.is_system,new.is_enabled,new.organization_id,new.code
  ) then
    insert into public.role_permissions(tenant_id,role_id,permission_id)
    select new.tenant_id,new.id,permission.id
    from public.permissions permission
    where permission.code='approval.act'
    on conflict do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists roles_approval_action_before_update on public.roles;
drop trigger if exists roles_approval_action_after_insert on public.roles;
drop trigger if exists roles_approval_action_after_update on public.roles;
create trigger roles_approval_action_before_update
before update of tenant_id,is_system,is_enabled,organization_id,code on public.roles
for each row execute function public.revoke_approval_action_before_role_update();
create trigger roles_approval_action_after_insert
after insert on public.roles
for each row execute function public.grant_approval_action_after_role_change();
create trigger roles_approval_action_after_update
after update of tenant_id,is_system,is_enabled,organization_id,code on public.roles
for each row execute function public.grant_approval_action_after_role_change();

insert into public.role_permissions(tenant_id,role_id,permission_id)
select role.tenant_id,role.id,permission.id
from public.roles role cross join public.permissions permission
where permission.code='approval.act'
  and public.is_approval_action_baseline_role(
    role.is_system,role.is_enabled,role.organization_id,role.code
  )
on conflict do nothing;

create or replace function public.current_approval_actor_identity()
returns table(
  tenant_id bigint,organization_id bigint,actor_member_id bigint,actor_auth_user_id uuid,
  actor_employee_id bigint,actor_employee_public_id uuid
)
language plpgsql
volatile
security definer
set search_path=''
as $$
begin
  return query
  select command_identity.tenant_id,command_identity.organization_id,
    command_identity.actor_member_id,command_identity.actor_auth_user_id,
    command_identity.actor_employee_id,command_identity.actor_employee_public_id
  from public.current_approval_command_identity('approval.act') command_identity;
end;
$$;

revoke all on function public.is_approval_action_baseline_role(boolean,boolean,bigint,text)
  from public,anon,authenticated,service_role;
revoke all on function public.revoke_approval_action_before_role_update()
  from public,anon,authenticated,service_role;
revoke all on function public.grant_approval_action_after_role_change()
  from public,anon,authenticated,service_role;
revoke all on function public.current_approval_actor_identity()
  from public,anon,authenticated,service_role;

commit;
